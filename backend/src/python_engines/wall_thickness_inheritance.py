"""Fill a feature's wall thickness from the girth welds that bound its joint.

Many pipetally exports report wall thickness on the joint rows — the girth
welds — and leave the column blank on the metal-loss rows inside them.  That is
not missing evidence: a pipe joint is a single piece of pipe rolled to one
thickness, so a pit sitting between two girth welds is in metal of exactly the
thickness those welds report.  Reading the value off the joint is the same
measurement, not a guess.

It matters because wall thickness is not decoration.  Depth is reported as a
percentage of it, so ``Depth Growth (%WT/yr)`` cannot be expressed in mm/yr
without it, and the fitness-for-service intake rejects any feature that has no
``Wall WT NEW (mm)`` — a run with the column blank on its anomalies reaches FFS
with nothing assessable at all.

Two rules keep the result defensible:

* **Girth welds only.**  A bend or a longitudinal seam does not bound a joint,
  so its thickness reading says nothing about which pipe the defect is in.  The
  predicate is imported from :mod:`gw_distance_derivation` rather than
  reimplemented, so the two passes can never disagree about what a joint
  boundary is.
* **The bounding welds, and only them.**  The upstream weld is preferred, with
  the downstream weld as the fallback when the upstream one reports no
  thickness — both bound the same joint.  Nothing walks further than that: a
  thickness taken from three joints away is a different piece of pipe and would
  be silently wrong.

Deciding *whether* to run this is not this module's job — see
``HungarianAnomalyAlignmentEngine._resolve_wall_thickness_policy``.
"""

import bisect
import math

from gw_distance_derivation import is_girth_weld_feature  # noqa: F401  (re-exported)

#: Provenance tags written onto each feature and surfaced per result row, so a
#: reviewer can tell a reading the tool reported from one taken off the joint.
REPORTED_SOURCE = "reported"
INHERITED_SOURCE = "gw_joint"


def readable_thickness(value) -> float | None:
    """The value as a positive thickness in mm, or None if it is not one.

    Zero and negatives are rejected rather than carried: a 0 mm wall would make
    every depth percentage divide by nothing downstream.
    """
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number <= 0:
        return None
    return number


def _native_distance(feature: dict) -> float | None:
    """The odometer the vendor reported, before any tie-in transform.

    The same reading :mod:`gw_distance_derivation` measures from, and for the
    same reason: which joint a feature sits in is a fact about the run's own
    chainage, not about the master axis it was later mapped onto.
    """
    for key in ("source_abs_distance_m", "abs_distance_m"):
        value = feature.get(key)
        if value is None:
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(number):
            return number
    return None


def _feature_thickness(feature: dict) -> float | None:
    """This feature's own reported wall thickness, wherever it is carried.

    The engine lifts the value onto the mapped record; a raw pipetally row that
    never went through that mapping still carries it under ``raw``.
    """
    direct = readable_thickness(feature.get("wall_thickness_mm"))
    if direct is not None:
        return direct
    raw = feature.get("raw") or {}
    return readable_thickness(raw.get("wall_thickness_mm"))


def joint_thickness_table(features: list[dict], is_girth_weld) -> list[tuple[float, float]]:
    """Every girth weld that reports a thickness, as (odometer, mm), sorted.

    A weld with no readable thickness is left out entirely: keeping it would
    make it a boundary that blanks the joint it bounds, when the weld on the
    other side may well carry the reading.
    """
    table = []
    for feature in features:
        if not is_girth_weld(feature):
            continue
        distance = _native_distance(feature)
        thickness = _feature_thickness(feature)
        if distance is None or thickness is None:
            continue
        table.append((distance, thickness))
    table.sort(key=lambda entry: entry[0])
    return table


def coverage(features: list[dict], is_girth_weld) -> dict:
    """How much of a run's non-weld population already reports a thickness.

    Girth welds are excluded for the same reason :func:`gw_distance_derivation.
    vendor_coverage` excludes them: they are the donors, and counting them would
    make a run whose anomalies are all blank look well populated.
    """
    total = 0
    present = 0
    for feature in features:
        if is_girth_weld(feature):
            continue
        total += 1
        if _feature_thickness(feature) is not None:
            present += 1
    return {
        "features": total,
        "reported": present,
        "coverage": (present / total) if total else 0.0,
    }


def inherit_wall_thickness(features: list[dict], is_girth_weld) -> dict:
    """Fill ``wall_thickness_mm`` on features that have none, from their joint.

    Mutates ``features`` in place and returns a statistics block for the audit.
    A reported value is never overwritten — this fills gaps, it does not restate
    the tool's own measurements.

    A feature whose joint has no thickness on either boundary is left as it was.
    Having no reading is the truth for it, and inventing one would put a number
    into an FFS calculation that no inspection ever produced.
    """
    table = joint_thickness_table(features, is_girth_weld)
    odometers = [entry[0] for entry in table]
    stats = {
        "girthWelds": sum(1 for feature in features if is_girth_weld(feature)),
        "jointReferences": len(table),
        "reported": 0,
        "inheritedUpstream": 0,
        "inheritedDownstream": 0,
        "noJointThickness": 0,
        "unreadableDistance": 0,
    }

    for feature in features:
        if is_girth_weld(feature):
            continue

        own = _feature_thickness(feature)
        if own is not None:
            feature["wall_thickness_mm"] = own
            feature["wall_thickness_source"] = REPORTED_SOURCE
            stats["reported"] += 1
            continue

        if not table:
            stats["noJointThickness"] += 1
            continue

        distance = _native_distance(feature)
        if distance is None:
            stats["unreadableDistance"] += 1
            continue

        # bisect_right, so a feature sitting exactly on a weld inherits from
        # that weld rather than from the joint before it — the same convention
        # the U/S GW distance derivation uses for the same reason.
        index = bisect.bisect_right(odometers, distance) - 1
        if index >= 0:
            feature["wall_thickness_mm"] = table[index][1]
            feature["wall_thickness_source"] = INHERITED_SOURCE
            stats["inheritedUpstream"] += 1
            continue

        # Upstream of the run's first weld with a reading.  The first weld
        # downstream still bounds the joint this feature is in, so it is the
        # right reference rather than a distant one.
        feature["wall_thickness_mm"] = table[0][1]
        feature["wall_thickness_source"] = INHERITED_SOURCE
        stats["inheritedDownstream"] += 1

    return stats
