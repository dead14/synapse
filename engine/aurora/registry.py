"""Persistent physical pipeline space (sections 9 and 25.7).

Vendor joint numbers are run-local aliases.  The cross-run identity is the
PersistentJointID, minted only once both of a joint's structural boundaries are
supported by the anchor map, and everything downstream is expressed in the
dimensionless local coordinate ``u`` rather than in a vendor odometer.
"""

from __future__ import annotations

import bisect
import hashlib
import math
from dataclasses import dataclass, field

from .canonical import CanonicalFeature
from .structure import AnchorMap, ChangeZone, StructuralEvent

STATUS_TRUSTED = "TRUSTED"
STATUS_UNCERTAIN = "UNCERTAIN"
STATUS_CHANGED = "STRUCTURAL_CHANGE"


@dataclass
class PersistentJoint:
    """One physical joint, identified across runs by :attr:`pjid`."""

    pjid: str
    sequence: int
    old_us_m: float
    old_ds_m: float
    new_us_m: float
    new_ds_m: float
    status: str = STATUS_TRUSTED
    # How many anchors were skipped between the two boundaries.  A joint whose
    # boundaries are two matched anchors with gaps between them is a real
    # joint, but a less certain one.
    interior_gaps: int = 0
    boundary_similarity: float = 0.0
    old_alias: int | None = None
    new_alias: int | None = None

    @property
    def old_length_m(self) -> float:
        return self.old_ds_m - self.old_us_m

    @property
    def new_length_m(self) -> float:
        return self.new_ds_m - self.new_us_m

    def to_dict(self) -> dict:
        return {
            "pjid": self.pjid,
            "sequence": self.sequence,
            "status": self.status,
            "oldUsM": round(self.old_us_m, 4),
            "oldDsM": round(self.old_ds_m, 4),
            "newUsM": round(self.new_us_m, 4),
            "newDsM": round(self.new_ds_m, 4),
            "oldLengthM": round(self.old_length_m, 4),
            "newLengthM": round(self.new_length_m, 4),
            "interiorGaps": self.interior_gaps,
            "boundarySimilarity": round(self.boundary_similarity, 4),
            "oldAlias": self.old_alias,
            "newAlias": self.new_alias,
        }


@dataclass
class PersistentJointMap:
    joints: list[PersistentJoint] = field(default_factory=list)
    pipeline_key: str = "pipeline"

    def __post_init__(self) -> None:
        self._old_boundaries = [joint.old_us_m for joint in self.joints]
        self._new_boundaries = [joint.new_us_m for joint in self.joints]

    def reindex(self) -> None:
        self._old_boundaries = [joint.old_us_m for joint in self.joints]
        self._new_boundaries = [joint.new_us_m for joint in self.joints]

    def joint_for(self, x_m: float, side: str) -> PersistentJoint | None:
        """The joint containing ``x_m``, or ``None`` outside every trusted joint.

        Returning ``None`` matters: a feature outside the registered physical
        map has no local frame, and inventing one for it is exactly the
        unconstrained extrapolation section 10.2 forbids.
        """
        boundaries = self._old_boundaries if side == "old" else self._new_boundaries
        if not boundaries:
            return None
        position = bisect.bisect_right(boundaries, x_m) - 1
        if position < 0:
            return None
        joint = self.joints[position]
        upper = joint.old_ds_m if side == "old" else joint.new_ds_m
        return joint if x_m <= upper else None

    def to_dict(self, max_joints: int = 4000) -> dict:
        return {
            "jointCount": len(self.joints),
            "trusted": sum(1 for j in self.joints if j.status == STATUS_TRUSTED),
            "uncertain": sum(1 for j in self.joints if j.status == STATUS_UNCERTAIN),
            "changed": sum(1 for j in self.joints if j.status == STATUS_CHANGED),
            "jointsTruncated": max(0, len(self.joints) - max_joints),
            "joints": [joint.to_dict() for joint in self.joints[:max_joints]],
        }


def _mint_pjid(pipeline_key: str, upstream_x: float, downstream_x: float) -> str:
    """A stable internal identity for the physical joint.

    Derived from the pipeline and the two boundary positions rather than from a
    vendor joint number, so the same physical joint keeps its identity when the
    next run renumbers everything.
    """
    digest = hashlib.sha1(
        f"{pipeline_key}|{upstream_x:.3f}|{downstream_x:.3f}".encode("utf-8")
    ).hexdigest()
    return f"PJ-{digest[:10].upper()}"


def _within_change_zone(
    old_from: float, old_to: float, change_zones: list[ChangeZone]
) -> bool:
    for zone in change_zones:
        if zone.old_x_from is None or zone.old_x_to is None:
            continue
        if old_from <= zone.old_x_to and old_to >= zone.old_x_from:
            return True
    return False


def build_persistent_joints(
    anchor_map: AnchorMap,
    pipeline_key: str = "pipeline",
) -> PersistentJointMap:
    """Consecutive matched anchor pairs become physical joints (section 25.7)."""
    matches: list[StructuralEvent] = anchor_map.matches
    joints: list[PersistentJoint] = []

    # Interior gaps are counted from the event stream, so a joint whose
    # boundaries are matched but which swallowed two unmatched welds is marked
    # uncertain rather than being silently treated as one clean joint.
    match_positions = [
        position for position, event in enumerate(anchor_map.events)
        if event.kind == "MATCH"
    ]

    for sequence, (left, right) in enumerate(zip(matches, matches[1:])):
        old_us, old_ds = left.old_x_m, right.old_x_m
        new_us, new_ds = left.new_x_m, right.new_x_m
        if not (old_ds > old_us and new_ds > new_us):
            continue

        start = match_positions[sequence]
        end = match_positions[sequence + 1]
        interior = end - start - 1

        status = STATUS_TRUSTED
        if _within_change_zone(old_us, old_ds, anchor_map.change_zones):
            status = STATUS_CHANGED
        elif interior > 0:
            status = STATUS_UNCERTAIN

        joints.append(PersistentJoint(
            pjid=_mint_pjid(pipeline_key, old_us, old_ds),
            sequence=sequence,
            old_us_m=old_us,
            old_ds_m=old_ds,
            new_us_m=new_us,
            new_ds_m=new_ds,
            status=status,
            interior_gaps=interior,
            boundary_similarity=min(left.similarity, right.similarity),
        ))

    joint_map = PersistentJointMap(joints=joints, pipeline_key=pipeline_key)
    joint_map.reindex()
    return joint_map


def assign_local_coordinates(
    features: list[CanonicalFeature],
    joint_map: PersistentJointMap,
    side: str,
) -> tuple[list[CanonicalFeature], list[CanonicalFeature]]:
    """Express every feature in its joint's ``u``, and say which have no joint.

    ``u = (x - x_US) / (x_DS - x_US)`` is invariant to translation and largely
    robust to a local linear scale difference, which is why the rest of the
    engine works in it rather than in metres.
    """
    inside: list[CanonicalFeature] = []
    outside: list[CanonicalFeature] = []
    for feature in features:
        if not math.isfinite(feature.x_raw_m):
            outside.append(feature)
            continue
        joint = joint_map.joint_for(feature.x_raw_m, side)
        if joint is None:
            feature.pjid = None
            feature.u = None
            outside.append(feature)
            continue
        upstream = joint.old_us_m if side == "old" else joint.new_us_m
        length = joint.old_length_m if side == "old" else joint.new_length_m
        feature.pjid = joint.pjid
        feature.u = (feature.x_raw_m - upstream) / length if length > 0 else 0.0
        inside.append(feature)
    return inside, outside


def group_by_joint(features: list[CanonicalFeature]) -> dict[str, list[CanonicalFeature]]:
    grouped: dict[str, list[CanonicalFeature]] = {}
    for feature in features:
        if feature.pjid is None:
            continue
        grouped.setdefault(feature.pjid, []).append(feature)
    for members in grouped.values():
        members.sort(key=lambda f: (f.u if f.u is not None else 0.0, f.key))
    return grouped
