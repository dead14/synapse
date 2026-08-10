"""Canonical ILI model (section 3) and circular coordinates (section 5.1).

The core operates only on these concepts.  Anything that knows a vendor name, a
spreadsheet column or an inspection year belongs in an adapter, never here.

Two rules from the specification are enforced by this module rather than left
to callers:

* NULL means *unknown*, never zero.  Every optional measurement is ``None`` when
  it was not reported, and every scoring term carries an availability mask so a
  missing field neither rewards nor penalises a candidate (section 3.2).
* Clock is circular.  Ordinary subtraction is invalid around 12 o'clock, so all
  circumferential arithmetic goes through :func:`wrap` and :func:`clock_delta`.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

TWO_PI = 2.0 * math.pi

# Canonical feature taxonomy (section 3.1).  Raw vendor labels are mapped onto
# these by :func:`classify`; the core never sees the raw label.
GIRTH_WELD = "GIRTH_WELD"
METAL_LOSS = "METAL_LOSS"
BEND = "BEND"
TEE_OFFTAKE = "TEE_OFFTAKE"
VALVE = "VALVE"
FLANGE = "FLANGE"
WT_CHANGE = "WT_CHANGE"
DIAMETER_CHANGE = "DIAMETER_CHANGE"
REPAIR = "REPAIR"
MARKER = "MARKER"
OTHER_STRUCTURAL = "OTHER_STRUCTURAL"
CLUSTER = "CLUSTER"
UNKNOWN = "UNKNOWN"

# Classes that may act as structural anchors, with the reliability weight of
# section 6.1.  A girth weld is the densest anchor but never the only one: a
# run with no weld list must still register on valves, tees and markers.
ANCHOR_RELIABILITY = {
    GIRTH_WELD: 1.00,
    VALVE: 0.95,
    TEE_OFFTAKE: 0.92,
    MARKER: 0.90,
    FLANGE: 0.80,
    DIAMETER_CHANGE: 0.75,
    REPAIR: 0.70,
    WT_CHANGE: 0.65,
    BEND: 0.55,
    OTHER_STRUCTURAL: 0.40,
}

# Ordered longest-label-first so "girth weld" is not shadowed by "weld" and a
# "clustered corrosion" row is recognised as a cluster before it is recognised
# as metal loss.
_CLASS_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (CLUSTER, re.compile(r"\b(?:cluster|klaster|kluster)s?(?:ed|ing)?\b", re.IGNORECASE)),
    (GIRTH_WELD, re.compile(r"\b(?:girth\s*weld|gw|weld|seam)\b", re.IGNORECASE)),
    (VALVE, re.compile(r"\bvalves?\b", re.IGNORECASE)),
    (TEE_OFFTAKE, re.compile(r"\btee\b|\boff[\s_-]?take\b|\bbranch(?:\s+connection)?\b", re.IGNORECASE)),
    (FLANGE, re.compile(r"\bflang(?:e|ed)\b", re.IGNORECASE)),
    (BEND, re.compile(r"\b(?:bend|elbow)\b", re.IGNORECASE)),
    (MARKER, re.compile(r"\bmarkers?\b|\bagm\b|\bmagnets?\b", re.IGNORECASE)),
    (REPAIR, re.compile(r"\bsleeves?\b|\brepairs?\b|\bpatch\b|\bcut[\s_-]?out\b", re.IGNORECASE)),
    (DIAMETER_CHANGE, re.compile(r"\breducers?\b|\bswage\b|\bdiameter\s+(?:change|transition)\b", re.IGNORECASE)),
    (WT_CHANGE, re.compile(r"\bwall\s*thickness\s*(?:change|transition)\b|\bwt\s*change\b", re.IGNORECASE)),
    (METAL_LOSS, re.compile(
        r"\bmetal[\s_-]?loss\b|\bcorros(?:ion|ive)\b|\bpitting\b|\banomal(?:y|ies)\b|\bexternal\s+loss\b",
        re.IGNORECASE,
    )),
    (OTHER_STRUCTURAL, re.compile(
        r"\b(?:launcher|receiver|pig\s*trap|casing|anodes?|supports?|clamp|saddle|tapp?(?:ing)?|stub|nozzle)\b",
        re.IGNORECASE,
    )),
)

_NULL_TEXT = {"", "none", "nan", "n/a", "na", "-", "#n/a", "null", "unknown"}
_THOUSANDS_SEPARATED = re.compile(r"^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$")


def coerce_float(value) -> float | None:
    """Parse a measurement, or return ``None`` when it is not a real number.

    Returning ``None`` rather than 0.0 is the whole point of section 3.2: a
    value that could not be read is unavailable evidence, not a measurement of
    zero.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(float(value)) else None
    text = str(value).strip()
    if text.lower() in _NULL_TEXT:
        return None
    if _THOUSANDS_SEPARATED.match(text):
        text = text.replace(",", "")
    try:
        parsed = float(text)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def wrap(alpha: float) -> float:
    """Signed circular difference in ``(-pi, pi]``: ``atan2(sin a, cos a)``."""
    return math.atan2(math.sin(alpha), math.cos(alpha))


def wrap_2pi(alpha: float) -> float:
    """Fold an angle into ``[0, 2*pi)``."""
    folded = math.fmod(alpha, TWO_PI)
    return folded + TWO_PI if folded < 0 else folded


def clock_delta(theta_1: float, theta_2: float) -> float:
    """Unsigned circular distance, ``|wrap(theta_2 - theta_1)|``."""
    return abs(wrap(theta_2 - theta_1))


def clock_to_radians(value) -> float | None:
    """Convert any reported clock representation to radians in ``[0, 2*pi)``.

    Accepts ``"10:30"``, ``"10.5"``, ``10.5`` and ``"10 h 30"``.  A 12-hour
    decimal ``h`` becomes ``theta = (pi/6) * h``.  Anything unreadable is
    unavailable evidence, so it returns ``None`` — not twelve o'clock.
    """
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        hours = float(value)
        return wrap_2pi((math.pi / 6.0) * hours) if math.isfinite(hours) else None

    text = str(value).strip()
    if text.lower() in _NULL_TEXT:
        return None
    match = re.match(r"^(\d{1,2})\s*[:hH.\s]\s*(\d{1,2})$", text)
    if match:
        hours = int(match.group(1)) % 12
        minutes = int(match.group(2))
        if minutes >= 60:
            return None
        return wrap_2pi((math.pi / 6.0) * (hours + minutes / 60.0))
    decimal = coerce_float(text)
    if decimal is None:
        return None
    return wrap_2pi((math.pi / 6.0) * decimal)


def radians_to_clock_hours(theta: float) -> float:
    """Inverse of :func:`clock_to_radians`, in decimal hours on ``[0, 12)``."""
    return wrap_2pi(theta) * 6.0 / math.pi


def radians_to_degrees(theta: float) -> float:
    return math.degrees(theta)


def classify(*labels) -> str:
    """Map raw vendor labels onto the canonical taxonomy.

    Every label the vendor uses to classify the row is passed in; free-text
    comments deliberately are not, so a remark reading "not a cluster" cannot
    reclassify the record.
    """
    haystack = " ".join(str(label) for label in labels if label not in (None, ""))
    if not haystack.strip():
        return UNKNOWN
    for canonical_class, pattern in _CLASS_PATTERNS:
        if pattern.search(haystack):
            return canonical_class
    return UNKNOWN


def is_anchor_class(feature_class: str) -> bool:
    return feature_class in ANCHOR_RELIABILITY


@dataclass
class CanonicalFeature:
    """One canonical record (section 3).

    ``key`` is the conservation identity: every input feature must appear
    exactly once in the output, and that is checked against this key.  ``raw``
    keeps the source record for audit but is never read by the algorithm.
    """

    key: str
    run: str
    x_raw_m: float
    feature_class: str
    source_id: str | None = None
    clock_rad: float | None = None
    depth_pct: float | None = None
    length_mm: float | None = None
    width_mm: float | None = None
    wall_thickness_mm: float | None = None
    surface: str | None = None
    us_gw_m: float | None = None
    joint_number: int | None = None
    joint_length_m: float | None = None
    raw: dict = field(default_factory=dict)

    # Registered coordinates, filled in by later stages.  They stay ``None``
    # until the stage that owns them has run, so a consumer can never mistake
    # an unregistered feature for one at the origin.
    pjid: str | None = None
    u: float | None = None

    @property
    def is_metal_loss(self) -> bool:
        return self.feature_class == METAL_LOSS

    @property
    def is_cluster(self) -> bool:
        return self.feature_class == CLUSTER

    @property
    def is_anchor(self) -> bool:
        return is_anchor_class(self.feature_class)


def canonicalize(record: dict, run: str, index: int) -> CanonicalFeature:
    """Build one canonical feature from an already-normalised source record.

    The record is the shape the persistence layer already produces (see
    ``hungarian_engine._load_persisted_run_features``); mapping a *file* onto
    that shape is an adapter's job and happens before this point.
    """
    distance = coerce_float(
        record.get("abs_distance_m")
        if record.get("abs_distance_m") is not None
        else record.get("log_distance_m", record.get("dist"))
    )
    raw = record.get("raw") or {}
    feature_class = classify(
        record.get("originalType"),
        record.get("feature_type"),
        raw.get("feature_type"),
        raw.get("type"),
        record.get("feature_identification"),
        raw.get("feature_identification"),
        record.get("dim_classification"),
        raw.get("dim_classification"),
    )
    joint_number = coerce_float(record.get("joint_number", raw.get("joint_number")))
    return CanonicalFeature(
        key=str(record.get("source_key") or f"{run}:{index}"),
        run=run,
        x_raw_m=distance if distance is not None else math.nan,
        feature_class=feature_class,
        source_id=str(record.get("id")) if record.get("id") is not None else None,
        clock_rad=clock_to_radians(record.get("clock_position", raw.get("clock_position"))),
        depth_pct=coerce_float(record.get("depth_pct", raw.get("depth_pct"))),
        length_mm=coerce_float(record.get("length_mm", raw.get("length_mm"))),
        width_mm=coerce_float(record.get("width_mm", raw.get("width_mm"))),
        wall_thickness_mm=coerce_float(
            record.get("wall_thickness_mm", raw.get("wall_thickness_mm"))
        ),
        surface=_normalise_surface(record.get("surface_location", raw.get("surface_location"))),
        us_gw_m=coerce_float(record.get("dist_to_us_gw_m", raw.get("dist_to_us_gw_m"))),
        joint_number=int(joint_number) if joint_number is not None else None,
        joint_length_m=coerce_float(record.get("joint_length_m", raw.get("joint_length_m"))),
        raw=record,
    )


def _normalise_surface(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip().lower()
    if text in _NULL_TEXT:
        return None
    if re.search(r"\bint(?:ernal)?\b|\binside\b", text):
        return "INTERNAL"
    if re.search(r"\bext(?:ernal)?\b|\boutside\b", text):
        return "EXTERNAL"
    if re.search(r"\bmid\b|\bwall\b", text):
        return "MIDWALL"
    return text.upper()


def surface_compatible(left: CanonicalFeature, right: CanonicalFeature) -> bool | None:
    """Tri-state: True, False, or ``None`` when either side did not report it.

    ``None`` is not ``False``.  A run with no surface column must still align,
    which is exactly what the availability mask of section 1.1 is for.
    """
    if left.surface is None or right.surface is None:
        return None
    return left.surface == right.surface


def canonicalize_run(records: list[dict], run: str) -> list[CanonicalFeature]:
    """Canonicalise a whole run, dropping only records with no usable position.

    A feature with no readable odometer cannot be registered against anything;
    it is returned separately by :func:`partition_positioned` rather than being
    silently placed at chainage zero.
    """
    return [canonicalize(record, run, index) for index, record in enumerate(records)]


def partition_positioned(
    features: list[CanonicalFeature],
) -> tuple[list[CanonicalFeature], list[CanonicalFeature]]:
    positioned = [f for f in features if math.isfinite(f.x_raw_m)]
    unpositioned = [f for f in features if not math.isfinite(f.x_raw_m)]
    positioned.sort(key=lambda f: (f.x_raw_m, f.key))
    return positioned, unpositioned
