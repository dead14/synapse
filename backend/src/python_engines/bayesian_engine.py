"""Alignment engine that matches anomalies by evidence instead of by tolerance.

Everything outside the matching decision is shared with the tolerance-gated
engine: the same canonical feature loading, the same locked girth welds, the
same segmentation, the same fitting pass, the same conservation audit, the same
result schema.  That is deliberate — a second engine that re-implemented data
loading would be a second place for a distance to be read wrongly.

What is *not* shared is the matcher.  This engine overrides exactly one seam,
``match_segment``, and answers the question a different way:

    tolerance-gated:  is this pair inside the window?  cheapest set wins.
    this engine:      how much more likely is this evidence under "same defect"
                      than under "coincidence"?  strongest set wins.

Use it when the girth welds locked but the metal loss did not — the signature
case being a section whose defects are all displaced by several metres, which a
window centred on zero rejects wholesale.  ``bayesian_matcher`` holds the model;
this file only adapts run features into it and reports what came back.

The two engines never write to the same evidence columns.  A cost and a
posterior probability are different claims, and a row carries one or the other.
"""

import sys

from bayesian_matcher import (
    MatcherConfig,
    Observation,
    match_observations,
)
from hungarian_engine import HungarianAnomalyAlignmentEngine

# Monte-Carlo calibration is on by default: the whole point of this engine is to
# be believed on a section where the tolerance-gated one found nothing, and
# "no random section in 200 looked this convincing" is what earns that.  The
# matcher skips it by itself on sections too large for the budget.
DEFAULT_PERMUTATION_TRIALS = 200


def _positive_float(value, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if number > 0 else fallback


def _non_negative_float(value, fallback: float) -> float:
    """Like ``_positive_float`` but keeps a legitimate zero.

    Used for the acceptance threshold, where zero is the meaningful default and
    a negative value would be inert — the solver maximises a sum, so a pair
    scoring below zero always makes its chain worse and is dropped regardless.
    Clamping states that plainly instead of accepting a setting that does
    nothing.
    """
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(number, 0.0)


class BayesianDriftAlignmentEngine(HungarianAnomalyAlignmentEngine):
    """Order-preserving probabilistic matcher for runs that disagree on chainage."""

    MATCH_METHOD = "BAYESIAN_DRIFT"

    def _bayesian_config(self) -> MatcherConfig:
        """Physical priors for this run, from the session's tolerance step.

        None of these values is a gate.  ``ToleranceConfig`` is simply where the
        wizard persists matcher settings, and the gate keys in it (clock,
        length, odometer windows) are ignored here — reading them would quietly
        reintroduce the very windows this engine exists to avoid.
        """
        if getattr(self, "_cached_bayesian_config", None) is not None:
            return self._cached_bayesian_config

        tol_config = self._session_params().get("ToleranceConfig", {}) or {}
        settings = tol_config.get("bayesian", {}) or {}
        defaults = MatcherConfig()

        joint_length = _positive_float(
            settings.get("joint_length_m"),
            _positive_float(
                getattr(self, "median_joint_length_m", None), defaults.joint_length_m,
            ),
        )
        trials = settings.get("permutation_trials", DEFAULT_PERMUTATION_TRIALS)
        try:
            trials = max(0, int(trials))
        except (TypeError, ValueError):
            trials = DEFAULT_PERMUTATION_TRIALS

        config = MatcherConfig(
            drift_bandwidth_m=_positive_float(
                settings.get("drift_bandwidth_m"), defaults.drift_bandwidth_m,
            ),
            max_drift_m=(
                _positive_float(settings.get("max_drift_m"), 0.0) or None
            ),
            min_sigma_m=_positive_float(settings.get("min_sigma_m"), defaults.min_sigma_m),
            max_sigma_m=_positive_float(settings.get("max_sigma_m"), defaults.max_sigma_m),
            weld_sigma_m=_positive_float(settings.get("weld_sigma_m"), defaults.weld_sigma_m),
            joint_length_m=joint_length,
            clock_sigma_deg=_positive_float(
                settings.get("clock_sigma_deg"), defaults.clock_sigma_deg,
            ),
            length_shrink_sigma_mm=_positive_float(
                settings.get("length_shrink_sigma_mm"), defaults.length_shrink_sigma_mm,
            ),
            length_growth_sigma_mm=_positive_float(
                settings.get("length_growth_sigma_mm"), defaults.length_growth_sigma_mm,
            ),
            width_shrink_sigma_mm=_positive_float(
                settings.get("width_shrink_sigma_mm"), defaults.width_shrink_sigma_mm,
            ),
            width_growth_sigma_mm=_positive_float(
                settings.get("width_growth_sigma_mm"), defaults.width_growth_sigma_mm,
            ),
            prior_match_probability=min(max(_positive_float(
                settings.get("prior_match_probability"), defaults.prior_match_probability,
            ), 0.01), 0.99),
            accept_log_bayes_factor=_non_negative_float(
                settings.get("accept_log_bayes_factor"), defaults.accept_log_bayes_factor,
            ),
            allow_scale=settings.get("allow_scale", defaults.allow_scale) is not False,
            permutation_trials=trials,
        )
        self._cached_bayesian_config = config
        return config

    def _observations(self, features: list[dict], positions: list[float]) -> list[Observation]:
        """Adapt segment features into matcher observations, in pipe order.

        The index is the feature's rank within the segment, which is what makes
        the order-preserving solver's "no crossing" constraint mean what it says.
        The caller supplies positions because OLD features are compared on their
        girth-weld-corrected chainage, not their raw one.
        """
        return [
            Observation(
                index=index,
                position=float(position),
                weld_distance=(
                    float(feature["dist_to_us_gw_m"])
                    if feature.get("dist_to_us_gw_m") is not None and self.use_us_gw_distance
                    else None
                ),
                clock_deg=self._clock_to_deg(feature.get("clock_position")),
                length_mm=(
                    float(feature["length_mm"]) if feature.get("length_mm") is not None else None
                ),
                width_mm=(
                    float(feature["width_mm"]) if feature.get("width_mm") is not None else None
                ),
            )
            for index, (feature, position) in enumerate(zip(features, positions))
        ]

    def match_segment(
        self,
        seg_id: int,
        seg_anomalies_1: list[dict],
        seg_anomalies_2: list[dict],
        offset_table: list[tuple[float, float]],
        offset_keys: list[float] | None = None,
        segment_tolerances: dict | None = None,
    ) -> tuple[list[tuple[int, int, dict]], dict]:
        """Pair one segment by evidence.

        ``segment_tolerances`` is accepted so the signature matches the seam, and
        ignored on purpose: a per-section tolerance override is a statement about
        gates, and this matcher has none.  The section's presence still matters —
        it is what bounds the segment — but its numbers do not.
        """
        config = self._bayesian_config()
        if not seg_anomalies_1 or not seg_anomalies_2:
            return [], {
                "segment": seg_id,
                "method": self.MATCH_METHOD,
                "oldCount": len(seg_anomalies_1),
                "newCount": len(seg_anomalies_2),
                "matched": 0,
            }

        # OLD is compared on the axis the locked girth welds already put it on,
        # so the drift this matcher discovers is whatever the locks did *not*
        # explain — the residual slip inside the section.
        corrected_positions = [
            feature["abs_distance_m"] + self._interpolate_offset(
                feature["abs_distance_m"], offset_table, offset_keys,
            )
            for feature in seg_anomalies_1
        ]
        new_positions = [feature["abs_distance_m"] for feature in seg_anomalies_2]

        old_observations = self._observations(seg_anomalies_1, corrected_positions)
        new_observations = self._observations(seg_anomalies_2, new_positions)

        outcome = match_observations(old_observations, new_observations, config)
        drift = outcome.drift

        drift_summary = {
            "shiftM": drift.shift_m if drift else 0.0,
            "scale": drift.scale if drift else 1.0,
            "scaleApplied": drift.scale_applied if drift else False,
            "sigmaM": drift.sigma_m if drift else None,
            "support": drift.support if drift else 0,
            "voteCandidates": drift.candidates if drift else 0,
            "bandwidthM": drift.bandwidth_m if drift else None,
        }
        if drift and abs(drift.shift_m) > 0:
            print(
                f"      [Bayesian] Segment {seg_id}: residual drift {drift.shift_m:+.3f} m "
                f"(sigma {drift.sigma_m:.3f} m, {drift.support} supporting defect(s)), "
                f"{len(outcome.pairs)} pair(s) accepted",
                file=sys.stderr,
            )

        accepted: list[tuple[int, int, dict]] = []
        for pair in outcome.pairs:
            accepted.append((pair["old_index"], pair["new_index"], {
                "method": self.MATCH_METHOD,
                "objective": "maximum total log Bayes factor, no crossing",
                "segment": seg_id,
                "logBayesFactor": pair["log_bayes_factor"],
                "posterior": pair.get("posterior"),
                "oldSidePosterior": pair.get("oldSidePosterior"),
                "newSidePosterior": pair.get("newSidePosterior"),
                "rivals": {
                    "old": pair.get("oldSideRivals", 0),
                    "new": pair.get("newSideRivals", 0),
                },
                "residualM": pair["residual_m"],
                "channels": pair["channels"],
                "drift": drift_summary,
                "prior": {
                    "matchProbability": config.prior_match_probability,
                    "logOdds": config.log_prior_odds(),
                },
                "acceptThresholdLogBayesFactor": config.accept_log_bayes_factor,
                "sectionPValue": outcome.permutation_p_value,
                "sectionPermutationTrials": outcome.permutation_trials,
            }))

        audit = {
            "segment": seg_id,
            "method": self.MATCH_METHOD,
            "oldCount": len(seg_anomalies_1),
            "newCount": len(seg_anomalies_2),
            "candidatesConsidered": outcome.candidates_considered,
            "matched": len(accepted),
            "drift": drift_summary,
            "totalLogBayesFactor": outcome.total_log_bayes_factor,
            "permutationTrials": outcome.permutation_trials,
            "permutationPValue": outcome.permutation_p_value,
            "notes": outcome.notes,
        }
        return accepted, audit

    def _matcher_audit(self) -> dict:
        """This matcher's own configuration — no gate values, because it has none."""
        config = self._bayesian_config()
        return {
            "model": {
                "driftBandwidthM": config.drift_bandwidth_m,
                "searchSigmas": config.search_sigmas,
                "minSigmaM": config.min_sigma_m,
                "maxSigmaM": config.max_sigma_m,
                "weldSigmaM": config.weld_sigma_m,
                "jointLengthM": config.joint_length_m,
                "clockSigmaDeg": config.clock_sigma_deg,
                "lengthShrinkSigmaMm": config.length_shrink_sigma_mm,
                "lengthGrowthSigmaMm": config.length_growth_sigma_mm,
                "widthShrinkSigmaMm": config.width_shrink_sigma_mm,
                "widthGrowthSigmaMm": config.width_growth_sigma_mm,
                "allowScale": config.allow_scale,
            },
            "decision": {
                "priorMatchProbability": config.prior_match_probability,
                "acceptLogBayesFactor": config.accept_log_bayes_factor,
                "permutationTrials": config.permutation_trials,
                "permutationSeed": config.permutation_seed,
            },
            "excludedEvidence": [
                "depth — it is the growth measurement this alignment produces, "
                "so using it to choose pairs would make the result circular",
            ],
        }


def main(argv=None):
    argv = sys.argv if argv is None else argv
    session_id = int(argv[1]) if len(argv) > 1 else None

    if not session_id:
        print("[ERROR] No session_id provided", file=sys.stderr)
        return 1

    engine = BayesianDriftAlignmentEngine(session_id=session_id, distance_tolerance_m=0.5)
    try:
        engine.perform_alignment()
    except Exception as error:
        import traceback

        traceback.print_exc(file=sys.stderr)
        print(f"[ERROR] Bayesian alignment failed: {error}", file=sys.stderr)
        return 1
    finally:
        engine.session.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
