"""Universal, evidence-gated partial-run tie-in alignment.

The canonical spatial direction is OLD (historical) -> NEW (master).  A legacy
NEW-to-OLD affine offset is still returned while downstream callers migrate to
the explicit piecewise transform.
"""

import json
import math
import re
import sys
from dataclasses import dataclass
from datetime import time as time_value

import numpy as np


METHOD_VERSION = "ordered-drift-spans-v3"
COMPARISON_COORDINATE_VERSION = "temporary-offset-normalization-v1"
ROBUST_FIT_METHOD = "DETERMINISTIC_THEIL_SEN_IRLS"
ROBUST_RESIDUAL_THRESHOLD_M = 2.0
ILI_SCALE_TOLERANCE = 0.02
MAX_SKIP_ANCHORS = 4
MAX_OVERLAP_CELLS = 1_000_000
MIN_AUTO_PAIRS = 3
AMBIGUITY_SCORE_RATIO = 0.95
FACILITY_BOUNDARY_TYPES = {"flange", "launcher", "receiver"}
FACILITY_BOUNDARY_MAX_DISTANCE_M = 10.0
MAX_THEIL_SEN_PAIRS = 100_000
SPAN_P95_REVIEW_THRESHOLD_M = 1.5

# Engineering gate for per-span geometry change.  These constants describe
# measurement physics, not any one pipeline, so the same gate holds for a 0.2 m
# fitting gap, a 10 m joint, and a 25 m multi-joint span.  Mirrored exactly in
# `backend/src/modules/alignment/alignmentContract.js` — change both together.
MIN_PIPE_GEOMETRY_SPAN_M = 2.0
GEOMETRY_NOISE_FLOOR_M = 1.0
LOCAL_SCALE_MINIMUM = 0.80
LOCAL_SCALE_MAXIMUM = 1.20
GEOMETRY_BASELINE_WINDOW_KNOTS = 4
GEOMETRY_BASELINE_SHIFT_M = 1.0


@dataclass
class Anchor:
    idx: int
    dist: float
    type: str
    feature_id: object = None
    wall_thickness_mm: float | None = None
    joint_length_m: float | None = None
    clock_position: float | None = None
    identification: str = ""


def _first_present(record, *keys, default=None):
    for key in keys:
        value = record.get(key)
        if value is not None and str(value).strip() != "":
            return value
    return default


def _finite_float(value):
    try:
        parsed = float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _normalize_anchor_type(primary_value, identification_value=None):
    primary = str(primary_value or "").strip().lower()
    identification = str(identification_value or "").strip().lower()
    if "flang" in primary or "flang" in identification:
        return "flange"
    label = primary or identification
    if "valve" in label:
        return "valve"
    if "tee" in label or "offtake" in label or "branch" in label:
        return "tee"
    if "bend" in label or "elbow" in label:
        return "bend"
    if "launcher" in label:
        return "launcher"
    if "receiver" in label:
        return "receiver"
    if re.search(r"\b(?:weld|girth)\b", label):
        return "weld"
    return label


def _normalize_clock_position(value):
    if value is None:
        return None
    if isinstance(value, time_value):
        hours = value.hour + value.minute / 60.0 + value.second / 3600.0
        return hours % 12.0
    if isinstance(value, (int, float)):
        numeric = float(value)
        if not math.isfinite(numeric):
            return None
        hours = numeric * 24.0 if 0.0 <= numeric <= 1.0 else numeric
        return hours % 12.0 if 0.0 <= hours <= 24.0 else None

    text = str(value).strip().lower()
    if not text or text in {"n/a", "na", "none", "null", "-"}:
        return None
    if ":" in text:
        parts = text.split(":")
        try:
            hours = float(parts[0])
            minutes = float(parts[1]) if len(parts) > 1 else 0.0
            seconds = float(parts[2]) if len(parts) > 2 else 0.0
        except ValueError:
            return None
        return (hours + minutes / 60.0 + seconds / 3600.0) % 12.0
    try:
        numeric = float(text)
    except ValueError:
        return None
    hours = numeric * 24.0 if 0.0 <= numeric <= 1.0 else numeric
    return hours % 12.0 if 0.0 <= hours <= 24.0 else None


def _is_excluded(distance, run_label, excluded_ranges):
    for excluded in excluded_ranges or []:
        if str(excluded.get("run", "")).upper() != run_label:
            continue
        start = _finite_float(excluded.get("startM"))
        end = _finite_float(excluded.get("endM"))
        if start is not None and end is not None and min(start, end) <= distance <= max(start, end):
            return True
    return False


def extract_anchors(features, run_label="OLD", excluded_ranges=None):
    allowed_types = {"weld", "flange", "valve", "tee", "bend", "launcher", "receiver"}
    anchors = []
    for index, feature in enumerate(features):
        primary_type = _first_present(
            feature,
            "type",
            "feature_type",
            "originalType",
            default="",
        )
        identification = _first_present(
            feature,
            "feature_identification",
            "identification",
            default="",
        )
        anchor_type = _normalize_anchor_type(primary_type, identification)
        distance = _finite_float(
            _first_present(
                feature,
                "dist",
                "log_distance_m",
                "logDistance",
                "distance",
                "chainage",
                "odometer",
            )
        )
        if anchor_type not in allowed_types or distance is None:
            continue
        if _is_excluded(distance, run_label, excluded_ranges):
            continue
        anchors.append(
            Anchor(
                idx=index,
                dist=distance,
                type=anchor_type,
                feature_id=_first_present(feature, "id", "feature_id"),
                wall_thickness_mm=_finite_float(
                    _first_present(feature, "wall_thickness_mm", "wallThickness", "wt")
                ),
                joint_length_m=_finite_float(
                    _first_present(feature, "joint_length_m", "jointLength", "spool")
                ),
                clock_position=_normalize_clock_position(
                    _first_present(feature, "clock_position", "clock")
                ),
                identification=str(identification).strip().lower(),
            )
        )
    return sorted(anchors, key=lambda anchor: (anchor.dist, anchor.idx))


def _node_score(old_anchor, new_anchor):
    if old_anchor.type != new_anchor.type:
        return float("-inf")
    score = 2.0 if old_anchor.type == "weld" else (5.0 if old_anchor.type == "flange" else 4.0)
    old_wall = old_anchor.wall_thickness_mm
    new_wall = new_anchor.wall_thickness_mm
    if old_wall is not None and new_wall is not None:
        difference = abs(old_wall - new_wall)
        if difference <= 0.5:
            score += 1.5
        elif difference > 1.0:
            score -= 2.0
    old_joint = old_anchor.joint_length_m
    new_joint = new_anchor.joint_length_m
    if old_joint is not None and new_joint is not None and old_joint > 0.0 and new_joint > 0.0:
        joint_difference = abs(old_joint - new_joint)
        if joint_difference <= max(0.1, 0.05 * max(old_joint, new_joint)):
            score += 2.5
        elif joint_difference > max(0.5, 0.20 * max(old_joint, new_joint)):
            score -= 1.5
    if old_anchor.clock_position is not None and new_anchor.clock_position is not None:
        clock_difference = abs(old_anchor.clock_position - new_anchor.clock_position)
        clock_difference = min(clock_difference, 12.0 - clock_difference)
        if clock_difference <= 0.5:
            score += 1.0
        elif clock_difference > 1.5:
            score -= 0.5
    return score


def _span_score(old_span, new_span, skipped_count):
    if old_span <= 0.0 or new_span <= 0.0:
        return float("-inf")
    absolute_error = abs(old_span - new_span)
    gross_error_limit = max(3.0, 0.25 * max(old_span, new_span))
    if absolute_error > gross_error_limit:
        return float("-inf")
    # A percentage-only tolerance is unstable on short spools.  The absolute
    # floor lets sub-metre odometer noise remain evidence while the robust cap
    # prevents one repaired spool from destroying an otherwise long path.
    tolerance = max(1.0, 0.05 * max(old_span, new_span))
    normalized_error = max(0.0, absolute_error - 0.15) / tolerance
    if normalized_error <= 1.0:
        length_score = 5.0 * (1.0 - normalized_error)
    else:
        length_score = -min(3.0, normalized_error - 1.0)
    return length_score - 4.6 * skipped_count


def _trace_path(previous, end_i, end_j):
    path = []
    current = (end_i, end_j)
    while current is not None:
        path.append(current)
        current = previous[current[0]][current[1]]
    return path[::-1]


def _candidate_from_path(path, score, old_anchors, new_anchors):
    index_shifts = [new_index - old_index for old_index, new_index in path]
    return {
        "path": path,
        "score": float(score),
        "scorePerPair": float(score / max(1, len(path))),
        "pairCount": len(path),
        "indexShift": float(np.median(index_shifts)),
        "oldStartM": old_anchors[path[0][0]].dist,
        "oldEndM": old_anchors[path[-1][0]].dist,
        "newStartM": new_anchors[path[0][1]].dist,
        "newEndM": new_anchors[path[-1][1]].dist,
    }


def _same_alignment_family(left, right):
    left_pairs = set(left["path"])
    right_pairs = set(right["path"])
    overlap = len(left_pairs & right_pairs) / max(1, min(len(left_pairs), len(right_pairs)))
    return overlap >= 0.5


def find_overlap_candidates(old_anchors, new_anchors, max_candidates=3):
    """Find monotonic local alignments using robust multi-anchor span transitions."""
    old_count, new_count = len(old_anchors), len(new_anchors)
    if old_count == 0 or new_count == 0:
        return []

    scores = [[0.0] * new_count for _ in range(old_count)]
    previous = [[None] * new_count for _ in range(old_count)]
    path_lengths = [[0] * new_count for _ in range(old_count)]

    for old_index, old_anchor in enumerate(old_anchors):
        for new_index, new_anchor in enumerate(new_anchors):
            node_score = _node_score(old_anchor, new_anchor)
            if not math.isfinite(node_score):
                continue
            best_score = node_score
            best_previous = None
            best_length = 1
            for old_step in range(1, min(MAX_SKIP_ANCHORS, old_index) + 1):
                prior_old_index = old_index - old_step
                for new_step in range(1, min(MAX_SKIP_ANCHORS, new_index) + 1):
                    prior_new_index = new_index - new_step
                    # Reachability, not sign.  A legitimate weld pair scores <= 0
                    # whenever it carries a wall-thickness change (base 2.0 minus
                    # up to 2.0), so testing the score truncated valid chains at
                    # every WT transition and split one true alignment into two
                    # short ones -> spurious AMBIGUOUS_OVERLAP.  path_lengths is
                    # 0 only for cells that were skipped as non-finite.
                    if path_lengths[prior_old_index][prior_new_index] <= 0:
                        continue
                    prior_score = scores[prior_old_index][prior_new_index]
                    span_score = _span_score(
                        old_anchor.dist - old_anchors[prior_old_index].dist,
                        new_anchor.dist - new_anchors[prior_new_index].dist,
                        old_step + new_step - 2,
                    )
                    if not math.isfinite(span_score):
                        continue
                    candidate_score = prior_score + node_score + span_score
                    candidate_length = path_lengths[prior_old_index][prior_new_index] + 1
                    if candidate_score > best_score or (
                        math.isclose(candidate_score, best_score)
                        and candidate_length > best_length
                    ):
                        best_score = candidate_score
                        best_previous = (prior_old_index, prior_new_index)
                        best_length = candidate_length
            scores[old_index][new_index] = best_score
            previous[old_index][new_index] = best_previous
            path_lengths[old_index][new_index] = best_length

    endpoints = sorted(
        (
            (scores[old_index][new_index], path_lengths[old_index][new_index], old_index, new_index)
            for old_index in range(old_count)
            for new_index in range(new_count)
            if path_lengths[old_index][new_index] >= 2
        ),
        reverse=True,
    )
    candidates = []
    for score, _, old_index, new_index in endpoints:
        path = _trace_path(previous, old_index, new_index)
        candidate = _candidate_from_path(path, score, old_anchors, new_anchors)
        if any(_same_alignment_family(candidate, existing) for existing in candidates):
            continue
        candidates.append(candidate)
        if len(candidates) >= max_candidates:
            break
    return candidates


def align_anchors(anchors_a, anchors_b, gap_penalty=-5.0):
    """Backward-compatible helper returning the strongest ordered local path."""
    del gap_penalty
    candidates = find_overlap_candidates(anchors_a, anchors_b, max_candidates=1)
    if not candidates:
        return []
    return [(anchors_a[i], anchors_b[j]) for i, j in candidates[0]["path"]]


def _sample_pair_slopes(source_array, target_array):
    left, right = np.triu_indices(len(source_array), k=1)
    differences = source_array[right] - source_array[left]
    valid = np.abs(differences) > 1e-9
    left = left[valid]
    right = right[valid]
    differences = differences[valid]
    if len(differences) > MAX_THEIL_SEN_PAIRS:
        selected = np.linspace(0, len(differences) - 1, MAX_THEIL_SEN_PAIRS, dtype=int)
        left = left[selected]
        right = right[selected]
        differences = differences[selected]
    return (target_array[right] - target_array[left]) / differences


def _least_squares_affine(source_array, target_array):
    design = np.column_stack((source_array, np.ones(len(source_array))))
    coefficients, *_ = np.linalg.lstsq(design, target_array, rcond=None)
    return float(coefficients[0]), float(coefficients[1])


def _fit_affine(source, target):
    """Fit a deterministic robust affine diagnostic without optional packages."""
    source_array = np.asarray(source, dtype=float)
    target_array = np.asarray(target, dtype=float)
    if len(target_array) < 2:
        scale = 1.0
        offset = float(np.median(target_array - source_array))
        residuals = target_array - (scale * source_array + offset)
        inliers = np.ones(len(target_array), dtype=bool)
        rmse = float(np.sqrt(np.mean(np.square(residuals)))) if len(residuals) else 0.0
        return scale, offset, inliers, residuals, rmse

    slopes = _sample_pair_slopes(source_array, target_array)
    scale = float(np.median(slopes)) if len(slopes) else 1.0
    offset = float(np.median(target_array - scale * source_array))
    inliers = np.ones(len(target_array), dtype=bool)

    for _ in range(5):
        residuals = target_array - (scale * source_array + offset)
        next_inliers = np.abs(residuals) <= ROBUST_RESIDUAL_THRESHOLD_M
        if np.count_nonzero(next_inliers) < 2:
            break
        next_scale, next_offset = _least_squares_affine(
            source_array[next_inliers], target_array[next_inliers]
        )
        stable = np.array_equal(next_inliers, inliers)
        scale, offset, inliers = next_scale, next_offset, next_inliers
        if stable:
            break

    residuals = target_array - (scale * source_array + offset)
    if np.count_nonzero(inliers) < 2:
        inliers = np.ones(len(target_array), dtype=bool)
        scale, offset = _least_squares_affine(source_array, target_array)
        residuals = target_array - (scale * source_array + offset)
    rmse = float(np.sqrt(np.mean(np.square(residuals[inliers]))))
    return scale, offset, inliers, residuals, rmse


def _stable_common_start_index(selected_path, old_anchors, new_anchors):
    """Start after an initial matched facility boundary, not after arbitrary gaps."""
    if not selected_path:
        return 0
    start_old = old_anchors[selected_path[0][0]].dist
    start_new = new_anchors[selected_path[0][1]].dist
    boundary_index = None
    for pair_index, (old_index, new_index) in enumerate(selected_path[:8]):
        old_anchor = old_anchors[old_index]
        new_anchor = new_anchors[new_index]
        within_boundary_cluster = (
            old_anchor.dist - start_old <= FACILITY_BOUNDARY_MAX_DISTANCE_M
            and new_anchor.dist - start_new <= FACILITY_BOUNDARY_MAX_DISTANCE_M
        )
        if not within_boundary_cluster:
            break
        if old_anchor.type in FACILITY_BOUNDARY_TYPES and new_anchor.type in FACILITY_BOUNDARY_TYPES:
            boundary_index = pair_index
    if boundary_index is None:
        return 0
    for pair_index in range(boundary_index + 1, len(selected_path)):
        old_index, new_index = selected_path[pair_index]
        if old_anchors[old_index].type == "weld" and new_anchors[new_index].type == "weld":
            return pair_index
    return 0


def _span_residual_quality(pairs):
    residuals = np.asarray(
        [
            (right_new.dist - left_new.dist) - (right_old.dist - left_old.dist)
            for (left_old, left_new), (right_old, right_new) in zip(pairs, pairs[1:])
        ],
        dtype=float,
    )
    absolute = np.abs(residuals)
    if not len(residuals):
        return {
            "count": 0,
            "medianM": 0.0,
            "medianAbsM": 0.0,
            "meanAbsM": 0.0,
            "p95AbsM": 0.0,
            "maximumAbsM": 0.0,
            "rmseM": 0.0,
        }
    return {
        "count": int(len(residuals)),
        "medianM": float(np.median(residuals)),
        "medianAbsM": float(np.median(absolute)),
        "meanAbsM": float(np.mean(absolute)),
        "p95AbsM": float(np.percentile(absolute, 95)),
        "maximumAbsM": float(np.max(absolute)),
        "rmseM": float(np.sqrt(np.mean(np.square(residuals)))),
    }


def _piecewise_knots(pairs):
    preferred = [pair for pair in pairs if pair[0].type == "weld" and pair[1].type == "weld"]
    knots_source = preferred if len(preferred) >= 2 else pairs
    return [
        {
            "oldId": old_anchor.feature_id,
            "newId": new_anchor.feature_id,
            "oldDistanceM": old_anchor.dist,
            "newDistanceM": new_anchor.dist,
        }
        for old_anchor, new_anchor in knots_source
    ]


def _local_scale_range(knots):
    scales = []
    for left, right in zip(knots, knots[1:]):
        old_span = right["oldDistanceM"] - left["oldDistanceM"]
        new_span = right["newDistanceM"] - left["newDistanceM"]
        if old_span >= MIN_PIPE_GEOMETRY_SPAN_M and new_span > 0.0:
            scales.append(new_span / old_span)
    if not scales:
        return {"minimum": 1.0, "maximum": 1.0}
    return {"minimum": float(min(scales)), "maximum": float(max(scales))}


def _maximum_offset_step(knots):
    changes = []
    for left, right in zip(knots, knots[1:]):
        left_offset = left["newDistanceM"] - left["oldDistanceM"]
        right_offset = right["newDistanceM"] - right["oldDistanceM"]
        changes.append(abs(right_offset - left_offset))
    return float(max(changes, default=0.0))


def offset_baseline_shift_m(offsets, index, window=GEOMETRY_BASELINE_WINDOW_KNOTS):
    """How far the OLD->NEW offset baseline moves across the span at ``index``.

    This is the check that separates the two failure modes a single-span
    threshold cannot tell apart.  A missing or mis-stitched weld displaces every
    knot downstream of it, so the baseline steps and stays there.  A fitting
    reported slightly differently by two vendors makes one knot wobble and the
    baseline is unchanged either side of it.  Medians are used so the excursion
    itself cannot drag the window it sits in.
    """
    before = offsets[max(0, index - window):index]
    after = offsets[index:index + window]
    if not before or not after:
        return 0.0
    return float(abs(np.median(after) - np.median(before)))


def geometry_gate_breaches(knots):
    """Spans whose geometry change cannot be explained by measurement error.

    Two independent gates.  ``breachedOffsetStep`` fires on a persistent shift of
    the offset baseline — the signature of a missing weld, and the reason the gate
    exists at all.  ``breachedScale`` fires when a pipe-length ratio is
    implausible; it only applies above ``MIN_PIPE_GEOMETRY_SPAN_M``, because below
    that a span is fitting spacing on one joint rather than steel length, and it
    additionally requires the absolute disagreement to clear the noise floor:
    demanding +/-20 % of a 2.4 m span means demanding +/-0.48 m, tighter than the
    tools resolve, which would reject real short pups.
    """
    offsets = [knot["newDistanceM"] - knot["oldDistanceM"] for knot in knots]
    breaches = []
    for index in range(1, len(knots)):
        left, right = knots[index - 1], knots[index]
        old_span = right["oldDistanceM"] - left["oldDistanceM"]
        new_span = right["newDistanceM"] - left["newDistanceM"]
        deviation = abs(new_span - old_span)
        scale = new_span / old_span if old_span > 0.0 else float("inf")
        baseline_shift = offset_baseline_shift_m(offsets, index)

        # Both conditions are needed, and each fixes a different failure of the
        # old flat threshold.  The local delta pins the breach to the span that
        # actually caused it — a window alone smears the report across its
        # neighbours, sending the operator to inspect the wrong spool.  The
        # baseline shift is what makes it a real defect rather than reporting
        # noise, because only a genuine missing weld keeps the offset displaced.
        local_delta = abs(offsets[index] - offsets[index - 1])
        breached_step = (
            local_delta > GEOMETRY_BASELINE_SHIFT_M
            and baseline_shift > GEOMETRY_BASELINE_SHIFT_M
        )
        breached_scale = (
            old_span >= MIN_PIPE_GEOMETRY_SPAN_M
            and (scale < LOCAL_SCALE_MINIMUM or scale > LOCAL_SCALE_MAXIMUM)
            and deviation > GEOMETRY_NOISE_FLOOR_M
        )
        if not breached_scale and not breached_step:
            continue
        breaches.append(
            {
                "oldStartM": left["oldDistanceM"],
                "oldEndM": right["oldDistanceM"],
                "newStartM": left["newDistanceM"],
                "newEndM": right["newDistanceM"],
                "oldSpanM": float(old_span),
                "newSpanM": float(new_span),
                "scale": float(scale),
                "deviationM": float(deviation),
                "baselineShiftM": baseline_shift,
                "localOffsetDeltaM": float(local_delta),
                "breachedScale": bool(breached_scale),
                "breachedOffsetStep": bool(breached_step),
            }
        )
    return breaches


def _public_candidate(candidate, rank):
    return {
        "rank": rank,
        "evidenceScore": candidate["score"],
        "scorePerPair": candidate["scorePerPair"],
        "pairCount": candidate["pairCount"],
        "oldStartM": candidate["oldStartM"],
        "oldEndM": candidate["oldEndM"],
        "newStartM": candidate["newStartM"],
        "newEndM": candidate["newEndM"],
    }


def _comparison_coordinates(pairs):
    """Build a temporary common axis for operator review and coarse search.

    Raw ILI odometers must remain immutable.  The provisional offset is only a
    robust visual/search aid; the accepted engineering transform is still the
    OLD-to-NEW piecewise knot mapping built below.
    """
    offsets = [new_anchor.dist - old_anchor.dist for old_anchor, new_anchor in pairs]
    provisional_offset = float(np.median(offsets)) if offsets else 0.0
    return {
        "version": COMPARISON_COORDINATE_VERSION,
        "direction": "OLD_SHIFTED_TO_NEW",
        "provisionalOffsetM": provisional_offset,
        "oldFormula": "oldComparisonDistanceM = oldDistanceM + provisionalOffsetM",
        "newFormula": "newComparisonDistanceM = newDistanceM",
        "isFinalTransform": False,
        "note": "Temporary normalization only. Use transform.knots for final anomaly mapping.",
    }


def calculate_tiein_offset(old_features, new_features, excluded_ranges=None):
    old_before = extract_anchors(old_features, "OLD", [])
    new_before = extract_anchors(new_features, "NEW", [])
    old_anchors = extract_anchors(old_features, "OLD", excluded_ranges)
    new_anchors = extract_anchors(new_features, "NEW", excluded_ranges)
    excluded_anchor_count = len(old_before) + len(new_before) - len(old_anchors) - len(new_anchors)

    if not old_anchors or not new_anchors:
        return {
            "success": False,
            "error": "Not enough physical anchors (GW/flange/valve/tee/bend/facility) in both runs.",
        }
    if len(old_anchors) * len(new_anchors) > MAX_OVERLAP_CELLS:
        return {
            "success": False,
            "code": "TIEIN_INPUT_TOO_LARGE",
            "error": (
                f"Tie-in overlap search exceeds {MAX_OVERLAP_CELLS:,} anchor cells; "
                "narrow the physical window or exclude non-engineering anchors."
            ),
        }

    candidates = find_overlap_candidates(old_anchors, new_anchors)
    if not candidates or candidates[0]["pairCount"] < 2:
        return {
            "success": False,
            "error": "Could not find a sufficiently ordered physical overlap.",
        }

    best = candidates[0]
    selected_path = best["path"]
    # Facility fittings may be part of the overlap evidence while still being
    # an unsafe boundary for permanent-pipe interpolation.  Keep them for
    # candidate ranking, then begin the transform at the first downstream GW.
    stable_start_index = _stable_common_start_index(selected_path, old_anchors, new_anchors)
    selected_path = selected_path[stable_start_index:]
    if len(selected_path) < 2:
        return {
            "success": False,
            "code": "INSUFFICIENT_STABLE_TIEIN_KNOTS",
            "error": "The physical overlap does not contain two stable downstream TIE IN knots.",
        }
    matched = [(old_anchors[i], new_anchors[j]) for i, j in selected_path]
    selected_old_indexes = {old_index for old_index, _ in selected_path}
    selected_new_indexes = {new_index for _, new_index in selected_path}
    skipped_old_anchors = [
        old_anchors[index]
        for index in range(selected_path[0][0], selected_path[-1][0] + 1)
        if index not in selected_old_indexes
    ]
    skipped_new_anchors = [
        new_anchors[index]
        for index in range(selected_path[0][1], selected_path[-1][1] + 1)
        if index not in selected_new_indexes
    ]
    old_distances = [pair[0].dist for pair in matched]
    new_distances = [pair[1].dist for pair in matched]

    canonical_scale, canonical_offset, canonical_inliers, canonical_residuals, canonical_rmse = _fit_affine(
        old_distances, new_distances
    )
    legacy_scale, legacy_offset, legacy_inliers, legacy_residuals, legacy_rmse = _fit_affine(
        new_distances, old_distances
    )
    combined_inliers = canonical_inliers & legacy_inliers
    if not np.any(combined_inliers):
        combined_inliers = canonical_inliers
    inlier_pairs = [pair for pair, keep in zip(matched, combined_inliers) if keep]
    unaligned_pairs = [pair for pair, keep in zip(matched, combined_inliers) if not keep]
    if len(inlier_pairs) < 2:
        inlier_pairs = matched
        unaligned_pairs = []
        combined_inliers = np.ones(len(matched), dtype=bool)

    comparison_coordinates = _comparison_coordinates(inlier_pairs)
    provisional_offset = comparison_coordinates["provisionalOffsetM"]

    knots = _piecewise_knots(inlier_pairs)
    span_quality = _span_residual_quality(inlier_pairs)
    scale_range = _local_scale_range(knots)
    maximum_offset_step = _maximum_offset_step(knots)
    gate_breaches = geometry_gate_breaches(knots)
    overlap_length = min(
        inlier_pairs[-1][0].dist - inlier_pairs[0][0].dist,
        inlier_pairs[-1][1].dist - inlier_pairs[0][1].dist,
    )
    runner_up = candidates[1] if len(candidates) > 1 else None
    ambiguous = bool(
        runner_up
        and runner_up["score"] >= best["score"] * AMBIGUITY_SCORE_RATIO
        and runner_up["pairCount"] >= best["pairCount"] * 0.95
    )

    reasons = []
    if len(inlier_pairs) < MIN_AUTO_PAIRS:
        reasons.append("INSUFFICIENT_MATCHED_ANCHORS")
    if overlap_length < 20.0 and len(inlier_pairs) < 5:
        reasons.append("INSUFFICIENT_PHYSICAL_COVERAGE")
    if ambiguous:
        reasons.append("AMBIGUOUS_OVERLAP")
    if len(inlier_pairs) / len(matched) < 0.6:
        reasons.append("LOW_INLIER_RATIO")
    if canonical_scale <= 0.0:
        reasons.append("NON_MONOTONIC_TRANSFORM")
    if any(breach["breachedScale"] for breach in gate_breaches):
        reasons.append("LOCAL_SCALE_OUTSIDE_ENGINEERING_GATE")
    if any(breach["breachedOffsetStep"] for breach in gate_breaches):
        reasons.append("ABRUPT_OFFSET_CHANGE")
    if span_quality["p95AbsM"] > SPAN_P95_REVIEW_THRESHOLD_M:
        reasons.append("HIGH_SPAN_RESIDUAL")

    inlier_ratio = len(inlier_pairs) / len(matched)
    residual_score = math.exp(
        -0.5 * (span_quality["p95AbsM"] / ROBUST_RESIDUAL_THRESHOLD_M) ** 2
    )
    coverage_score = min(1.0, len(inlier_pairs) / 8.0)
    uniqueness_score = 0.0 if ambiguous else (
        1.0 if runner_up is None else max(0.0, min(1.0, 1.0 - runner_up["score"] / best["score"]))
    )
    scale_score = math.exp(-0.5 * ((canonical_scale - 1.0) / ILI_SCALE_TOLERANCE) ** 2)
    confidence = 100.0 * (
        0.35 * inlier_ratio
        + 0.25 * residual_score
        + 0.20 * coverage_score
        + 0.10 * uniqueness_score
        + 0.10 * scale_score
    )
    decision_status = "AUTO_ACCEPTED" if not reasons else "REVIEW_REQUIRED"

    def pair_details(pairs):
        details = []
        for old_anchor, new_anchor in pairs:
            canonical_residual = new_anchor.dist - (
                canonical_scale * old_anchor.dist + canonical_offset
            )
            details.append(
                {
                    "oldId": old_anchor.feature_id,
                    "newId": new_anchor.feature_id,
                    "oldDistanceM": old_anchor.dist,
                    "newDistanceM": new_anchor.dist,
                    "oldComparisonDistanceM": old_anchor.dist + provisional_offset,
                    "newComparisonDistanceM": new_anchor.dist,
                    "comparisonResidualM": new_anchor.dist - (old_anchor.dist + provisional_offset),
                    "type": old_anchor.type,
                    "residualM": float(canonical_residual),
                }
            )
        return details

    message = (
        f"{decision_status}: {len(inlier_pairs)} ordered physical anchor pairs; "
        f"OLD {inlier_pairs[0][0].dist:.3f} m ties to NEW {inlier_pairs[0][1].dist:.3f} m; "
        f"{len(skipped_old_anchors)} OLD and {len(skipped_new_anchors)} NEW anchors skipped; "
        f"affine diagnostic RMSE {canonical_rmse:.3f} m."
    )
    return {
        "success": True,
        "methodVersion": METHOD_VERSION,
        "decision": {
            "status": decision_status,
            "reasons": reasons,
            "requiresHumanReview": decision_status != "AUTO_ACCEPTED",
            "evidenceScore": float(confidence),
            "isProbability": False,
        },
        "tieIn": {
            "oldDistanceM": inlier_pairs[0][0].dist,
            "newDistanceM": inlier_pairs[0][1].dist,
            "oldId": inlier_pairs[0][0].feature_id,
            "newId": inlier_pairs[0][1].feature_id,
        },
        "transform": {
            "direction": "OLD_TO_NEW",
            "sourceRun": "OLD",
            "targetRun": "NEW",
            "model": "MONOTONIC_PIECEWISE_LINEAR",
            "allowExtrapolation": False,
            "domain": {
                "oldStartM": knots[0]["oldDistanceM"],
                "oldEndM": knots[-1]["oldDistanceM"],
                "newStartM": knots[0]["newDistanceM"],
                "newEndM": knots[-1]["newDistanceM"],
            },
            "affineFallback": {
                "scale": canonical_scale,
                "offsetM": canonical_offset,
                "formula": "newDistanceM = scale * oldDistanceM + offsetM",
            },
            "localScaleRange": scale_range,
            "maximumOffsetStepM": maximum_offset_step,
            "knotCount": len(knots),
            "knots": knots,
        },
        # Named spans behind LOCAL_SCALE_OUTSIDE_ENGINEERING_GATE and
        # ABRUPT_OFFSET_CHANGE.  A bare reason code tells an operator that
        # something is wrong somewhere along 4 km of pipe; these let them go look
        # at the actual spool before deciding.
        "gateBreaches": gate_breaches,
        "comparisonCoordinates": comparison_coordinates,
        "robustFit": {
            "method": ROBUST_FIT_METHOD,
            "dependencyFree": True,
            "residualThresholdM": ROBUST_RESIDUAL_THRESHOLD_M,
        },
        "spanResidual": span_quality,
        # Legacy contract: add offset to NEW to express it approximately on OLD.
        "offset": float(legacy_offset),
        "scale": float(legacy_scale),
        "confidence": float(min(100.0, max(0.0, confidence))),
        "message": message,
        "candidatePairCount": len(matched),
        "alignedPairCount": len(inlier_pairs),
        "unalignedPairCount": len(unaligned_pairs),
        "skippedOldAnchorCount": len(skipped_old_anchors),
        "skippedNewAnchorCount": len(skipped_new_anchors),
        "matchedPairCount": len(matched),
        "inlierPairCount": len(inlier_pairs),
        "residualRmseM": canonical_rmse,
        "legacyResidualRmseM": legacy_rmse,
        "excludedAnchorCount": excluded_anchor_count,
        "overlap": {
            "oldStartM": knots[0]["oldDistanceM"],
            "oldEndM": knots[-1]["oldDistanceM"],
            "newStartM": knots[0]["newDistanceM"],
            "newEndM": knots[-1]["newDistanceM"],
        },
        "evidenceOverlap": {
            "oldStartM": inlier_pairs[0][0].dist,
            "oldEndM": inlier_pairs[-1][0].dist,
            "newStartM": inlier_pairs[0][1].dist,
            "newEndM": inlier_pairs[-1][1].dist,
        },
        "candidates": [
            _public_candidate(candidate, rank)
            for rank, candidate in enumerate(candidates, start=1)
        ],
        "pairs": pair_details(inlier_pairs),
        "unalignedPairs": pair_details(unaligned_pairs),
        "skippedAnchors": {
            "old": [
                {"id": anchor.feature_id, "distanceM": anchor.dist, "type": anchor.type}
                for anchor in skipped_old_anchors
            ],
            "new": [
                {"id": anchor.feature_id, "distanceM": anchor.dist, "type": anchor.type}
                for anchor in skipped_new_anchors
            ],
        },
    }


def _force_utf8_io():
    """See dtw_engine._force_utf8_io — a decode error in the stdin iterator is
    raised outside the per-request try block and kills the persistent worker."""
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def main():
    """Persistent worker loop: one JSON request per stdin line."""
    _force_utf8_io()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        payload = {}
        try:
            payload = json.loads(line)
            request_id = payload.get("requestId")
            result = calculate_tiein_offset(
                payload.get("oldRun", []),
                payload.get("newRun", []),
                payload.get("excludedRanges", []),
            )
            result["requestId"] = request_id
            print(json.dumps(result))
            sys.stdout.flush()
        except Exception as error:
            print(
                json.dumps(
                    {
                        "success": False,
                        "error": str(error),
                        "requestId": payload.get("requestId"),
                    }
                )
            )
            sys.stdout.flush()


if __name__ == "__main__":
    main()
