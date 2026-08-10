"""Coordinate registration: axial mapping and clock rotation (sections 10-12).

Inside a correctly paired physical joint the map from the old run to the new
one is affine and comes straight from the two boundaries — no global offset is
assumed anywhere.  The circumferential component is estimated as a *rotation*,
never as a widened clock tolerance: a coherent two-hour shift is a 60 degree
coordinate correction, and treating it as a tolerance would admit every feature
within two hours of every other one.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field

from .canonical import wrap, wrap_2pi
from .config import TransformConfig
from .registry import PersistentJoint, PersistentJointMap

PROVENANCE_BOUNDARY = "JOINT_BOUNDARY"
PROVENANCE_RESCUE = "PATTERN_RESCUE"
PROVENANCE_SMOOTHED = "REGULARISED"


@dataclass
class TransformState:
    """Local transform for one physical joint (section 12)."""

    pjid: str
    sequence: int
    axial_scale: float = 1.0
    axial_offset_m: float = 0.0
    axial_residual_m: float = 0.0
    clock_rotation_rad: float = 0.0
    clock_shear_rad_per_u: float = 0.0
    support: int = 0
    confidence: float = 0.0
    provenance: str = PROVENANCE_BOUNDARY
    axial_sigma_m: float | None = None
    clock_sigma_rad: float | None = None

    def predict_x(self, x_old_m: float) -> float:
        return self.axial_scale * x_old_m + self.axial_offset_m + self.axial_residual_m

    def predict_theta(self, theta_old_rad: float, u_old: float = 0.5) -> float:
        return wrap_2pi(
            theta_old_rad
            + self.clock_rotation_rad
            + self.clock_shear_rad_per_u * (u_old - 0.5)
        )

    def to_dict(self) -> dict:
        return {
            "pjid": self.pjid,
            "sequence": self.sequence,
            "axialScale": round(self.axial_scale, 6),
            "axialOffsetM": round(self.axial_offset_m, 4),
            "axialResidualM": round(self.axial_residual_m, 4),
            "clockRotationDeg": round(math.degrees(wrap(self.clock_rotation_rad)), 2),
            "clockRotationHours": round(wrap(self.clock_rotation_rad) * 6.0 / math.pi, 3),
            "clockShearDegPerU": round(math.degrees(self.clock_shear_rad_per_u), 2),
            "support": self.support,
            "confidence": round(self.confidence, 4),
            "provenance": self.provenance,
        }


@dataclass
class TransformField:
    states: dict[str, TransformState] = field(default_factory=dict)
    drift_check: dict = field(default_factory=dict)

    def get(self, pjid: str | None) -> TransformState | None:
        return self.states.get(pjid) if pjid else None

    def to_dict(self, max_states: int = 4000) -> dict:
        ordered = sorted(self.states.values(), key=lambda state: state.sequence)
        rotations = [
            math.degrees(wrap(state.clock_rotation_rad))
            for state in ordered
            if state.support > 0 or abs(state.clock_rotation_rad) > 1e-9
        ]
        scales = [state.axial_scale for state in ordered]
        return {
            "stateCount": len(ordered),
            "statesTruncated": max(0, len(ordered) - max_states),
            "medianAxialScale": round(statistics.median(scales), 6) if scales else None,
            "medianClockRotationDeg": (
                round(statistics.median(rotations), 2) if rotations else None
            ),
            "rotatedJoints": sum(
                1 for state in ordered
                if abs(wrap(state.clock_rotation_rad)) > math.radians(10)
            ),
            "driftCheck": self.drift_check,
            "states": [state.to_dict() for state in ordered[:max_states]],
        }


def build_axial_field(
    joint_map: PersistentJointMap,
    config: TransformConfig,
) -> TransformField:
    """Piecewise-affine registration from the joint boundaries (section 10).

    ``a_j = L_B / L_A`` and ``b_j = x_B,US - a_j * x_A,US``.  A scale outside
    the configured plausibility band is not a drifting odometer; it is a
    mis-paired joint, so the state is marked unconfident and the joint keeps
    its identity map rather than stretching features across it.
    """
    field_states: dict[str, TransformState] = {}
    for joint in joint_map.joints:
        state = TransformState(pjid=joint.pjid, sequence=joint.sequence)
        old_length = joint.old_length_m
        new_length = joint.new_length_m
        if old_length > 0 and new_length > 0:
            scale = new_length / old_length
            if config.scale_min <= scale <= config.scale_max:
                state.axial_scale = scale
                state.axial_offset_m = joint.new_us_m - scale * joint.old_us_m
                state.confidence = joint.boundary_similarity
            else:
                # Out of band: fall back to a pure translation, which is still
                # monotonic, and record the reduced confidence.
                state.axial_scale = 1.0
                state.axial_offset_m = joint.new_us_m - joint.old_us_m
                state.confidence = 0.25 * joint.boundary_similarity
        else:
            state.axial_offset_m = joint.new_us_m - joint.old_us_m
            state.confidence = 0.1
        field_states[joint.pjid] = state

    transform_field = TransformField(states=field_states)
    transform_field.drift_check = drift_accumulation_check(joint_map)
    return transform_field


def drift_accumulation_check(joint_map: PersistentJointMap) -> dict:
    """The QC identity of section 10.1.

    ``delta_(j+1) - delta_j`` should equal ``L_B,j - L_A,j``.  Where it does,
    a large *absolute* drift is fully explained by accumulated joint-length
    differences and is therefore not evidence of a wrong match — which is the
    single most common way a good alignment gets rejected by eye.
    """
    residuals: list[float] = []
    for joint in joint_map.joints:
        delta_us = joint.new_us_m - joint.old_us_m
        delta_ds = joint.new_ds_m - joint.old_ds_m
        expected = joint.new_length_m - joint.old_length_m
        residuals.append((delta_ds - delta_us) - expected)

    if not residuals:
        return {"joints": 0, "explained": None}
    absolute = [abs(value) for value in residuals]
    total_drift = (
        joint_map.joints[-1].new_ds_m - joint_map.joints[-1].old_ds_m
        - (joint_map.joints[0].new_us_m - joint_map.joints[0].old_us_m)
    )
    return {
        "joints": len(residuals),
        "totalAccumulatedDriftM": round(total_drift, 4),
        "maxIdentityResidualM": round(max(absolute), 6),
        "medianIdentityResidualM": round(statistics.median(absolute), 6),
        # The identity is exact by construction when the boundaries come from
        # the anchor map, so anything above a millimetre means the joint map
        # itself was edited or interpolated.
        "explained": max(absolute) < 1e-3,
    }


def estimate_clock_rotation(
    pairs: list[tuple[float, float]],
    config: TransformConfig,
) -> tuple[float, int]:
    """Circular median of observed clock differences (section 11).

    Returns the rotation and its support.  Below ``clock_min_support`` the
    rotation is not adopted: one or two features agreeing is a coincidence, and
    an unsupported rotation is indistinguishable from a widened tolerance.
    """
    differences = [wrap(new - old) for old, new in pairs]
    if len(differences) < config.clock_min_support:
        return 0.0, len(differences)
    return _circular_median(differences), len(differences)


def _circular_median(angles: list[float]) -> float:
    """The angle minimising the sum of circular distances to the sample.

    A plain mean of wrapped differences is wrong near the +/-pi boundary and an
    arithmetic median is wrong for the same reason, so the candidate set is the
    sample itself and the cost is evaluated circularly.
    """
    if not angles:
        return 0.0
    if len(angles) == 1:
        return angles[0]
    best_angle = angles[0]
    best_cost = math.inf
    for candidate in angles:
        cost = sum(abs(wrap(angle - candidate)) for angle in angles)
        if cost < best_cost:
            best_cost, best_angle = cost, candidate
    return best_angle


def regularise_field(
    transform_field: TransformField,
    config: TransformConfig,
) -> TransformField:
    """Total-variation smoothing of the residual drift field (section 12).

    The L1 term encourages plateaus and permits abrupt jumps; the second
    difference discourages jitter.  Joints with their own strong evidence are
    pinned: the regulariser exists to fill in weakly supported joints, never to
    overwrite a measured local transform for the sake of a smooth curve.
    """
    ordered = sorted(transform_field.states.values(), key=lambda s: s.sequence)
    if len(ordered) < 3:
        return transform_field

    values = [state.axial_residual_m for state in ordered]
    weights = [max(state.confidence, 0.01) * (1 + state.support) for state in ordered]

    for _pass in range(config.smoothing_passes):
        updated = list(values)
        for index in range(len(values)):
            neighbours = []
            if index > 0:
                neighbours.append(values[index - 1])
            if index < len(values) - 1:
                neighbours.append(values[index + 1])
            if not neighbours:
                continue
            # Weighted pull toward the neighbours, damped by this joint's own
            # evidence.  A high-support joint barely moves; an unsupported one
            # inherits its neighbourhood, which is the plateau behaviour the
            # total-variation term is there to produce.
            pull = config.lambda_total_variation / (1.0 + weights[index])
            curvature = config.lambda_curvature / (1.0 + weights[index])
            target = sum(neighbours) / len(neighbours)
            updated[index] = (
                values[index] * (1 - pull - curvature)
                + target * (pull + curvature)
            )
        values = updated

    for state, value in zip(ordered, values):
        if state.provenance == PROVENANCE_BOUNDARY and state.support == 0:
            state.axial_residual_m = value
            state.provenance = PROVENANCE_SMOOTHED
    return transform_field


def apply_rescue_transform(
    state: TransformState,
    joint: PersistentJoint,
    axial_shift_u: float,
    clock_rotation_rad: float,
    clock_shear_rad_per_u: float,
    support: int,
    confidence: float,
    axial_sigma_m: float | None = None,
    clock_sigma_rad: float | None = None,
) -> TransformState:
    """Fold an accepted Pattern Rescue transform into the field (section 25.11).

    The rescue estimates a shift in normalised joint coordinates; it is stored
    back in metres so every downstream consumer keeps reading one transform
    model rather than two.
    """
    state.axial_residual_m = axial_shift_u * joint.new_length_m
    state.clock_rotation_rad = clock_rotation_rad
    state.clock_shear_rad_per_u = clock_shear_rad_per_u
    state.support = support
    state.confidence = confidence
    state.provenance = PROVENANCE_RESCUE
    state.axial_sigma_m = axial_sigma_m
    state.clock_sigma_rad = clock_sigma_rad
    return state
