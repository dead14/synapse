"""Validated application of the canonical OLD-to-NEW tie-in transform."""

import bisect
import math


def validated_tiein_knots(payload):
    decision = payload.get("tieInDecision") or {}
    transform = payload.get("tieInTransform") or {}
    if decision.get("status") != "AUTO_ACCEPTED":
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
        if knots and (old_distance <= knots[-1][0] or new_distance <= knots[-1][1]):
            return []
        if knots:
            old_span = old_distance - knots[-1][0]
            new_span = new_distance - knots[-1][1]
            if old_span >= 2.0 and not 0.80 <= new_span / old_span <= 1.20:
                return []
            if abs(new_span - old_span) > 1.5:
                return []
        knots.append((old_distance, new_distance))
    domain = transform.get("domain") or {}
    try:
        domain_start = float(domain.get("oldStartM"))
        domain_end = float(domain.get("oldEndM"))
    except (AttributeError, TypeError, ValueError):
        return []
    if not math.isclose(domain_start, knots[0][0], abs_tol=1e-6):
        return []
    if not math.isclose(domain_end, knots[-1][0], abs_tol=1e-6):
        return []
    return knots


def map_old_to_new(distance, knots):
    if not knots or distance < knots[0][0] or distance > knots[-1][0]:
        return None
    old_axis = [knot[0] for knot in knots]
    right = bisect.bisect_right(old_axis, distance)
    if right == 0:
        return knots[0][1]
    if right >= len(knots):
        return knots[-1][1]
    old_left, new_left = knots[right - 1]
    old_right, new_right = knots[right]
    fraction = (distance - old_left) / (old_right - old_left)
    return new_left + fraction * (new_right - new_left)
