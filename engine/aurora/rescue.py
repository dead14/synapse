"""AURORA-PCR — Pattern-Constrained Re-identification (sections 16.2, 25.10).

Pattern Rescue answers one specific failure: the pairwise matcher returns few
or zero matches even though the two corrosion populations plainly describe the
same physical area after a systematic local transformation.

The subsystem estimates the transformation first.  It never enlarges the raw
tolerance — a raw two-hour clock difference becomes a two-degree residual only
because the whole local constellation independently voted for a two-hour
coordinate rotation, and if it did not, the region stays unresolved.

The search is bounded by the structural map at all times.  A numerically
beautiful pattern outside the registered corridor is not a candidate, however
high it scores.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field

import numpy as np

from .canonical import wrap
from .config import PatternConfig, RescueConfig
from .pattern import (
    PatternPoint,
    density_correlation,
    density_map,
    descriptor_similarity,
    neighbour_descriptors,
)

STATUS_ACCEPTED = "ACCEPTED"
STATUS_AMBIGUOUS = "AMBIGUOUS_TRANSFORM"
STATUS_NO_CONSENSUS = "NO_COHERENT_TRANSFORM"
STATUS_NOT_ELIGIBLE = "NOT_ELIGIBLE"
STATUS_TOO_LITTLE_EVIDENCE = "INSUFFICIENT_INFORMATION"


@dataclass
class TransformHypothesis:
    axial_shift_u: float
    clock_rotation_rad: float
    support: float
    source: str = "MOTIF_VOTE"

    def to_dict(self) -> dict:
        return {
            "axialShiftU": round(self.axial_shift_u, 5),
            "clockRotationDeg": round(math.degrees(wrap(self.clock_rotation_rad)), 2),
            "support": round(self.support, 3),
            "source": self.source,
        }


@dataclass
class RescueCase:
    """The stored evidence for one rescue attempt (section 27, table row)."""

    pjid: str
    trigger_reason: str
    status: str
    source_points: int
    target_points: int
    axial_shift_u: float = 0.0
    clock_rotation_rad: float = 0.0
    clock_shear_rad_per_u: float = 0.0
    inliers: int = 0
    inlier_fraction: float = 0.0
    best_score: float = 0.0
    second_score: float = 0.0
    ambiguity: float = 0.0
    region_correlation: float = 0.0
    axial_sigma_u: float | None = None
    clock_sigma_rad: float | None = None
    hypotheses: list[TransformHypothesis] = field(default_factory=list)

    @property
    def accepted(self) -> bool:
        return self.status == STATUS_ACCEPTED

    def to_dict(self) -> dict:
        return {
            "pjid": self.pjid,
            "triggerReason": self.trigger_reason,
            "status": self.status,
            "sourcePoints": self.source_points,
            "targetPoints": self.target_points,
            "axialShiftU": round(self.axial_shift_u, 5),
            "clockRotationDeg": round(math.degrees(wrap(self.clock_rotation_rad)), 2),
            "clockRotationHours": round(wrap(self.clock_rotation_rad) * 6.0 / math.pi, 2),
            "clockShearDegPerU": round(math.degrees(self.clock_shear_rad_per_u), 2),
            "inliers": self.inliers,
            "inlierFraction": round(self.inlier_fraction, 4),
            "bestScore": round(self.best_score, 4),
            "secondScore": round(self.second_score, 4),
            "ambiguity": round(self.ambiguity, 4),
            "regionCorrelation": round(self.region_correlation, 4),
            "hypotheses": [h.to_dict() for h in self.hypotheses[:5]],
        }


def direct_match_health(
    high_confidence: int, source_count: int, target_count: int
) -> float:
    """``H_direct = N_high_confidence / max(1, min(N_A, N_B))`` (section 25.9)."""
    return high_confidence / max(1, min(source_count, target_count))


def rescue_eligible(
    health: float,
    structure_confidence: float,
    source_count: int,
    target_count: int,
    config: RescueConfig,
) -> tuple[bool, str]:
    """The hard trigger conditions, evaluated inside a trusted corridor only.

    A low direct match rate on its own is never enough.  Without strong
    structural support the rescue would be free to search, and a free search is
    the global-jump failure this architecture exists to eliminate.
    """
    if health >= config.direct_ok:
        return False, "direct match health is already sufficient"
    if structure_confidence < config.structure_min:
        return False, (
            f"structural support {structure_confidence:.2f} is below the corridor "
            f"threshold {config.structure_min:.2f} — the search would be unbounded"
        )
    if min(source_count, target_count) < config.min_information:
        return False, "too few features to carry a relative-geometry argument"
    return True, (
        f"direct match health {health:.2f} collapsed inside a corridor with "
        f"structural support {structure_confidence:.2f}"
    )


def _vote_weights(
    source: list[PatternPoint],
    target: list[PatternPoint],
    config: PatternConfig,
) -> np.ndarray:
    """Descriptor-similarity weight for every candidate correspondence.

    Weighting the votes is what separates a real constellation from noise: two
    points that happen to sit the same distance apart contribute little unless
    their whole neighbourhood agrees.
    """
    source_descriptors = neighbour_descriptors(source, config)
    target_descriptors = neighbour_descriptors(target, config)
    weights = np.zeros((len(source), len(target)), dtype=float)
    for i, left in enumerate(source_descriptors):
        for j, right in enumerate(target_descriptors):
            weights[i, j] = 0.15 + descriptor_similarity(left, right, config)
    return weights


def vote_local_transforms(
    source: list[PatternPoint],
    target: list[PatternPoint],
    pattern_config: PatternConfig,
    config: RescueConfig,
) -> list[TransformHypothesis]:
    """Hough/KDE accumulation over ``(b, phi)`` proposals (section 15).

    Every candidate correspondence proposes one translation and one rotation.
    Because both are differences, a transformation common to the whole region
    lands every one of its votes in the same cell, while incidental pairs
    scatter.
    """
    if not source or not target:
        return []

    weights = _vote_weights(source, target, pattern_config)

    shift_bandwidth = max(pattern_config.vote_bandwidth_u, 1e-6)
    angle_bandwidth = max(pattern_config.vote_bandwidth_rad, 1e-6)
    accumulator: dict[tuple[int, int], float] = {}
    samples: dict[tuple[int, int], list[tuple[float, float, float]]] = {}

    for i, left in enumerate(source):
        for j, right in enumerate(target):
            shift = right.u - left.u
            has_clock = left.theta is not None and right.theta is not None
            rotation = wrap(right.theta - left.theta) if has_clock else 0.0
            weight = float(weights[i, j])
            shift_bin = int(round(shift / shift_bandwidth))
            angle_bin = int(round(rotation / angle_bandwidth)) if has_clock else 0
            # Smearing into the neighbouring cells is the kernel: a vote just
            # over a bin edge still supports the mode it belongs to.
            for shift_offset in (-1, 0, 1):
                for angle_offset in (-1, 0, 1):
                    decay = math.exp(-0.5 * (shift_offset ** 2 + angle_offset ** 2))
                    key = (shift_bin + shift_offset, angle_bin + angle_offset)
                    accumulator[key] = accumulator.get(key, 0.0) + weight * decay
            samples.setdefault((shift_bin, angle_bin), []).append(
                (shift, rotation, weight)
            )

    if not accumulator:
        return []

    ranked = sorted(accumulator.items(), key=lambda item: item[1], reverse=True)
    hypotheses: list[TransformHypothesis] = []
    claimed: list[tuple[int, int]] = []
    for (shift_bin, angle_bin), support in ranked:
        # Modes must be genuinely distinct; adjacent cells of one peak are the
        # same hypothesis, not a competing one.
        if any(
            abs(shift_bin - other_shift) <= 2 and abs(angle_bin - other_angle) <= 2
            for other_shift, other_angle in claimed
        ):
            continue
        claimed.append((shift_bin, angle_bin))
        window = [
            sample
            for shift_offset in (-1, 0, 1)
            for angle_offset in (-1, 0, 1)
            for sample in samples.get((shift_bin + shift_offset, angle_bin + angle_offset), [])
        ]
        if not window:
            continue
        hypotheses.append(TransformHypothesis(
            axial_shift_u=_weighted_median([(s, w) for s, _r, w in window]),
            clock_rotation_rad=_weighted_circular_median(
                [(r, w) for _s, r, w in window]
            ),
            support=support,
        ))
        if len(hypotheses) >= 5:
            break
    return hypotheses


def _weighted_median(samples: list[tuple[float, float]]) -> float:
    if not samples:
        return 0.0
    ordered = sorted(samples, key=lambda item: item[0])
    total = sum(weight for _value, weight in ordered)
    if total <= 0:
        return statistics.median(value for value, _weight in ordered)
    accumulated = 0.0
    for value, weight in ordered:
        accumulated += weight
        if accumulated >= total / 2.0:
            return value
    return ordered[-1][0]


def _weighted_circular_median(samples: list[tuple[float, float]]) -> float:
    if not samples:
        return 0.0
    best_angle, best_cost = samples[0][0], math.inf
    for candidate, _weight in samples:
        cost = sum(
            weight * abs(wrap(angle - candidate)) for angle, weight in samples
        )
        if cost < best_cost:
            best_cost, best_angle = cost, candidate
    return best_angle


def _count_inliers(
    source: list[PatternPoint],
    target: list[PatternPoint],
    shift: float,
    rotation: float,
    shear: float,
    config: RescueConfig,
) -> tuple[int, list[tuple[int, int, float, float]]]:
    """Greedy nearest correspondence on corrected coordinates.

    Cardinalities may differ, so a target point is consumed at most once and
    unmatched mass is simply left over: forcing a one-to-one pairing here is
    exactly what produces the false pairs the specification warns about.
    """
    consumed: set[int] = set()
    pairs: list[tuple[int, int, float, float]] = []
    for i, left in enumerate(source):
        best: tuple[float, int, float, float] | None = None
        predicted_u = left.u + shift
        for j, right in enumerate(target):
            if j in consumed:
                continue
            axial_residual = right.u - predicted_u
            if abs(axial_residual) > config.inlier_gate_u:
                continue
            if left.theta is None or right.theta is None:
                clock_residual = 0.0
            else:
                predicted_theta = left.theta + rotation + shear * (left.u - 0.5)
                clock_residual = wrap(right.theta - predicted_theta)
                if abs(clock_residual) > config.inlier_gate_rad:
                    continue
            cost = (abs(axial_residual) / max(config.inlier_gate_u, 1e-9)) + (
                abs(clock_residual) / max(config.inlier_gate_rad, 1e-9)
            )
            if best is None or cost < best[0]:
                best = (cost, j, axial_residual, clock_residual)
        if best is not None:
            consumed.add(best[1])
            pairs.append((i, best[1], best[2], best[3]))
    return len(pairs), pairs


def _density_hypothesis(
    source: list[PatternPoint],
    target: list[PatternPoint],
) -> tuple[TransformHypothesis | None, float]:
    """Cross-correlation of the two density maps (section 14.3).

    This is the representation that survives one tool reporting a patch as one
    box and the other reporting fifteen, so it is generated as an independent
    proposal rather than as a tiebreak.
    """
    if not source or not target:
        return None, 0.0
    bins_u, bins_theta = 24, 12
    left = density_map(source, bins_u, bins_theta)
    right = density_map(target, bins_u, bins_theta)

    best = (-1.0, 0, 0)
    for axial_shift in range(-bins_u // 3, bins_u // 3 + 1):
        shifted_axial = np.roll(left, axial_shift, axis=0)
        for angle_shift in range(bins_theta):
            candidate = np.roll(shifted_axial, angle_shift, axis=1)
            score = density_correlation(candidate, right)
            if score > best[0]:
                best = (score, axial_shift, angle_shift)

    score, axial_shift, angle_shift = best
    if score <= 0:
        return None, 0.0
    rotation = wrap((angle_shift / bins_theta) * 2.0 * math.pi)
    return (
        TransformHypothesis(
            axial_shift_u=axial_shift / bins_u,
            clock_rotation_rad=rotation,
            support=score,
            source="DENSITY_CORRELATION",
        ),
        score,
    )


def run_pattern_rescue(
    pjid: str,
    source: list[PatternPoint],
    target: list[PatternPoint],
    trigger_reason: str,
    pattern_config: PatternConfig,
    config: RescueConfig,
) -> RescueCase:
    """Estimate a local transform from relative geometry, or decline to.

    The required pipeline of section 16.2 in order: build the window, compute
    relative descriptors and density, generate hypotheses, accumulate votes,
    reach a robust consensus, and only then regenerate candidates on corrected
    coordinates — which the caller does with the returned transform.
    """
    case = RescueCase(
        pjid=pjid,
        trigger_reason=trigger_reason,
        status=STATUS_NO_CONSENSUS,
        source_points=len(source),
        target_points=len(target),
    )

    if min(len(source), len(target)) < config.min_information:
        case.status = STATUS_TOO_LITTLE_EVIDENCE
        return case

    # A window larger than this is not a joint, it is a section; bounding it
    # keeps the O(n*m) vote affordable and keeps the rescue local.
    source = source[: config.max_points_per_window]
    target = target[: config.max_points_per_window]

    hypotheses = vote_local_transforms(source, target, pattern_config, config)
    density_proposal, correlation = _density_hypothesis(source, target)
    case.region_correlation = correlation
    if density_proposal is not None:
        hypotheses.append(density_proposal)
    if not hypotheses:
        return case

    # Robust consensus: score every proposal by the inlier count it actually
    # produces, not by the vote mass that proposed it.  A mode with many votes
    # and no inliers is a repetitive artefact.
    scored: list[tuple[float, TransformHypothesis, list]] = []
    for hypothesis in hypotheses:
        inliers, pairs = _count_inliers(
            source, target,
            hypothesis.axial_shift_u, hypothesis.clock_rotation_rad, 0.0,
            config,
        )
        scored.append((inliers / max(1, min(len(source), len(target))), hypothesis, pairs))
    scored.sort(key=lambda item: item[0], reverse=True)

    best_fraction, best, best_pairs = scored[0]
    # The motif vote and the density correlation are independent routes to the
    # same answer, and when they agree they must not be read as two competing
    # modes: that turned a unanimous rescue into an ambiguous one.  Only a
    # genuinely different transform counts as the runner-up.
    second_fraction = next(
        (
            fraction
            for fraction, hypothesis, _pairs in scored[1:]
            if not _same_transform(best, hypothesis, pattern_config)
        ),
        0.0,
    )
    case.hypotheses = [item[1] for item in scored]
    case.best_score = best_fraction
    case.second_score = second_fraction
    case.ambiguity = (
        (best_fraction - second_fraction) / best_fraction if best_fraction > 0 else 0.0
    )

    if len(best_pairs) < config.min_inliers or best_fraction < config.min_inlier_fraction:
        case.status = STATUS_NO_CONSENSUS
        return case
    if case.ambiguity < config.uniqueness_min and second_fraction > 0:
        # Several transforms explain the same repetitive pattern almost equally
        # well.  A high similarity is not sufficient (section 15.1).
        case.status = STATUS_AMBIGUOUS
        return case

    # Refine on the inliers only, which is the RANSAC step: the consensus set
    # re-estimates the transform without the outliers that the vote tolerated.
    axial_residuals = [pair[2] for pair in best_pairs]
    clock_residuals = [pair[3] for pair in best_pairs]
    refined_shift = best.axial_shift_u + statistics.median(axial_residuals)
    refined_rotation = wrap(
        best.clock_rotation_rad
        + _weighted_circular_median([(value, 1.0) for value in clock_residuals])
    )

    shear = 0.0
    if config.enable_clock_shear and len(best_pairs) >= config.shear_min_support:
        shear = _fit_clock_shear(source, target, best_pairs, refined_rotation, config)

    inliers, pairs = _count_inliers(
        source, target, refined_shift, refined_rotation, shear, config
    )
    if inliers < config.min_inliers:
        case.status = STATUS_NO_CONSENSUS
        return case

    case.status = STATUS_ACCEPTED
    case.axial_shift_u = refined_shift
    case.clock_rotation_rad = refined_rotation
    case.clock_shear_rad_per_u = shear
    case.inliers = inliers
    case.inlier_fraction = inliers / max(1, min(len(source), len(target)))
    case.axial_sigma_u = _spread([pair[2] for pair in pairs])
    case.clock_sigma_rad = _spread([pair[3] for pair in pairs])
    return case


def _same_transform(
    left: TransformHypothesis,
    right: TransformHypothesis,
    config: PatternConfig,
) -> bool:
    """Whether two proposals describe one mode rather than two."""
    return (
        abs(left.axial_shift_u - right.axial_shift_u) <= 2 * config.vote_bandwidth_u
        and abs(wrap(left.clock_rotation_rad - right.clock_rotation_rad))
        <= 2 * config.vote_bandwidth_rad
    )


def _spread(values: list[float]) -> float | None:
    """Robust scale of a residual sample, as the transform's own uncertainty."""
    if len(values) < 2:
        return None
    median = statistics.median(values)
    absolute = [abs(value - median) for value in values]
    # 1.4826 makes the median absolute deviation a consistent estimator of the
    # standard deviation for a normal sample.
    return max(1.4826 * statistics.median(absolute), 1e-6)


def _fit_clock_shear(
    source: list[PatternPoint],
    target: list[PatternPoint],
    pairs: list[tuple[int, int, float, float]],
    rotation: float,
    config: RescueConfig,
) -> float:
    """Least-squares longitudinal clock shear, adopted only if it earns it.

    ``k_j`` must never become a free warping parameter used to force arbitrary
    point matches, so it is strongly regularised, bounded, and kept only when
    it measurably improves the residual fit (section 11.1).
    """
    samples = [
        (source[i].u - 0.5, wrap(target[j].theta - source[i].theta - rotation))
        for i, j, _axial, _clock in pairs
        if source[i].theta is not None and target[j].theta is not None
    ]
    if len(samples) < config.shear_min_support:
        return 0.0

    positions = np.array([item[0] for item in samples])
    residuals = np.array([item[1] for item in samples])
    denominator = float(np.dot(positions, positions)) + 1.0 / max(
        config.shear_max_rad_per_u, 1e-6
    )
    slope = float(np.dot(positions, residuals)) / denominator
    slope = max(-config.shear_max_rad_per_u, min(config.shear_max_rad_per_u, slope))

    before = float(np.sqrt(np.mean(residuals ** 2)))
    after = float(np.sqrt(np.mean((residuals - slope * positions) ** 2)))
    if before <= 1e-9 or (before - after) / before < config.shear_improvement_min:
        return 0.0
    return slope
