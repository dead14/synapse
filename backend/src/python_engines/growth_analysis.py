"""Conservative multi-run metal-loss trend estimation for engineering review.

This module deliberately produces no remaining-life or acceptance decision. It
only summarizes a weighted linear trend when the caller supplies three or more
dated depth measurements and their sizing uncertainty.
"""

from datetime import date
from math import isfinite, sqrt


GROWTH_MODEL_VERSION = "weighted-linear-growth-v1"


def _finite(value, field, *, positive=False):
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{field} must be a finite number") from error
    if not isfinite(number) or (positive and number <= 0):
        qualifier = "positive finite" if positive else "finite"
        raise ValueError(f"{field} must be a {qualifier} number")
    return number


def _parse_observation(record):
    if not isinstance(record, dict):
        raise ValueError("each observation must be an object")
    try:
        observed_at = date.fromisoformat(str(record.get("observed_at", "")))
    except ValueError as error:
        raise ValueError("observed_at must be an ISO date") from error
    depth_pct = _finite(record.get("depth_pct"), "depth_pct")
    if depth_pct < 0 or depth_pct > 100:
        raise ValueError("depth_pct must be between 0 and 100")
    uncertainty_pct = _finite(record.get("uncertainty_pct"), "uncertainty_pct", positive=True)
    return observed_at, depth_pct, uncertainty_pct


def estimate_growth_rate(observations):
    """Estimate an uncertainty-weighted depth trend in percent wall thickness/year.

    The result remains advisory and requires engineering review because it does
    not calibrate tool bias, validate matching, or produce a remaining-life
    decision.
    """
    if not isinstance(observations, list) or len(observations) < 3:
        raise ValueError("at least three observations are required")

    parsed = sorted((_parse_observation(record) for record in observations), key=lambda item: item[0])
    dates = [item[0] for item in parsed]
    if len(set(dates)) != len(dates):
        raise ValueError("observed_at values must be unique")

    first_date = dates[0]
    x_values = [(observed_at - first_date).days / 365.25 for observed_at, _, _ in parsed]
    if x_values[-1] <= 0:
        raise ValueError("observations must span more than one date")
    y_values = [depth_pct for _, depth_pct, _ in parsed]
    weights = [1 / (uncertainty_pct ** 2) for _, _, uncertainty_pct in parsed]
    total_weight = sum(weights)
    x_mean = sum(weight * x for weight, x in zip(weights, x_values)) / total_weight
    y_mean = sum(weight * y for weight, y in zip(weights, y_values)) / total_weight
    denominator = sum(weight * ((x - x_mean) ** 2) for weight, x in zip(weights, x_values))
    if denominator <= 0:
        raise ValueError("observations must span distinct time points")

    slope = sum(
        weight * (x - x_mean) * (y - y_mean)
        for weight, x, y in zip(weights, x_values, y_values)
    ) / denominator
    slope_standard_error = sqrt(1 / denominator)
    confidence_half_width = 1.96 * slope_standard_error

    return {
        "model_version": GROWTH_MODEL_VERSION,
        "status": "REVIEW_REQUIRED",
        "requires_engineering_review": True,
        "measurement_count": len(parsed),
        "observed_from": first_date.isoformat(),
        "observed_to": dates[-1].isoformat(),
        "estimated_growth_pct_per_year": slope,
        "confidence_interval_95_pct_per_year": [
            slope - confidence_half_width,
            slope + confidence_half_width,
        ],
        "limitations": [
            "Does not correct ILI sizing bias.",
            "Does not validate anomaly matching or approve an integrity decision.",
        ],
    }
