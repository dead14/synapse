import sys
import json
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

def row_from_pair(f1, f2, oi, ni, match_status):
    len1 = f1.get('length') if f1.get('length') is not None else get_fallback(f1, ['length', 'len', 'panjang'])
    wid1 = f1.get('width') if f1.get('width') is not None else get_fallback(f1, ['width', 'wid', 'lebar'])
    len2 = f2.get('length') if f2.get('length') is not None else get_fallback(f2, ['length', 'len', 'panjang'])
    wid2 = f2.get('width') if f2.get('width') is not None else get_fallback(f2, ['width', 'wid', 'lebar'])
    
    c = {
        "Match/Unmatch": match_status,
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
            comparison.append(row_from_pair(f1, f2, oi, ni, "Match"))
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
    # -----------------------------------------------------------------
    remaining_old_indices = [i for i in range(n) if i not in processed_old]
    remaining_new_indices = [j for j in range(m) if j not in processed_new]

    ro = len(remaining_old_indices)
    rn = len(remaining_new_indices)

    if ro > 0 and rn > 0:
        # FIX (performance hardening): sort remaining new features by
        # corrected distance and use bisect to only consider candidates
        # within a generous window, instead of an unconditional O(ro*rn)
        # full scan. Window is threshold-based so correctness is preserved.
        new_dist_pairs = sorted(
            (
                (get_corrected_dist(new_features[j], dist_correction_map), j_idx)
                for j_idx, j in enumerate(remaining_new_indices)
            ),
            key=lambda p: p[0]
        )
        new_dists_sorted = [p[0] for p in new_dist_pairs]
        new_jidx_sorted = [p[1] for p in new_dist_pairs]

        cost_matrix = np.full((ro, rn), 1e9)

        max_window = landmark_thresh + dist_thresh_base + dist_thresh_pct * 1e6
        # cap window search generously; still verified by exact threshold below

        for i_idx, i in enumerate(remaining_old_indices):
            f1 = old_features[i]
            t1_raw = str(f1.get('type', '')).lower()
            is_landmark_1 = t1_raw in LANDMARK_TYPES
            fam1 = type_family(t1_raw)
            dist1 = get_corrected_dist(f1, dist_correction_map)
            clock1 = clock_to_hours(f1.get('clock'))
            depth1 = f1.get('depth')

            lo = bisect.bisect_left(new_dists_sorted, dist1 - max_window)
            hi = bisect.bisect_right(new_dists_sorted, dist1 + max_window)

            for k in range(lo, hi):
                j_idx = new_jidx_sorted[k]
                j = remaining_new_indices[j_idx]
                f2 = new_features[j]
                t2_raw = str(f2.get('type', '')).lower()
                is_landmark_2 = t2_raw in LANDMARK_TYPES
                fam2 = type_family(t2_raw)

                if is_landmark_1 != is_landmark_2:
                    continue
                if is_landmark_1 and is_landmark_2 and t1_raw != t2_raw:
                    continue
                # FIX #3: non-landmark types must now also be compatible
                # (same family), rather than passing through unchecked.
                if not is_landmark_1 and not is_landmark_2 and fam1 != fam2:
                    continue

                dist2 = get_corrected_dist(f2, dist_correction_map)
                dist_diff = abs(dist1 - dist2)

                if is_landmark_1:
                    threshold = landmark_thresh
                else:
                    threshold = dist_thresh_base + dist_thresh_pct * max(dist1, dist2)

                if dist_diff > threshold:
                    continue

                # FIX #4: soft penalty on top of distance, only among
                # candidates that already pass the hard distance threshold.
                cost = dist_diff
                if w_depth and depth1 is not None and f2.get('depth') is not None:
                    cost += w_depth * abs(depth1 - f2.get('depth'))
                if w_clock:
                    clock2 = clock_to_hours(f2.get('clock'))
                    cost += w_clock * circular_clock_diff(clock1, clock2)

                cost_matrix[i_idx, j_idx] = cost

        row_ind, col_ind = linear_sum_assignment(cost_matrix)

        for i_idx, j_idx in zip(row_ind, col_ind):
            cost = cost_matrix[i_idx, j_idx]
            if cost >= 1e9:
                continue
            i = remaining_old_indices[i_idx]
            j = remaining_new_indices[j_idx]
            f1 = old_features[i]
            f2 = new_features[j]
            processed_old.add(i)
            processed_new.add(j)
            comparison.append(row_from_pair(f1, f2, i, j, "Match"))

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
