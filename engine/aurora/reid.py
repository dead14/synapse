"""Metal-loss re-identification and the relationship solver (sections 17, 20, 25.12).

Individual candidates are generated only after structure, joint identity, the
local transform and region correspondence are known.  That ordering is what
makes the candidate set small, the runtime bounded and the false-candidate rate
low — and it is what keeps a feature from being "rescued" by a search far
upstream or downstream, which recreates the global-jump failure the whole
architecture exists to eliminate.

A one-to-one optimiser is used, but only as a *local* sub-solver inside an
already registered candidate set.  It is not the alignment engine.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .canonical import wrap
from .config import AuroraConfig
from .pattern import PatternPoint, PatternRegion, chamfer_distance
from .profile import CapabilityProfile
from .score import (
    AMBIGUOUS,
    AUTO_MATCH,
    EvidenceVector,
    calibrate_probability,
    classify_confidence,
    explain,
    raw_evidence_score,
)
from .transform import TransformState
from .uncertainty import ResidualModel, dimension_compatibility

ONE_TO_ONE = "ONE_TO_ONE"
ONE_TO_MANY = "ONE_TO_MANY"
MANY_TO_ONE = "MANY_TO_ONE"
MANY_TO_MANY_REGION = "MANY_TO_MANY_REGION"
REGION_ONLY = "REGION_ONLY"
NEW_OR_PREVIOUSLY_UNDETECTED = "NEW_OR_PREVIOUSLY_UNDETECTED"
MISSING_OR_UNDETECTED = "MISSING_OR_UNDETECTED"
STRUCTURAL_CHANGE = "STRUCTURAL_CHANGE"
UNRESOLVED = "UNRESOLVED"


@dataclass
class MatchGroup:
    """One correspondence, of any cardinality (section 20)."""

    group_type: str
    pjid: str
    old_members: list[PatternPoint] = field(default_factory=list)
    new_members: list[PatternPoint] = field(default_factory=list)
    probability: float = 0.0
    # The interpretable evidence score, kept apart from the calibrated
    # probability (section 21).  A reviewer can read this one directly; the
    # probability only means what the current calibration says it means.
    raw_score: float = 0.0
    region_confidence: float = 0.0
    feature_confidence: float = 0.0
    confidence_class: str = "UNMATCHED"
    ambiguity_margin: float = 1.0
    axial_residual_m: float | None = None
    clock_residual_rad: float | None = None
    mahalanobis_squared: float | None = None
    rescue_mode: str | None = None
    evidence: EvidenceVector | None = None
    explanation: list[str] = field(default_factory=list)
    alternatives: list[dict] = field(default_factory=list)
    region_id: str | None = None

    @property
    def is_matched(self) -> bool:
        return self.group_type in (
            ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY_REGION
        )


@dataclass
class JointResult:
    pjid: str
    groups: list[MatchGroup] = field(default_factory=list)
    direct_health: float = 0.0
    region_confidence: float = 0.0
    rescue_status: str | None = None
    note: str | None = None


def _candidate_evidence(
    old_point: PatternPoint,
    new_point: PatternPoint,
    state: TransformState,
    joint_length_m: float,
    residual_model: ResidualModel,
    capability: CapabilityProfile,
    structure_confidence: float,
    motif_similarity: float,
    region_similarity: float | None,
) -> EvidenceVector:
    """Evidence for one candidate, evaluated on *corrected* coordinates.

    Section 25.13 is explicit that confidence is based on corrected residuals
    rather than on raw inter-run differences: a raw two-hour clock difference
    is a two-degree residual once the region's own rotation is accounted for.
    """
    predicted_u = old_point.u + (
        state.axial_residual_m / joint_length_m if joint_length_m > 0 else 0.0
    )
    axial_residual_m = (new_point.u - predicted_u) * joint_length_m

    clock_residual: float | None = None
    if old_point.theta is not None and new_point.theta is not None:
        predicted_theta = (
            old_point.theta
            + state.clock_rotation_rad
            + state.clock_shear_rad_per_u * (old_point.u - 0.5)
        )
        clock_residual = wrap(new_point.theta - predicted_theta)

    evidence = EvidenceVector()
    evidence.axial_residual_m = axial_residual_m
    evidence.clock_residual_rad = clock_residual
    evidence.mahalanobis_squared = residual_model.mahalanobis_squared(
        axial_residual_m, clock_residual
    )
    evidence.geometry = residual_model.geometric_similarity(
        axial_residual_m, clock_residual
    )
    evidence.geometry_available = True
    evidence.structure = structure_confidence
    evidence.motif = motif_similarity
    evidence.motif_available = motif_similarity > 0
    if region_similarity is not None:
        evidence.region = region_similarity
        evidence.region_available = True

    old_surface = old_point.feature.surface
    new_surface = new_point.feature.surface
    if old_surface is not None and new_surface is not None:
        evidence.surface = 1.0 if old_surface == new_surface else 0.0
        evidence.surface_available = True

    # Depth, length and width are not primary identity constraints across tool
    # generations, so they enter as one weak, masked term rather than as three
    # independent gates.
    depth_score, depth_mask = dimension_compatibility(
        old_point.feature.depth_pct, new_point.feature.depth_pct, capability
    )
    length_score, length_mask = dimension_compatibility(
        old_point.feature.length_mm, new_point.feature.length_mm, capability
    )
    if depth_mask + length_mask:
        evidence.dimension = (depth_score * depth_mask + length_score * length_mask) / (
            depth_mask + length_mask
        )
        evidence.dimension_available = True
    return evidence


def _motif_similarity_matrix(
    old_points: list[PatternPoint],
    new_points: list[PatternPoint],
    config: AuroraConfig,
) -> np.ndarray:
    from .pattern import descriptor_similarity, neighbour_descriptors

    old_descriptors = neighbour_descriptors(old_points, config.pattern)
    new_descriptors = neighbour_descriptors(new_points, config.pattern)
    matrix = np.zeros((len(old_points), len(new_points)), dtype=float)
    for i, left in enumerate(old_descriptors):
        for j, right in enumerate(new_descriptors):
            matrix[i, j] = descriptor_similarity(left, right, config.pattern)
    return matrix


def solve_joint(
    pjid: str,
    old_points: list[PatternPoint],
    new_points: list[PatternPoint],
    state: TransformState,
    joint_length_m: float,
    residual_model: ResidualModel,
    capability: CapabilityProfile,
    structure_confidence: float,
    config: AuroraConfig,
    region_confidence: float = 0.0,
    rescue_mode: str | None = None,
    old_regions: list[PatternRegion] | None = None,
    new_regions: list[PatternRegion] | None = None,
) -> JointResult:
    """Candidate generation, local assignment and group classification."""
    result = JointResult(pjid=pjid, region_confidence=region_confidence)

    if not old_points and not new_points:
        return result
    if not old_points:
        result.groups = [
            MatchGroup(
                group_type=NEW_OR_PREVIOUSLY_UNDETECTED,
                pjid=pjid,
                new_members=[point],
                explanation=["no old feature in this physical joint"],
            )
            for point in new_points
        ]
        return result
    if not new_points:
        result.groups = [
            MatchGroup(
                group_type=MISSING_OR_UNDETECTED,
                pjid=pjid,
                old_members=[point],
                explanation=["no new feature in this physical joint"],
            )
            for point in old_points
        ]
        return result

    motif = _motif_similarity_matrix(old_points, new_points, config)
    region_similarity = _region_similarity(old_regions, new_regions)

    rows, columns = len(old_points), len(new_points)
    probability = np.zeros((rows, columns), dtype=float)
    evidence_grid: list[list[EvidenceVector | None]] = [
        [None] * columns for _ in range(rows)
    ]
    gated = np.zeros((rows, columns), dtype=bool)

    for i, old_point in enumerate(old_points):
        for j, new_point in enumerate(new_points):
            evidence = _candidate_evidence(
                old_point, new_point, state, joint_length_m, residual_model,
                capability, structure_confidence, float(motif[i, j]), region_similarity,
            )
            # The corridor gate.  A candidate outside it is not scored down, it
            # is not a candidate: this is the structural bound that stops a
            # feature being matched to a look-alike elsewhere.
            if evidence.mahalanobis_squared > config.uncertainty.mahalanobis_gate:
                continue
            surface = evidence.surface_available and evidence.surface < 0.5
            if surface:
                # Internal and external metal loss at the same place are two
                # different features, not one that moved through the wall.
                continue
            gated[i, j] = True
            evidence_grid[i][j] = evidence
            probability[i, j] = calibrate_probability(evidence, config.score)

    assignment = _local_assignment(probability, gated)
    assigned_old = {i for i, _j in assignment}
    assigned_new = {j for _i, j in assignment}

    groups: list[MatchGroup] = []
    high_confidence = 0

    for i, j in assignment:
        evidence = evidence_grid[i][j]
        margin = _ambiguity_margin(probability, gated, i, j)
        confidence_class = classify_confidence(
            float(probability[i, j]), margin, False, config.score
        )
        group = MatchGroup(
            group_type=ONE_TO_ONE,
            pjid=pjid,
            old_members=[old_points[i]],
            new_members=[new_points[j]],
            probability=float(probability[i, j]),
            raw_score=raw_evidence_score(evidence, config.score),
            region_confidence=region_confidence,
            feature_confidence=float(probability[i, j]),
            confidence_class=confidence_class,
            ambiguity_margin=margin,
            axial_residual_m=evidence.axial_residual_m,
            clock_residual_rad=evidence.clock_residual_rad,
            mahalanobis_squared=evidence.mahalanobis_squared,
            rescue_mode=rescue_mode,
            evidence=evidence,
            explanation=explain(
                evidence,
                _transform_note(state, rescue_mode),
            ),
            alternatives=_alternatives(probability, gated, i, j, new_points),
        )
        groups.append(group)
        if confidence_class == AUTO_MATCH:
            high_confidence += 1

    # Split and merge: a leftover feature that still has a gated edge to an
    # already assigned partner is the same physical corrosion reported with a
    # different box population, not a new defect.
    groups = _attach_split_merge(
        groups, probability, gated, evidence_grid,
        old_points, new_points, assigned_old, assigned_new, config,
    )

    for i, old_point in enumerate(old_points):
        if i in assigned_old or any(old_point in g.old_members for g in groups):
            continue
        groups.append(MatchGroup(
            group_type=MISSING_OR_UNDETECTED,
            pjid=pjid,
            old_members=[old_point],
            region_confidence=region_confidence,
            rescue_mode=rescue_mode,
            explanation=["no candidate inside the registered corridor passed the gate"],
        ))
    for j, new_point in enumerate(new_points):
        if j in assigned_new or any(new_point in g.new_members for g in groups):
            continue
        groups.append(MatchGroup(
            group_type=NEW_OR_PREVIOUSLY_UNDETECTED,
            pjid=pjid,
            new_members=[new_point],
            region_confidence=region_confidence,
            rescue_mode=rescue_mode,
            explanation=["no candidate inside the registered corridor passed the gate"],
        ))

    result.groups = groups
    result.direct_health = high_confidence / max(1, min(rows, columns))
    return result


def _transform_note(state: TransformState, rescue_mode: str | None) -> str | None:
    rotation_deg = math.degrees(wrap(state.clock_rotation_rad))
    if rescue_mode:
        return (
            f"evaluated after an accepted local transform "
            f"(axial {state.axial_residual_m:+.3f} m, clock {rotation_deg:+.1f} deg) "
            f"estimated by {rescue_mode}"
        )
    if abs(rotation_deg) > 1.0:
        return f"local clock rotation {rotation_deg:+.1f} deg applied before scoring"
    return None


def _region_similarity(
    old_regions: list[PatternRegion] | None,
    new_regions: list[PatternRegion] | None,
) -> float | None:
    """Chamfer-based region agreement, or ``None`` when regions are absent."""
    if not old_regions or not new_regions:
        return None
    old_points = [point for region in old_regions for point in region.members]
    new_points = [point for region in new_regions for point in region.members]
    distance = chamfer_distance(old_points, new_points)
    if not math.isfinite(distance):
        return None
    return math.exp(-distance / 0.08)


def _local_assignment(
    probability: np.ndarray, gated: np.ndarray
) -> list[tuple[int, int]]:
    """Optimal one-to-one assignment inside one joint.

    Optional and local by design (section 25.12).  Only gated cells may be
    chosen, so the optimiser can never reach outside the corridor even when the
    cost surface would prefer to.
    """
    if not gated.any():
        return []
    try:
        from scipy.optimize import linear_sum_assignment
    except ImportError:  # pragma: no cover - scipy is a hard dependency
        return _greedy_assignment(probability, gated)

    cost = np.where(gated, -probability, 1.0e6)
    rows, columns = linear_sum_assignment(cost)
    return [
        (int(i), int(j))
        for i, j in zip(rows, columns)
        if gated[i, j] and probability[i, j] > 0
    ]


def _greedy_assignment(
    probability: np.ndarray, gated: np.ndarray
) -> list[tuple[int, int]]:
    pairs: list[tuple[int, int]] = []
    used_rows: set[int] = set()
    used_columns: set[int] = set()
    order = np.argsort(-probability, axis=None)
    for flat in order:
        i, j = divmod(int(flat), probability.shape[1])
        if not gated[i, j] or probability[i, j] <= 0:
            continue
        if i in used_rows or j in used_columns:
            continue
        used_rows.add(i)
        used_columns.add(j)
        pairs.append((i, j))
    return pairs


def _ambiguity_margin(
    probability: np.ndarray, gated: np.ndarray, row: int, column: int
) -> float:
    """``P_best - P_second`` across both axes of the candidate grid.

    Both axes matter: a new feature that two old features explain equally well
    is as ambiguous as an old feature with two new candidates.
    """
    chosen = float(probability[row, column])
    competitors = [
        float(probability[row, other])
        for other in range(probability.shape[1])
        if other != column and gated[row, other]
    ] + [
        float(probability[other, column])
        for other in range(probability.shape[0])
        if other != row and gated[other, column]
    ]
    if not competitors:
        return 1.0
    return max(0.0, chosen - max(competitors))


def _alternatives(
    probability: np.ndarray,
    gated: np.ndarray,
    row: int,
    column: int,
    new_points: list[PatternPoint],
    limit: int = 3,
) -> list[dict]:
    """The competing candidates a reviewer must be able to inspect (section 22)."""
    others = [
        (float(probability[row, other]), other)
        for other in range(probability.shape[1])
        if other != column and gated[row, other]
    ]
    others.sort(reverse=True)
    return [
        {
            "newKey": new_points[other].key,
            "newSourceId": new_points[other].feature.source_id,
            "probability": round(value, 4),
        }
        for value, other in others[:limit]
    ]


def _attach_split_merge(
    groups: list[MatchGroup],
    probability: np.ndarray,
    gated: np.ndarray,
    evidence_grid: list[list[EvidenceVector | None]],
    old_points: list[PatternPoint],
    new_points: list[PatternPoint],
    assigned_old: set[int],
    assigned_new: set[int],
    config: AuroraConfig,
) -> list[MatchGroup]:
    """Fold unassigned features into the group their evidence belongs to.

    One old box against several new ones is a higher-resolution tool splitting
    a patch, not one match plus several new defects; the reverse is a merge.
    Both are first-class relationships, and reporting them as "new" or
    "missing" would put phantom corrosion growth into the integrity record.
    """
    index_of_old = {id(point): index for index, point in enumerate(old_points)}
    index_of_new = {id(point): index for index, point in enumerate(new_points)}

    for group in groups:
        if group.group_type != ONE_TO_ONE:
            continue
        row = index_of_old[id(group.old_members[0])]
        column = index_of_new[id(group.new_members[0])]

        extra_new = [
            other for other in range(probability.shape[1])
            if other not in assigned_new
            and gated[row, other]
            and probability[row, other] >= config.score.review_probability
        ]
        extra_old = [
            other for other in range(probability.shape[0])
            if other not in assigned_old
            and gated[other, column]
            and probability[other, column] >= config.score.review_probability
        ]

        if extra_new and not extra_old:
            group.group_type = ONE_TO_MANY
            for other in extra_new:
                group.new_members.append(new_points[other])
                assigned_new.add(other)
            group.explanation.append(
                f"one old box corresponds to {len(group.new_members)} new boxes — "
                "higher reporting resolution or a split patch"
            )
        elif extra_old and not extra_new:
            group.group_type = MANY_TO_ONE
            for other in extra_old:
                group.old_members.append(old_points[other])
                assigned_old.add(other)
            group.explanation.append(
                f"{len(group.old_members)} old boxes correspond to one new box — "
                "merged reporting of the same corrosion"
            )
        elif extra_old and extra_new:
            # Both sides have unclaimed evidence: the region corresponds but
            # the individual box mapping is not defensible.
            group.group_type = MANY_TO_MANY_REGION
            for other in extra_new:
                group.new_members.append(new_points[other])
                assigned_new.add(other)
            for other in extra_old:
                group.old_members.append(old_points[other])
                assigned_old.add(other)
            group.confidence_class = AMBIGUOUS
            group.explanation.append(
                "corrosion colony corresponds, but individual box identity is "
                "not defensible on this evidence"
            )
        # Feature-level confidence is separate from region-level confidence and
        # must be stored as such (section 16.2).
        if group.group_type in (ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY_REGION):
            complexity = len(group.old_members) * len(group.new_members)
            group.feature_confidence = group.probability / complexity
    return groups
