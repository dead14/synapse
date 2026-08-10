"""Evidence scoring, calibration and confidence classes (section 21).

An arbitrary weighted sum is not a probability, so the interpretable evidence
score and the calibrated ``P(match)`` are kept apart.  The calibration is a
logistic model because it is inspectable: every coefficient can be read, argued
with and replaced once engineer-confirmed labels exist, and the model version
travels with every result so a score can be reproduced.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass

from .config import ScoreConfig

AUTO_MATCH = "AUTO_MATCH"
PROBABLE_REVIEW = "PROBABLE_REVIEW"
AMBIGUOUS = "AMBIGUOUS"
UNMATCHED = "UNMATCHED"
STRUCTURAL_CHANGE = "STRUCTURAL_CHANGE"


@dataclass
class EvidenceVector:
    """``X_ij`` from section 17, with one availability mask per term."""

    geometry: float = 0.0
    geometry_available: bool = False
    region: float = 0.0
    region_available: bool = False
    motif: float = 0.0
    motif_available: bool = False
    surface: float = 0.0
    surface_available: bool = False
    structure: float = 0.0
    uniqueness: float = 0.0
    dimension: float = 0.0
    dimension_available: bool = False
    axial_residual_m: float | None = None
    clock_residual_rad: float | None = None
    mahalanobis_squared: float | None = None

    def to_dict(self) -> dict:
        data = asdict(self)
        if self.clock_residual_rad is not None:
            data["clockResidualDeg"] = round(math.degrees(self.clock_residual_rad), 2)
        return data


def raw_evidence_score(evidence: EvidenceVector, config: ScoreConfig) -> float:
    """``S_raw``: a weighted geometric mean over *available* evidence only.

    Geometric rather than arithmetic so one term at zero pulls the score down
    hard — a candidate that fails the geometry is not rescued by agreeing on
    surface — while an unavailable term simply leaves the average.
    """
    terms: list[tuple[float, float]] = [
        (evidence.structure, config.weight_structure),
        (evidence.uniqueness, config.weight_uniqueness),
    ]
    if evidence.geometry_available:
        terms.append((evidence.geometry, config.weight_geometry))
    if evidence.region_available:
        terms.append((evidence.region, config.weight_region))
    if evidence.motif_available:
        terms.append((evidence.motif, config.weight_motif))
    if evidence.surface_available:
        terms.append((evidence.surface, config.weight_surface))
    if evidence.dimension_available:
        terms.append((evidence.dimension, config.weight_dimension))

    weight_total = sum(weight for _value, weight in terms)
    if weight_total <= 0:
        return 0.0
    accumulated = sum(
        weight * math.log(max(value, 1e-6)) for value, weight in terms
    )
    return math.exp(accumulated / weight_total)


def calibrate_probability(evidence: EvidenceVector, config: ScoreConfig) -> float:
    """``P_match = sigmoid(beta_0 + beta^T X)`` over available evidence.

    Terms whose mask is unset contribute nothing at all rather than
    contributing a zero, which would be a statement that the evidence argues
    *against* the match.
    """
    logit = config.intercept
    logit += config.weight_structure * evidence.structure
    logit += config.weight_uniqueness * evidence.uniqueness
    if evidence.geometry_available:
        logit += config.weight_geometry * evidence.geometry
    if evidence.region_available:
        logit += config.weight_region * evidence.region
    if evidence.motif_available:
        logit += config.weight_motif * evidence.motif
    if evidence.surface_available:
        logit += config.weight_surface * evidence.surface
    if evidence.dimension_available:
        logit += config.weight_dimension * evidence.dimension
    return 1.0 / (1.0 + math.exp(-max(-40.0, min(40.0, logit))))


def classify_confidence(
    probability: float,
    ambiguity_margin: float,
    structural_conflict: bool,
    config: ScoreConfig,
) -> str:
    """Route a candidate to a queue (section 21.1).

    A high probability with a small ambiguity margin still goes to review: two
    candidates the model cannot separate are exactly the case where an
    automatic decision costs the most.
    """
    if structural_conflict:
        return STRUCTURAL_CHANGE
    if probability < config.review_probability:
        return UNMATCHED
    if ambiguity_margin < config.min_ambiguity_margin:
        return AMBIGUOUS
    if probability >= config.auto_match_probability:
        return AUTO_MATCH
    return PROBABLE_REVIEW


def explain(evidence: EvidenceVector, transform_note: str | None = None) -> list[str]:
    """The human-readable half of the explainability contract (section 22)."""
    lines: list[str] = []
    if evidence.axial_residual_m is not None:
        lines.append(f"axial residual {evidence.axial_residual_m:+.3f} m after registration")
    if evidence.clock_residual_rad is not None:
        lines.append(
            f"clock residual {math.degrees(evidence.clock_residual_rad):+.1f} deg after rotation"
        )
    if evidence.mahalanobis_squared is not None:
        lines.append(f"normalised residual D^2 = {evidence.mahalanobis_squared:.2f}")
    if evidence.region_available:
        lines.append(f"region similarity {evidence.region:.2f}")
    if evidence.motif_available:
        lines.append(f"neighbourhood/motif similarity {evidence.motif:.2f}")
    if evidence.surface_available:
        lines.append(
            "surface agrees" if evidence.surface >= 0.5 else "surface disagrees"
        )
    if not evidence.dimension_available:
        lines.append("depth/length not comparable — not used as identity evidence")
    lines.append(f"structural support {evidence.structure:.2f}")
    if transform_note:
        lines.append(transform_note)
    return lines
