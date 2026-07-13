import sys
import json
import numpy as np

def calculate_tiein_offset(old_features, new_features, window_size=50):
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
        return {"success": False, "error": "New run is too short to find a reliable pattern."}

    signature = np.array(new_spools[:actual_window_size])
    target = np.array(old_spools)

    if len(target) < len(signature):
         return {"success": False, "error": "Old run is shorter than New run signature."}

    best_sad = float("inf")
    best_idx = 0

    for i in range(len(target) - len(signature) + 1):
        window = target[i : i + len(signature)]
        sad = np.sum(np.abs(window - signature))
        if sad < best_sad:
            best_sad = sad
            best_idx = i

    estimated_offset = old_gws[best_idx]["dist"] - new_gws[0]["dist"]
    
    avg_sad = best_sad / actual_window_size
    confidence = 100.0
    if avg_sad > 0.05:
        confidence -= (avg_sad - 0.05) * 200
    confidence = max(0, min(100, confidence))

    return {
        "success": True,
        "offset": estimated_offset,
        "best_idx": best_idx,
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
