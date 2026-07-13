import sys
import json
import numpy as np

def calculate_tiein_offset(old_features, new_features, window_size=20):
    old_gws = [f for f in old_features if str(f.get("type", "")).lower() == "weld"]
    new_gws = [f for f in new_features if str(f.get("type", "")).lower() == "weld"]

    if len(old_gws) < 2 or len(new_gws) < 2:
        return {"success": False, "error": "Not enough girth welds to perform tie-in offset calculation."}

    n = len(old_gws)
    m = len(new_gws)

    old_spools = [old_gws[i]["dist"] - old_gws[i-1]["dist"] for i in range(1, n)]
    new_spools = [new_gws[i]["dist"] - new_gws[i-1]["dist"] for i in range(1, m)]

    actual_window_size = min(window_size, len(new_spools))
    if actual_window_size < 5:
        return {"success": False, "error": "New run is too short to find a reliable pattern (need at least 5 joints)."}

    target = np.array(old_spools)

    global_best_sad = float('inf')
    global_best_target_idx = 0
    global_best_sig_idx = 0

    # Step size for picking different signatures from the new run
    step = max(1, actual_window_size // 4)
    
    for sig_start in range(0, len(new_spools) - actual_window_size + 1, step):
        signature = np.array(new_spools[sig_start : sig_start + actual_window_size])
        
        if len(target) < len(signature):
             continue

        # 4. Sliding Window Sum of Absolute Differences (SAD) for this signature
        for i in range(len(target) - len(signature) + 1):
            window = target[i : i + len(signature)]
            sad = np.sum(np.abs(window - signature))
            if sad < global_best_sad:
                global_best_sad = sad
                global_best_target_idx = i
                global_best_sig_idx = sig_start

    if global_best_sad == float('inf'):
        return {"success": False, "error": "Could not find any matching pattern."}

    # 5. Calculate Offset
    # The signature started at `global_best_sig_idx` in new_spools, which corresponds to `new_gws[global_best_sig_idx]`
    # The matching window started at `global_best_target_idx` in old_spools, which corresponds to `old_gws[global_best_target_idx]`
    estimated_offset = old_gws[global_best_target_idx]['dist'] - new_gws[global_best_sig_idx]['dist']
    
    # 6. Calculate Metrics
    avg_sad = global_best_sad / actual_window_size

    # Simple confidence metric based on average error per joint
    # If error is < 10cm -> 100%
    # If error is > 10cm -> decays
    confidence = 100.0
    if avg_sad > 0.10:
        confidence -= (avg_sad - 0.10) * 150
    confidence = max(0, min(100, confidence))

    return {
        "success": True,
        "offset": estimated_offset,
        "best_target_idx": global_best_target_idx,
        "best_sig_idx": global_best_sig_idx,
        "avg_sad": float(avg_sad),
        "confidence": float(confidence),
        "message": f"Match found with avg error {avg_sad*100:.1f}cm per joint. Confidence: {confidence:.1f}%"
    }

if __name__ == "__main__":
    input_data = sys.stdin.read()
    if not input_data.strip():
        print(json.dumps({"success": False, "error": "No input data provided."}))
        sys.exit(1)

    try:
        payload = json.loads(input_data)
        result = calculate_tiein_offset(payload.get("oldRun", []), payload.get("newRun", []))
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
