import sys
import json
import math
import bisect
import numpy as np
from scipy.optimize import linear_sum_assignment

# ---------------------------------------------------------------------------
# Type grouping for non-landmark anomalies.
# FIX #3: sebelumnya non-landmark (metal loss, dent, gouge, crack, dll) sama
# sekali tidak dicek tipe -> metal loss bisa "match" ke dent asal jarak dekat.
# Landmark tetap wajib exact match seperti sebelumnya. Non-landmark sekarang
# dikelompokkan per keluarga; default = exact match kalau tidak dikenali,
# tapi bisa diperlonggar lewat mapping ini kalau perlu.
# ---------------------------------------------------------------------------
LANDMARK_TYPES = {'valve', 'tee', 'bend', 'offtake'}

TYPE_FAMILY = {
    'metal loss': 'metal_loss',
    'metal_loss': 'metal_loss',
    'external metal loss': 'metal_loss',
    'internal metal loss': 'metal_loss',
    'corrosion': 'metal_loss',
    'pitting': 'metal_loss',
    'dent': 'mechanical_damage',
    'gouge': 'mechanical_damage',
    'dent with metal loss': 'mechanical_damage',
    'crack': 'crack_like',
    'crack field': 'crack_like',
    'scc': 'crack_like',
    'lamination': 'lamination',
    'girth weld anomaly': 'weld_anomaly',
    'seam weld anomaly': 'weld_anomaly',
}


def type_family(raw_type):
    """Map a raw feature type string to a matching family. Unknown types
    fall back to the lowercased raw string itself, which forces an exact
    match (safe default) instead of silently letting anything through."""
    t = str(raw_type or '').strip().lower()
    return TYPE_FAMILY.get(t, t)


def clock_to_hours(clock_str):
    """Parse '3:00' / '3.5' / 3 style clock values into a float 0-12 scale.
    Returns None if unparseable so callers can skip the penalty gracefully."""
    if clock_str is None:
        return None
    try:
        if isinstance(clock_str, (int, float)):
            return float(clock_str) % 12
        s = str(clock_str).strip()
        if ':' in s:
            h, m = s.split(':')
            h = int(h) % 12
            m = int(m)
            return h + m / 60.0
        return float(s) % 12
    except (ValueError, TypeError):
        return None


def circular_clock_diff(c1, c2):
    """Shortest distance between two clock positions on a 12h dial."""
    if c1 is None or c2 is None:
        return 0.0
    diff = abs(c1 - c2) % 12
    return min(diff, 12 - diff)


def build_dist_correction_map(aligned_features):
    """FIX #2: sebelumnya koreksi jarak (aligned_dist_map) hanya diterapkan
    ke sisi Old, sisi New selalu pakai raw dist. Ini asimetris dan diam-diam
    salah kalau alignedFeatures berisi entri dari kedua run.
    Sekarang map dibangun sekali dan diterapkan ke SISI MANAPUN (old/new)
    berdasarkan id, jadi feature dari run manapun yang punya alignedDist
    akan otomatis terkoreksi."""
    m = {}
    for f in aligned_features:
        fid = f.get('id', f.get('featureId'))
        if fid is not None and f.get('alignedDist') is not None:
            m[fid] = f.get('alignedDist')
    return m


def get_corrected_dist(feature, dist_correction_map):
    fid = feature.get('id', feature.get('featureId'))
    if fid in dist_correction_map:
        return dist_correction_map[fid]
    return feature.get('dist', 0)


def build_id_index(features, label, warnings):
    """FIX (hardening): deteksi duplicate featureId. Vendor ILI data kadang
    punya id ganda; sebelumnya silent overwrite tanpa jejak apapun."""
    idx_map = {}
    for idx, f in enumerate(features):
        fid = f.get('id', f.get('featureId'))
        if fid is not None:
            fid_str = str(fid)
            if fid_str in idx_map:
                warnings.append(
                    f"Duplicate feature id '{fid_str}' in {label} run "
                    f"(indices {idx_map[fid_str]} and {idx})"
                )
            idx_map[fid_str] = idx
    return idx_map


def format_clock(val):
    if val is None or val == "-":
        return "-"
    try:
        val_str = str(val).replace(',', '.')
        if ":" in val_str:
            return val
        f = float(val_str)
        if 0 <= f <= 1:
            total_hours = f * 24
            h = int(total_hours)
            m = int(round((total_hours - h) * 60))
            if m == 60:
                h += 1
                m = 0
            if h == 0 and f > 0:
                h = 12
            if h == 0 and f == 0:
                h = 12
            return f"{h}:{m:02d}"
    except (ValueError, TypeError):
        pass
    return str(val)


def get_fallback(f, keywords):
    for k, v in f.items():
        k_lower = k.lower()
        if any(kw in k_lower for kw in keywords):
            try:
                # Try to convert to float, replace comma with dot for Indonesian locale
                if isinstance(v, str):
                    v = v.replace(',', '.')
                return float(v)
            except (ValueError, TypeError):
                pass
    return None


def _feat_dist(feature):
    """Safely get distance from a feature dict, fallback to 0."""
    try:
        return float(feature.get('dist', 0) or 0)
    except (ValueError, TypeError):
        return 0.0


def build_joint_segments(gw_matches, old_features, new_features):
    """
    Build per-joint containment segments from LOCKED girth-weld matches.

    Each consecutive pair of matched GWs defines one "joint room":
        joint k = {old_lo, old_hi, new_lo, new_hi, joint_len_new}

    Anomalies inside joint k (OLD side) may ONLY match anomalies inside the
    same joint k (NEW side). This is the strict containment that eliminates
    cross-joint false matches ("data loncat").

    Concept ported from engine/matching.py:build_joint_segments().

    Returns (segments, n_segments). Empty if <2 matched GWs.
    """
    # Resolve matched GWs into (old_dist, new_dist) pairs.
    gw_pairs = []
    for m in gw_matches:
        if m.get('status') not in ('Match', 'Flagged'):
            continue
        # Prefer resolved distances; fallback to oldDist/newDist/oldVal/newVal
        d_old = m.get('oldDist', m.get('oldVal'))
        d_new = m.get('newDist', m.get('newVal'))
        if d_old is None or d_new is None:
            # Try resolving via feature index/id
            oi = m.get('oldIndex')
            ni = m.get('newIndex')
            if oi is not None and oi < len(old_features):
                d_old = _feat_dist(old_features[oi])
            if ni is not None and ni < len(new_features):
                d_new = _feat_dist(new_features[ni])
        if d_old is None or d_new is None:
            continue
        try:
            gw_pairs.append((float(d_old), float(d_new)))
        except (ValueError, TypeError):
            continue

    if len(gw_pairs) < 2:
        return [], 0

    gw_pairs.sort(key=lambda x: x[0])

    segments = []
    for i in range(len(gw_pairs) - 1):
        old_lo, new_lo = gw_pairs[i]
        old_hi, new_hi = gw_pairs[i + 1]
        # Guard against non-increasing bounds (duplicate/degenerate GW pairs)
        if old_hi <= old_lo or new_hi <= new_lo:
            continue
        segments.append({
            'old_lo': old_lo,
            'old_hi': old_hi,
            'new_lo': new_lo,
            'new_hi': new_hi,
            'joint_len_new': new_hi - new_lo,
            'joint_len_old': old_hi - old_lo,
        })
    return segments, len(segments)


def compute_confidence(f_old, f_new, dist_diff):
    """
    Naive Bayes match confidence as a percentage (0-100).

    Ported from the frontend ProbabilityModal (ResultsPanel.tsx): a product of
    Gaussian likelihoods over distance, depth, length, width, and clock
    differences, compared against a fixed unmatch prior.

    Missing attributes contribute a neutral likelihood of 1.0 (no penalty),
    so confidence degrades gracefully when vendor data is sparse.

    Sigma values match the ProbabilityModal implementation:
        dist sigma=0.5m, depth sigma=10 %WT, length/width sigma=20mm, clock sigma=1hr
    """
    def _gauss(delta, sigma):
        # exp(-delta^2 / (2*sigma^2)); delta of 0 => 1.0 (perfect)
        return math.exp(-(float(delta) ** 2) / (2.0 * float(sigma) ** 2))

    # Distance likelihood (always available)
    l_dist = _gauss(dist_diff, 0.5)

    # Depth likelihood (optional)
    d_old = f_old.get('depth')
    d_new = f_new.get('depth')
    if d_old is not None and d_new is not None:
        try:
            l_depth = _gauss(abs(float(d_old) - float(d_new)), 10.0)
        except (ValueError, TypeError):
            l_depth = 1.0
    else:
        l_depth = 1.0

    # Length likelihood (optional, with keyword fallback)
    len_old = f_old.get('length') if f_old.get('length') is not None else get_fallback(f_old, ['length', 'len', 'panjang'])
    len_new = f_new.get('length') if f_new.get('length') is not None else get_fallback(f_new, ['length', 'len', 'panjang'])
    if len_old is not None and len_new is not None:
        try:
            l_length = _gauss(abs(float(len_old) - float(len_new)), 20.0)
        except (ValueError, TypeError):
            l_length = 1.0
    else:
        l_length = 1.0

    # Width likelihood (optional)
    wid_old = f_old.get('width') if f_old.get('width') is not None else get_fallback(f_old, ['width', 'wid', 'lebar'])
    wid_new = f_new.get('width') if f_new.get('width') is not None else get_fallback(f_new, ['width', 'wid', 'lebar'])
    if wid_old is not None and wid_new is not None:
        try:
            l_width = _gauss(abs(float(wid_old) - float(wid_new)), 20.0)
        except (ValueError, TypeError):
            l_width = 1.0
    else:
        l_width = 1.0

    # Clock likelihood (optional)
    c_old = clock_to_hours(f_old.get('clock'))
    c_new = clock_to_hours(f_new.get('clock'))
    if c_old is not None and c_new is not None:
        l_clock = _gauss(circular_clock_diff(c_old, c_new), 1.0)
    else:
        l_clock = 1.0

    # Type-family match multiplier
    type_match = 1.0 if type_family(f_old.get('type')) == type_family(f_new.get('type')) else 0.001

    p_match = l_dist * l_depth * l_length * l_width * l_clock * type_match
    p_unmatch = 0.05
    confidence = (p_match / (p_match + p_unmatch)) * 100.0
    return max(0.0, min(100.0, confidence))


def row_from_pair(f1, f2, oi, ni, match_status, confidence=0.0):
    len1 = f1.get('length') if f1.get('length') is not None else get_fallback(f1, ['length', 'len', 'panjang'])
    wid1 = f1.get('width') if f1.get('width') is not None else get_fallback(f1, ['width', 'wid', 'lebar'])
    len2 = f2.get('length') if f2.get('length') is not None else get_fallback(f2, ['length', 'len', 'panjang'])
    wid2 = f2.get('width') if f2.get('width') is not None else get_fallback(f2, ['width', 'wid', 'lebar'])

    c = {
        "Match/Unmatch": match_status,
        "Confidence (%)": round(confidence, 1),
        "Identif. OLD": f1.get('featureId', f"Old-{oi}") if oi is not None else "-",
        "Identif. NEW": f2.get('featureId', f"New-{ni}") if ni is not None else "-",
        "Log Dist OLD (m)": f1.get('dist', None) if oi is not None else None,
        "Log Dist NEW (m)": f2.get('dist', None) if ni is not None else None,
        "Feature Type OLD": f1.get('type', '-') if oi is not None else "-",
        "Feature Type NEW": f2.get('type', '-') if ni is not None else "-",
        "Depth OLD (%WT)": f1.get('depth', None) if oi is not None else None,
        "Depth NEW (%WT)": f2.get('depth', None) if ni is not None else None,
        "Length OLD (mm)": len1 if oi is not None else None,
        "Length NEW (mm)": len2 if ni is not None else None,
        "Width OLD (mm)": wid1 if oi is not None else None,
        "Width NEW (mm)": wid2 if ni is not None else None,
        "O'Clock OLD": format_clock(f1.get('clock', '-')) if oi is not None else "-",
        "O'Clock NEW": format_clock(f2.get('clock', '-')) if ni is not None else "-",
    }
    
    # Interleave all other properties from the original parsed rows side-by-side
    excluded = ['id', 'type', 'dist', 'originalType', 'featureId', 'depth', 'clock', 'length', 'width']
    all_keys = []
    if oi is not None:
        for k in f1.keys():
            if k not in excluded and k not in all_keys:
                all_keys.append(k)
    if ni is not None:
        for k in f2.keys():
            if k not in excluded and k not in all_keys:
                all_keys.append(k)
                
    for k in all_keys:
        c[f"{k} OLD"] = f1.get(k, None) if oi is not None else None
        c[f"{k} NEW"] = f2.get(k, None) if ni is not None else None
                
    return c


def run_hungarian_alignment(params):
    warnings = []

    old_features = params.get('summaryData', {}).get('oldRun', {}).get('rawFeatures', [])
    new_features = params.get('summaryData', {}).get('newRun', {}).get('rawFeatures', [])
    gw_matches = params.get('gwMatches', [])

    # --- Configurable matching parameters -----------------------------
    dist_thresh_base = params.get('distThresh', 0.3)
    # FIX #5: ILI distance uncertainty grows with distance from the
    # reference point (accumulated odometer/wheel-count error). Instead of
    # a flat threshold everywhere, allow an optional proportional term:
    #   effective_threshold = base + pct * max(dist_old, dist_new)
    dist_thresh_pct = params.get('distThreshPct', 0.0)  # e.g. 0.0005 = 0.05%/m
    landmark_thresh = params.get('landmarkThresh', 1.5)

    # FIX #4: soft penalty weights so depth & clock (already present in the
    # data) actually influence which candidate Hungarian prefers, without
    # turning them into hard filters that could reject a valid match.
    w_depth = params.get('depthPenaltyWeight', 0.0)   # cost per %WT of |depth diff|
    w_clock = params.get('clockPenaltyWeight', 0.0)    # cost per hour of clock diff

    n = len(old_features)
    m = len(new_features)
    if n == 0 or m == 0:
        return {"comparison": [], "warnings": warnings}

    old_id_to_idx = build_id_index(old_features, "OLD", warnings)
    new_id_to_idx = build_id_index(new_features, "NEW", warnings)

    aligned_features = params.get('alignedFeatures', [])
    dist_correction_map = build_dist_correction_map(aligned_features)

    comparison = []
    processed_old = set()
    processed_new = set()

    # -----------------------------------------------------------------
    # 1. GW matches: add directly to comparison.
    # These are LOCKED matches from the GW Simulator — they must NOT
    # be re-matched by the Hungarian algorithm.
    # -----------------------------------------------------------------
    import sys as _sys
    _sys.stderr.write(f"[HUNGARIAN] Received {len(gw_matches)} gwMatches\n")
    _sys.stderr.write(f"[HUNGARIAN] old_features: {n}, new_features: {m}\n")
    _sys.stderr.write(f"[HUNGARIAN] old_id_to_idx has {len(old_id_to_idx)} entries\n")
    _sys.stderr.write(f"[HUNGARIAN] new_id_to_idx has {len(new_id_to_idx)} entries\n")

    # Pre-build distance-to-index maps for fallback matching
    # Maps (type, round(dist, 3)) -> index for fast lookup by distance
    old_dist_idx = {}
    for idx_o, f_o in enumerate(old_features):
        key = (str(f_o.get('type', '')).lower(), round(float(f_o.get('dist', 0)), 3))
        old_dist_idx[key] = idx_o
    new_dist_idx = {}
    for idx_n, f_n in enumerate(new_features):
        key = (str(f_n.get('type', '')).lower(), round(float(f_n.get('dist', 0)), 3))
        new_dist_idx[key] = idx_n

    gw_resolved = 0
    gw_failed = 0

    for match in gw_matches:
        status = match.get('status')
        old_id_raw = match.get('oldId')
        new_id_raw = match.get('newId')

        # Primary: lookup by feature ID
        oi = old_id_to_idx.get(str(old_id_raw)) if old_id_raw is not None else None
        ni = new_id_to_idx.get(str(new_id_raw)) if new_id_raw is not None else None

        # Fallback: lookup by distance if ID lookup failed
        if oi is None and match.get('oldVal') is not None:
            old_dist_key = ('weld', round(float(match['oldVal']), 3))
            oi = old_dist_idx.get(old_dist_key)
            if oi is not None:
                _sys.stderr.write(f"[HUNGARIAN] oldId '{old_id_raw}' not found, fallback by dist {match['oldVal']} -> idx {oi}\n")

        if ni is None and match.get('newVal') is not None:
            new_dist_key = ('weld', round(float(match['newVal']), 3))
            ni = new_dist_idx.get(new_dist_key)
            if ni is not None:
                _sys.stderr.write(f"[HUNGARIAN] newId '{new_id_raw}' not found, fallback by dist {match['newVal']} -> idx {ni}\n")

        # Second fallback: try oldDist/newDist fields (from DTW output format)
        if oi is None and match.get('oldDist') is not None:
            old_dist_key = ('weld', round(float(match['oldDist']), 3))
            oi = old_dist_idx.get(old_dist_key)

        if ni is None and match.get('newDist') is not None:
            new_dist_key = ('weld', round(float(match['newDist']), 3))
            ni = new_dist_idx.get(new_dist_key)

        if oi is not None:
            processed_old.add(oi)
        if ni is not None:
            processed_new.add(ni)

        is_confirmed = status in ('Match', 'Flagged')

        if is_confirmed and (oi is not None or ni is not None):
            gw_resolved += 1
            f1 = old_features[oi] if oi is not None else {}
            f2 = new_features[ni] if ni is not None else {}
            gw_conf = match.get('confidence', 100.0)
            comparison.append(row_from_pair(f1, f2, oi, ni, "Match", gw_conf))
        elif is_confirmed:
            gw_failed += 1
            _sys.stderr.write(f"[HUNGARIAN] FAILED to resolve GW match: oldId={old_id_raw}, newId={new_id_raw}, status={status}\n")
        else:
            # Split into independent unmatched rows instead of merging.
            if oi is not None:
                f1 = old_features[oi]
                comparison.append(row_from_pair(f1, {}, oi, None, "Unmatched Old"))
            if ni is not None:
                f2 = new_features[ni]
                comparison.append(row_from_pair({}, f2, None, ni, "Unmatched New"))

    _sys.stderr.write(f"[HUNGARIAN] GW resolved: {gw_resolved}, failed: {gw_failed}, total processed_old: {len(processed_old)}, processed_new: {len(processed_new)}\n")

    # -----------------------------------------------------------------
    # 2. Remaining features -> Hungarian assignment
    #
    # v10.0 STRICT PER-JOINT CONTAINMENT:
    #   - Anomalies (metal_loss, mechanical_damage, crack_like, ...) are
    #     matched ONLY within the joint room bounded by two consecutive
    #     LOCKED GWs. This eliminates cross-joint false matches ("data
    #     loncat") where an anomaly in joint A jumps to a candidate in
    #     joint B/C.
    #   - Landmarks (valve, tee, bend, offtake) remain GLOBAL Hungarian:
    #     they are sparse physical fixtures that may legitimately match
    #     across wider distances.
    # Concept ported from engine/matching.py:run_joint_centric_matching().
    # -----------------------------------------------------------------
    remaining_old_indices = [i for i in range(n) if i not in processed_old]
    remaining_new_indices = [j for j in range(m) if j not in processed_new]

    # Build joint segments from the locked GW matches.
    joint_segments, n_joints = build_joint_segments(gw_matches, old_features, new_features)

    # Classify remaining features into anomaly vs landmark buckets.
    ANOMALY_TYPES = {'anomaly', 'metal loss', 'metal_loss', 'corrosion',
                     'pitting', 'dent', 'gouge', 'crack', 'scc', 'lamination'}
    anomaly_old = []
    anomaly_new = []
    landmark_old = []
    landmark_new = []
    for i in remaining_old_indices:
        t = str(old_features[i].get('type', '')).lower()
        if t in LANDMARK_TYPES:
            landmark_old.append(i)
        elif t in ANOMALY_TYPES or t not in ('weld',):
            anomaly_old.append(i)
    for j in remaining_new_indices:
        t = str(new_features[j].get('type', '')).lower()
        if t in LANDMARK_TYPES:
            landmark_new.append(j)
        elif t in ANOMALY_TYPES or t not in ('weld',):
            anomaly_new.append(j)

    _sys.stderr.write(
        f"[HUNGARIAN] Joints: {n_joints} | "
        f"anomalies OLD/NEW: {len(anomaly_old)}/{len(anomaly_new)} | "
        f"landmarks OLD/NEW: {len(landmark_old)}/{len(landmark_new)}\n"
    )

    # -----------------------------------------------------------------
    # 2a. PER-JOINT Hungarian for anomalies (strict containment).
    # -----------------------------------------------------------------
    anomaly_matched_pairs = []  # list of (old_idx, new_idx, dist_diff)
    if n_joints > 0 and anomaly_old and anomaly_new:
        for seg in joint_segments:
            old_lo, old_hi = seg['old_lo'], seg['old_hi']
            new_lo, new_hi = seg['new_lo'], seg['new_hi']
            jlen_new = seg['joint_len_new']
            jlen_old = seg['joint_len_old']

            # Anomalies inside this joint (OLD side), not yet matched.
            seg_old = [
                i for i in anomaly_old
                if i not in processed_old
                and old_lo <= _feat_dist(old_features[i]) < old_hi
            ]
            # Anomalies inside this joint (NEW side), not yet matched.
            seg_new = [
                j for j in anomaly_new
                if j not in processed_new
                and new_lo <= _feat_dist(new_features[j]) < new_hi
            ]
            if not seg_old or not seg_new:
                continue

            na = len(seg_old)
            nb = len(seg_new)
            side = max(na, nb)
            cost_mat = np.full((side, side), 1e9)

            for a, i in enumerate(seg_old):
                f1 = old_features[i]
                dist1_old = _feat_dist(f1)
                # Linear-reference the OLD anomaly position into the NEW
                # joint space: ratio within the OLD joint applied to NEW span.
                if jlen_old > 0:
                    ratio = (dist1_old - old_lo) / jlen_old
                else:
                    ratio = 0.0
                ratio = max(0.0, min(1.0, ratio))
                dist1_mapped = new_lo + ratio * jlen_new
                depth1 = f1.get('depth')
                clock1 = clock_to_hours(f1.get('clock'))

                for b, j in enumerate(seg_new):
                    f2 = new_features[j]
                    dist2 = _feat_dist(f2)
                    dist_diff = abs(dist1_mapped - dist2)

                    # Within-joint threshold is strict and fixed.
                    if dist_diff > dist_thresh_base:
                        continue

                    cost = dist_diff
                    if w_depth and depth1 is not None and f2.get('depth') is not None:
                        cost += w_depth * abs(depth1 - f2.get('depth'))
                    if w_clock:
                        clock2 = clock_to_hours(f2.get('clock'))
                        cost += w_clock * circular_clock_diff(clock1, clock2)
                    cost_mat[a, b] = cost

            row_ind, col_ind = linear_sum_assignment(cost_mat)
            for a, b in zip(row_ind, col_ind):
                if cost_mat[a, b] >= 1e9:
                    continue
                i = seg_old[a]
                j = seg_new[b]
                if i in processed_old or j in processed_new:
                    continue
                processed_old.add(i)
                processed_new.add(j)
                f1 = old_features[i]
                f2 = new_features[j]
                dd = abs(_feat_dist(f1) - _feat_dist(f2))
                anomaly_matched_pairs.append((i, j, dd))

        for (i, j, dd) in anomaly_matched_pairs:
            f1 = old_features[i]
            f2 = new_features[j]
            conf = compute_confidence(f1, f2, dd)
            comparison.append(row_from_pair(f1, f2, i, j, "Match", conf))

        _sys.stderr.write(
            f"[HUNGARIAN] Per-joint anomaly matches: {len(anomaly_matched_pairs)}\n"
        )
    elif anomaly_old and anomaly_new and n_joints == 0:
        warnings.append(
            "No locked girth-weld matches found — anomaly containment "
            "disabled (no joints). All anomalies left unmatched. Run the "
            "GW Simulator step first to lock weld pairs."
        )
        _sys.stderr.write("[HUNGARIAN] WARNING: 0 joints — anomalies cannot be contained, left unmatched\n")

    # -----------------------------------------------------------------
    # 2b. GLOBAL Hungarian for landmarks (valve, tee, bend, offtake).
    # These are sparse physical fixtures; global matching is appropriate.
    # -----------------------------------------------------------------
    lo = len(landmark_old)
    ln = len(landmark_new)
    if lo > 0 and ln > 0:
        new_dist_pairs = sorted(
            (
                (get_corrected_dist(new_features[j], dist_correction_map), j_idx)
                for j_idx, j in enumerate(landmark_new)
            ),
            key=lambda p: p[0]
        )
        new_dists_sorted = [p[0] for p in new_dist_pairs]
        new_jidx_sorted = [p[1] for p in new_dist_pairs]

        cost_matrix = np.full((lo, ln), 1e9)
        max_window = landmark_thresh + dist_thresh_base + dist_thresh_pct * 1e6

        for i_idx, i in enumerate(landmark_old):
            f1 = old_features[i]
            t1_raw = str(f1.get('type', '')).lower()
            dist1 = get_corrected_dist(f1, dist_correction_map)
            clock1 = clock_to_hours(f1.get('clock'))
            depth1 = f1.get('depth')

            lo_w = bisect.bisect_left(new_dists_sorted, dist1 - max_window)
            hi_w = bisect.bisect_right(new_dists_sorted, dist1 + max_window)

            for k in range(lo_w, hi_w):
                j_idx = new_jidx_sorted[k]
                j = landmark_new[j_idx]
                f2 = new_features[j]
                t2_raw = str(f2.get('type', '')).lower()

                # Landmarks require exact type match.
                if t1_raw != t2_raw:
                    continue

                dist2 = get_corrected_dist(f2, dist_correction_map)
                dist_diff = abs(dist1 - dist2)

                if dist_diff > landmark_thresh:
                    continue

                cost = dist_diff
                if w_depth and depth1 is not None and f2.get('depth') is not None:
                    cost += w_depth * abs(depth1 - f2.get('depth'))
                if w_clock:
                    clock2 = clock_to_hours(f2.get('clock'))
                    cost += w_clock * circular_clock_diff(clock1, clock2)
                cost_matrix[i_idx, j_idx] = cost

        row_ind, col_ind = linear_sum_assignment(cost_matrix)
        lm_count = 0
        for i_idx, j_idx in zip(row_ind, col_ind):
            cost = cost_matrix[i_idx, j_idx]
            if cost >= 1e9:
                continue
            i = landmark_old[i_idx]
            j = landmark_new[j_idx]
            if i in processed_old or j in processed_new:
                continue
            processed_old.add(i)
            processed_new.add(j)
            f1 = old_features[i]
            f2 = new_features[j]
            dd = abs(_feat_dist(f1) - _feat_dist(f2))
            conf = compute_confidence(f1, f2, dd)
            comparison.append(row_from_pair(f1, f2, i, j, "Match", conf))
            lm_count += 1
        _sys.stderr.write(f"[HUNGARIAN] Global landmark matches: {lm_count}\n")

    # -----------------------------------------------------------------
    # 3 & 4. Remaining unmatched Old / New
    # -----------------------------------------------------------------
    for i in range(n):
        if i not in processed_old:
            comparison.append(row_from_pair(old_features[i], {}, i, None, "Unmatched Old"))

    for j in range(m):
        if j not in processed_new:
            comparison.append(row_from_pair({}, new_features[j], None, j, "Unmatched New"))

    # -----------------------------------------------------------------
    # Sort by log distance.
    # FIX (minor): rows with neither OLD nor NEW distance (shouldn't
    # normally happen, but defensive) are pushed to the end instead of
    # silently sorting to the front at 0, which used to confuse QC review.
    # -----------------------------------------------------------------
    def get_sort_key(c):
        old_dist = c.get('Log Dist OLD (m)')
        new_dist = c.get('Log Dist NEW (m)')
        if old_dist is not None:
            return float(old_dist)
        if new_dist is not None:
            return float(new_dist)
        return float('inf')

    comparison.sort(key=get_sort_key)
    return {"comparison": comparison, "warnings": warnings}


if __name__ == "__main__":
    try:
        input_data = sys.stdin.read()
        params = json.loads(input_data)
        result = run_hungarian_alignment(params)
        print(json.dumps(result))
    except Exception as e:
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)
