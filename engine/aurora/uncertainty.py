"""Universal uncertainty model (section 18).

Each run and each tool may state different accuracies, so AURORA combines
measurement and registration uncertainty instead of applying one fixed
tolerance to every pair of runs.  Where a vendor states nothing, the default
profile is used and the provenance says so, which is what lets a reviewer tell
a measured gate from an assumed one.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .config import UncertaintyConfig
from .profile import CapabilityProfile, ToolProfile


@dataclass(frozen=True)
class ResidualModel:
    """The combined ``Sigma_total`` for one run pair, as two scalar sigmas.

    Axial and circumferential residuals are treated as independent, so the
    Mahalanobis form reduces to a sum of two normalised squares.  A full
    covariance is only worth carrying once the cross term is actually
    estimated, which happens in Pattern Rescue and is folded in there.
    """

    axial_sigma_m: float
    clock_sigma_rad: float
    provenance: str
    dof: float

    def mahalanobis_squared(
        self, axial_residual_m: float, clock_residual_rad: float | None
    ) -> float:
        total = (axial_residual_m / self.axial_sigma_m) ** 2
        if clock_residual_rad is not None:
            total += (clock_residual_rad / self.clock_sigma_rad) ** 2
        return total

    def geometric_similarity(
        self, axial_residual_m: float, clock_residual_rad: float | None
    ) -> float:
        """``S_geom`` under a Student-t likelihood (section 18.1).

        Heavy tails matter here: ILI residuals are not Gaussian, and a Gaussian
        lets one moderate residual veto every other piece of strong evidence.
        """
        distance = self.mahalanobis_squared(axial_residual_m, clock_residual_rad)
        dimensions = 2.0 if clock_residual_rad is not None else 1.0
        log_likelihood = -((self.dof + dimensions) / 2.0) * math.log(
            1.0 + distance / self.dof
        )
        return math.exp(log_likelihood)

    def to_dict(self) -> dict:
        return {
            "axialSigmaM": round(self.axial_sigma_m, 4),
            "clockSigmaDeg": round(math.degrees(self.clock_sigma_rad), 2),
            "provenance": self.provenance,
            "studentTDof": self.dof,
        }


def build_residual_model(
    old_tool: ToolProfile,
    new_tool: ToolProfile,
    capability: CapabilityProfile,
    config: UncertaintyConfig,
    transform_sigma_m: float | None = None,
    transform_sigma_rad: float | None = None,
) -> ResidualModel:
    """``Sigma_total = Sigma_runA + Sigma_runB + Sigma_transform + Sigma_model``."""
    axial_terms = [
        old_tool.axial_sigma_m or config.default_axial_sigma_m,
        new_tool.axial_sigma_m or config.default_axial_sigma_m,
        transform_sigma_m if transform_sigma_m is not None else config.transform_sigma_m,
    ]
    clock_terms = [
        old_tool.clock_sigma_rad or config.default_clock_sigma_rad,
        new_tool.clock_sigma_rad or config.default_clock_sigma_rad,
        transform_sigma_rad if transform_sigma_rad is not None else config.transform_sigma_rad,
    ]
    axial = math.sqrt(sum(term * term for term in axial_terms))
    clock = math.sqrt(sum(term * term for term in clock_terms))

    if capability.cross_technology:
        # Cross-technology comparison inflates the geometric terms rather than
        # disabling them: the structure is still comparable, the sizing is not.
        axial *= config.cross_technology_inflation
        clock *= config.cross_technology_inflation

    provenance = (
        "VENDOR_STATED"
        if old_tool.uncertainty_provenance == "VENDOR_STATED"
        and new_tool.uncertainty_provenance == "VENDOR_STATED"
        else "DEFAULT_PROFILE"
    )
    return ResidualModel(
        axial_sigma_m=axial,
        clock_sigma_rad=clock,
        provenance=provenance,
        dof=config.student_t_dof,
    )


def dimension_compatibility(
    old_value: float | None,
    new_value: float | None,
    capability: CapabilityProfile,
) -> tuple[float, int]:
    """Evidence from a reported dimension, with its availability mask.

    Depth, length and width are deliberately weak identity evidence across tool
    generations (section 17): real growth, sizing tolerance and a changed
    reporting algorithm all move them.  The mask is returned so the caller
    normalises over available evidence only.
    """
    if old_value is None or new_value is None:
        return 0.0, 0
    if old_value <= 0 or new_value <= 0:
        return 0.0, 0
    ratio = math.log(new_value / old_value)
    # One natural-log unit is a factor of e; a factor of two between runs is
    # unremarkable for a resized box, which is why the scale is this loose.
    scale = 0.9 / max(capability.tool_comparability, 0.2)
    return math.exp(-0.5 * (ratio / scale) ** 2), 1
