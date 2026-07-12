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


def calculate_dtw(old_gws, new_gws, ota_threshold):
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
    
    for i in range(1, n + 1):
        old_dist = old_gws[i-1]['dist']
        L_old = old_gws[i-1]['spool']
        
        # Calculate Physical Window based on OTA.
        # v10.0: tighter window — removed the *2.0 multiplier that was too loose,
        # and raised the minimum floor from 15m to 10m to avoid over-constraining
        # at the pipeline start.
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
                
            L_new = new_gws[j-1]['spool']
            
            # Dynamic Gap Penalty (controlled by OTA slider).
            # v10.0: reduced OTA factor from /2.0 to /4.0 for tighter control
            # over skip operations — prevents excessive gap insertions.
            gap_penalty = 2.0 + (ota_threshold / 4.0)
            
            # Cost is pure physical difference in spool length
            cost = abs(L_old - L_new)
            abs_diff = abs(old_dist - new_dist)
            cost += abs_diff * 0.001
            
            # NO INFINITY CUTOFF! Just let the algorithm compare Match vs Skip
            match_cost = dtw_matrix[i-1][j-1] + cost
                
            # Insertion (skip new_gw) and Deletion (skip old_gw) costs
            insert_cost = dtw_matrix[i][j-1] + L_new + gap_penalty
            delete_cost = dtw_matrix[i-1][j] + L_old + gap_penalty
            
            min_prev = min(match_cost, insert_cost, delete_cost)
            dtw_matrix[i][j] = min_prev
            
            if min_prev == float('inf'):
                pass
            elif min_prev == match_cost:
                path_matrix[i][j] = (i-1, j-1)
            elif min_prev == insert_cost:
                path_matrix[i][j] = (i, j-1)
            else:
                path_matrix[i][j] = (i-1, j)

    # Backtrack to find the optimal path
    matches = []
    i, j = n, m
    
    # If the end is unreachable (matrix is inf), find the closest reachable cell
    if dtw_matrix[i][j] == float('inf'):
        best_val = float('inf')
        best_pos = (i, j)
        for r in range(n, -1, -1):
            if dtw_matrix[r][m] < best_val:
                best_val = dtw_matrix[r][m]
                best_pos = (r, m)
        for c in range(m, -1, -1):
            if dtw_matrix[n][c] < best_val:
                best_val = dtw_matrix[n][c]
                best_pos = (n, c)
        i, j = best_pos
        
        # The skipped elements at the end
        while n > i:
            matches.append({
                'oldIndex': n-1, 'newIndex': None,
                'oldId': old_gws[n-1]['id'], 'newId': None,
                'oldDist': old_gws[n-1]['dist'], 'newDist': None,
                'status': 'Skipped'
            })
            n -= 1
        while m > j:
            matches.append({
                'oldIndex': None, 'newIndex': m-1,
                'oldId': None, 'newId': new_gws[m-1]['id'],
                'oldDist': None, 'newDist': new_gws[m-1]['dist'],
                'status': 'Skipped'
            })
            m -= 1

    while i > 0 or j > 0:
        if i > 0 and j > 0:
            prev_i, prev_j = path_matrix[i][j]
            if prev_i == -1 and prev_j == -1:
                # Dead end (path broke). Fallback
                if i > j:
                    prev_i, prev_j = i - 1, j
                else:
                    prev_i, prev_j = i, j - 1
        elif i > 0:
            prev_i, prev_j = i - 1, j
        else:
            prev_i, prev_j = i, j - 1

        if prev_i == i - 1 and prev_j == j - 1:
            # Diagonal: Guaranteed Match (since constraints were enforced in forward pass)
            matches.append({
                'oldIndex': i-1, 'newIndex': j-1,
                'oldId': old_gws[i-1]['id'], 'newId': new_gws[j-1]['id'],
                'oldDist': old_gws[i-1]['dist'], 'newDist': new_gws[j-1]['dist'],
                'status': 'Match'
            })
        elif prev_i == i - 1:
            # Deletion (Old GW not found in New)
            matches.append({
                'oldIndex': i-1, 'newIndex': None,
                'oldId': old_gws[i-1]['id'], 'newId': None,
                'oldDist': old_gws[i-1]['dist'], 'newDist': None,
                'status': 'Skipped'
            })
        else:
            # Insertion (New GW not found in Old)
            matches.append({
                'oldIndex': None, 'newIndex': j-1,
                'oldId': None, 'newId': new_gws[j-1]['id'],
                'oldDist': None, 'newDist': new_gws[j-1]['dist'],
                'status': 'Skipped'
            })
            
        i, j = prev_i, prev_j
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

def main():
    # Read JSON payload from stdin
    input_data = sys.stdin.read()
    if not input_data:
        print(json.dumps({"error": "No input provided"}))
        return

    try:
        data = json.loads(input_data)
        ota_threshold = data.get('ota', 1.5)
        old_run = data.get('oldRun', [])
        new_run = data.get('newRun', [])
        use_valve_anchor = data.get('useValveAnchor', False)

        # Filter GWs
        old_gws = [f for f in old_run if f['type'] == 'weld']
        new_gws = [f for f in new_run if f['type'] == 'weld']

        if not old_gws or not new_gws:
            print(json.dumps({"error": "No GWs found in one or both runs"}))
            return

        # ============================================================
        # 0. Valve/Tee anchor matching (v10.0 ADTH-DTW hierarchy).
        # If enabled, match valves first to create "mega-segments"
        # that constrain girth-weld DTW to within valve boundaries.
        # Literature: valve -> weld -> defect hierarchy (ADTH-DTW 2026).
        # ============================================================
        valve_pairs = match_valves(old_run, new_run) if use_valve_anchor else []

        if len(valve_pairs) >= 2 and use_valve_anchor:
            # Valve-segmented DTW: run DTW per valve segment independently.
            # This prevents odometer drift between distant valve sections
            # from corrupting weld matching across the whole pipeline.
            sys.stderr.write(
                f"[DTW] Valve-segmented mode: {len(valve_pairs)} anchors, "
                f"running DTW per segment...\n"
            )

            all_gw_matches = []
            # Pre-calculate spool lengths for ALL GWs (needed for DTW cost).
            for i in range(len(old_gws)):
                old_gws[i]['spool'] = old_gws[i]['dist'] - old_gws[i-1]['dist'] if i > 0 else old_gws[i]['dist']
            for j in range(len(new_gws)):
                new_gws[j]['spool'] = new_gws[j]['dist'] - new_gws[j-1]['dist'] if j > 0 else new_gws[j]['dist']

            for k in range(len(valve_pairs) - 1):
                old_lo = valve_pairs[k]['old_dist']
                old_hi = valve_pairs[k + 1]['old_dist']
                new_lo = valve_pairs[k]['new_dist']
                new_hi = valve_pairs[k + 1]['new_dist']

                # GWs within this valve segment.
                seg_old = [w for w in old_gws if old_lo <= w['dist'] < old_hi]
                seg_new = [w for w in new_gws if new_lo <= w['dist'] < new_hi]

                if not seg_old or not seg_new:
                    continue  # Empty segment (possible if only one run has welds here)

                seg_matches = _run_dtw_segment(seg_old, seg_new, ota_threshold)

                # Remap local indices back to global weld arrays.
                # We need to map segment-local weld positions back so that
                # the downstream GW match format is consistent.
                global_old_dists = {round(w['dist'], 6): w for w in old_gws}
                global_new_dists = {round(w['dist'], 6): w for w in new_gws}

                for m in seg_matches:
                    # Find the corresponding global weld features
                    od = m.get('oldDist')
                    nd = m.get('newDist')
                    gw_old = global_old_dists.get(round(float(od), 6) if od is not None else -1)
                    gw_new = global_new_dists.get(round(float(nd), 6) if nd is not None else -1)
                    m['oldId'] = gw_old.get('id') if gw_old else None
                    m['newId'] = gw_new.get('id') if gw_new else None

                all_gw_matches.extend(seg_matches)

            # Handle "outside valves" segments: before first valve & after last valve.
            # Use global DTW for these edge regions.
            first_old = valve_pairs[0]['old_dist']
            first_new = valve_pairs[0]['new_dist']
            last_old = valve_pairs[-1]['old_dist']
            last_new = valve_pairs[-1]['new_dist']

            # Before first valve
            pre_old = [w for w in old_gws if w['dist'] < first_old]
            pre_new = [w for w in new_gws if w['dist'] < first_new]
            if pre_old and pre_new:
                pre_matches = _run_dtw_segment(pre_old, pre_new, ota_threshold)
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

            # After last valve
            post_old = [w for w in old_gws if w['dist'] >= last_old]
            post_new = [w for w in new_gws if w['dist'] >= last_new]
            if post_old and post_new:
                post_matches = _run_dtw_segment(post_old, post_new, ota_threshold)
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

            gw_matches = all_gw_matches
            sys.stderr.write(
                f"[DTW] Valve-segmented complete: {len(gw_matches)} total GW matches "
                f"across {len(valve_pairs)-1} valve segments\n"
            )

        else:
            # Fallback: standard global DTW (backward compatible).
            if use_valve_anchor and len(valve_pairs) < 2:
                sys.stderr.write(
                    f"[DTW] Valve anchor requested but only {len(valve_pairs)} valve "
                    f"pairs found — falling back to global DTW\n"
                )
            gw_matches = calculate_dtw(old_gws, new_gws, ota_threshold)

        # Post-process: calculate joint lengths and flag deviations (existing logic)
        _post_process_matches(gw_matches, ota_threshold)

        # Linear Referencing for other features
        aligned_non_gw = linear_referencing(old_run, new_run, gw_matches)

        result = {
            "success": True,
            "gwMatches": gw_matches,
            "valveAnchors": valve_pairs if use_valve_anchor else [],
            "alignedFeatures": aligned_non_gw,
            "valveSegmented": use_valve_anchor and len(valve_pairs) >= 2,
            "stats": {
                "totalOldGws": len(old_gws),
                "totalNewGws": len(new_gws),
                "matchedGws": len([m for m in gw_matches if m.get('status') == 'Match']),
                "valveAnchors": len(valve_pairs)
            }
        }

        print(json.dumps(result))

    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"error": str(e)}))


def _run_dtw_segment(seg_old, seg_new, ota_threshold):
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

    return calculate_dtw(seg_old, seg_new, ota_threshold)


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
