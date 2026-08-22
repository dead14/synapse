"""Normative AURORA orchestration (section 25).

STRUCTURE -> REGISTER COORDINATES -> TEST DIRECT CORRESPONDENCE ->
RESCUE REGIONAL PATTERN IF NEEDED -> SOLVE FEATURE RELATIONSHIPS -> SCORE ->
REVIEW.

No downstream stage may silently bypass a failed upstream physical-identity
condition.  A stage that cannot conclude either widens its evidence in a
controlled way, enters REVIEW/UNRESOLVED, or invokes the explicit Pattern
Rescue branch — it never solves uncertainty by globally increasing tolerance.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .anchors import Anchor, coarse_offset_vote, extract_anchors
from .canonical import (
    CanonicalFeature,
    CLUSTER,
    GIRTH_WELD,
    METAL_LOSS,
    canonicalize_run,
    partition_positioned,
    wrap,
)
from .config import AuroraConfig, resolve_config
from .pattern import PatternPoint, build_points, build_regions
from .profile import (
    CapabilityProfile,
    MODE_PATTERN_RESCUE,
    MODE_STRUCTURAL_CHANGE,
    ToolProfile,
    build_capability_profile,
    select_operating_mode,
)
from .registry import (
    PersistentJoint,
    PersistentJointMap,
    STATUS_CHANGED,
    assign_local_coordinates,
    build_persistent_joints,
    group_by_joint,
)
from .reid import (
    MANY_TO_MANY_REGION,
    MISSING_OR_UNDETECTED,
    NEW_OR_PREVIOUSLY_UNDETECTED,
    STRUCTURAL_CHANGE as GROUP_STRUCTURAL_CHANGE,
    MatchGroup,
    solve_joint,
)
from .rescue import (
    RescueCase,
    STATUS_ACCEPTED,
    direct_match_health,
    rescue_eligible,
    run_pattern_rescue,
)
from .score import AUTO_MATCH, PROBABLE_REVIEW
from .structure import AnchorMap, register_structure_two_pass
from .transform import (
    apply_rescue_transform,
    build_axial_field,
    estimate_clock_rotation,
    regularise_field,
    TransformField,
    TransformState,
)
from .uncertainty import build_residual_model

# Job states (section 25.2).
STATE_CREATED = "CREATED"
STATE_INGESTED = "INGESTED"
STATE_VALIDATED = "VALIDATED"
STATE_STRUCTURE_REGISTERED = "STRUCTURE_REGISTERED"
STATE_PHYSICAL_SPACE_BUILT = "PHYSICAL_SPACE_BUILT"
STATE_AXIAL_REGISTERED = "AXIAL_REGISTERED"
STATE_DIRECT_MATCHED = "DIRECT_MATCHED"
STATE_REGION_REGISTERED = "REGION_REGISTERED"
STATE_RELATIONSHIPS_SOLVED = "RELATIONSHIPS_SOLVED"
STATE_SCORED = "SCORED"
STATE_REVIEW_READY = "REVIEW_READY"
STATE_FAILED_INPUT = "FAILED_INPUT"
STATE_INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"

BYPASS_UNREGISTERED = "Outside the registered physical map — no local frame"
BYPASS_CHANGE_ZONE = (
    "Structural change zone — cross-boundary identity is not forced"
)


@dataclass
class AnchorPair:
    """One registered structural correspondence, for the result table."""

    old_feature: CanonicalFeature
    new_feature: CanonicalFeature
    anchor_type: str
    similarity: float


@dataclass
class AuroraResult:
    state: str = STATE_CREATED
    mode: str = ""
    mode_reasons: list[str] = field(default_factory=list)
    capability: CapabilityProfile | None = None
    anchor_map: AnchorMap | None = None
    joint_map: PersistentJointMap | None = None
    transform_field: TransformField | None = None
    rescue_cases: list[RescueCase] = field(default_factory=list)
    groups: list[MatchGroup] = field(default_factory=list)

    anchor_pairs: list[AnchorPair] = field(default_factory=list)
    unmatched_anchors_old: list[CanonicalFeature] = field(default_factory=list)
    unmatched_anchors_new: list[CanonicalFeature] = field(default_factory=list)
    bypassed_old: list[tuple[CanonicalFeature, str]] = field(default_factory=list)
    bypassed_new: list[tuple[CanonicalFeature, str]] = field(default_factory=list)

    review_queue: list[dict] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)
    config: AuroraConfig = field(default_factory=AuroraConfig)
    failure_reason: str | None = None

    def summary(self) -> dict:
        matched = sum(1 for group in self.groups if group.is_matched)
        auto = sum(1 for group in self.groups if group.confidence_class == AUTO_MATCH)
        review = sum(
            1 for group in self.groups if group.confidence_class == PROBABLE_REVIEW
        )
        region_only = sum(
            1 for group in self.groups if group.group_type == MANY_TO_MANY_REGION
        )
        return {
            "state": self.state,
            "mode": self.mode,
            "modeReasons": self.mode_reasons,
            "matchGroups": matched,
            "autoAccepted": auto,
            "reviewRequired": review,
            "regionOnly": region_only,
            "structuralChange": sum(
                1 for group in self.groups
                if group.group_type == GROUP_STRUCTURAL_CHANGE
            ),
            "anchorPairs": len(self.anchor_pairs),
            "rescueAttempts": len(self.rescue_cases),
            "rescueAccepted": sum(1 for case in self.rescue_cases if case.accepted),
            "configVersion": self.config.config_version,
            "modelVersion": self.config.model_version,
        }

    def artifacts(self) -> dict:
        """The stage artifact contract of section 25.15.

        Every stage records what it produced, with the config and model version
        that produced it, so a result can be reproduced and a reviewer can see
        which stage a conclusion came from.
        """
        return {
            "summary": self.summary(),
            "capabilityProfile": self.capability.to_dict() if self.capability else None,
            "anchorMap": self.anchor_map.to_dict() if self.anchor_map else None,
            "persistentJointMap": self.joint_map.to_dict() if self.joint_map else None,
            "transformField": (
                self.transform_field.to_dict() if self.transform_field else None
            ),
            "rescueCases": [case.to_dict() for case in self.rescue_cases],
            "reviewQueue": self.review_queue[:500],
            "reviewQueueTotal": len(self.review_queue),
            "warnings": self.warnings,
            "failureReason": self.failure_reason,
        }


def _partition_features(
    features: list[CanonicalFeature],
) -> tuple[list[CanonicalFeature], list[CanonicalFeature], list[tuple[CanonicalFeature, str]]]:
    """Split a run into anchors, matchable metal loss, and bypassed evidence.

    A clustered record is metal loss and is aligned as such.  The CLUSTER class
    is kept because the report still says a row is a vendor-merged group — an
    FFS caveat about what the envelope describes — but it decides nothing here.
    """
    anchors: list[CanonicalFeature] = []
    metal_loss: list[CanonicalFeature] = []
    bypassed: list[tuple[CanonicalFeature, str]] = []
    for feature in features:
        if feature.is_anchor:
            anchors.append(feature)
        elif feature.feature_class in (METAL_LOSS, CLUSTER):
            metal_loss.append(feature)
        else:
            bypassed.append((feature, "Not a matchable anomaly class"))
    return anchors, metal_loss, bypassed


def _anchor_by_index(anchors: list[Anchor]) -> dict[int, Anchor]:
    return {anchor.index: anchor for anchor in anchors}


def _collect_anchor_results(
    anchor_map: AnchorMap,
    old_anchors: list[Anchor],
    new_anchors: list[Anchor],
    result: AuroraResult,
) -> None:
    old_by_index = _anchor_by_index(old_anchors)
    new_by_index = _anchor_by_index(new_anchors)
    for event in anchor_map.events:
        if event.kind == "MATCH":
            old_anchor = old_by_index.get(event.old_index)
            new_anchor = new_by_index.get(event.new_index)
            if old_anchor and new_anchor:
                result.anchor_pairs.append(AnchorPair(
                    old_feature=old_anchor.feature,
                    new_feature=new_anchor.feature,
                    anchor_type=old_anchor.anchor_type,
                    similarity=event.similarity,
                ))
        elif event.kind == "DELETION":
            anchor = old_by_index.get(event.old_index)
            if anchor:
                result.unmatched_anchors_old.append(anchor.feature)
        elif event.kind == "INSERTION":
            anchor = new_by_index.get(event.new_index)
            if anchor:
                result.unmatched_anchors_new.append(anchor.feature)


def _seed_global_clock_rotation(
    groups: list[MatchGroup],
    transform_field: TransformField,
    config: AuroraConfig,
) -> tuple[float, int]:
    """One coherent rotation across the run is a coordinate correction.

    Estimated from the high-confidence direct matches only, and adopted only
    with enough support — an unsupported rotation is indistinguishable from a
    widened clock tolerance, which section 11 forbids.
    """
    samples: list[tuple[float, float]] = []
    for group in groups:
        if group.confidence_class not in (AUTO_MATCH, PROBABLE_REVIEW):
            continue
        if len(group.old_members) != 1 or len(group.new_members) != 1:
            continue
        old_theta = group.old_members[0].theta
        new_theta = group.new_members[0].theta
        if old_theta is None or new_theta is None:
            continue
        samples.append((old_theta, new_theta))

    rotation, support = estimate_clock_rotation(samples, config.transform)
    if support >= config.transform.clock_min_support and abs(wrap(rotation)) > math.radians(5):
        for state in transform_field.states.values():
            if state.support == 0:
                state.clock_rotation_rad = rotation
        return rotation, support
    return 0.0, support


def _joint_points(
    joint: PersistentJoint,
    old_by_joint: dict[str, list[CanonicalFeature]],
    new_by_joint: dict[str, list[CanonicalFeature]],
) -> tuple[list[PatternPoint], list[PatternPoint]]:
    return (
        build_points(old_by_joint.get(joint.pjid, [])),
        build_points(new_by_joint.get(joint.pjid, [])),
    )


def run_aurora_alignment(
    old_records: list[dict],
    new_records: list[dict],
    old_run: dict | None = None,
    new_run: dict | None = None,
    pipeline_key: str = "pipeline",
    config_overrides: dict | None = None,
) -> AuroraResult:
    """Execute the normative pipeline for one run pair."""
    config = resolve_config(config_overrides)
    result = AuroraResult(config=config)

    # --- Phase 0: ingestion and canonicalisation (25.3) -------------------
    old_features = canonicalize_run(old_records, "old")
    new_features = canonicalize_run(new_records, "new")
    old_positioned, old_unpositioned = partition_positioned(old_features)
    new_positioned, new_unpositioned = partition_positioned(new_features)
    result.state = STATE_INGESTED

    for feature in old_unpositioned:
        result.bypassed_old.append((feature, "No readable odometer position"))
    for feature in new_unpositioned:
        result.bypassed_new.append((feature, "No readable odometer position"))

    old_anchor_features, old_metal_loss, old_bypassed = _partition_features(old_positioned)
    new_anchor_features, new_metal_loss, new_bypassed = _partition_features(new_positioned)
    result.bypassed_old.extend(old_bypassed)
    result.bypassed_new.extend(new_bypassed)

    # --- Phase 1: capability, quality and operating mode (25.4) ----------
    old_tool = ToolProfile.from_run(old_run)
    new_tool = ToolProfile.from_run(new_run)
    capability = build_capability_profile(
        old_positioned, new_positioned, old_tool, new_tool
    )
    result.capability = capability
    result.warnings.extend(capability.warnings)
    result.state = STATE_VALIDATED

    if not old_positioned or not new_positioned:
        result.state = STATE_FAILED_INPUT
        result.failure_reason = "One run has no positioned feature at all."
        _finalise_unregistered(result, old_metal_loss, new_metal_loss)
        return result

    # --- Phase 2 and 3: anchors, fingerprints, monotonic registration ----
    old_anchors = extract_anchors(old_anchor_features, config.anchors)
    new_anchors = extract_anchors(new_anchor_features, config.anchors)
    coarse_offset = coarse_offset_vote(old_anchors, new_anchors, config.anchors)
    anchor_map = register_structure_two_pass(
        old_anchors, new_anchors, config.anchors, config.structure, coarse_offset
    )
    result.anchor_map = anchor_map
    _collect_anchor_results(anchor_map, old_anchors, new_anchors, result)
    result.state = STATE_STRUCTURE_REGISTERED

    structure_confidence = anchor_map.confidence()
    mode, reasons = select_operating_mode(
        capability, structural_change_detected=bool(anchor_map.change_zones)
    )
    result.mode, result.mode_reasons = mode, reasons

    if len(anchor_map.matches) < config.structure.min_matched_anchors:
        # Without a structural map there is no corridor, and without a corridor
        # every candidate is an unconstrained guess.  UNRESOLVED is the correct
        # answer here, not a fabricated match.
        result.state = STATE_INSUFFICIENT_EVIDENCE
        result.failure_reason = (
            f"only {len(anchor_map.matches)} structural anchors could be registered; "
            "no physical corridor exists to match inside"
        )
        result.warnings.append({
            "code": "INSUFFICIENT_STRUCTURAL_EVIDENCE",
            "severity": "CRITICAL",
            "message": result.failure_reason,
        })
        _finalise_unregistered(result, old_metal_loss, new_metal_loss)
        return result

    # --- Phase 4: persistent joints and axial registration (25.7) --------
    joint_map = build_persistent_joints(anchor_map, pipeline_key)
    result.joint_map = joint_map
    result.state = STATE_PHYSICAL_SPACE_BUILT

    old_inside, old_outside = assign_local_coordinates(old_metal_loss, joint_map, "old")
    new_inside, new_outside = assign_local_coordinates(new_metal_loss, joint_map, "new")

    transform_field = build_axial_field(joint_map, config.transform)
    transform_field = regularise_field(transform_field, config.transform)
    result.transform_field = transform_field
    result.state = STATE_AXIAL_REGISTERED

    old_by_joint = group_by_joint(old_inside)
    new_by_joint = group_by_joint(new_inside)

    residual_model = build_residual_model(
        old_tool, new_tool, capability, config.uncertainty
    )

    # --- Phase 5: first-pass direct matching (25.8) ----------------------
    direct_results = _match_all_joints(
        joint_map, old_by_joint, new_by_joint, transform_field,
        residual_model, capability, structure_confidence, config,
    )
    result.state = STATE_DIRECT_MATCHED

    # One coherent rotation across the whole run is a coordinate correction,
    # not a per-feature tolerance; re-run once it is known.
    rotation, support = _seed_global_clock_rotation(
        [
            group
            for joint_result in direct_results.values()
            for group in joint_result.groups
        ],
        transform_field,
        config,
    )
    if support >= config.transform.clock_min_support and abs(wrap(rotation)) > math.radians(5):
        result.warnings.append({
            "code": "GLOBAL_CLOCK_ROTATION",
            "severity": "INFO",
            "message": (
                f"a coherent clock rotation of {math.degrees(wrap(rotation)):+.1f} deg "
                f"({support} supporting matches) was applied as a coordinate "
                "correction; the raw clock tolerance was not widened"
            ),
        })
        direct_results = _match_all_joints(
            joint_map, old_by_joint, new_by_joint, transform_field,
            residual_model, capability, structure_confidence, config,
        )

    # --- Phase 6 to 8: health gate, Pattern Rescue, relationship solver --
    final_groups: list[MatchGroup] = []
    for joint in joint_map.joints:
        joint_result = direct_results[joint.pjid]
        old_points, new_points = _joint_points(joint, old_by_joint, new_by_joint)

        if joint.status == STATUS_CHANGED:
            for point in old_points:
                result.bypassed_old.append((point.feature, BYPASS_CHANGE_ZONE))
            for point in new_points:
                result.bypassed_new.append((point.feature, BYPASS_CHANGE_ZONE))
            continue

        health = direct_match_health(
            sum(1 for group in joint_result.groups if group.confidence_class == AUTO_MATCH),
            len(old_points),
            len(new_points),
        )
        joint_result.direct_health = health

        eligible, reason = rescue_eligible(
            health, structure_confidence, len(old_points), len(new_points), config.rescue
        )
        if not eligible:
            final_groups.extend(joint_result.groups)
            continue

        case = run_pattern_rescue(
            joint.pjid, old_points, new_points, reason, config.pattern, config.rescue
        )
        result.rescue_cases.append(case)
        if case.status != STATUS_ACCEPTED:
            # Pattern evidence failed despite a valid corridor.  The honest
            # answer is UNRESOLVED, not a wider tolerance.
            final_groups.extend(joint_result.groups)
            continue

        state = transform_field.get(joint.pjid) or TransformState(
            pjid=joint.pjid, sequence=joint.sequence
        )
        apply_rescue_transform(
            state, joint,
            case.axial_shift_u, case.clock_rotation_rad, case.clock_shear_rad_per_u,
            case.inliers, case.inlier_fraction,
            axial_sigma_m=(
                case.axial_sigma_u * joint.new_length_m
                if case.axial_sigma_u is not None else None
            ),
            clock_sigma_rad=case.clock_sigma_rad,
        )
        transform_field.states[joint.pjid] = state

        rescued = solve_joint(
            joint.pjid, old_points, new_points, state, joint.new_length_m,
            residual_model, capability, structure_confidence, config,
            region_confidence=case.inlier_fraction,
            rescue_mode=MODE_PATTERN_RESCUE,
            old_regions=build_regions(old_points, joint.pjid, "old", config.pattern),
            new_regions=build_regions(new_points, joint.pjid, "new", config.pattern),
        )
        rescued.rescue_status = case.status
        final_groups.extend(rescued.groups)

    result.state = STATE_REGION_REGISTERED

    # Metal loss outside every registered joint keeps its evidence but claims
    # no identity: extrapolating a local frame past the trusted anchors is the
    # unconstrained search section 10.2 forbids.
    for feature in old_outside:
        result.bypassed_old.append((feature, BYPASS_UNREGISTERED))
    for feature in new_outside:
        result.bypassed_new.append((feature, BYPASS_UNREGISTERED))

    result.groups = final_groups
    result.state = STATE_RELATIONSHIPS_SOLVED
    result.state = STATE_SCORED

    if mode == MODE_STRUCTURAL_CHANGE:
        result.warnings.append({
            "code": "STRUCTURAL_CHANGE_ZONES",
            "severity": "REVIEW",
            "message": (
                f"{len(anchor_map.change_zones)} structural change zone(s) detected; "
                "cross-boundary anomaly identity was not forced through them"
            ),
        })

    result.review_queue = _build_review_queue(result)
    result.state = STATE_REVIEW_READY
    return result


def _match_all_joints(
    joint_map: PersistentJointMap,
    old_by_joint: dict[str, list[CanonicalFeature]],
    new_by_joint: dict[str, list[CanonicalFeature]],
    transform_field: TransformField,
    residual_model,
    capability: CapabilityProfile,
    structure_confidence: float,
    config: AuroraConfig,
) -> dict:
    results = {}
    for joint in joint_map.joints:
        old_points, new_points = _joint_points(joint, old_by_joint, new_by_joint)
        state = transform_field.get(joint.pjid) or TransformState(
            pjid=joint.pjid, sequence=joint.sequence
        )
        if joint.status == STATUS_CHANGED:
            results[joint.pjid] = solve_joint(
                joint.pjid, [], [], state, joint.new_length_m,
                residual_model, capability, structure_confidence, config,
            )
            continue
        results[joint.pjid] = solve_joint(
            joint.pjid, old_points, new_points, state, joint.new_length_m,
            residual_model, capability, structure_confidence, config,
            region_confidence=0.0,
            old_regions=build_regions(old_points, joint.pjid, "old", config.pattern),
            new_regions=build_regions(new_points, joint.pjid, "new", config.pattern),
        )
    return results


def _finalise_unregistered(
    result: AuroraResult,
    old_metal_loss: list[CanonicalFeature],
    new_metal_loss: list[CanonicalFeature],
) -> None:
    """Conserve every feature when the run never reached the matching stages."""
    result.groups = (
        [
            MatchGroup(
                group_type=MISSING_OR_UNDETECTED,
                pjid="",
                old_members=[PatternPoint(feature=feature, u=0.0, theta=feature.clock_rad)],
                explanation=["no registered physical map — identity not claimed"],
            )
            for feature in old_metal_loss
        ]
        + [
            MatchGroup(
                group_type=NEW_OR_PREVIOUSLY_UNDETECTED,
                pjid="",
                new_members=[PatternPoint(feature=feature, u=0.0, theta=feature.clock_rad)],
                explanation=["no registered physical map — identity not claimed"],
            )
            for feature in new_metal_loss
        ]
    )


def _build_review_queue(result: AuroraResult) -> list[dict]:
    """Exception-based review (section 25.13).

    Only the cases a human can change go in: high-confidence, unambiguous
    matches stay auditable but are not queued, because asking an engineer to
    approve thousands of them is how the exceptions get missed.
    """
    queue: list[dict] = []
    for group in result.groups:
        if group.confidence_class == AUTO_MATCH and group.group_type == "ONE_TO_ONE":
            continue
        if not group.is_matched and group.group_type in (
            MISSING_OR_UNDETECTED, NEW_OR_PREVIOUSLY_UNDETECTED
        ):
            continue
        queue.append({
            "pjid": group.pjid,
            "type": group.group_type,
            "confidenceClass": group.confidence_class,
            "probability": round(group.probability, 4),
            "ambiguityMargin": round(group.ambiguity_margin, 4),
            "regionConfidence": round(group.region_confidence, 4),
            "featureConfidence": round(group.feature_confidence, 4),
            "oldKeys": [point.key for point in group.old_members],
            "newKeys": [point.key for point in group.new_members],
            "rescueMode": group.rescue_mode,
            "explanation": group.explanation,
            "alternatives": group.alternatives,
            "allowedActions": [
                "ACCEPT_MATCH", "REJECT_MATCH", "REASSIGN",
                "SPLIT", "MERGE", "REGION_ONLY", "MARK_BAD_DATA",
            ],
        })
    for case in result.rescue_cases:
        if case.accepted:
            continue
        queue.append({
            "pjid": case.pjid,
            "type": "PATTERN_RESCUE",
            "confidenceClass": case.status,
            "probability": round(case.best_score, 4),
            "ambiguityMargin": round(case.ambiguity, 4),
            "regionConfidence": round(case.region_correlation, 4),
            "featureConfidence": 0.0,
            "oldKeys": [],
            "newKeys": [],
            "rescueMode": MODE_PATTERN_RESCUE,
            "explanation": [case.trigger_reason, f"rescue outcome: {case.status}"],
            "alternatives": [h.to_dict() for h in case.hypotheses[:3]],
            "allowedActions": ["MARK_CHANGE_ZONE", "REGION_ONLY", "MARK_BAD_DATA"],
        })
    for zone in (result.anchor_map.change_zones if result.anchor_map else []):
        queue.append({
            "pjid": "",
            "type": "STRUCTURAL_CHANGE",
            "confidenceClass": "STRUCTURAL_CHANGE",
            "probability": 0.0,
            "ambiguityMargin": 0.0,
            "regionConfidence": 0.0,
            "featureConfidence": 0.0,
            "oldKeys": [],
            "newKeys": [],
            "rescueMode": None,
            "explanation": [zone.reason],
            "alternatives": [],
            "allowedActions": ["MARK_CHANGE_ZONE", "MARK_BAD_DATA"],
        })
    return queue
