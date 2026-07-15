
import json
import numpy as np
from sklearn.linear_model import RANSACRegressor

with open("test_data_full.json", "r") as f:
    data = json.load(f)

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

old_anchors = extract_anchors(data["oldRun"])
new_anchors = extract_anchors(data["newRun"])

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

matched = align_anchors(old_anchors, new_anchors)

if len(matched) >= 2:
    X = np.array([b.dist for a, b in matched]).reshape(-1, 1) # new
    y = np.array([a.dist for a, b in matched])                # old

    model = RANSACRegressor(residual_threshold=2.0)
    model.fit(X, y)
    scale = model.estimator_.coef_[0]
    offset = model.estimator_.intercept_
    inliers = model.inlier_mask_
    
    print(f"Scale: {scale:.6f}")
    print(f"Offset: {offset:.2f}")
    print(f"Inliers: {np.sum(inliers)} / {len(matched)}")

