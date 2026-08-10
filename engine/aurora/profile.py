"""Capability, data quality and operating mode (sections 4, 19 and 25.4).

The profiler decides what evidence is *usable*.  It never decides a match, and
it never reads a year or a vendor name to reach a conclusion — the mode comes
out of measured coverage, residuals and tool metadata, which is what makes the
same code correct for a pair of runs it has never seen.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field

from .canonical import (
    ANCHOR_RELIABILITY,
    CanonicalFeature,
    GIRTH_WELD,
    METAL_LOSS,
)

# Operating modes (section 4.1).  M7 is not selected here: Pattern Rescue is a
# per-region decision taken at run time by the direct-match health gate.
MODE_STANDARD = "M1_STANDARD"
MODE_SEVERE_DRIFT = "M2_SEVERE_DRIFT"
MODE_SPARSE_ANCHOR = "M3_SPARSE_ANCHOR"
MODE_CROSS_TECH = "M4_CROSS_TECH"
MODE_STRUCTURAL_CHANGE = "M5_STRUCTURAL_CHANGE"
MODE_MULTI_RUN = "M6_MULTI_RUN"
MODE_PATTERN_RESCUE = "M7_PATTERN_RESCUE"

DEFAULT_PROFILE_ID = "DEFAULT_PROFILE"


@dataclass(frozen=True)
class ToolProfile:
    """What a tool can be trusted to report (section 19).

    Vendor and model are metadata carried for audit.  They are never branched
    on: the algorithm reads ``technology`` and the stated uncertainties, and
    falls back to a conservative default when those are unknown.
    """

    profile_id: str = DEFAULT_PROFILE_ID
    technology: str | None = None
    vendor: str | None = None
    model: str | None = None
    axial_sigma_m: float | None = None
    clock_sigma_rad: float | None = None
    depth_sigma_pct: float | None = None
    uncertainty_provenance: str = "DEFAULT_PROFILE"

    @classmethod
    def from_run(cls, run: dict | None) -> "ToolProfile":
        run = run or {}
        technology = run.get("technology") or run.get("toolTechnology")
        vendor = run.get("vendor")
        stated = run.get("statedUncertainties") or {}
        provenance = "VENDOR_STATED" if stated else "DEFAULT_PROFILE"
        return cls(
            profile_id=str(run.get("toolProfileId") or DEFAULT_PROFILE_ID),
            technology=str(technology).upper() if technology else None,
            vendor=str(vendor) if vendor else None,
            model=str(run.get("toolModel")) if run.get("toolModel") else None,
            axial_sigma_m=_positive(stated.get("axial_m")),
            clock_sigma_rad=_positive(stated.get("clock_rad")),
            depth_sigma_pct=_positive(stated.get("depth_pct")),
            uncertainty_provenance=provenance,
        )


def _positive(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


@dataclass
class CapabilityProfile:
    """Measured availability and quality of every evidence stream (section 4)."""

    anchor_count_old: int = 0
    anchor_count_new: int = 0
    anchor_coverage: float = 0.0
    median_anchor_gap_m: float | None = None
    clock_coverage: float = 0.0
    dimension_coverage: float = 0.0
    surface_coverage: float = 0.0
    metal_loss_old: int = 0
    metal_loss_new: int = 0
    density_ratio: float | None = None
    coarse_offset_m: float = 0.0
    drift_estimate_m: float = 0.0
    tool_comparability: float = 1.0
    cross_technology: bool = False
    run_count: int = 2
    warnings: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "anchorCountOld": self.anchor_count_old,
            "anchorCountNew": self.anchor_count_new,
            "anchorCoverage": round(self.anchor_coverage, 4),
            "medianAnchorGapM": (
                round(self.median_anchor_gap_m, 3)
                if self.median_anchor_gap_m is not None else None
            ),
            "clockCoverage": round(self.clock_coverage, 4),
            "dimensionCoverage": round(self.dimension_coverage, 4),
            "surfaceCoverage": round(self.surface_coverage, 4),
            "metalLossOld": self.metal_loss_old,
            "metalLossNew": self.metal_loss_new,
            "densityRatio": (
                round(self.density_ratio, 4) if self.density_ratio is not None else None
            ),
            "coarseOffsetM": round(self.coarse_offset_m, 3),
            "driftEstimateM": round(self.drift_estimate_m, 3),
            "toolComparability": round(self.tool_comparability, 3),
            "crossTechnology": self.cross_technology,
            "runCount": self.run_count,
            "warnings": self.warnings,
        }


def _coverage(features: list[CanonicalFeature], predicate) -> float:
    metal_loss = [f for f in features if f.feature_class == METAL_LOSS]
    if not metal_loss:
        return 0.0
    return sum(1 for f in metal_loss if predicate(f)) / len(metal_loss)


def _anchor_gaps(anchors: list[CanonicalFeature]) -> list[float]:
    return [
        right.x_raw_m - left.x_raw_m
        for left, right in zip(anchors, anchors[1:])
        if right.x_raw_m > left.x_raw_m
    ]


def build_capability_profile(
    old_features: list[CanonicalFeature],
    new_features: list[CanonicalFeature],
    old_tool: ToolProfile,
    new_tool: ToolProfile,
    run_count: int = 2,
) -> CapabilityProfile:
    old_anchors = [f for f in old_features if f.is_anchor]
    new_anchors = [f for f in new_features if f.is_anchor]
    old_metal_loss = [f for f in old_features if f.feature_class == METAL_LOSS]
    new_metal_loss = [f for f in new_features if f.feature_class == METAL_LOSS]

    profile = CapabilityProfile(run_count=run_count)
    profile.anchor_count_old = len(old_anchors)
    profile.anchor_count_new = len(new_anchors)
    profile.metal_loss_old = len(old_metal_loss)
    profile.metal_loss_new = len(new_metal_loss)

    gaps = _anchor_gaps(old_anchors) + _anchor_gaps(new_anchors)
    profile.median_anchor_gap_m = statistics.median(gaps) if gaps else None

    # Coverage is the fraction of the line that has an anchor within a
    # plausible joint length of it.  With no anchors at all this is zero, which
    # is what pushes the job into SPARSE_ANCHOR rather than into a false
    # STANDARD run on an empty structural map.
    span = _span(old_features + new_features)
    if span > 0 and profile.median_anchor_gap_m:
        expected = span / max(profile.median_anchor_gap_m, 1e-6)
        observed = min(len(old_anchors), len(new_anchors))
        profile.anchor_coverage = max(0.0, min(1.0, observed / max(expected, 1.0)))
    elif old_anchors and new_anchors:
        profile.anchor_coverage = 0.5

    combined = old_features + new_features
    profile.clock_coverage = _coverage(combined, lambda f: f.clock_rad is not None)
    profile.dimension_coverage = _coverage(
        combined, lambda f: f.depth_pct is not None and f.length_mm is not None
    )
    profile.surface_coverage = _coverage(combined, lambda f: f.surface is not None)

    if old_metal_loss and new_metal_loss:
        profile.density_ratio = len(new_metal_loss) / len(old_metal_loss)

    profile.coarse_offset_m, profile.drift_estimate_m = _estimate_drift(
        old_anchors, new_anchors
    )

    profile.cross_technology = bool(
        old_tool.technology and new_tool.technology
        and old_tool.technology != new_tool.technology
    )
    # Comparability is evidence reliability, not a verdict.  It modulates
    # variance downstream; it never decides a match on its own.
    profile.tool_comparability = 0.6 if profile.cross_technology else 1.0
    if old_tool.uncertainty_provenance == "DEFAULT_PROFILE" or \
            new_tool.uncertainty_provenance == "DEFAULT_PROFILE":
        profile.tool_comparability *= 0.9
        profile.warnings.append({
            "code": "TOOL_UNCERTAINTY_DEFAULTED",
            "severity": "INFO",
            "message": (
                "At least one run states no tool uncertainty; the conservative "
                "default profile is used and automation confidence is reduced."
            ),
        })

    if profile.clock_coverage < 0.2:
        profile.warnings.append({
            "code": "CLOCK_COVERAGE_LOW",
            "severity": "REVIEW",
            "message": (
                "Fewer than one in five metal-loss features carries a readable "
                "clock position; circumferential evidence is largely unavailable."
            ),
        })
    if min(len(old_anchors), len(new_anchors)) == 0:
        profile.warnings.append({
            "code": "NO_STRUCTURAL_ANCHORS",
            "severity": "CRITICAL",
            "message": (
                "One run reports no structural anchors at all; nothing can be "
                "registered and every candidate would be an unconstrained guess."
            ),
        })
    return profile


def _span(features: list[CanonicalFeature]) -> float:
    positions = [f.x_raw_m for f in features if math.isfinite(f.x_raw_m)]
    if len(positions) < 2:
        return 0.0
    return max(positions) - min(positions)


def _estimate_drift(
    old_anchors: list[CanonicalFeature],
    new_anchors: list[CanonicalFeature],
) -> tuple[float, float]:
    """Coarse global offset and how much it varies along the line.

    This is a banding aid and a mode signal only (section 8): a large offset is
    never by itself evidence of a wrong match, because millimetre differences
    in reported joint length accumulate to metres over a long pipeline
    (section 10.1).
    """
    if not old_anchors or not new_anchors:
        return 0.0, 0.0

    old_positions = [f.x_raw_m for f in old_anchors]
    new_positions = [f.x_raw_m for f in new_anchors]
    # Offset from the ends rather than from a pairing: pairing is what the
    # structural registration does later, and doing it here would make the mode
    # depend on the answer it is supposed to help find.
    head = new_positions[0] - old_positions[0]
    tail = new_positions[-1] - old_positions[-1]
    coarse = (head + tail) / 2.0
    return coarse, abs(tail - head)


def select_operating_mode(
    profile: CapabilityProfile,
    structural_change_detected: bool = False,
) -> tuple[str, list[str]]:
    """Choose the operating mode from evidence, and say why (section 4.1).

    The reasons are returned with the mode and stored in the artifacts: an
    operating mode nobody can explain is not auditable.
    """
    reasons: list[str] = []

    if profile.run_count >= 3:
        reasons.append(f"{profile.run_count} usable runs")
        return MODE_MULTI_RUN, reasons

    if structural_change_detected:
        reasons.append("repair/cut-out/reroute evidence in the anchor map")
        return MODE_STRUCTURAL_CHANGE, reasons

    if profile.cross_technology:
        reasons.append("the two runs report different sensing technologies")
        return MODE_CROSS_TECH, reasons

    if profile.anchor_coverage < 0.35 or min(
        profile.anchor_count_old, profile.anchor_count_new
    ) < 5:
        reasons.append(
            f"anchor coverage {profile.anchor_coverage:.0%} with "
            f"{min(profile.anchor_count_old, profile.anchor_count_new)} usable anchors"
        )
        return MODE_SPARSE_ANCHOR, reasons

    gap = profile.median_anchor_gap_m or 12.0
    if profile.drift_estimate_m > max(2.0, 0.25 * gap):
        reasons.append(
            f"axial drift varies by {profile.drift_estimate_m:.2f} m across the run"
        )
        return MODE_SEVERE_DRIFT, reasons

    reasons.append(
        f"anchor coverage {profile.anchor_coverage:.0%}, "
        f"drift {profile.drift_estimate_m:.2f} m"
    )
    return MODE_STANDARD, reasons


def anchor_reliability(feature_class: str) -> float:
    return ANCHOR_RELIABILITY.get(feature_class, 0.3)


def girth_weld_fraction(anchors: list[CanonicalFeature]) -> float:
    if not anchors:
        return 0.0
    return sum(1 for a in anchors if a.feature_class == GIRTH_WELD) / len(anchors)
