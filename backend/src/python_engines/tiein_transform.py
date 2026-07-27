"""Validated application of the canonical OLD-to-NEW tie-in transform.

This module owns the engineering geometry gate for the whole Python side.  It
used to be duplicated in ``tiein_engine`` as well, and the two copies drifted:
the estimator accepted a transform that this validator then rejected, so the
matcher ran with no transform at all and returned zero pairs.  ``tiein_engine``
now imports the gate from here.  The JavaScript mirror lives in
`backend/src/modules/alignment/alignmentContract.js` — change both together.
"""

import bisect
import math

# Per-span geometry gate. These describe ILI measurement physics rather than any
# one pipeline, so one rule holds for a 0.2 m fitting gap, a 10 m joint and a
# 25 m multi-joint span.
MIN_PIPE_GEOMETRY_SPAN_M = 2.0
GEOMETRY_NOISE_FLOOR_M = 1.0
LOCAL_SCALE_MINIMUM = 0.80
LOCAL_SCALE_MAXIMUM = 1.20
GEOMETRY_BASELINE_WINDOW_KNOTS = 4
GEOMETRY_BASELINE_SHIFT_M = 1.0

# A transform whose gates all passed, or one an engineer explicitly signed off on
# despite a gate warning. Partial Run has no scalar fallback, so without the
# acknowledged status a REVIEW_REQUIRED estimate dead-ends the wizard.
ACCEPTED_TIEIN_DECISION_STATUSES = frozenset({"AUTO_ACCEPTED", "REVIEW_ACKNOWLEDGED"})


def _median(values):
    ordered = sorted(values)
    count = len(ordered)
    if count == 0:
        return 0.0
    middle = count // 2
    if count % 2:
        return float(ordered[middle])
    return float((ordered[middle - 1] + ordered[middle]) / 2.0)


def offset_baseline_shift_m(offsets, index, window=GEOMETRY_BASELINE_WINDOW_KNOTS):
    """How far the OLD->NEW offset baseline moves across the span at ``index``.

    This separates two failure modes a single-span threshold cannot tell apart.
    A missing or mis-stitched weld displaces every knot downstream of it, so the
    baseline steps and stays there.  A fitting the two vendors place slightly
    differently makes one knot wobble while the baseline either side is
    unchanged.  Medians stop the excursion dragging the window it sits in.
    """
    before = offsets[max(0, index - window):index]
    after = offsets[index:index + window]
    if not before or not after:
        return 0.0
    return abs(_median(after) - _median(before))


def geometry_gate_breaches(knots):
    """Spans whose geometry change cannot be explained by measurement error.

    ``breachedOffsetStep`` fires on a persistent shift of the offset baseline —
    the missing-weld signature this gate exists for.  ``breachedScale`` fires on
    an implausible pipe-length ratio; it applies only above
    ``MIN_PIPE_GEOMETRY_SPAN_M``, because below that a span is fitting spacing on
    one joint rather than steel, and it also requires the absolute disagreement
    to clear the noise floor: +/-20% of a 2.4 m span is +/-0.48 m, tighter than
    the tools resolve, which would reject real short pups.

    ``knots`` items may be dicts (canonical records) or (old, new) pairs.
    """
    def old_of(knot):
        return knot["oldDistanceM"] if isinstance(knot, dict) else knot[0]

    def new_of(knot):
        return knot["newDistanceM"] if isinstance(knot, dict) else knot[1]

    offsets = [new_of(knot) - old_of(knot) for knot in knots]
    breaches = []
    for index in range(1, len(knots)):
        left, right = knots[index - 1], knots[index]
        old_span = old_of(right) - old_of(left)
        new_span = new_of(right) - new_of(left)
        deviation = abs(new_span - old_span)
        scale = new_span / old_span if old_span > 0.0 else float("inf")
        baseline_shift = offset_baseline_shift_m(offsets, index)
        local_delta = abs(offsets[index] - offsets[index - 1])

        # Both conditions are needed. The local delta pins the breach to the span
        # that caused it, since a window alone smears the report across its
        # neighbours and sends the operator to inspect the wrong spool. The
        # baseline shift is what makes it a real defect rather than reporting
        # noise, because only a genuine missing weld keeps the offset displaced.
        breached_step = (
            local_delta > GEOMETRY_BASELINE_SHIFT_M
            and baseline_shift > GEOMETRY_BASELINE_SHIFT_M
        )
        breached_scale = (
            old_span >= MIN_PIPE_GEOMETRY_SPAN_M
            and not LOCAL_SCALE_MINIMUM <= scale <= LOCAL_SCALE_MAXIMUM
            and deviation > GEOMETRY_NOISE_FLOOR_M
        )
        if not breached_scale and not breached_step:
            continue
        breaches.append({
            "oldStartM": old_of(left),
            "oldEndM": old_of(right),
            "newStartM": new_of(left),
            "newEndM": new_of(right),
            "oldSpanM": float(old_span),
            "newSpanM": float(new_span),
            "scale": float(scale),
            "deviationM": float(deviation),
            "baselineShiftM": float(baseline_shift),
            "localOffsetDeltaM": float(local_delta),
            "breachedScale": bool(breached_scale),
            "breachedOffsetStep": bool(breached_step),
        })
    return breaches


def validated_tiein_knot_records(payload):
    """Return canonical knot records only when the whole transform is valid.

    IDs are audit metadata rather than mandatory identity: some vendor exports
    do not populate them.  Source odometer plus strict monotonic order remains
    the canonical physical key in that case.
    """
    decision = payload.get("tieInDecision") or {}
    transform = payload.get("tieInTransform") or {}
    if decision.get("status") not in ACCEPTED_TIEIN_DECISION_STATUSES:
        return []
    if transform.get("direction") != "OLD_TO_NEW":
        return []
    if transform.get("model") != "MONOTONIC_PIECEWISE_LINEAR":
        return []
    if transform.get("allowExtrapolation") is not False:
        return []
    raw_knots = transform.get("knots")
    if not isinstance(raw_knots, list) or not 2 <= len(raw_knots) <= 10_000:
        return []

    knots = []
    for knot in raw_knots:
        try:
            old_distance = float(knot.get("oldDistanceM"))
            new_distance = float(knot.get("newDistanceM"))
        except (AttributeError, TypeError, ValueError):
            return []
        if not math.isfinite(old_distance) or not math.isfinite(new_distance):
            return []
        # Strict monotonicity is a structural invariant: a non-monotonic mapping
        # is not a function, and nobody may waive it. The geometry gate is a
        # plausibility judgement and is applied below, over the whole knot list,
        # because a persistent baseline shift cannot be seen one span at a time.
        if knots and (
            old_distance <= knots[-1]["oldDistanceM"]
            or new_distance <= knots[-1]["newDistanceM"]
        ):
            return []
        knots.append({
            "oldDistanceM": old_distance,
            "newDistanceM": new_distance,
            "oldId": knot.get("oldId"),
            "newId": knot.get("newId"),
        })
    domain = transform.get("domain") or {}
    try:
        domain_start = float(domain.get("oldStartM"))
        domain_end = float(domain.get("oldEndM"))
    except (AttributeError, TypeError, ValueError):
        return []
    if not math.isclose(domain_start, knots[0]["oldDistanceM"], abs_tol=1e-6):
        return []
    if not math.isclose(domain_end, knots[-1]["oldDistanceM"], abs_tol=1e-6):
        return []

    # New-domain bounds were added to the canonical contract after the first
    # release. Validate them when present while retaining read compatibility
    # with already persisted accepted evidence.
    has_new_domain = "newStartM" in domain or "newEndM" in domain
    if has_new_domain and not ("newStartM" in domain and "newEndM" in domain):
        return []
    for key, expected in (
        ("newStartM", knots[0]["newDistanceM"]),
        ("newEndM", knots[-1]["newDistanceM"]),
    ):
        if key not in domain:
            continue
        try:
            actual = float(domain.get(key))
        except (TypeError, ValueError):
            return []
        if not math.isfinite(actual) or not math.isclose(actual, expected, abs_tol=1e-6):
            return []

    # An explicitly acknowledged decision has already been signed off past the
    # plausibility gate by an engineer, and the server bound that decision to the
    # transform with an HMAC. Re-running the gate here would silently discard the
    # transform and leave the matcher with nothing to map with.
    if decision.get("status") == "AUTO_ACCEPTED" and geometry_gate_breaches(knots):
        return []
    return knots


def validated_tiein_knots(payload):
    return [
        (knot["oldDistanceM"], knot["newDistanceM"])
        for knot in validated_tiein_knot_records(payload)
    ]


class PreparedTransform:
    """A knot list with its search axis already extracted.

    ``map_old_to_new`` rebuilt ``[knot[0] for knot in knots]`` on every call.
    The matchers call it once per feature against one transform, so a 50k
    feature run against a 10k knot transform rebuilt a 10k element list half a
    billion times.  The axis depends only on the knots, so it is built once.

    The knot list must not be mutated after preparation; every producer in this
    codebase treats validated knots as immutable evidence.
    """

    __slots__ = ("knots", "_old_axis", "_first_old", "_last_old", "_count")

    def __init__(self, knots):
        self.knots = knots
        self._old_axis = [knot[0] for knot in knots]
        self._count = len(knots)
        self._first_old = knots[0][0] if knots else None
        self._last_old = knots[-1][0] if knots else None

    def __call__(self, distance):
        """OLD odometer to NEW odometer, or None outside the knot domain."""
        knots = self.knots
        if not self._count or distance < self._first_old or distance > self._last_old:
            return None
        right = bisect.bisect_right(self._old_axis, distance)
        if right == 0:
            return knots[0][1]
        if right >= self._count:
            return knots[-1][1]
        old_left, new_left = knots[right - 1]
        old_right, new_right = knots[right]
        fraction = (distance - old_left) / (old_right - old_left)
        return new_left + fraction * (new_right - new_left)


def prepare_transform(knots):
    """Build a reusable OLD-to-NEW mapper for a fixed knot list."""
    return PreparedTransform(knots)


# One-entry memo keyed on knot-list identity, so the legacy
# ``map_old_to_new(distance, knots)`` call shape gets the prepared axis too.
# The key is held by strong reference so its id() can never be recycled onto a
# different list while the entry is live; one knot list is a bounded 10k items.
_LAST_PREPARED_KNOTS = None
_LAST_PREPARED_TRANSFORM = None


def _prepared_for(knots):
    global _LAST_PREPARED_KNOTS, _LAST_PREPARED_TRANSFORM
    if _LAST_PREPARED_KNOTS is knots:
        return _LAST_PREPARED_TRANSFORM
    prepared = PreparedTransform(knots)
    _LAST_PREPARED_KNOTS = knots
    _LAST_PREPARED_TRANSFORM = prepared
    return prepared


def map_old_to_new(distance, knots):
    if not knots:
        return None
    return _prepared_for(knots)(distance)
