"""aurora_engine.py — worker wrapper for the AURORA-ILI universal strategy.

Reads an alignment session, hands the canonical records to ``engine.aurora``,
and emits the same bucket contract every other strategy emits so the Node layer
normalises them identically.  The stage artifacts AURORA produces — capability
profile, anchor map, persistent joints, transform field, rescue cases, review
queue — travel inside ``audit.aurora``, because ``normalizeComparisonResult``
flattens every *top-level array* into the comparison table and an artifact list
would otherwise turn into result rows.

Usage:
    python aurora_engine.py <session_id>

Environment:
    DATABASE_URL              PostgreSQL connection string
    ALIGNMENT_RESULT_FILE     optional path to write the JSON result to
    ALIGNMENT_PAIR_CONFIG_FILE  optional per-pair configuration override
"""

from __future__ import annotations

import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", ".."))
sys.path.insert(0, os.path.dirname(__file__))

from hungarian_engine import (  # noqa: E402  (path set up above)
    CLUSTER_BYPASS_REASON,
    HungarianAnomalyAlignmentEngine,
)

from engine.aurora import run_aurora_alignment  # noqa: E402
from engine.aurora.canonical import GIRTH_WELD, TEE_OFFTAKE, VALVE  # noqa: E402
from engine.aurora.orchestrator import (  # noqa: E402
    STATE_FAILED_INPUT,
    STATE_INSUFFICIENT_EVIDENCE,
)
from engine.aurora.reid import (  # noqa: E402
    MANY_TO_MANY_REGION,
    MISSING_OR_UNDETECTED,
    NEW_OR_PREVIOUSLY_UNDETECTED,
)

# Anchor classes a missing partner is genuine missing evidence for.  Everything
# else — bends, flanges, markers, supports — is pipe furniture whose absence
# from one report is routine, so an unpaired one is conserved as a bypass row
# rather than being reported as a phantom missing girth weld.
_MISSING_EVIDENCE_CLASSES = frozenset({GIRTH_WELD, VALVE, TEE_OFFTAKE})

_EMPTY = "-"

# Names the method that produced each row, alongside HUNGARIAN and
# BAYESIAN_DRIFT.  Kept in step with MATCH_METHOD_LABELS in
# frontend/src/utils/alignmentDisplay.ts.
MATCH_METHOD = "AURORA_ILI"


def _value(record: dict | None, *keys):
    if not record:
        return _EMPTY
    for key in keys:
        if key in record and record[key] not in (None, ""):
            return record[key]
        raw = record.get("raw") or {}
        if key in raw and raw[key] not in (None, ""):
            return raw[key]
    return _EMPTY


class AuroraRowBuilder:
    """Builds result rows in the shape every downstream consumer already reads.

    The column set mirrors ``hungarian_engine``'s so the results table, the
    Excel export, the corrosion review and the FFS intake need no strategy
    branch.  AURORA's own evidence is added as extra columns rather than by
    changing any existing one.
    """

    def __init__(self, engine: HungarianAnomalyAlignmentEngine):
        self.engine = engine
        self.year_span = engine._growth_year_span()

    def build(
        self,
        old_record: dict | None,
        new_record: dict | None,
        status: str,
        result_group: str,
        bypass_reason: str = _EMPTY,
        aurora: dict | None = None,
    ) -> dict:
        physics_warnings = self.engine._physics_warnings(old_record, new_record)
        depth_growth, length_growth = self._growth(old_record, new_record)
        odo_diff = None
        if old_record and new_record:
            odo_diff = round(
                float(new_record["abs_distance_m"]) - float(old_record["abs_distance_m"]), 4
            )

        if bypass_reason == _EMPTY and any(
            record and HungarianAnomalyAlignmentEngine._is_cluster_feature(record)
            for record in (old_record, new_record)
        ):
            bypass_reason = CLUSTER_BYPASS_REASON

        row = {
            "session_id": self.engine.session_id,
            "feature_old_id": _safe_int(old_record.get("id")) if old_record else None,
            "feature_new_id": _safe_int(new_record.get("id")) if new_record else None,
            "match_status": status,
            "Match/Unmatch": status,
            "Result Group": result_group,
            "Bypass Reason": bypass_reason,
            "Run Year OLD": self.engine.run_1_year,
            "Run Year NEW": self.engine.run_2_year,
            "Growth Interval (y)": self.year_span if self.year_span is not None else _EMPTY,
            "Physics Warning": ", ".join(w["code"] for w in physics_warnings) or _EMPTY,
            "physics_warnings": physics_warnings,
            "Depth Growth (%WT/yr)": depth_growth if depth_growth is not None else _EMPTY,
            "Length Growth (mm/yr)": length_growth if length_growth is not None else _EMPTY,
            "Source Key OLD": old_record.get("source_key") if old_record else _EMPTY,
            "Source Key NEW": new_record.get("source_key") if new_record else _EMPTY,
            "Section": _EMPTY,
            "Section ID": _EMPTY,
            "Section OLD": _EMPTY,
            "Section NEW": _EMPTY,
            "odo_diff": odo_diff,
            "Identif. OLD": old_record.get("id") if old_record else _EMPTY,
            "Identif. NEW": new_record.get("id") if new_record else _EMPTY,
            "Feature ID OLD": old_record.get("id") if old_record else _EMPTY,
            "Feature ID NEW": new_record.get("id") if new_record else _EMPTY,
            **HungarianAnomalyAlignmentEngine._result_distance_fields(
                old_record, new_record
            ),
            "Joint No. OLD": _value(old_record, "joint_number"),
            "Joint No. NEW": _value(new_record, "joint_number"),
            "Dist GW OLD (m)": _value(old_record, "dist_to_us_gw_m"),
            "Dist GW NEW (m)": _value(new_record, "dist_to_us_gw_m"),
            "Joint Len OLD (m)": _value(old_record, "joint_length_m"),
            "Joint Len NEW (m)": _value(new_record, "joint_length_m"),
            "Feature Type OLD": _value(old_record, "originalType", "feature_type"),
            "Feature Type NEW": _value(new_record, "originalType", "feature_type"),
            "Feature Identification OLD": _value(old_record, "feature_identification"),
            "Feature Identification NEW": _value(new_record, "feature_identification"),
            "Dim Classification OLD": _value(old_record, "dim_classification"),
            "Dim Classification NEW": _value(new_record, "dim_classification"),
            "Wall WT OLD (mm)": _value(old_record, "wall_thickness_mm"),
            "Wall WT NEW (mm)": _value(new_record, "wall_thickness_mm"),
            "Depth OLD (%WT)": _value(old_record, "depth_pct"),
            "Depth NEW (%WT)": _value(new_record, "depth_pct"),
            "Length OLD (mm)": _value(old_record, "length_mm"),
            "Length NEW (mm)": _value(new_record, "length_mm"),
            "Width OLD (mm)": _value(old_record, "width_mm"),
            "Width NEW (mm)": _value(new_record, "width_mm"),
            "O'Clock OLD": _value(old_record, "clock_position"),
            "O'Clock NEW": _value(new_record, "clock_position"),
            "Surface OLD": _value(old_record, "surface_location"),
            "Surface NEW": _value(new_record, "surface_location"),
            "ERF ASME OLD": _value(old_record, "erf_asme"),
            "ERF ASME NEW": _value(new_record, "erf_asme"),
            "Psafe OLD (bar)": _value(old_record, "psafe_bar"),
            "Psafe NEW (bar)": _value(new_record, "psafe_bar"),
            "Comment OLD": _value(old_record, "comment"),
            "Comment NEW": _value(new_record, "comment"),
        }
        row.update(self._match_method_columns(aurora))
        row.update(self._aurora_columns(aurora))
        return row

    @staticmethod
    def _match_method_columns(aurora: dict | None) -> dict:
        """The shared match-evidence columns, filled in AURORA's own terms.

        The schema is stable across matchers so the table has one shape, but a
        row never carries a value in a column that means nothing for it: AURORA
        has no tolerance cost and no Bayes factor, and putting a number under
        either heading would invite reading it as the quantity that heading
        names.  ``match_evidence`` is deliberately absent — the drawer renders
        either a cost breakdown or a posterior breakdown, and AURORA's evidence
        is neither.  Its explanation lives in the AURORA columns and in the
        registration evidence panel.
        """
        probability = (aurora or {}).get("probability")
        return {
            "Match Method": MATCH_METHOD if aurora else _EMPTY,
            "Match Cost": _EMPTY,
            "Match Confidence (%)": (
                round(float(probability) * 100.0, 2)
                if isinstance(probability, (int, float)) else _EMPTY
            ),
            "Match Log Bayes Factor": _EMPTY,
        }

    @staticmethod
    def _aurora_columns(aurora: dict | None) -> dict:
        aurora = aurora or {}
        return {
            "AURORA Group ID": aurora.get("groupId", _EMPTY),
            "AURORA Match Type": aurora.get("matchType", _EMPTY),
            "AURORA PJID": aurora.get("pjid", _EMPTY),
            "AURORA Confidence Class": aurora.get("confidenceClass", _EMPTY),
            "AURORA P(match)": aurora.get("probability", _EMPTY),
            "AURORA Evidence Score": aurora.get("rawScore", _EMPTY),
            "AURORA Ambiguity Margin": aurora.get("ambiguityMargin", _EMPTY),
            "AURORA Region Confidence": aurora.get("regionConfidence", _EMPTY),
            "AURORA Feature Confidence": aurora.get("featureConfidence", _EMPTY),
            "AURORA Axial Residual (m)": aurora.get("axialResidualM", _EMPTY),
            "AURORA Clock Residual (deg)": aurora.get("clockResidualDeg", _EMPTY),
            "AURORA Rescue Mode": aurora.get("rescueMode", _EMPTY),
            "AURORA Explanation": aurora.get("explanation", _EMPTY),
        }

    def _growth(self, old_record: dict | None, new_record: dict | None):
        if not (old_record and new_record and self.year_span and self.year_span > 0):
            return None, None
        depth_growth = None
        length_growth = None
        if old_record.get("depth_pct") is not None and new_record.get("depth_pct") is not None:
            depth_growth = (
                float(new_record["depth_pct"]) - float(old_record["depth_pct"])
            ) / self.year_span
        if old_record.get("length_mm") is not None and new_record.get("length_mm") is not None:
            length_growth = (
                float(new_record["length_mm"]) - float(old_record["length_mm"])
            ) / self.year_span
        return depth_growth, length_growth


def _safe_int(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def _group_columns(group, index: int, member_index: int, member_total: int) -> dict:
    """Per-row AURORA evidence for one member of one match group.

    A split or merge produces several rows that describe one physical
    correspondence, so every row carries the same group id and type; the member
    index says which part of the group it is.
    """
    return {
        "groupId": f"MG-{index:06d}",
        "matchType": (
            f"{group.group_type} [{member_index + 1}/{member_total}]"
            if member_total > 1 else group.group_type
        ),
        "pjid": group.pjid or _EMPTY,
        "confidenceClass": group.confidence_class,
        "probability": round(group.probability, 4),
        "rawScore": round(group.raw_score, 4),
        "ambiguityMargin": round(group.ambiguity_margin, 4),
        "regionConfidence": round(group.region_confidence, 4),
        "featureConfidence": round(group.feature_confidence, 4),
        "axialResidualM": (
            round(group.axial_residual_m, 4)
            if group.axial_residual_m is not None else _EMPTY
        ),
        "clockResidualDeg": (
            round(math.degrees(group.clock_residual_rad), 2)
            if group.clock_residual_rad is not None else _EMPTY
        ),
        "rescueMode": group.rescue_mode or _EMPTY,
        "explanation": "; ".join(group.explanation) if group.explanation else _EMPTY,
    }


def build_aurora_output(
    engine: HungarianAnomalyAlignmentEngine,
    old_features: list[dict],
    new_features: list[dict],
    config_overrides: dict | None = None,
    pipeline_key: str = "pipeline",
    pair_label: str | None = None,
) -> dict:
    """Run AURORA over two loaded runs and shape the result into buckets."""
    HungarianAnomalyAlignmentEngine._ensure_source_keys(old_features, "OLD")
    HungarianAnomalyAlignmentEngine._ensure_source_keys(new_features, "NEW")

    eligible_old, filtered_old = engine._partition_scenario_features(old_features)
    eligible_new, filtered_new = engine._partition_scenario_features(new_features)

    result = run_aurora_alignment(
        eligible_old,
        eligible_new,
        old_run=getattr(engine, "_run_1_meta", {}),
        new_run=getattr(engine, "_run_2_meta", {}),
        pipeline_key=pipeline_key,
        config_overrides=config_overrides,
    )

    builder = AuroraRowBuilder(engine)
    output = {
        "gw_locked": [],
        "gw_unmatched": [],
        "fitting_matched": [],
        "anomaly_matched": [],
        "anomaly_only_old": [],
        "anomaly_only_new": [],
        "bypassed_old": [],
        "bypassed_new": [],
        "filtered_old": [],
        "filtered_new": [],
    }

    # --- structural evidence ---------------------------------------------
    for pair in result.anchor_pairs:
        aurora = {
            "matchType": "STRUCTURAL_ANCHOR",
            "confidenceClass": "AUTO_MATCH",
            "probability": round(pair.similarity, 4),
            "explanation": f"{pair.anchor_type} registered by monotonic sequence alignment",
        }
        bucket = "gw_locked" if pair.anchor_type == GIRTH_WELD else "fitting_matched"
        output[bucket].append(builder.build(
            pair.old_feature.raw, pair.new_feature.raw, "Matched",
            "GW" if bucket == "gw_locked" else "FITTING",
            aurora=aurora,
        ))

    for feature in result.unmatched_anchors_old:
        if feature.feature_class in _MISSING_EVIDENCE_CLASSES:
            output["gw_unmatched"].append(builder.build(
                feature.raw, None, "ONLY_OLD", "GW",
                aurora={"matchType": "STRUCTURAL_GAP"},
            ))
        else:
            output["bypassed_old"].append(builder.build(
                feature.raw, None, "Bypassed OLD", "BYPASSED",
                bypass_reason="Pipe furniture with no counterpart in the new run",
            ))
    for feature in result.unmatched_anchors_new:
        if feature.feature_class in _MISSING_EVIDENCE_CLASSES:
            output["gw_unmatched"].append(builder.build(
                None, feature.raw, "ONLY_NEW", "GW",
                aurora={"matchType": "STRUCTURAL_INSERTION"},
            ))
        else:
            output["bypassed_new"].append(builder.build(
                None, feature.raw, "Bypassed NEW", "BYPASSED",
                bypass_reason="Pipe furniture with no counterpart in the old run",
            ))

    # --- match groups -----------------------------------------------------
    for index, group in enumerate(result.groups):
        old_records = [point.feature.raw for point in group.old_members]
        new_records = [point.feature.raw for point in group.new_members]

        if group.group_type == MISSING_OR_UNDETECTED:
            for record in old_records:
                output["anomaly_only_old"].append(builder.build(
                    record, None, "Only OLD", "ANOMALY",
                    aurora=_group_columns(group, index, 0, 1),
                ))
            continue
        if group.group_type == NEW_OR_PREVIOUSLY_UNDETECTED:
            for record in new_records:
                output["anomaly_only_new"].append(builder.build(
                    None, record, "Only NEW", "ANOMALY",
                    aurora=_group_columns(group, index, 0, 1),
                ))
            continue

        # A group of unequal cardinality emits one row per member of its larger
        # side.  Every source key still appears exactly once, which is what the
        # conservation audit checks, and the shared group id is what ties the
        # rows back together as one physical correspondence.
        members = max(len(old_records), len(new_records))
        for member_index in range(members):
            old_record = old_records[member_index] if member_index < len(old_records) else None
            new_record = new_records[member_index] if member_index < len(new_records) else None
            status = "Matched"
            if group.group_type == MANY_TO_MANY_REGION:
                # The region corresponds; the individual box mapping does not.
                # Saying "Matched" here would put an identity claim into the
                # record that the evidence does not support.
                status = "Region only"
            output["anomaly_matched"].append(builder.build(
                old_record, new_record, status, "ANOMALY",
                aurora=_group_columns(group, index, member_index, members),
            ))

    # --- conserved, not aligned ------------------------------------------
    for feature, reason in result.bypassed_old:
        output["bypassed_old"].append(builder.build(
            feature.raw, None, "Bypassed OLD", "BYPASSED", bypass_reason=reason,
        ))
    for feature, reason in result.bypassed_new:
        output["bypassed_new"].append(builder.build(
            None, feature.raw, "Bypassed NEW", "BYPASSED", bypass_reason=reason,
        ))
    for record in filtered_old:
        output["filtered_old"].append(builder.build(
            record, None, "Filtered OLD", "FILTERED",
            bypass_reason=str(record.get("filter_reason") or "Excluded from matching"),
        ))
    for record in filtered_new:
        output["filtered_new"].append(builder.build(
            None, record, "Filtered NEW", "FILTERED",
            bypass_reason=str(record.get("filter_reason") or "Excluded from matching"),
        ))

    rows = [row for bucket in output.values() for row in bucket]
    audit = HungarianAnomalyAlignmentEngine._build_conservation_audit(
        old_features, new_features, rows,
    )
    audit["warnings"] = (
        engine._missing_survey_year_warnings() + result.warnings
    )
    artifacts = result.artifacts()
    # A chain run merges one audit per pair, so the artifacts have to name the
    # comparison they came from or the evidence panel cannot say which pair a
    # transform field belongs to.
    artifacts["summary"]["pairLabel"] = pair_label or (
        f"{engine.run_1_year or '?'} → {engine.run_2_year or '?'}"
    )
    audit["aurora"] = artifacts
    output["audit"] = audit

    if result.state in (STATE_FAILED_INPUT, STATE_INSUFFICIENT_EVIDENCE):
        # The rows are still conserved and still exported; what is withheld is
        # the identity claim, which is the correct answer when the physical
        # evidence does not support one.
        print(
            f"[WARN] AURORA finished in {result.state}: {result.failure_reason}",
            file=sys.stderr,
        )
    return output


def _write_result(output: dict) -> None:
    result_path = os.environ.get("ALIGNMENT_RESULT_FILE")
    if result_path:
        with open(result_path, "w", encoding="utf-8") as handle:
            json.dump(output, handle)
        print(f"___RESULT_FILE___{result_path}")
    else:
        print("___RESULT_JSON_BEGIN___")
        print(json.dumps(output))
        print("___RESULT_JSON_END___")


def _force_utf8_io():
    """Never let the locale codepage decide how the result is encoded."""
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def main(argv=None) -> int:
    argv = sys.argv if argv is None else argv
    if len(argv) < 2:
        print("[ERROR] No session_id provided", file=sys.stderr)
        return 1

    engine = HungarianAnomalyAlignmentEngine(int(argv[1]))
    try:
        params = engine._session_params()
        old_features = engine.fetch_data(is_old_run=True)
        new_features = engine.fetch_data(is_old_run=False)
        output = build_aurora_output(
            engine,
            old_features,
            new_features,
            config_overrides=params.get("auroraConfig"),
            # Left to the survey-year fallback: a chain run rebinds the session
            # to one pair at a time, so the two years already name this pair,
            # and they read better than the internal run-id key.

            pipeline_key=str(
                (engine._get_session().pipeline_id if engine._get_session() else None)
                or "pipeline"
            ),
        )
        _write_result(output)
        summary = output["audit"]["aurora"]["summary"]
        print(
            f"[DONE] AURORA {summary['mode']} — {summary['matchGroups']} groups, "
            f"{summary['autoAccepted']} auto-accepted, "
            f"{summary['rescueAccepted']}/{summary['rescueAttempts']} rescues accepted"
        )
        return 0
    except Exception as error:  # noqa: BLE001 - reported, then re-raised as exit 1
        import traceback

        traceback.print_exc(file=sys.stderr)
        print(f"[ERROR] AURORA alignment failed: {error}", file=sys.stderr)
        return 1
    finally:
        engine.session.close()


if __name__ == "__main__":
    _force_utf8_io()
    sys.exit(main())
