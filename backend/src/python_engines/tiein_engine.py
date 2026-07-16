import sys
import json
import numpy as np

try:
    from sklearn.linear_model import RANSACRegressor
except ImportError:
    # Fallback if sklearn is not available for some reason, though it should be
    RANSACRegressor = None

class Anchor:
    def __init__(self, idx, dist, ftype, feature_id=None):
        self.idx = idx
        self.dist = dist
        self.type = ftype
        self.feature_id = feature_id
        self.spacing_to_prev = None

def _normalize_anchor_type(value):
    feature_type = str(value or "").strip().lower()
    if "weld" in feature_type or "girth" in feature_type or "seam" in feature_type:
        return "weld"
    return feature_type


def _is_excluded(distance, run_label, excluded_ranges):
    for excluded in excluded_ranges or []:
        if str(excluded.get("run", "")).upper() != run_label:
            continue
        start = float(excluded.get("startM", float("-inf")))
        end = float(excluded.get("endM", float("inf")))
        if min(start, end) <= distance <= max(start, end):
            return True
    return False


def extract_anchors(features, run_label="OLD", excluded_ranges=None):
    allowed_types = {
        "weld", "valve", "tee", "offtake", "bend", "launcher", "receiver"
    }
    anchors = []
    for i, f in enumerate(features):
        t = _normalize_anchor_type(
            f.get("type", f.get("feature_type", f.get("originalType", "")))
        )
        try:
            distance = float(f.get("dist", 0.0))
        except (TypeError, ValueError):
            continue
        if t in allowed_types and not _is_excluded(
            distance, run_label, excluded_ranges
        ):
            anchors.append(Anchor(i, distance, t, f.get("id")))
    anchors.sort(key=lambda anchor: anchor.dist)
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
        if a.spacing_to_prev is None or b.spacing_to_prev is None:
            return 10.0
        return 10.0 - abs(a.spacing_to_prev - b.spacing_to_prev)

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

def calculate_tiein_offset(old_features, new_features, excluded_ranges=None):
    """
    Find tie-in offset using Anchor-based Sequence Alignment (Needleman-Wunsch) and RANSAC Regression.
    Does NOT modify the data or use DTW, just returns the median or RANSAC intercept offset.
    """
    old_before = extract_anchors(old_features, "OLD", [])
    new_before = extract_anchors(new_features, "NEW", [])
    old_anchors = extract_anchors(old_features, "OLD", excluded_ranges)
    new_anchors = extract_anchors(new_features, "NEW", excluded_ranges)
    excluded_anchor_count = (
        len(old_before) + len(new_before) - len(old_anchors) - len(new_anchors)
    )

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
            model = RANSACRegressor(residual_threshold=2.0, random_state=42)
            model.fit(X, y)
            scale = model.estimator_.coef_[0]
            offset = model.estimator_.intercept_
            inliers = model.inlier_mask_
            
            estimated_offset = float(offset)
            inlier_count = np.sum(inliers)
            residuals = y - model.predict(X)
            residual_rmse = float(np.sqrt(np.mean(np.square(residuals[inliers]))))
            inlier_ratio = inlier_count / len(matched)
            coverage = min(1.0, len(matched) / 3.0)
            residual_score = float(np.exp(-residual_rmse / 2.0))
            scale_score = float(np.exp(-abs(float(scale) - 1.0) * 20.0))
            confidence = min(
                100.0,
                100.0 * inlier_ratio * coverage * residual_score * scale_score,
            )
            message = (
                f"Sequence alignment found {len(matched)} pairs; "
                f"RANSAC kept {inlier_count} inliers with {residual_rmse:.3f} m RMSE."
            )
            
        except Exception as e:
            # Fallback to simple median if RANSAC fails
            offsets = [a.dist - b.dist for a, b in matched]
            estimated_offset = float(np.median(offsets))
            confidence = 50.0
            scale = 1.0
            inliers = np.ones(len(matched), dtype=bool)
            residuals = y - (X.flatten() + estimated_offset)
            residual_rmse = float(np.sqrt(np.mean(np.square(residuals))))
            message = "Fallback to median offset due to RANSAC failure."
    else:
        # Fallback to simple median
        offsets = [a.dist - b.dist for a, b in matched]
        estimated_offset = float(np.median(offsets))
        confidence = 50.0
        scale = 1.0
        inliers = np.ones(len(matched), dtype=bool)
        residuals = y - (X.flatten() + estimated_offset)
        residual_rmse = float(np.sqrt(np.mean(np.square(residuals))))
        message = f"Sequence Alignment found {len(matched)} pairs. Used median offset."

    inlier_pairs = [pair for pair, is_inlier in zip(matched, inliers) if is_inlier]
    if not inlier_pairs:
        inlier_pairs = matched
    pair_details = [
        {
            "oldId": old_anchor.feature_id,
            "newId": new_anchor.feature_id,
            "oldDistanceM": old_anchor.dist,
            "newDistanceM": new_anchor.dist,
            "residualM": float(
                old_anchor.dist - (float(scale) * new_anchor.dist + estimated_offset)
            ),
        }
        for old_anchor, new_anchor in inlier_pairs
    ]

    return {
        "success": True,
        "offset": estimated_offset,
        "scale": float(scale),
        "confidence": float(confidence),
        "message": message,
        "matchedPairCount": len(matched),
        "inlierPairCount": len(inlier_pairs),
        "residualRmseM": residual_rmse,
        "excludedAnchorCount": excluded_anchor_count,
        "overlap": {
            "oldStartM": min(pair[0].dist for pair in inlier_pairs),
            "oldEndM": max(pair[0].dist for pair in inlier_pairs),
            "newStartM": min(pair[1].dist for pair in inlier_pairs),
            "newEndM": max(pair[1].dist for pair in inlier_pairs),
        },
        "pairs": pair_details,
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
            result = calculate_tiein_offset(
                payload.get("oldRun", []),
                payload.get("newRun", []),
                payload.get("excludedRanges", []),
            )
            result['requestId'] = request_id
            print(json.dumps(result))
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"success": False, "error": str(e), "requestId": payload.get('requestId') if 'payload' in dir() else None}))
            sys.stdout.flush()

if __name__ == "__main__":
    main()
