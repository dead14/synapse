import sys
import json
import math
import re
from bisect import bisect_left, bisect_right
from tiein_transform import (
    map_old_to_new,
    validated_tiein_knot_records,
    validated_tiein_knots,
)

# Feature types that serve as absolute anchors (Tier-1 in ILI alignment).
# Valves and Tees are sparse, physical fixtures whose odometer positions are
# highly stable between ILI runs, making them ideal alignment anchors.
ANCHOR_TYPES = {'valve', 'tee'}
# Generous tolerance for anchor matching — these are absolute reference points
# whose odometer drift is bounded by physical placement (ported from
# engine/constants.py LANDMARK_MATCH_TOL).
ANCHOR_TOLERANCE_M = 200.0
TIEIN_ANCHOR_TOLERANCE_M = 10.0
TIEIN_KNOT_DISTANCE_TOLERANCE_M = 1e-6

# The implementation allocates both a cost matrix and a path matrix. Keep the
# allocation bounded so malformed or unexpectedly large requests fail before
# they can exhaust the worker's memory.
MAX_DTW_CELLS = 4_000_000


def ota_deviation_ratio(old_spool, new_spool):
    """Return the OTA ratio defined by the ILI comparison workflow.

    OTA is evaluated per spool as ``abs(L_old / L_new - 1)``.  Keeping this
    in one helper makes the DTW decision, the QA table, and the chart metadata
    agree on the same physical rule.
    """
    if new_spool <= 0:
        return float('inf')
    return abs((old_spool / new_spool) - 1.0)


def _distance_intervals(previous, current):
    source_values = (
        previous.get('oldSourceDist'),
        current.get('oldSourceDist'),
        previous.get('newSourceDist'),
        current.get('newSourceDist'),
    )
    use_source_distances = all(
        isinstance(value, (int, float)) and math.isfinite(value)
        for value in source_values
    )
    if use_source_distances:
        old_previous, old_current, new_previous, new_current = source_values
    else:
        old_previous = previous.get('oldDist', 0.0)
        old_current = current.get('oldDist', 0.0)
        new_previous = previous.get('newDist', 0.0)
        new_current = current.get('newDist', 0.0)
    return old_current - old_previous, new_current - new_previous


def _alignment_feature_kind(feature):
    primary = feature.get('type')
    primary_label = str(primary or '').strip()
    identification_label = str(feature.get('feature_identification') or '').strip().lower()
    if not primary_label or primary_label.lower() in {'other', 'unknown', 'unclassified'}:
        primary_label = str(
            feature.get('originalType')
            or feature.get('feature_type')
            or feature.get('feature_identification')
            or ''
        ).strip()
    label = primary_label.lower()
    if re.search(r'\bflang(?:e|ed)\b', label) or re.search(r'\bflang(?:e|ed)\b', identification_label):
        return 'flange'
    if re.search(r'\bvalve\b', label):
        return 'valve'
    if re.search(r'\b(?:tee|offtake|branch(?:\s+connection)?)\b', label):
        return 'tee'
    if re.search(r'\b(?:weld|girth|seam)\b', label):
        return 'weld'
    return label


def match_valves(old_features, new_features, tolerance=ANCHOR_TOLERANCE_M):
    """
    Match valve/tee anchors by type while preserving physical order.

    Valves and tees are the most physically stable features — they don't move
    between inspections. Matching them FIRST establishes "mega-segments" that
    constrain downstream girth-weld matching, preventing global drift errors.

    Literature basis: ADTH-DTW (MDPI 2026) and Dann & Maes (2017) both
    establish the hierarchy valve -> weld -> defect.

    Returns a list of {old_dist, new_dist, old_id, new_id} anchor pairs,
    sorted by old_dist. Empty if no anchors found in either run.
    """
    old_anchors = sorted(
        [f for f in old_features if _alignment_feature_kind(f) in ANCHOR_TYPES],
        key=lambda f: float(f.get('dist', 0))
    )
    new_anchors = sorted(
        [f for f in new_features if _alignment_feature_kind(f) in ANCHOR_TYPES],
        key=lambda f: float(f.get('dist', 0))
    )

    if not old_anchors or not new_anchors:
        return []

    old_count = len(old_anchors)
    new_count = len(new_anchors)
    # Scores only need the previous row. Keep one byte per cell for
    # backtracking instead of retaining several full Python-object matrices.
    actions = [bytearray(new_count + 1) for _ in range(old_count + 1)]
    for new_index in range(1, new_count + 1):
        actions[0][new_index] = 1  # Skip the new anchor.

    previous_counts = [0] * (new_count + 1)
    previous_errors = [0.0] * (new_count + 1)

    for old_index in range(1, old_count + 1):
        old_anchor = old_anchors[old_index - 1]
        current_counts = [0] * (new_count + 1)
        current_errors = [0.0] * (new_count + 1)
        for new_index in range(1, new_count + 1):
            new_anchor = new_anchors[new_index - 1]
            options = [
                (
                    previous_counts[new_index],
                    previous_errors[new_index],
                    0,
                ),
                (
                    current_counts[new_index - 1],
                    current_errors[new_index - 1],
                    1,
                ),
            ]
            difference = abs(
                float(old_anchor.get('dist', 0)) - float(new_anchor.get('dist', 0))
            )
            if (
                _alignment_feature_kind(old_anchor) == _alignment_feature_kind(new_anchor)
                and difference <= tolerance
            ):
                options.append((
                    previous_counts[new_index - 1] + 1,
                    previous_errors[new_index - 1] + difference,
                    2,
                ))

            best = max(options, key=lambda option: (option[0], -option[1], option[2]))
            current_counts[new_index] = best[0]
            current_errors[new_index] = best[1]
            actions[old_index][new_index] = best[2]

        previous_counts = current_counts
        previous_errors = current_errors

    matched_indexes = []
    old_index, new_index = old_count, new_count
    while old_index > 0 or new_index > 0:
        action = actions[old_index][new_index]
        if action == 2:
            matched_indexes.append((old_index - 1, new_index - 1))
            old_index -= 1
            new_index -= 1
        elif action == 1:
            new_index -= 1
        else:
            old_index -= 1
    matched_indexes.reverse()

    pairs = []
    for i, j in matched_indexes:
        pairs.append({
            'old_dist': float(old_anchors[i].get('dist', 0)),
            'new_dist': float(new_anchors[j].get('dist', 0)),
            'old_id': old_anchors[i].get('id'),
            'new_id': new_anchors[j].get('id'),
        })
    return pairs


def calculate_dtw(old_gws, new_gws, ota_threshold, strict_penalty=False):
    """
    Dynamic Time Warping (DTW) explicitly for Girth Welds.
    Matches old_gws with new_gws using distance constraints.
    ota_threshold is a percentage (e.g. 1.5 for 1.5%).
    """
    n = len(old_gws)
    m = len(new_gws)

    cell_count = n * m
    if cell_count > MAX_DTW_CELLS:
        raise ValueError(
            f"DTW input requires {cell_count} cells; maximum is {MAX_DTW_CELLS}"
        )
    
    if n == 0 or m == 0:
        return []

    # Pre-extract arrays for faster lookup and avoid dictionary access in tight loops
    old_dists = [gw['dist'] for gw in old_gws]
    new_dists = [gw['dist'] for gw in new_gws]

    # Precalculate spool lengths (distance from previous GW)
    for i in range(n):
        old_gws[i]['spool'] = old_dists[i] - old_dists[i-1] if i > 0 else old_dists[i]
    for j in range(m):
        new_gws[j]['spool'] = new_dists[j] - new_dists[j-1] if j > 0 else new_dists[j]
    
    inf = float('inf')
    
    # Initialize DTW matrix with infinity
    dtw_matrix = [[inf] * (m + 1) for _ in range(n + 1)]
    dtw_matrix[0][0] = 0.0
    
    # Path tracking matrix
    path_matrix = [[(-1, -1)] * (m + 1) for _ in range(n + 1)]
    path_matrix[0][0] = (0, 0)
    
    # Initialize edges to allow insertions/deletions at the start
    for i in range(1, n + 1):
        dtw_matrix[i][0] = dtw_matrix[i-1][0] + 5.0
        path_matrix[i][0] = (i-1, 0)
    for j in range(1, m + 1):
        dtw_matrix[0][j] = dtw_matrix[0][j-1] + 5.0
        path_matrix[0][j] = (0, j-1)
    
    ota_factor = ota_threshold / 100.0
    gap_penalty = 2.0 + (ota_threshold / 4.0)
    K = 10 # Lookback up to 9 skips
    best_end_cost = inf
    best_end = (n, m)
    
    # Local variable caching for performance
    strict_mult = 1.0 if strict_penalty else 0.001

    for i in range(1, n + 1):
        old_dist = old_dists[i-1]
        
        # Calculate Physical Window based on OTA.
        allowed_global_drift = max(old_dist, 50.0) * ota_factor
        if allowed_global_drift < 10.0:
            allowed_global_drift = 10.0

        # Binary search for window bounds
        first_j = max(1, bisect_left(new_dists, old_dist - allowed_global_drift) + 1)
        last_j = bisect_right(new_dists, old_dist + allowed_global_drift)
        
        for j in range(first_j, last_j + 1):
            new_dist = new_dists[j-1]
            if _alignment_feature_kind(old_gws[i-1]) != _alignment_feature_kind(new_gws[j-1]):
                continue
            abs_dist_diff = abs(old_dist - new_dist)
            
            best_cost = inf
            best_prev = (-1, -1)
            
            # Allow skipping INITIAL nodes: if i <= K and j <= K, we can jump from (0,0) to (i,j)
            if i <= K and j <= K:
                cost = abs_dist_diff * strict_mult
                total_cost = dtw_matrix[0][0] + cost + (i - 1) * gap_penalty + (j - 1) * gap_penalty
                if total_cost < best_cost:
                    best_cost = total_cost
                    best_prev = (0, 0)
            
            # Dynamic Spool Length Lookback
            limit_i = i if i < K else K
            limit_j = j if j < K else K
            
            for k in range(1, limit_i + 1):
                prev_i = i - k
                L_old = old_dist - old_dists[prev_i-1] if prev_i > 0 else old_dist
                k_penalty = (k - 1) * gap_penalty
                
                dtw_row = dtw_matrix[prev_i]
                
                for l in range(1, limit_j + 1):
                    prev_j = j - l
                    if prev_i == 0 and prev_j == 0:
                        continue
                    
                    base_cost = dtw_row[prev_j]
                    if base_cost == inf:
                        continue
                        
                    L_new = new_dist - new_dists[prev_j-1] if prev_j > 0 else new_dist
                    
                    if L_new <= 0:
                        deviation_pct = inf
                        actual_diff = abs(L_old - L_new)
                    else:
                        deviation_ratio = abs((L_old / L_new) - 1.0)
                        deviation_pct = deviation_ratio * 100.0
                        actual_diff = abs(L_old - L_new)
                    
                    if deviation_pct <= ota_threshold:
                        cost = actual_diff
                    else:
                        allowed_spool_difference = L_new * ota_factor
                        excess_diff = actual_diff - allowed_spool_difference
                        cost = actual_diff + excess_diff * 100.0
                        
                    if strict_penalty:
                        cost += abs_dist_diff
                        if deviation_pct > 50.0:
                            cost = inf
                    else:
                        cost += abs_dist_diff * 0.001
                        
                    if cost != inf:
                        total_cost = base_cost + cost + k_penalty + (l - 1) * gap_penalty
                        if total_cost < best_cost:
                            best_cost = total_cost
                            best_prev = (prev_i, prev_j)
                            
            dtw_matrix[i][j] = best_cost
            path_matrix[i][j] = best_prev

            if best_cost != inf:
                final_cost = best_cost + (n - i) * gap_penalty + (m - j) * gap_penalty
                if final_cost < best_end_cost:
                    best_end_cost = final_cost
                    best_end = (i, j)

    # Backtrack to find the optimal path
    matches = []
    
    # Find best end node
    i, j = best_end
    
    # No candidate survived the physical window. Returning two independent
    # orphan sets preserves the constraint instead of inventing a diagonal
    # match between physically unrelated welds.
    if best_end_cost == float('inf'):
        for old_index, old_gw in enumerate(old_gws):
            matches.append({
                'oldIndex': old_index, 'newIndex': None,
                'oldId': old_gw['id'], 'newId': None,
                'oldDist': old_gw['dist'], 'newDist': None,
                'status': 'Skipped'
            })
        for new_index, new_gw in enumerate(new_gws):
            matches.append({
                'oldIndex': None, 'newIndex': new_index,
                'oldId': None, 'newId': new_gw['id'],
                'oldDist': None, 'newDist': new_gw['dist'],
                'status': 'Skipped'
            })
        return matches
    
    # The skipped elements at the very end
    for skip_i in range(n, i, -1):
        matches.append({
            'oldIndex': skip_i-1, 'newIndex': None,
            'oldId': old_gws[skip_i-1]['id'], 'newId': None,
            'oldDist': old_gws[skip_i-1]['dist'], 'newDist': None,
            'status': 'Skipped'
        })
    for skip_j in range(m, j, -1):
        matches.append({
            'oldIndex': None, 'newIndex': skip_j-1,
            'oldId': None, 'newId': new_gws[skip_j-1]['id'],
            'oldDist': None, 'newDist': new_gws[skip_j-1]['dist'],
            'status': 'Skipped'
        })
        
    while i > 0 and j > 0:
        prev_i, prev_j = path_matrix[i][j]
        
        # A finite cell should always have a predecessor. If corrupt or
        # inconsistent state is encountered, stop matching and let the
        # remaining entries be emitted as skips below.
        if prev_i == -1 and prev_j == -1:
            break
            
        matches.append({
            'oldIndex': i-1, 'newIndex': j-1,
            'oldId': old_gws[i-1]['id'], 'newId': new_gws[j-1]['id'],
            'oldDist': old_gws[i-1]['dist'], 'newDist': new_gws[j-1]['dist'],
            'status': 'Match'
        })
        
        # Add skipped in between
        for skip_i in range(i - 1, prev_i, -1):
            matches.append({
                'oldIndex': skip_i-1, 'newIndex': None,
                'oldId': old_gws[skip_i-1]['id'], 'newId': None,
                'oldDist': old_gws[skip_i-1]['dist'], 'newDist': None,
                'status': 'Skipped'
            })
        for skip_j in range(j - 1, prev_j, -1):
            matches.append({
                'oldIndex': None, 'newIndex': skip_j-1,
                'oldId': None, 'newId': new_gws[skip_j-1]['id'],
                'oldDist': None, 'newDist': new_gws[skip_j-1]['dist'],
                'status': 'Skipped'
            })
            
        i, j = prev_i, prev_j
        
    # Handling remaining skips at the beginning if any
    while i > 0:
        matches.append({
            'oldIndex': i-1, 'newIndex': None,
            'oldId': old_gws[i-1]['id'], 'newId': None,
            'oldDist': old_gws[i-1]['dist'], 'newDist': None,
            'status': 'Skipped'
        })
        i -= 1
    while j > 0:
        matches.append({
            'oldIndex': None, 'newIndex': j-1,
            'oldId': None, 'newId': new_gws[j-1]['id'],
            'oldDist': None, 'newDist': new_gws[j-1]['dist'],
            'status': 'Skipped'
        })
        j -= 1
        
    matches.reverse()

    # NOTE: Post-processing (joint lengths, deviation_ratio, flagged) is now
    # handled by _post_process_matches() in main() to avoid duplication when
    # running valve-segmented DTW (multiple segments need unified post-processing).
    return matches

def linear_referencing(old_features, new_features, gw_matches):
    """
    Interpolate positions of non-GW features based on matched GW boundaries.
    """
    # Create lookup dictionaries for quick access
    old_gw_dists = { m['oldId']: m['oldDist'] for m in gw_matches }
    new_gw_dists = { m['newId']: m['newDist'] for m in gw_matches }
    
    aligned_features = []
    
    # We will process the pipeline segment by segment (between matched GWs)
    # Only use actual matches for linear referencing
    valid_matches = [m for m in gw_matches if m['status'] == 'Match']
    
    for k in range(len(valid_matches) - 1):
        match_start = valid_matches[k]
        match_end = valid_matches[k+1]
        
        old_start = match_start['oldDist']
        old_end = match_end['oldDist']
        new_start = match_start['newDist']
        new_end = match_end['newDist']
        
        old_len = old_end - old_start
        new_len = new_end - new_start
        
        # Find features in this segment
        segment_features = [f for f in old_features if old_start <= f['dist'] < old_end and _alignment_feature_kind(f) != 'weld']
        
        for f in segment_features:
            if old_len > 0:
                ratio = (f['dist'] - old_start) / old_len
                mapped_dist = new_start + (ratio * new_len)
            else:
                mapped_dist = new_start
                
            aligned_features.append({
                **f,
                'alignedDist': mapped_dist,
                'segmentStart': old_start,
                'segmentEnd': old_end
            })
            
    return aligned_features


def reconcile_gw_matches(candidate_matches, old_gws, new_gws):
    """Conserve every source GW exactly once, preferring valid matches.

    Segment-based DTW can emit the same boundary from two segments or omit a
    run tail when the opposite side has no records. Rebuilding the orphan set
    from the authoritative source lists makes those cases deterministic.
    """
    def identity(feature_id, distance):
        if distance is None:
            return None
        # A null vendor ID is valid. Distance and ordered occurrence keep such
        # rows distinct enough for reconciliation; same-chainage duplicates
        # are consumed from the source pool exactly once.
        return str(feature_id) if feature_id is not None else None, round(float(distance), 6)

    def build_pool(features):
        pool = {}
        for index, feature in enumerate(features):
            key = identity(feature.get("id"), feature.get("dist"))
            if key is not None:
                pool.setdefault(key, []).append((index, feature))
        return pool

    old_pool = build_pool(old_gws)
    new_pool = build_pool(new_gws)
    used_old = set()
    used_new = set()
    reconciled = []

    for candidate in candidate_matches:
        if candidate.get("status") != "Match":
            continue
        old_key = identity(candidate.get("oldId"), candidate.get("oldDist"))
        new_key = identity(candidate.get("newId"), candidate.get("newDist"))
        old_options = old_pool.get(old_key, [])
        new_options = new_pool.get(new_key, [])
        old_entry = next((entry for entry in old_options if entry[0] not in used_old), None)
        new_entry = next((entry for entry in new_options if entry[0] not in used_new), None)
        if old_entry is None or new_entry is None:
            continue

        old_index, old_feature = old_entry
        new_index, new_feature = new_entry
        used_old.add(old_index)
        used_new.add(new_index)
        reconciled.append({
            **candidate,
            "oldIndex": old_index,
            "newIndex": new_index,
            "oldId": old_feature.get("id"),
            "newId": new_feature.get("id"),
            "oldDist": old_feature.get("dist"),
            "newDist": new_feature.get("dist"),
            # Dist is the common NEW-master coordinate after TIE IN.  Preserve
            # source odometers too, so the UI can measure actual spool length
            # when an engineer clicks two adjacent GW markers.
            "oldSourceDist": old_feature.get("sourceDist", old_feature.get("dist")),
            "newSourceDist": new_feature.get("sourceDist", new_feature.get("dist")),
            "oldKey": old_feature.get("sourceKey", f"OLD:{old_index}"),
            "newKey": new_feature.get("sourceKey", f"NEW:{new_index}"),
            "status": "Match",
        })

    for old_index, old_feature in enumerate(old_gws):
        if old_index in used_old:
            continue
        reconciled.append({
            "oldIndex": old_index,
            "newIndex": None,
            "oldId": old_feature.get("id"),
            "newId": None,
            "oldDist": old_feature.get("dist"),
            "newDist": None,
            "oldSourceDist": old_feature.get("sourceDist", old_feature.get("dist")),
            "newSourceDist": None,
            "oldKey": old_feature.get("sourceKey", f"OLD:{old_index}"),
            "newKey": None,
            "status": "Skipped",
        })

    for new_index, new_feature in enumerate(new_gws):
        if new_index in used_new:
            continue
        reconciled.append({
            "oldIndex": None,
            "newIndex": new_index,
            "oldId": None,
            "newId": new_feature.get("id"),
            "oldDist": None,
            "newDist": new_feature.get("dist"),
            "oldSourceDist": None,
            "newSourceDist": new_feature.get("sourceDist", new_feature.get("dist")),
            "oldKey": None,
            "newKey": new_feature.get("sourceKey", f"NEW:{new_index}"),
            "status": "Skipped",
        })

    return reconciled


def _tiein_locked_matches(knot_records, old_gws, new_gws):
    """Resolve every accepted transform knot back to its physical weld rows.

    Accepted knots are authoritative. They must never be fed through DTW a
    second time because OTA and unrelated anchors could reassign them. The
    resolver is intentionally strict and returns unresolved indexes instead
    of silently falling back to heuristic matching.
    """
    used_old = set()
    used_new = set()
    matches = []
    unresolved = []

    def source_distance(feature):
        return feature.get("sourceDist", feature.get("dist"))

    def build_pool(features):
        pool = {}
        for index, feature in enumerate(features):
            if _alignment_feature_kind(feature) != "weld":
                continue
            distance = source_distance(feature)
            if not isinstance(distance, (int, float)) or not math.isfinite(distance):
                continue
            pool.setdefault(round(float(distance), 6), []).append((index, feature))
        return pool

    old_pool = build_pool(old_gws)
    new_pool = build_pool(new_gws)

    def resolve(pool, target_distance, expected_id, used_indexes):
        candidates = []
        for index, feature in pool.get(round(float(target_distance), 6), []):
            if index in used_indexes:
                continue
            distance = source_distance(feature)
            if not math.isclose(
                float(distance),
                float(target_distance),
                abs_tol=TIEIN_KNOT_DISTANCE_TOLERANCE_M,
            ):
                continue
            candidates.append((index, feature))

        if expected_id is not None:
            id_matches = [
                candidate for candidate in candidates
                if candidate[1].get("id") is not None
                and str(candidate[1].get("id")) == str(expected_id)
            ]
            if len(id_matches) == 1:
                return id_matches[0]
            if len(id_matches) > 1:
                return None
            # When both sides carry an ID, a mismatch is stale evidence, not
            # permission to substitute a different weld at the same chainage.
            if any(candidate[1].get("id") is not None for candidate in candidates):
                return None

        # Distance-only resolution is supported for vendor rows without IDs,
        # but ambiguity at an identical chainage must be reviewed upstream.
        return candidates[0] if len(candidates) == 1 else None

    for knot_index, knot in enumerate(knot_records):
        old_entry = resolve(
            old_pool,
            knot["oldDistanceM"],
            knot.get("oldId"),
            used_old,
        )
        new_entry = resolve(
            new_pool,
            knot["newDistanceM"],
            knot.get("newId"),
            used_new,
        )
        if old_entry is None or new_entry is None:
            unresolved.append(knot_index)
            continue

        old_index, old_feature = old_entry
        new_index, new_feature = new_entry
        used_old.add(old_index)
        used_new.add(new_index)
        matches.append({
            "oldIndex": old_index,
            "newIndex": new_index,
            "oldId": old_feature.get("id"),
            "newId": new_feature.get("id"),
            "oldDist": old_feature.get("dist"),
            "newDist": new_feature.get("dist"),
            "status": "Match",
        })

    return matches, unresolved


def _prepare_runs_in_master_space(data):
    """Copy input rows and apply only an accepted OLD-to-NEW transform."""
    old_run = [dict(feature) for feature in data.get('oldRun', [])]
    new_run = [dict(feature) for feature in data.get('newRun', [])]
    knots = validated_tiein_knots(data)
    transform_applied = bool(knots)
    excluded_old = []
    excluded_new = []

    if transform_applied:
        transformed_old = []
        for feature in old_run:
            distance = feature.get('dist')
            if not isinstance(distance, (int, float)) or not math.isfinite(distance):
                continue
            master_distance = map_old_to_new(float(distance), knots)
            if master_distance is None:
                excluded_old.append({
                    'id': feature.get('id'),
                    'sourceDistanceM': float(distance),
                    'type': feature.get('type', feature.get('originalType')),
                    'reason': 'OUTSIDE_ACCEPTED_TIEIN_DOMAIN',
                })
                continue
            feature['sourceDist'] = float(distance)
            feature['dist'] = master_distance
            transformed_old.append(feature)
        old_run = transformed_old
        target_start = knots[0][1]
        target_end = knots[-1][1]
        overlapping_new = []
        for feature in new_run:
            distance = feature.get('dist')
            if not isinstance(distance, (int, float)) or not math.isfinite(distance):
                continue
            if float(distance) < target_start or float(distance) > target_end:
                excluded_new.append({
                    'id': feature.get('id'),
                    'sourceDistanceM': float(distance),
                    'type': feature.get('type', feature.get('originalType')),
                    'reason': 'OUTSIDE_ACCEPTED_TIEIN_TARGET_DOMAIN',
                })
                continue
            overlapping_new.append(feature)
        new_run = overlapping_new
    else:
        # Compatibility path for sessions created before the directional
        # transform contract. Legacy offset maps NEW approximately onto OLD.
        tie_in_offset = data.get('tieInOffset', 0.0)
        if isinstance(tie_in_offset, (int, float)) and tie_in_offset != 0.0:
            for feature in new_run:
                if isinstance(feature.get('dist'), (int, float)):
                    feature['sourceDist'] = feature['dist']
                    feature['dist'] = feature['dist'] + tie_in_offset
    return old_run, new_run, transform_applied, excluded_old, excluded_new


def _timeline_feature(feature, display_distance, *, in_overlap=True, reason=None):
    source_distance = feature.get('sourceDist', feature.get('dist'))
    item = {
        'id': feature.get('id'),
        'type': _alignment_feature_kind(feature),
        'displayDistanceM': float(display_distance),
        'sourceDistanceM': float(source_distance),
        'inOverlap': bool(in_overlap),
    }
    if reason:
        item['reason'] = reason
    return item


def _build_timeline_evidence(data, knots):
    """Describe both physical run coverages on the NEW-master coordinate.

    Matching is intentionally limited to the accepted TIE IN overlap, but the
    review timeline must retain BOTH complete inspections. Whichever run reaches
    beyond the overlap, the operator has to see the part that was not compared.

    Only the NEW side used to be kept whole. That covered a partial OLD run
    against a full master, but not the mirror case, and the mirror case is just
    as real: a full 2012 run against a partial 2024 master silently lost 1.8 km
    of OLD pipe. Both lanes then rendered as fully covered, which flatly
    contradicted the tie-in card that stated the domain started at OLD 1869.77 m.
    """
    timeline_kinds = {'weld', 'valve', 'tee'}

    def finite_features(features):
        return sorted(
            [
                feature for feature in features
                if _alignment_feature_kind(feature) in timeline_kinds
                and isinstance(feature.get('dist'), (int, float))
                and math.isfinite(feature['dist'])
            ],
            key=lambda feature: float(feature['dist']),
        )

    raw_old = finite_features([dict(feature) for feature in data.get('oldRun', [])])
    raw_new = finite_features([dict(feature) for feature in data.get('newRun', [])])

    if knots:
        old_source_start, new_target_start = knots[0]
        old_source_end, new_target_end = knots[-1]

        def old_display_distance(source_distance):
            """Where an OLD feature sits on the master axis, for display only.

            Inside the knot domain this is the accepted piecewise mapping. Beyond
            either end there is no accepted mapping, so the offset at the nearest
            knot is carried outward — the surveyor's assumption that no further
            drift is known past the last common point. These positions never
            reach the matcher, which still runs strictly inside the domain, so
            `allowExtrapolation: false` on the transform is untouched.
            """
            if source_distance < old_source_start:
                return new_target_start - (old_source_start - source_distance)
            if source_distance > old_source_end:
                return new_target_end + (source_distance - old_source_end)
            return map_old_to_new(source_distance, knots)

        old_features = []
        for feature in raw_old:
            source_distance = float(feature['dist'])
            in_domain = old_source_start <= source_distance <= old_source_end
            display_distance = old_display_distance(source_distance)
            if display_distance is None:
                continue
            old_features.append(_timeline_feature(
                dict(feature, sourceDist=source_distance),
                display_distance,
                in_overlap=in_domain,
                reason=None if in_domain else 'OUTSIDE_ACCEPTED_TIEIN_DOMAIN',
            ))
        old_features.sort(key=lambda item: item['displayDistanceM'])
        new_features = [
            _timeline_feature(
                feature,
                feature['dist'],
                in_overlap=new_target_start <= float(feature['dist']) <= new_target_end,
                reason=(
                    None
                    if new_target_start <= float(feature['dist']) <= new_target_end
                    else 'OUTSIDE_ACCEPTED_TIEIN_TARGET_DOMAIN'
                ),
            )
            for feature in raw_new
        ]
        old_coverage = {
            'startM': float(new_target_start),
            'endM': float(new_target_end),
            'sourceStartM': float(old_source_start),
            'sourceEndM': float(old_source_end),
        }
    else:
        old_features = [
            _timeline_feature(feature, feature['dist'])
            for feature in raw_old
        ]
        new_features = [
            _timeline_feature(feature, feature['dist'])
            for feature in raw_new
        ]
        old_coverage = (
            {
                'startM': old_features[0]['displayDistanceM'],
                'endM': old_features[-1]['displayDistanceM'],
                'sourceStartM': old_features[0]['sourceDistanceM'],
                'sourceEndM': old_features[-1]['sourceDistanceM'],
            }
            if old_features else None
        )

    all_display_distances = [
        feature['displayDistanceM']
        for feature in [*old_features, *new_features]
    ]
    domain = (
        {'startM': min(all_display_distances), 'endM': max(all_display_distances)}
        if all_display_distances else {'startM': 0.0, 'endM': 1.0}
    )
    new_coverage = (
        {
            'startM': new_features[0]['displayDistanceM'],
            'endM': new_features[-1]['displayDistanceM'],
        }
        if new_features else None
    )
    return {
        'coordinateSystem': 'NEW_MASTER' if knots else 'COMMON_DISPLAY',
        'domain': domain,
        'oldCoverage': old_coverage,
        'newCoverage': new_coverage,
        'oldFeatures': old_features,
        'newFeatures': new_features,
    }


def process_request(data):
    ota_threshold = data.get('ota', 1.5)
    strict_penalty = data.get('strictPenalty', False)
    if data.get('partialRunEnabled') is True and data.get('tieInTransform') is None:
        return {
            "success": False,
            "code": "PARTIAL_RUN_TIEIN_REQUIRED",
            "error": "Partial-run alignment requires accepted TIE IN evidence; raw odometer matching is blocked.",
            "requestId": data.get('requestId'),
        }
    if data.get('tieInTransform') is not None and not validated_tiein_knots(data):
        return {
            "success": False,
            "code": "INVALID_TIEIN_TRANSFORM",
            "error": "Tie-in transform is invalid or lacks server-accepted evidence.",
            "requestId": data.get('requestId'),
        }
    tie_in_knot_records = validated_tiein_knot_records(data)
    old_run, new_run, tie_in_transform_applied, tie_in_excluded_old, tie_in_excluded_new = _prepare_runs_in_master_space(data)
    timeline = _build_timeline_evidence(data, validated_tiein_knots(data))
    use_valve_anchor = data.get('useValveAnchor', False)
    apply_dtw_correction = data.get('applyDtwCorrection', True)
    request_id = data.get('requestId')
    # Extract GW candidates (strict Tier-1/Tier-2 anchors only)
    gw_types = {'weld', 'valve', 'tee'}
    
    old_gws = sorted(
        [f for f in old_run if _alignment_feature_kind(f) in gw_types
         and isinstance(f.get('dist'), (int, float)) and math.isfinite(f['dist'])],
        key=lambda feature: feature['dist'],
    )
    new_gws = sorted(
        [f for f in new_run if _alignment_feature_kind(f) in gw_types
         and isinstance(f.get('dist'), (int, float)) and math.isfinite(f['dist'])],
        key=lambda feature: feature['dist'],
    )

    if not old_gws or not new_gws:
        return {
            "success": False,
            "code": "NO_ALIGNMENT_ANCHORS",
            "error": "No GWs/Anchors found in one or both runs",
            "requestId": request_id,
            "tieInTransformApplied": tie_in_transform_applied,
            "tieInExcludedOld": tie_in_excluded_old,
            "tieInExcludedNew": tie_in_excluded_new,
        }

    cell_count = len(old_gws) * len(new_gws)
    if not tie_in_transform_applied and cell_count > MAX_DTW_CELLS:
        return {
            "success": False,
            "code": "DTW_INPUT_TOO_LARGE",
            "error": (
                f"DTW input requires {cell_count} cells; "
                f"maximum is {MAX_DTW_CELLS}"
            ),
            "requestId": request_id,
        }

    valve_pairs = match_valves(
        old_gws,
        new_gws,
        tolerance=(TIEIN_ANCHOR_TOLERANCE_M if tie_in_transform_applied else ANCHOR_TOLERANCE_M),
    ) if use_valve_anchor else []

    all_gw_matches = []
    matching_mode = "DTW"

    if tie_in_transform_applied:
        gw_matches, unresolved_knot_indexes = _tiein_locked_matches(
            tie_in_knot_records,
            old_gws,
            new_gws,
        )
        if unresolved_knot_indexes:
            return {
                "success": False,
                "code": "TIEIN_LOCK_RESOLUTION_FAILED",
                "error": "One or more accepted TIE IN weld knots cannot be resolved uniquely in both runs.",
                "requestId": request_id,
                "tieInTransformApplied": True,
                "unresolvedKnotIndexes": unresolved_knot_indexes,
                "tieInExcludedOld": tie_in_excluded_old,
                "tieInExcludedNew": tie_in_excluded_new,
            }
        matching_mode = "TIEIN_LOCKED"
    elif use_valve_anchor and len(valve_pairs) >= 2:
        for i in range(len(old_gws)):
            old_gws[i]['spool'] = old_gws[i]['dist'] - old_gws[i-1]['dist'] if i > 0 else old_gws[i]['dist']
        for j in range(len(new_gws)):
            new_gws[j]['spool'] = new_gws[j]['dist'] - new_gws[j-1]['dist'] if j > 0 else new_gws[j]['dist']

        for k in range(len(valve_pairs) - 1):
            old_lo = valve_pairs[k]['old_dist']
            old_hi = valve_pairs[k + 1]['old_dist']
            new_lo = valve_pairs[k]['new_dist']
            new_hi = valve_pairs[k + 1]['new_dist']

            seg_old = [w for w in old_gws if old_lo <= w['dist'] < old_hi]
            seg_new = [w for w in new_gws if new_lo <= w['dist'] < new_hi]

            if not seg_old or not seg_new:
                continue

            seg_matches = _run_dtw_segment(seg_old, seg_new, ota_threshold, strict_penalty)
            all_gw_matches.extend(seg_matches)

        first_old = valve_pairs[0]['old_dist']
        first_new = valve_pairs[0]['new_dist']
        last_old = valve_pairs[-1]['old_dist']
        last_new = valve_pairs[-1]['new_dist']

        pre_old = [w for w in old_gws if w['dist'] < first_old]
        pre_new = [w for w in new_gws if w['dist'] < first_new]
        if pre_old and pre_new:
            pre_matches = _run_dtw_segment(pre_old, pre_new, ota_threshold, strict_penalty)
            all_gw_matches.extend(pre_matches)

        post_old = [w for w in old_gws if w['dist'] >= last_old]
        post_new = [w for w in new_gws if w['dist'] >= last_new]
        if post_old and post_new:
            post_matches = _run_dtw_segment(post_old, post_new, ota_threshold, strict_penalty)
            all_gw_matches.extend(post_matches)

        all_gw_matches.sort(key=lambda match: (
            match.get('oldDist') is None,
            float(match.get('oldDist') or 0.0),
        ))
        gw_matches = all_gw_matches

    else:
        gw_matches = calculate_dtw(old_gws, new_gws, ota_threshold, strict_penalty)

    gw_matches = reconcile_gw_matches(gw_matches, old_gws, new_gws)
    _post_process_matches(gw_matches, ota_threshold)
    aligned_non_gw = linear_referencing(old_run, new_run, gw_matches) if apply_dtw_correction else []

    # The offset trend is deliberately produced by the engine from the final
    # DTW path.  Consumers must not reconstruct it from a mixed list of
    # matches, valve anchors, and skipped welds: duplicate x-values create
    # vertical chart artifacts and can point a chart click at the wrong row.
    offset_trend = [
        {
            'oldId': match.get('oldId'),
            'newId': match.get('newId'),
            'oldDistance': match.get('oldDist'),
            'newDistance': match.get('newDist'),
            'offset': round(match['newDist'] - match['oldDist'], 6),
            'oldSpool': match.get('L_ref', 0.0),
            'newSpool': match.get('L_new', 0.0),
            'otaPercent': round(match.get('deviation_ratio', 0.0) * 100.0, 6),
            'flagged': bool(match.get('flagged')),
        }
        for match in gw_matches
        if match.get('status') == 'Match'
        and match.get('oldDist') is not None
        and match.get('newDist') is not None
    ]

    gwMatchesFinal = []
    gwOrphans = []
    for m in gw_matches:
        if m.get('status') == 'Match':
            # Create a clean representation for gwMatchesFinal
            gwMatchesFinal.append({
                'old_id': m.get('oldId'),
                'new_id': m.get('newId'),
                'old_odometer': m.get('oldDist'),
                'new_odometer': m.get('newDist'),
                'type': 'GW', # Or preserve original type if needed, but GW is requested
                'status': 'MATCHED'
            })
        else:
            om = dict(m)
            om['type'] = 'GW'
            if om.get('newId') is None:
                om['status'] = 'ONLY_OLD'
                om['id'] = om.get('oldId')
                om['odometer'] = om.get('oldDist')
            elif om.get('oldId') is None:
                om['status'] = 'ONLY_NEW'
                om['id'] = om.get('newId')
                om['odometer'] = om.get('newDist')
            gwOrphans.append(om)

    return {
        "success": True,
        "gwMatches": gw_matches, # legacy compat
        "gwMatchesFinal": gwMatchesFinal,
        "gwOrphans": gwOrphans,
        "offsetTrend": offset_trend,
        "valveAnchors": valve_pairs if use_valve_anchor else [],
        "alignedFeatures": aligned_non_gw,
        "tieInTransformApplied": tie_in_transform_applied,
        "tieInExcludedOld": tie_in_excluded_old,
        "tieInExcludedNew": tie_in_excluded_new,
        "timeline": timeline,
        "dtwCorrectionApplied": apply_dtw_correction,
        "matchingMode": matching_mode,
        "valveSegmented": use_valve_anchor and len(valve_pairs) >= 2,
        "requestId": request_id,
        "stats": {
            "totalOldGws": len(old_gws),
            "totalNewGws": len(new_gws),
            "matchedGws": len(gwMatchesFinal),
            "valveAnchors": len(valve_pairs)
        }
    }


def _force_utf8_io():
    """Never let the locale codepage decide how requests are decoded.

    Node sets PYTHONIOENCODING, but this keeps the engine correct when it is
    run by hand.  ``errors='replace'`` matters as much as the encoding: a
    UnicodeDecodeError raised by the ``for line in sys.stdin`` iterator happens
    outside the per-request try block and would kill the persistent worker.
    """
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def main():
    _force_utf8_io()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            data = json.loads(line)
            result = process_request(data)
            print(json.dumps(result))
            sys.stdout.flush()
            
        except Exception as e:
            import traceback
            traceback.print_exc(file=sys.stderr)
            request_id = None
            if 'data' in locals() and isinstance(data, dict):
                request_id = data.get('requestId')
            print(json.dumps({"error": str(e), "success": False, "requestId": request_id}))
            sys.stdout.flush()

def _run_dtw_segment(seg_old, seg_new, ota_threshold, strict_penalty=False):
    """
    Run DTW on a subset of GWs (a valve-bounded segment).
    Wraps calculate_dtw with its own spool-length calculation.
    """
    # Ensure spool lengths are calculated for this segment
    for i in range(len(seg_old)):
        seg_old[i] = dict(seg_old[i])  # shallow copy to avoid mutating originals
        seg_old[i]['spool'] = seg_old[i]['dist'] - seg_old[i-1]['dist'] if i > 0 else seg_old[i]['dist']
    for j in range(len(seg_new)):
        seg_new[j] = dict(seg_new[j])
        seg_new[j]['spool'] = seg_new[j]['dist'] - seg_new[j-1]['dist'] if j > 0 else seg_new[j]['dist']

    return calculate_dtw(seg_old, seg_new, ota_threshold, strict_penalty)


def _post_process_matches(gw_matches, ota_threshold):
    """
    Calculate joint lengths (L_ref, L_new), deviation ratios, and flagged
    status for consecutive matched GWs. This is the same logic that was
    previously inline in calculate_dtw's main flow.
    """
    valid_matches = [m for m in gw_matches if m.get('status') == 'Match']

    for k in range(1, len(valid_matches)):
        prev = valid_matches[k - 1]
        curr = valid_matches[k]

        L_ref, L_new = _distance_intervals(prev, curr)

        curr['L_ref'] = L_ref
        curr['L_new'] = L_new

        if L_ref > 0:
            deviation_ratio = ota_deviation_ratio(L_ref, L_new)
            curr['deviation_ratio'] = deviation_ratio

            flag_threshold = ota_threshold / 100.0
            if deviation_ratio > flag_threshold:
                curr['flagged'] = True
                curr['scaling_factor'] = 1.0
            else:
                curr['flagged'] = False
                curr['scaling_factor'] = L_ref / L_new if L_new > 0 else 1.0
        else:
            curr['deviation_ratio'] = 0.0
            curr['flagged'] = False
            curr['scaling_factor'] = 1.0

    if len(valid_matches) > 0:
        valid_matches[0]['L_ref'] = 0
        valid_matches[0]['L_new'] = 0
        valid_matches[0]['deviation_ratio'] = 0.0
        valid_matches[0]['flagged'] = False
        valid_matches[0]['scaling_factor'] = 1.0


if __name__ == "__main__":
    main()
