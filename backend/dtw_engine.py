import sys
import json
import math

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
        
        # Calculate Physical Window based on OTA (e.g. 5% + 15m buffer)
        allowed_global_drift = max(old_dist, 50.0) * (ota_threshold / 100.0) * 2.0
        allowed_global_drift = max(allowed_global_drift, 15.0)
        
        # Optimize loop since distances are monotonically increasing
        for j in range(1, m + 1):
            new_dist = new_gws[j-1]['dist']
            
            # Physical window constraint
            if new_dist < old_dist - allowed_global_drift:
                continue # j is too far behind
            if new_dist > old_dist + allowed_global_drift:
                break # j is too far ahead, stop inner loop!
                
            L_new = new_gws[j-1]['spool']
            
            # Dynamic Gap Penalty (controlled by OTA slider)
            # Higher OTA means larger penalty for skipping, forcing algorithms to match even with high stretch
            # Base penalty is 2.0 meters. OTA adds up to e.g. 5.0 meters to it.
            gap_penalty = 2.0 + (ota_threshold / 2.0)
            
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
    
    # POST-PROCESSING: Calculate Joint Lengths and 5% Odometer Accuracy Threshold
    # We only calculate joint lengths between consecutive MATCHED GWs
    valid_matches = [m for m in matches if m['status'] == 'Match']
    
    # Attach joint stats to the matches array directly
    for k in range(1, len(valid_matches)):
        prev_match = valid_matches[k-1]
        curr_match = valid_matches[k]
        
        L_ref = curr_match['oldDist'] - prev_match['oldDist']
        L_new = curr_match['newDist'] - prev_match['newDist']
        
        curr_match['L_ref'] = L_ref
        curr_match['L_new'] = L_new
        
        if L_ref > 0:
            deviation_ratio = abs(L_new - L_ref) / L_ref
            curr_match['deviation_ratio'] = deviation_ratio
            
            # Flag matches with high deviation (scale dynamically with OTA, base 5%)
            flag_threshold = 0.05 + (ota_threshold / 100.0)
            if deviation_ratio > flag_threshold:
                curr_match['flagged'] = True
                curr_match['scaling_factor'] = 1.0 # Cannot scale safely
                # We KEEP status as 'Match', just flagged=True.
                # The frontend will render it as a yellow node with a yellow dashed line.
            else:
                curr_match['flagged'] = False
                curr_match['scaling_factor'] = L_ref / L_new if L_new > 0 else 1.0
        else:
            curr_match['deviation_ratio'] = 0.0
            curr_match['flagged'] = False
            curr_match['scaling_factor'] = 1.0
            
    # Keep the first match neutral
    if len(valid_matches) > 0:
        valid_matches[0]['L_ref'] = 0
        valid_matches[0]['L_new'] = 0
        valid_matches[0]['deviation_ratio'] = 0.0
        valid_matches[0]['flagged'] = False
        valid_matches[0]['scaling_factor'] = 1.0

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
        
        # Filter GWs
        old_gws = [f for f in old_run if f['type'] == 'weld']
        new_gws = [f for f in new_run if f['type'] == 'weld']
        
        if not old_gws or not new_gws:
            print(json.dumps({"error": "No GWs found in one or both runs"}))
            return
            
        # 1. Run DTW to match GWs
        gw_matches = calculate_dtw(old_gws, new_gws, ota_threshold)
        
        # 2. Linear Referencing for other features
        aligned_non_gw = linear_referencing(old_run, new_run, gw_matches)
        
        result = {
            "success": True,
            "gwMatches": gw_matches,
            "alignedFeatures": aligned_non_gw,
            "stats": {
                "totalOldGws": len(old_gws),
                "totalNewGws": len(new_gws),
                "matchedGws": len(gw_matches)
            }
        }
        
        print(json.dumps(result))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()
