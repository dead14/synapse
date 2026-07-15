import sys
import json
import numpy as np

try:
    from sklearn.linear_model import RANSACRegressor
except ImportError:
    # Fallback if sklearn is not available for some reason, though it should be
    RANSACRegressor = None

class Anchor:
    def __init__(self, idx, dist, ftype):
        self.idx = idx
        self.dist = dist
        self.type = ftype
        self.spacing_to_prev = 0.0

def extract_anchors(features):
    allowed_types = {"valve", "tee", "offtake", "bend", "launcher", "receiver"}
    anchors = []
    for i, f in enumerate(features):
        t = str(f.get("type", "")).lower()
        if t in allowed_types:
            anchors.append(Anchor(i, float(f.get("dist", 0.0)), t))
    for i in range(1, len(anchors)):
        anchors[i].spacing_to_prev = anchors[i].dist - anchors[i-1].dist
    return anchors

def align_anchors(anchors_a, anchors_b, gap_penalty=-5.0):
    n, m = len(anchors_a), len(anchors_b)
    if n == 0 or m == 0:
        return []
        
    score = [[0]*(m+1) for _ in range(n+1)]
    for i in range(1, n+1):
        score[i][0] = i * gap_penalty
    for j in range(1, m+1):
        score[0][j] = j * gap_penalty

    def sim(a, b):
        if a.type != b.type:
            return -1e9
        return -abs(a.spacing_to_prev - b.spacing_to_prev)

    for i in range(1, n+1):
        for j in range(1, m+1):
            match = score[i-1][j-1] + sim(anchors_a[i-1], anchors_b[j-1])
            delete = score[i-1][j] + gap_penalty
            insert = score[i][j-1] + gap_penalty
            score[i][j] = max(match, delete, insert)

    # Traceback
    i, j = n, m
    pairs = []
    while i > 0 and j > 0:
        s = score[i][j]
        if s == score[i-1][j-1] + sim(anchors_a[i-1], anchors_b[j-1]):
            if anchors_a[i-1].type == anchors_b[j-1].type:
                pairs.append((anchors_a[i-1], anchors_b[j-1]))
            i -= 1
            j -= 1
        elif s == score[i-1][j] + gap_penalty:
            i -= 1
        else:
            j -= 1
    return pairs[::-1]

def calculate_tiein_offset(old_features, new_features):
    """
    Find tie-in offset using Anchor-based Sequence Alignment (Needleman-Wunsch) and RANSAC Regression.
    Does NOT modify the data or use DTW, just returns the median or RANSAC intercept offset.
    """
    old_anchors = extract_anchors(old_features)
    new_anchors = extract_anchors(new_features)

    if len(old_anchors) == 0 or len(new_anchors) == 0:
        return {"success": False, "error": "Not enough anchor features (Valve/Tee/Bend) found to perform sequence alignment."}

    matched = align_anchors(old_anchors, new_anchors)
    
    if len(matched) < 2:
        return {"success": False, "error": "Could not find enough matching anchors to calculate a reliable offset."}

    X = np.array([b.dist for a, b in matched]).reshape(-1, 1) # new
    y = np.array([a.dist for a, b in matched])                # old

    estimated_offset = 0.0
    confidence = 0.0
    message = ""

    if RANSACRegressor is not None and len(matched) >= 3:
        try:
            model = RANSACRegressor(residual_threshold=2.0)
            model.fit(X, y)
            scale = model.estimator_.coef_[0]
            offset = model.estimator_.intercept_
            inliers = model.inlier_mask_
            
            estimated_offset = float(offset)
            inlier_count = np.sum(inliers)
            confidence = min(100.0, (inlier_count / len(matched)) * 100.0)
            if confidence < 30:
                confidence = 30.0 # Floor it so UI doesn't say "Estimated" if we found something
                
            message = f"Sequence Alignment found {len(matched)} pairs. RANSAC kept {inlier_count} inliers. Base Offset: {offset:.2f}m."
            
        except Exception as e:
            # Fallback to simple median if RANSAC fails
            offsets = [a.dist - b.dist for a, b in matched]
            estimated_offset = float(np.median(offsets))
            confidence = 50.0
            message = "Fallback to median offset due to RANSAC failure."
    else:
        # Fallback to simple median
        offsets = [a.dist - b.dist for a, b in matched]
        estimated_offset = float(np.median(offsets))
        confidence = 50.0
        message = f"Sequence Alignment found {len(matched)} pairs. Used median offset."

    return {
        "success": True,
        "offset": estimated_offset,
        "confidence": float(confidence),
        "message": message
    }

def main():
    """Persistent worker loop — reads one JSON request per line from stdin."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
            request_id = payload.get('requestId')
            result = calculate_tiein_offset(payload.get("oldRun", []), payload.get("newRun", []))
            result['requestId'] = request_id
            print(json.dumps(result))
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"success": False, "error": str(e), "requestId": payload.get('requestId') if 'payload' in dir() else None}))
            sys.stdout.flush()

if __name__ == "__main__":
    main()
