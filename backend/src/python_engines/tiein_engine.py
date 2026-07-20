"""Universal, evidence-gated partial-run tie-in alignment.

The canonical spatial direction is OLD (historical) -> NEW (master).  A legacy
NEW-to-OLD affine offset is still returned while downstream callers migrate to
the explicit piecewise transform.
"""

import json
import math
import sys
from dataclasses import dataclass

import numpy as np


METHOD_VERSION = "ordered-local-spans-v2"
COMPARISON_COORDINATE_VERSION = "temporary-offset-normalization-v1"
RANSAC_RESIDUAL_THRESHOLD_M = 2.0
ILI_SCALE_TOLERANCE = 0.02
MAX_SKIP_ANCHORS = 4
MAX_OVERLAP_CELLS = 1_000_000
MIN_AUTO_PAIRS = 3
AMBIGUITY_SCORE_RATIO = 0.95

try:
    from sklearn.linear_model import RANSACRegressor
except ImportError:
    RANSACRegressor = None


@dataclass
class Anchor:
    idx: int
    dist: float
    type: str
    feature_id: object = None
    wall_thickness_mm: float | None = None
    joint_length_m: float | None = None
    clock_position: str | None = None
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


def _normalize_anchor_type(value):
    label = str(value or "").strip().lower()
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
    if "weld" in label or "girth" in label or "seam" in label:
        return "weld"
    return label


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
    allowed_types = {"weld", "valve", "tee", "bend", "launcher", "receiver"}
    anchors = []
    for index, feature in enumerate(features):
        labels = " ".join(
            str(value)
            for value in (
                feature.get("type"),
                feature.get("feature_type"),
                feature.get("feature_identification"),
                feature.get("originalType"),
            )
            if value is not None
        )
        anchor_type = _normalize_anchor_type(labels)
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
                clock_position=str(
                    _first_present(feature, "clock_position", "clock", default="")
                ).strip()
                or None,
                identification=str(
                    _first_present(feature, "feature_identification", "identification", default="")
                ).strip().lower(),
            )
        )
    return sorted(anchors, key=lambda anchor: (anchor.dist, anchor.idx))


def _node_score(old_anchor, new_anchor):
    if old_anchor.type != new_anchor.type:
        return float("-inf")
    score = 2.0 if old_anchor.type == "weld" else 4.0
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
    old_is_fitting_weld = "flang" in old_anchor.identification
    new_is_fitting_weld = "flang" in new_anchor.identification
    if old_is_fitting_weld != new_is_fitting_weld:
        score -= 6.0
    if old_anchor.clock_position and new_anchor.clock_position:
        score += 1.0 if old_anchor.clock_position == new_anchor.clock_position else -0.5
    return score


def _span_score(old_span, new_span, skipped_count):
    if old_span <= 0.0 or new_span <= 0.0:
        return float("-inf")
    absolute_error = abs(old_span - new_span)
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
                    prior_score = scores[prior_old_index][prior_new_index]
                    if prior_score <= 0.0:
                        continue
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


def _fit_affine(source, target):
    source_array = np.asarray(source, dtype=float).reshape(-1, 1)
    target_array = np.asarray(target, dtype=float)
    if RANSACRegressor is not None and len(target_array) >= 3:
        model = RANSACRegressor(
            residual_threshold=RANSAC_RESIDUAL_THRESHOLD_M,
            random_state=42,
        )
        model.fit(source_array, target_array)
        scale = float(model.estimator_.coef_[0])
        offset = float(model.estimator_.intercept_)
        inliers = np.asarray(model.inlier_mask_, dtype=bool)
        predicted = model.predict(source_array)
    else:
        scale = 1.0
        offset = float(np.median(target_array - source_array.flatten()))
        predicted = source_array.flatten() * scale + offset
        inliers = np.ones(len(target_array), dtype=bool)
    if not np.any(inliers):
        inliers = np.ones(len(target_array), dtype=bool)
    residuals = target_array - predicted
    rmse = float(np.sqrt(np.mean(np.square(residuals[inliers]))))
    return scale, offset, inliers, residuals, rmse


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
        if old_span >= 2.0 and new_span > 0.0:
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
            "error": "Not enough physical anchors (GW/valve/tee/bend) in both runs.",
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
    # A short fitting cluster at a launcher can differ in weld reporting while
    # the permanent pipe immediately downstream is identical.  Treat the first
    # endpoint after such an early skip as the stable physical common knot;
    # keep the preceding pair only as candidate-ranking evidence.
    stable_start_index = 0
    for pair_index, (old_index, new_index) in enumerate(selected_path[:3]):
        fitting_class_changed = (
            ("flang" in old_anchors[old_index].identification)
            != ("flang" in new_anchors[new_index].identification)
        )
        if fitting_class_changed and pair_index + 1 < len(selected_path):
            stable_start_index = pair_index + 1
    for pair_index in range(1, min(4, len(selected_path))):
        previous_old, previous_new = selected_path[pair_index - 1]
        current_old, current_new = selected_path[pair_index]
        near_candidate_start = (
            old_anchors[current_old].dist - old_anchors[selected_path[0][0]].dist <= 5.0
            and new_anchors[current_new].dist - new_anchors[selected_path[0][1]].dist <= 5.0
        )
        old_span = old_anchors[current_old].dist - old_anchors[previous_old].dist
        new_span = new_anchors[current_new].dist - new_anchors[previous_new].dist
        if near_candidate_start and (
            current_old - previous_old > 1 or current_new - previous_new > 1
        ):
            stable_start_index = pair_index
    selected_path = selected_path[stable_start_index:]
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
    scale_range = _local_scale_range(knots)
    maximum_offset_step = _maximum_offset_step(knots)
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
    if scale_range["minimum"] < 0.80 or scale_range["maximum"] > 1.20:
        reasons.append("LOCAL_SCALE_OUTSIDE_ENGINEERING_GATE")
    if maximum_offset_step > 1.5:
        reasons.append("ABRUPT_OFFSET_CHANGE")

    inlier_ratio = len(inlier_pairs) / len(matched)
    residual_score = math.exp(-0.5 * (canonical_rmse / RANSAC_RESIDUAL_THRESHOLD_M) ** 2)
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
            },
            "affineFallback": {
                "scale": canonical_scale,
                "offsetM": canonical_offset,
                "formula": "newDistanceM = scale * oldDistanceM + offsetM",
            },
            "localScaleRange": scale_range,
            "maximumOffsetStepM": maximum_offset_step,
            "knots": knots,
        },
        "comparisonCoordinates": comparison_coordinates,
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


def main():
    """Persistent worker loop: one JSON request per stdin line."""
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
