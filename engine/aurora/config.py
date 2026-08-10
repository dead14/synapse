"""Versioned AURORA configuration.

Section 30 of the specification forbids hard-coded thresholds in the core.
Every number the algorithm reads therefore lives here, in physical units or in
probability/quantile terms, and every artifact records ``CONFIG_VERSION`` so a
result can be replayed exactly.

Defaults are starting points, not standards.  A caller overrides them per job
by passing a dict to :func:`resolve_config`; the merged values, not the
defaults, are what the artifacts record.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, fields, replace

CONFIG_VERSION = "universal-v1.2.0"
MODEL_VERSION = "aurora-calibration-v1-logistic"


@dataclass(frozen=True)
class AnchorConfig:
    """Fingerprint construction and comparison (sections 7 and 25.5)."""

    # Multi-scale windows, smallest first.  A repetitive pipe string needs the
    # wider window; a distinctive short pup is already unique at K=2.
    windows: tuple[int, ...] = (2, 3, 5, 7)
    # Huber transition, in units of the scaled residual.
    huber_kappa: float = 1.5
    # Saturation of the per-term loss.  A plain Huber still grows without
    # bound, so a single merged or missing joint next to an otherwise perfect
    # anchor could veto it outright — which is precisely the "one bad joint
    # dominating" failure the robust loss exists to prevent.  Beyond this the
    # term simply says "this component disagrees", and the remaining evidence
    # decides.
    max_term_loss: float = 4.0
    # Scale of the normalised joint-length ratio term.  Joint lengths agree to
    # well under a percent between runs of the same pipe; 3% is the point past
    # which two joints are a different pair.
    ratio_sigma: float = 0.03
    # Scale of the absolute joint-length term, in metres.  Deliberately looser
    # than the ratio term: absolute lengths carry the odometer's own error.
    length_sigma_m: float = 0.35
    weight_ratio: float = 1.0
    weight_length: float = 0.45
    weight_type: float = 0.8
    weight_wall_thickness: float = 0.3
    # Below this best-versus-second-best separation the anchor is ambiguous and
    # may not be treated as a hard correspondence on its own (section 7.1).
    uniqueness_min: float = 0.08


@dataclass(frozen=True)
class StructureConfig:
    """Order-preserving sequence registration (sections 8 and 25.6)."""

    gap_open: float = 0.55
    gap_extend: float = 0.18
    weight_fingerprint: float = 1.0
    weight_type: float = 0.6
    weight_coarse_position: float = 0.25
    # Half-width of the candidate band around the coarse map, in metres.  This
    # is computational banding only; it never decides identity.
    band_m: float = 45.0
    # A band is also bounded in index space so a dense cluster of anchors
    # cannot make the band cover the whole run.
    band_indices: int = 60
    # Second pass.  Once a coarse monotonic map exists, the *absolute* position
    # has been made reliable by construction, so the position term may be tight
    # — which is what stops a fingerprint degraded by a neighbouring structural
    # change from pulling a match one joint sideways.
    refine_position_sigma_m: float = 4.0
    refine_weight_position: float = 1.6
    refine_min_similarity: float = 0.45
    refine_min_pairs: int = 5
    # Knots whose residual disagrees with their neighbourhood by more than this
    # are dropped before the coarse map is fitted.  Without it the refinement
    # inherits the first pass's own mistakes and confirms them.
    refine_outlier_m: float = 2.0
    refine_outlier_window: int = 7
    # Consecutive unmatched anchors on one side beyond this count read as a
    # physical modification rather than as missed detections.
    change_zone_gap_run: int = 4
    # A change zone is also declared when the two sides disagree by more than
    # this distance across an otherwise contiguous stretch.
    change_zone_residual_m: float = 12.0
    min_matched_anchors: int = 3


@dataclass(frozen=True)
class TransformConfig:
    """Axial and circumferential registration (sections 10 to 12)."""

    # A local axial scale outside this band is not a drifting odometer, it is a
    # mis-paired joint.
    scale_min: float = 0.85
    scale_max: float = 1.15
    # Total-variation and second-difference weights of the drift-field
    # regulariser (section 12).  L1 keeps plateaus, the second difference
    # discourages jitter.
    lambda_total_variation: float = 0.35
    lambda_curvature: float = 0.15
    smoothing_passes: int = 24
    # A local clock rotation is only adopted with this much independent support.
    clock_min_support: int = 3


@dataclass(frozen=True)
class PatternConfig:
    """Relative geometry, regions and density (sections 13 to 16)."""

    neighbours: int = 6
    # Kernel bandwidths of the transform-vote accumulator, in the units of the
    # voted quantities: normalised axial position and radians.
    vote_bandwidth_u: float = 0.035
    vote_bandwidth_rad: float = 0.20
    # Region building in corrected cylindrical space.
    region_epsilon_u: float = 0.06
    region_epsilon_rad: float = 0.45
    region_min_members: int = 2


@dataclass(frozen=True)
class RescueConfig:
    """Pattern Rescue trigger and consensus (sections 16.2 and 25.10)."""

    # Direct-match health at or above this needs no rescue (section 25.9).
    direct_ok: float = 0.55
    # Structural confidence the corridor must carry before a rescue may run.
    structure_min: float = 0.5
    # Fewer points than this cannot carry a relative-geometry argument.
    min_information: int = 3
    min_inliers: int = 3
    inlier_gate_u: float = 0.05
    inlier_gate_rad: float = 0.30
    # Best versus second-best transform mode.  A repetitive pattern that two
    # transforms explain equally well is rejected, not rescued.
    uniqueness_min: float = 0.20
    # Fraction of the smaller population that must fall inside the transform.
    min_inlier_fraction: float = 0.35
    # A rescue never leaves its structural corridor; this is how far the
    # corridor may extend beyond the registered joint, in joint counts.
    corridor_joint_span: int = 0
    max_points_per_window: int = 600
    # Longitudinal clock shear stays off unless it earns its place (section
    # 11.1).  It must never become a free warping parameter used to force
    # arbitrary point matches, so it is off by default, bounded, and adopted
    # only when it measurably improves the residual fit.
    enable_clock_shear: bool = False
    shear_min_support: int = 8
    shear_improvement_min: float = 0.25
    shear_max_rad_per_u: float = 0.5


@dataclass(frozen=True)
class UncertaintyConfig:
    """Residual models (section 18)."""

    # Per-run axial reporting uncertainty, in metres, when the tool profile
    # states nothing.  Provenance is recorded as DEFAULT_PROFILE.
    default_axial_sigma_m: float = 0.35
    # ~8.6 degrees.  Deliberately near a high-resolution tool's stated clock
    # accuracy rather than near a comfortable review window: a systematic shift
    # is meant to be recovered as a rotation, and a loose sigma here would
    # swallow exactly the shifts Pattern Rescue exists to estimate.
    default_clock_sigma_rad: float = 0.15
    # Registration uncertainty added on top of the two measurement terms.
    transform_sigma_m: float = 0.20
    transform_sigma_rad: float = 0.10
    # Cross-technology inflation applied to every geometric term.
    cross_technology_inflation: float = 1.8
    # Student-t degrees of freedom.  Low values keep one moderate residual from
    # dominating the rest of the evidence.
    student_t_dof: float = 4.0
    # Candidate gate, as a chi-square quantile on two degrees of freedom.
    mahalanobis_gate: float = 9.21  # 99%


@dataclass(frozen=True)
class ScoreConfig:
    """Calibration and confidence classes (section 21)."""

    auto_match_probability: float = 0.88
    review_probability: float = 0.55
    # A high probability with competing candidates still goes to review.
    min_ambiguity_margin: float = 0.15
    # Logistic calibration coefficients.  Transparent and inspectable by
    # design; they are replaced by fitted values once labelled review data
    # exists, and the model version changes with them.
    intercept: float = -1.15
    weight_geometry: float = 3.30
    weight_region: float = 1.10
    weight_motif: float = 0.75
    weight_surface: float = 0.35
    weight_structure: float = 0.90
    weight_uniqueness: float = 0.80
    weight_dimension: float = 0.25


@dataclass(frozen=True)
class AuroraConfig:
    anchors: AnchorConfig = field(default_factory=AnchorConfig)
    structure: StructureConfig = field(default_factory=StructureConfig)
    transform: TransformConfig = field(default_factory=TransformConfig)
    pattern: PatternConfig = field(default_factory=PatternConfig)
    rescue: RescueConfig = field(default_factory=RescueConfig)
    uncertainty: UncertaintyConfig = field(default_factory=UncertaintyConfig)
    score: ScoreConfig = field(default_factory=ScoreConfig)
    config_version: str = CONFIG_VERSION
    model_version: str = MODEL_VERSION

    def to_dict(self) -> dict:
        return asdict(self)


_SECTIONS = {
    "anchors": AnchorConfig,
    "structure": StructureConfig,
    "transform": TransformConfig,
    "pattern": PatternConfig,
    "rescue": RescueConfig,
    "uncertainty": UncertaintyConfig,
    "score": ScoreConfig,
}


def resolve_config(overrides: dict | None = None) -> AuroraConfig:
    """Merge per-job overrides over the defaults.

    Unknown keys are ignored rather than raising: an operator profile written
    for a later version of the engine must not stop this one from running, and
    the artifacts record what was actually used either way.
    """
    config = AuroraConfig()
    if not overrides:
        return config

    updates: dict = {}
    for name, section_type in _SECTIONS.items():
        section_overrides = overrides.get(name)
        if not isinstance(section_overrides, dict):
            continue
        known = {f.name for f in fields(section_type)}
        accepted = {
            key: value for key, value in section_overrides.items() if key in known
        }
        if accepted:
            updates[name] = replace(getattr(config, name), **accepted)
    if updates:
        config = replace(config, **updates)
    return config
