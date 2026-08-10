"""Derive each feature's distance to its own upstream girth weld.

Many pipetally exports carry the odometer (log distance) and nothing else: the
"Dist. to U/S GW" column is blank, or absent entirely.  That column is the
strongest identity evidence the matcher has, because it survives an odometer
that drifted — a run can be three metres out on chainage and still place a pit
0.42 m downstream of its joint weld.

The value is recoverable.  A run that reports its girth welds as features
already carries every reference point needed: the distance to the upstream weld
is the feature's own odometer minus the odometer of the last girth weld at or
before it.  This module does exactly that, and nothing else — no matching, no
tolerances, no cross-run reasoning.

Two rules make the result safe to feed into a cross-run gate:

* **Girth welds only.**  A bend, a flange or a longitudinal seam is not what a
  vendor means by "U/S GW", so using one as the reference would produce a
  number that cannot be compared with a vendor-reported column.
* **The run's own native odometer.**  Derivation reads the distance as the
  vendor reported it, before any tie-in transform maps the run onto the master
  axis.  A weld-relative quantity must be measured in the axis the weld was
  measured in; taking the difference of two transformed values would stretch it
  by whatever the transform did locally.

Deciding *when* to derive is not this module's job — see
``HungarianAnomalyAlignmentEngine._resolve_us_gw_distance_policy``, which owns
the provenance-consistency rule between the two runs.
"""

import bisect
import math
import re

# Provenance tags written onto each feature, and surfaced per result row so a
# reviewer can tell a vendor number from one this code computed.
VENDOR_SOURCE = "vendor"
DERIVED_SOURCE = "derived"

# A girth weld is a circumferential joint weld.  Seam, long-seam, spiral and
# helical welds run *along* the pipe: they are not joint boundaries and using
# one as an upstream reference would place a feature in the wrong joint.
_GIRTH_WELD_PATTERN = re.compile(r"\bgirth\b|\bgw\b|\bweld\b", re.IGNORECASE)
_NON_GIRTH_WELD_PATTERN = re.compile(
    r"\b(?:seam|long|longitudinal|spiral|helical|erw|dsaw|lsaw)\b", re.IGNORECASE
)


def is_girth_weld_label(*labels: str) -> bool:
    """Whether any of these vendor labels names a circumferential joint weld."""
    for label in labels:
        text = str(label or "")
        if not text.strip():
            continue
        if _NON_GIRTH_WELD_PATTERN.search(text):
            continue
        if _GIRTH_WELD_PATTERN.search(text):
            return True
    return False


def feature_labels(feature: dict) -> tuple[str, str]:
    """The two columns a vendor uses to say what a feature is.

    Mirrors ``HungarianAnomalyAlignmentEngine._gw_feature_labels``, and exists
    here so the generator can classify a feature without importing the alignment
    engine — which would drag pandas, numpy and the ORM into a job that only
    needs arithmetic.  The engine delegates to this rather than keeping its own
    copy: one regex in one place is the whole point.
    """
    raw = feature.get("raw", {}) or {}
    primary = str(
        feature.get("originalType")
        or raw.get("feature_type")
        or raw.get("type")
        or raw.get("originalType")
        or ""
    ).strip().lower()
    identification = str(raw.get("feature_identification") or "").strip().lower()
    if not primary or primary in {"other", "unknown", "unclassified"}:
        primary = identification
    return primary, identification


def is_girth_weld_feature(feature: dict) -> bool:
    """Whether this feature is a circumferential joint weld.

    Narrower than the alignment engine's ``_is_gw_feature``, deliberately. That
    predicate answers "does Phase 1 own this row", and a bend or a valve is in
    it. Measuring a defect's distance from the nearest bend would produce a
    number no vendor column can be compared with.
    """
    return is_girth_weld_label(*feature_labels(feature))


def _native_distance(feature: dict) -> float | None:
    """The odometer the vendor reported, before any tie-in transform."""
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


def girth_weld_odometers(features: list[dict], is_girth_weld) -> list[float]:
    """Sorted native odometers of every girth weld in one run."""
    odometers = []
    for feature in features:
        if not is_girth_weld(feature):
            continue
        distance = _native_distance(feature)
        if distance is not None:
            odometers.append(distance)
    odometers.sort()
    return odometers


def vendor_coverage(features: list[dict], is_girth_weld) -> dict:
    """How much of a run's *anomaly* population carries a vendor GW distance.

    Girth welds themselves are excluded: their own distance-to-upstream-weld is
    either zero or absent by convention, and counting them would make a run
    with many welds and no anomaly readings look well populated.
    """
    total = 0
    present = 0
    for feature in features:
        if is_girth_weld(feature):
            continue
        total += 1
        if feature.get("dist_to_us_gw_m") is not None:
            present += 1
    return {
        "features": total,
        "reported": present,
        "coverage": (present / total) if total else 0.0,
    }


def derive_us_gw_distances(features: list[dict], is_girth_weld, *, overwrite: bool) -> dict:
    """Fill ``dist_to_us_gw_m`` from the odometer and the run's own girth welds.

    Mutates ``features`` in place and returns a statistics block for the audit.
    ``overwrite=False`` fills only the gaps and leaves vendor values alone;
    ``overwrite=True`` replaces every value, which is what the caller wants when
    the two runs must be put on one consistent provenance.

    A feature upstream of the run's first girth weld has no upstream weld and is
    left as ``None`` — the matcher then simply has no weld evidence for it,
    which is the truth, rather than a distance measured from nothing.
    """
    weld_odometers = girth_weld_odometers(features, is_girth_weld)
    stats = {
        "girthWelds": len(weld_odometers),
        "derived": 0,
        "keptVendor": 0,
        "noUpstreamWeld": 0,
        "unreadableDistance": 0,
    }
    if not weld_odometers:
        # Nothing to measure from.  Vendor values, if any, stay exactly as they
        # were: an empty weld list is a missing reference, not a reason to
        # discard evidence the vendor did supply.
        for feature in features:
            if feature.get("dist_to_us_gw_m") is not None:
                stats["keptVendor"] += 1
        return stats

    for feature in features:
        if is_girth_weld(feature):
            continue
        has_vendor_value = feature.get("dist_to_us_gw_m") is not None
        if has_vendor_value and not overwrite:
            stats["keptVendor"] += 1
            continue

        distance = _native_distance(feature)
        if distance is None:
            stats["unreadableDistance"] += 1
            continue

        # bisect_right, so a feature sitting exactly on a weld is measured from
        # that weld (0.0) rather than from the joint before it.
        index = bisect.bisect_right(weld_odometers, distance) - 1
        if index < 0:
            stats["noUpstreamWeld"] += 1
            if overwrite:
                feature["dist_to_us_gw_m"] = None
                feature["dist_to_us_gw_source"] = None
            continue

        feature["dist_to_us_gw_m"] = distance - weld_odometers[index]
        feature["dist_to_us_gw_source"] = DERIVED_SOURCE
        stats["derived"] += 1

    return stats


def median_joint_length(features: list[dict], is_girth_weld) -> float | None:
    """Median spacing between consecutive girth welds, when it can be measured.

    The Bayesian matcher needs this as the width of the "where in the joint
    could this defect have been" null hypothesis.  Measuring it beats assuming
    a 12 m joint on a line that was built from 6 m or 18 m pipe.
    """
    odometers = girth_weld_odometers(features, is_girth_weld)
    spacings = [
        second - first
        for first, second in zip(odometers, odometers[1:])
        if second > first
    ]
    if not spacings:
        return None
    spacings.sort()
    middle = len(spacings) // 2
    if len(spacings) % 2 == 1:
        return spacings[middle]
    return (spacings[middle - 1] + spacings[middle]) / 2.0
