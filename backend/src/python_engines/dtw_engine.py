import sys
import json
import math
import numpy as np
from scipy.optimize import linear_sum_assignment

# Feature types that serve as absolute anchors (Tier-1 in ILI alignment).
# Valves and Tees are sparse, physical fixtures whose odometer positions are
# highly stable between ILI runs, making them ideal alignment anchors.
ANCHOR_TYPES = {'valve', 'tee'}
# Generous tolerance for anchor matching — these are absolute reference points
# whose odometer drift is bounded by physical placement (ported from
# engine/constants.py LANDMARK_MATCH_TOL).
ANCHOR_TOLERANCE_M = 200.0


def match_valves(old_features, new_features, tolerance=ANCHOR_TOLERANCE_M):
    """
    Match valve/tee anchors between OLD and NEW runs via the Hungarian algorithm.

    Valves and tees are the most physically stable features — they don't move
    between inspections. Matching them FIRST establishes "mega-segments" that
    constrain downstream girth-weld matching, preventing global drift errors.

    Literature basis: ADTH-DTW (MDPI 2026) and Dann & Maes (2017) both
    establish the hierarchy valve -> weld -> defect.

    Returns a list of {old_dist, new_dist, old_id, new_id} anchor pairs,
    sorted by old_dist. Empty if no anchors found in either run.
    """
    old_anchors = sorted(
        [f for f in old_features if str(f.get('type', '')).lower() in ANCHOR_TYPES],
        key=lambda f: float(f.get('dist', 0))
    )
    new_anchors = sorted(
        [f for f in new_features if str(f.get('type', '')).lower() in ANCHOR_TYPES],
        key=lambda f: float(f.get('dist', 0))
    )

    if not old_anchors or not new_anchors:
        return []

    na = len(old_anchors)
    nb = len(new_anchors)
    INF = float('inf')
    # Build a rectangular cost matrix — scipy can handle non-square.
    cost_mat = np.full((na, nb), INF)

    for i, oa in enumerate(old_anchors):
        d_old = float(oa.get('dist', 0))
        for j, na_f in enumerate(new_anchors):
            d_new = float(na_f.get('dist', 0))
            diff = abs(d_old - d_new)
            if diff > tolerance:
                continue
            cost_mat[i, j] = diff

    # Ensure at least one valid entry per row/column by replacing all-INF
    # rows/columns with a large-but-finite penalty, so the solver doesn't
    # fail on infeasible matrices (happens when anchors are very asymmetric).
    for i in range(na):
        if np.all(np.isinf(cost_mat[i, :])):
            # This OLD anchor has no valid NEW candidate — assign max penalty
            cost_mat[i, :] = tolerance * 2
    for j in range(nb):
        if np.all(np.isinf(cost_mat[:, j])):
            cost_mat[:, j] = tolerance * 2

    row_ind, col_ind = linear_sum_assignment(cost_mat)
    pairs = []
    for i, j in zip(row_ind, col_ind):
        if cost_mat[i, j] >= tolerance:
            continue  # Skip penalty-only assignments (no real match)
        pairs.append({
            'old_dist': float(old_anchors[i].get('dist', 0)),
            'new_dist': float(new_anchors[j].get('dist', 0)),
            'old_id': old_anchors[i].get('id'),
            'new_id': new_anchors[j].get('id'),
        })

    pairs.sort(key=lambda p: p['old_dist'])
    return pairs


def calculate_dtw(old_gws, new_gws, ota_threshold, strict_penalty=False):
    """
    Dynamic Time Warping (DTW) explicitly for Girth Welds.
    Matches old_gws with new_gws using distance constraints.
    ota_threshold is a percentage (e.g. 1.5 for 1.5%).
    """
    n = len(old_gws)
    m = len(new_gws)
    
    if n == 0 or m == 0:
        return []

    # Precalculate spool lengths (distance from previous GW)
    for i in range(n):
        old_gws[i]['spool'] = old_gws[i]['dist'] - old_gws[i-1]['dist'] if i > 0 else old_gws[i]['dist']
    for j in range(m):
        new_gws[j]['spool'] = new_gws[j]['dist'] - new_gws[j-1]['dist'] if j > 0 else new_gws[j]['dist']

    # We no longer need base_window based on index.
    
    # Initialize DTW matrix with infinity
    dtw_matrix = [[float('inf')] * (m + 1) for _ in range(n + 1)]
    dtw_matrix[0][0] = 0
    
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
    
    gap_penalty = 2.0 + (ota_threshold / 4.0)
    K = 10 # Lookback up to 9 skips
    
    for i in range(1, n + 1):
        old_dist = old_gws[i-1]['dist']
        
        # Calculate Physical Window based on OTA.
        allowed_global_drift = max(old_dist, 50.0) * (ota_threshold / 100.0)
        allowed_global_drift = max(allowed_global_drift, 10.0)
        
        # Optimize loop since distances are monotonically increasing
        for j in range(1, m + 1):
            new_dist = new_gws[j-1]['dist']
            
            # Physical window constraint
            if new_dist < old_dist - allowed_global_drift:
                continue # j is too far behind
            if new_dist > old_dist + allowed_global_drift:
                break # j is too far ahead, stop inner loop!
            
            best_cost = float('inf')
            best_prev = (-1, -1)
            
            # Allow skipping INITIAL nodes: if i <= K and j <= K, we can jump from (0,0) to (i,j)
            if i <= K and j <= K:
                prev_i, prev_j = 0, 0
                abs_dist_diff = abs(old_dist - new_dist)
                
                cost = 0
                if strict_penalty:
                    cost += abs_dist_diff * 1.0
                else:
                    cost += abs_dist_diff * 0.001
                    
                total_cost = dtw_matrix[prev_i][prev_j] + cost + (i - 1) * gap_penalty + (j - 1) * gap_penalty
                if total_cost < best_cost:
                    best_cost = total_cost
                    best_prev = (prev_i, prev_j)
            
            # Dynamic Spool Length Lookback
            for k in range(1, min(i, K) + 1):
                for l in range(1, min(j, K) + 1):
                    prev_i, prev_j = i - k, j - l
                    if prev_i == 0 and prev_j == 0:
                        continue # Already handled above
                    
                    if dtw_matrix[prev_i][prev_j] == float('inf'):
                        continue
                        
                    L_old = old_dist - old_gws[prev_i-1]['dist']
                    L_new = new_dist - new_gws[prev_j-1]['dist']
                    
                    denom = max(L_old, L_new)
                    deviation_pct = (abs(L_old - L_new) / denom) * 100.0 if denom > 0 else 0
                    actual_diff = abs(L_old - L_new)
                    abs_dist_diff = abs(old_dist - new_dist)
                    
                    if deviation_pct <= ota_threshold:
                        cost = actual_diff
                    else:
                        excess_diff = actual_diff - (denom * (ota_threshold / 100.0))
                        cost = actual_diff + excess_diff * 100.0
                        
                    if strict_penalty:
                        cost += abs_dist_diff * 1.0
                        if denom > 0 and deviation_pct > 50.0:
                            cost = float('inf')
                    else:
                        cost += abs_dist_diff * 0.001
                        
                    if cost != float('inf'):
                        total_cost = dtw_matrix[prev_i][prev_j] + cost + (k - 1) * gap_penalty + (l - 1) * gap_penalty
                        if total_cost < best_cost:
                            best_cost = total_cost
                            best_prev = (prev_i, prev_j)
                            
            dtw_matrix[i][j] = best_cost
            path_matrix[i][j] = best_prev

    # Backtrack to find the optimal path
    matches = []
    
    # Find best end node
    best_end_cost = float('inf')
    best_end = (n, m)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if dtw_matrix[i][j] != float('inf'):
                # Add cost of skipping remaining nodes
                final_cost = dtw_matrix[i][j] + (n - i) * gap_penalty + (m - j) * gap_penalty
                if final_cost < best_end_cost:
                    best_end_cost = final_cost
                    best_end = (i, j)
                    
    i, j = best_end
    
    # If the end is unreachable entirely (e.g. strict penalty cut everything), fallback
    if best_end_cost == float('inf'):
        i, j = n, m
    
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
        
        # If dead end, force diagonal fallback
        if prev_i == -1 and prev_j == -1:
            prev_i, prev_j = i - 1, j - 1
            
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
        segment_features = [f for f in old_features if old_start <= f['dist'] < old_end and f['type'] != 'weld']
        
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

def process_request(data):
    ota_threshold = data.get('ota', 1.5)
    strict_penalty = data.get('strictPenalty', False)
    old_run = data.get('oldRun', [])
    new_run = data.get('newRun', [])
    use_valve_anchor = data.get('useValveAnchor', False)
    request_id = data.get('requestId')
    tie_in_offset = data.get('tieInOffset', 0.0)

    # 1. Apply tieInOffset globally to ALL NEW features
    if tie_in_offset != 0.0:
        for f in new_run:
            f['dist'] = f['dist'] + tie_in_offset

    # 2. Extract GW candidates (strict Tier-1/Tier-2 anchors only)
    gw_types = {'weld', 'girth weld', 'valve', 'tee', 'flange'}
    
    old_gws = [f for f in old_run if str(f.get('originalType', f.get('type'))).lower() in gw_types]
    new_gws = [f for f in new_run if str(f.get('originalType', f.get('type'))).lower() in gw_types]

    if not old_gws or not new_gws:
        return {"error": "No GWs/Anchors found in one or both runs", "requestId": request_id}

    valve_pairs = match_valves(old_gws, new_gws) if use_valve_anchor else []

    all_gw_matches = []
    
    if use_valve_anchor and len(valve_pairs) >= 2:
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

            global_old_dists = {round(w['dist'], 6): w for w in old_gws}
            global_new_dists = {round(w['dist'], 6): w for w in new_gws}

            for m in seg_matches:
                od = m.get('oldDist')
                nd = m.get('newDist')
                gw_old = global_old_dists.get(round(float(od), 6) if od is not None else -1)
                gw_new = global_new_dists.get(round(float(nd), 6) if nd is not None else -1)
                m['oldId'] = gw_old.get('id') if gw_old else None
                m['newId'] = gw_new.get('id') if gw_new else None

            all_gw_matches.extend(seg_matches)

        first_old = valve_pairs[0]['old_dist']
        first_new = valve_pairs[0]['new_dist']
        last_old = valve_pairs[-1]['old_dist']
        last_new = valve_pairs[-1]['new_dist']

        pre_old = [w for w in old_gws if w['dist'] < first_old]
        pre_new = [w for w in new_gws if w['dist'] < first_new]
        if pre_old and pre_new:
            pre_matches = _run_dtw_segment(pre_old, pre_new, ota_threshold, strict_penalty)
            global_old_dists = {round(w['dist'], 6): w for w in old_gws}
            global_new_dists = {round(w['dist'], 6): w for w in new_gws}
            for m in pre_matches:
                od = m.get('oldDist')
                nd = m.get('newDist')
                gw_old = global_old_dists.get(round(float(od), 6) if od is not None else -1)
                gw_new = global_new_dists.get(round(float(nd), 6) if nd is not None else -1)
                m['oldId'] = gw_old.get('id') if gw_old else None
                m['newId'] = gw_new.get('id') if gw_new else None
            all_gw_matches.extend(pre_matches)

        post_old = [w for w in old_gws if w['dist'] >= last_old]
        post_new = [w for w in new_gws if w['dist'] >= last_new]
        if post_old and post_new:
            post_matches = _run_dtw_segment(post_old, post_new, ota_threshold, strict_penalty)
            global_old_dists = {round(w['dist'], 6): w for w in old_gws}
            global_new_dists = {round(w['dist'], 6): w for w in new_gws}
            for m in post_matches:
                od = m.get('oldDist')
                nd = m.get('newDist')
                gw_old = global_old_dists.get(round(float(od), 6) if od is not None else -1)
                gw_new = global_new_dists.get(round(float(nd), 6) if nd is not None else -1)
                m['oldId'] = gw_old.get('id') if gw_old else None
                m['newId'] = gw_new.get('id') if gw_new else None
            all_gw_matches.extend(post_matches)

        all_gw_matches.sort(key=lambda m: (m.get('oldDist') or 999999))
        gw_matches = all_gw_matches

    else:
        gw_matches = calculate_dtw(old_gws, new_gws, ota_threshold, strict_penalty)

    _post_process_matches(gw_matches, ota_threshold)
    aligned_non_gw = linear_referencing(old_run, new_run, gw_matches)

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
        "valveAnchors": valve_pairs if use_valve_anchor else [],
        "alignedFeatures": aligned_non_gw,
        "valveSegmented": use_valve_anchor and len(valve_pairs) >= 2,
        "requestId": request_id,
        "stats": {
            "totalOldGws": len(old_gws),
            "totalNewGws": len(new_gws),
            "matchedGws": len(gwMatchesFinal),
            "valveAnchors": len(valve_pairs)
        }
    }


def main():
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

        L_ref = curr.get('oldDist', 0) - prev.get('oldDist', 0)
        L_new = curr.get('newDist', 0) - prev.get('newDist', 0)

        curr['L_ref'] = L_ref
        curr['L_new'] = L_new

        if L_ref > 0:
            deviation_ratio = abs(L_new - L_ref) / L_ref
            curr['deviation_ratio'] = deviation_ratio

            flag_threshold = 0.05 + (ota_threshold / 100.0)
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
