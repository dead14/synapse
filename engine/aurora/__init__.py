"""AURORA-ILI — Adaptive Universal Registration of Odometer, Rotation & Anomalies.

An evidence-driven registration and re-identification engine for correlating
in-line inspection data across years, vendors, tool generations and reporting
conventions.  Alignment is treated as a latent physical registration problem,
not as a fixed-tolerance spreadsheet join.

The universality rule is structural: no branch in this package may depend on an
inspection year, a vendor name, a spreadsheet column or one reference pipeline.
Everything source-specific stops at the adapter that produces the canonical
records this package consumes.
"""

from .canonical import (
    CanonicalFeature,
    canonicalize,
    canonicalize_run,
    classify,
    clock_to_radians,
    wrap,
    wrap_2pi,
)
from .config import AuroraConfig, CONFIG_VERSION, MODEL_VERSION, resolve_config
from .orchestrator import AuroraResult, run_aurora_alignment
from .profile import CapabilityProfile, ToolProfile, select_operating_mode
from .rescue import RescueCase, run_pattern_rescue
from .structure import assert_non_crossing, register_structure

__all__ = [
    "AuroraConfig",
    "AuroraResult",
    "CanonicalFeature",
    "CapabilityProfile",
    "CONFIG_VERSION",
    "MODEL_VERSION",
    "RescueCase",
    "ToolProfile",
    "assert_non_crossing",
    "canonicalize",
    "canonicalize_run",
    "classify",
    "clock_to_radians",
    "register_structure",
    "resolve_config",
    "run_aurora_alignment",
    "run_pattern_rescue",
    "select_operating_mode",
    "wrap",
    "wrap_2pi",
]
