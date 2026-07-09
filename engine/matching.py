import pandas as pd
import numpy as np
import bisect
from scipy.optimize import linear_sum_assignment
from .constants import *
from .math_utils import *
from .math_utils import _sf, _sstr, _clock_diff, _surface_compatible
#  BAGIAN 6 — JOINT SEGMENTATION (JOINT-CENTRIC MATCHING)
# ══════════════════════════════════════════════════════════════════════════════════

def build_joint_segments(df_new, df_old, matched_new):
    """
    Bangun segmen per-joint berdasarkan GW yang sudah matched.

    Setelah Fase 1 selesai dan GW di-lock:
    - Buat daftar pasangan (GW_new_dist, GW_old_dist)
    - Setiap pasangan berurutan mendefinisikan satu "ruang joint"
    - Anomali di dalam joint NEW hanya boleh dipasangkan dengan anomali
      di dalam joint OLD yang sama → eliminasi false match lintas joint.

    Returns
    -------
    segments : list of dict
    n_segments : int
    """
    gw_pairs = []
    for idx_n, idx_o in matched_new.items():
        ft = str(df_new.at[idx_n, "feature_type"])
        if ft != "Weld":
            continue
        d_n = _sf(df_new.at[idx_n, "log_distance_m"])
        d_o = _sf(df_old.at[idx_o, "log_distance_m"])
        if d_n is not None and d_o is not None:
            gw_pairs.append((d_n, d_o))

    if len(gw_pairs) < 2:
        print(f"   [JOINT-CENTRIC] Hanya {len(gw_pairs)} GW matched "
              f"→ tidak bisa buat segmen joint")
        return [], 0

    gw_pairs.sort(key=lambda x: x[0])

    segments = []
    for i in range(len(gw_pairs) - 1):
        n_lo, o_lo = gw_pairs[i]
        n_hi, o_hi = gw_pairs[i + 1]
        segments.append({
            "new_lo":        n_lo,
            "new_hi":        n_hi,
            "old_lo":        o_lo,
            "old_hi":        o_hi,
            "joint_len_new": n_hi - n_lo,
            "joint_len_old": o_hi - o_lo,
        })

    print(f"   [JOINT-CENTRIC] {len(segments)} segmen joint "
          f"dari {len(gw_pairs)} GW matched")
    return segments, len(segments)


def run_joint_centric_matching(df_new, df_old, matched_new, matched_old,
                               used_old, joint_segments, dtw_corrections,
                               pipeline_length):
    """
    v8.1 CORE: Hungarian HANYA dalam ruang joint yang sudah terkunci oleh GW.

    Untuk setiap segmen joint:
    1. Ambil anomali NEW di dalam [GW_n_lo, GW_n_hi)
    2. Ambil anomali OLD di dalam [GW_o_lo, GW_o_hi)
    3. Jalankan Hungarian pada subset kecil
    4. Commit pasangan valid

    [FIX-1 v8.1]: total_joints dihitung sekali per segment, bukan per feat_type.
    [FIX-5 v8.1]: Early exit per segment jika semua anomali sudah matched.
    """
    total_matched  = 0
    joints_with_match = 0
    joints_empty   = 0

    passes = [
        ("tight",  CLOCK_HARD_GATE["tight"]),
        ("medium", CLOCK_HARD_GATE["medium"]),
        ("loose",  CLOCK_HARD_GATE["loose"]),
        ("super",  CLOCK_HARD_GATE["super"]),
    ]

    for seg in joint_segments:
        n_lo = seg["new_lo"];  n_hi = seg["new_hi"]
        o_lo = seg["old_lo"];  o_hi = seg["old_hi"]
        jlen = max(seg["joint_len_new"], seg["joint_len_old"], 1.0)

        # Radius ODO dalam-joint: 20% panjang joint (min 0.3m, maks 3.0m)
        odo_max = max(0.3, min(jlen * JOINT_CENTRIC_ODO_SCALE, 3.0))

        seg_matched_this = 0  # matched di segment ini

        for feat_type in ["Metal Loss", "Dent"]:
            for pass_name, clock_max in passes:
                # Ambil anomali NEW yang belum matched di joint ini
                rows_new_j = df_new[
                    (df_new["feature_type"] == feat_type) &
                    (df_new["log_distance_m"] >= n_lo) &
                    (df_new["log_distance_m"] <  n_hi) &
                    (~df_new.index.isin(matched_new))
                ]
                # Ambil anomali OLD yang belum dipakai di joint ini
                rows_old_j = df_old[
                    (df_old["feature_type"] == feat_type) &
                    (df_old["log_distance_m"] >= o_lo) &
                    (df_old["log_distance_m"] <  o_hi) &
                    (~df_old.index.isin(used_old))
                ]

                if len(rows_new_j) == 0 or len(rows_old_j) == 0:
                    continue

                na = len(rows_new_j)
                nb = len(rows_old_j)
                side = max(na, nb)
                cost_mat = np.full((side, side), PENALTY)

                idx_n_list = rows_new_j.index.tolist()
                idx_o_list = rows_old_j.index.tolist()

                for i, in_n in enumerate(idx_n_list):
                    rn = rows_new_j.loc[in_n]
                    d_n_orig = float(rn["log_distance_m"])
                    # Terapkan koreksi DTW jika tersedia
                    d_n_corr = (dtw_correct_distance(d_n_orig, dtw_corrections)
                                if dtw_corrections else d_n_orig)

                    cn = rn.get("clock_position")
                    sn = _sstr(rn.get("surface_location"))

                    for j, in_o in enumerate(idx_o_list):
                        ro = rows_old_j.loc[in_o]
                        d_o = float(ro["log_distance_m"])

                        odo_diff = abs(d_n_corr - d_o)
                        if odo_diff > odo_max:
                            continue

                        co = ro.get("clock_position")
                        so = _sstr(ro.get("surface_location"))

                        cd = _clock_diff(cn, co)
                        if cd is not None and cd > clock_max:
                            continue

                        if not _surface_compatible(sn, so):
                            continue

                        cost_mat[i, j] = compute_cost_ml(
                            odo_diff, cn, co,
                            rn.get("depth_pct"),        ro.get("depth_pct"),
                            rn.get("length_mm"),        ro.get("length_mm"),
                            rn.get("width_mm"),         ro.get("width_mm"),
                            rn.get("dist_to_us_gw_m"),  ro.get("dist_to_us_gw_m"),
                            rn.get("joint_length_m"),   ro.get("joint_length_m"),
                            clock_gate_deg=clock_max,
                        )

                ri, ci = linear_sum_assignment(cost_mat)
                for r, c in zip(ri, ci):
                    if (r < na and c < nb and
                            cost_mat[r, c] < PENALTY * 0.5 and
                            idx_n_list[r] not in matched_new and
                            idx_o_list[c] not in used_old):
                        matched_new[idx_n_list[r]] = idx_o_list[c]
                        matched_old[idx_o_list[c]] = idx_n_list[r]
                        used_old.add(idx_o_list[c])
                        total_matched   += 1
                        seg_matched_this += 1

        # [FIX-1]: Hitung statistik sekali per segment, di luar loop feat_type
        if seg_matched_this > 0:
            joints_with_match += 1
        else:
            joints_empty += 1

    print(f"   [JOINT-CENTRIC] {total_matched} anomali matched dalam "
          f"{len(joint_segments)} joint "
          f"| {joints_with_match} joint ada match, {joints_empty} joint kosong/skip")
    return matched_new, matched_old, used_old


# ══════════════════════════════════════════════════════════════════════════════════
#  BAGIAN 7 — LANDMARK SEGMENTATION
# ══════════════════════════════════════════════════════════════════════════════════

LANDMARK_MATCH_TOL = {
    "Valve": 200.0,   # Tier-1 Absolute Anchor
    "Tee":    35.0,   # Tier-1 Anchor
    "Weld":    8.0,   # Tier-2 Skeleton
}

def _get_landmarks(df_new, df_old):
    """
    Bangun segmentasi awal berdasarkan landmark types.

    [FIX-7 v8.1]: used set di-reset untuk setiap landmark type,
    mencegah cross-contamination antar Valve/Tee/Weld.
    """
    pts_new, pts_old = [], []

    for lt, tol in LANDMARK_MATCH_TOL.items():
        n = sorted(df_new[df_new["feature_type"] == lt]["log_distance_m"].dropna().values)
        o = sorted(df_old[df_old["feature_type"] == lt]["log_distance_m"].dropna().values)
        used = set()  # [FIX-7]: di-reset per lt, bukan shared
        for pn in n:
            best_j, best_d = -1, 1e9
            for j, po in enumerate(o):
                if j not in used and abs(pn - po) < best_d:
                    best_d, best_j = abs(pn - po), j
            if best_j >= 0 and best_d < tol:
                pts_new.append(pn)
                pts_old.append(o[best_j])
                used.add(best_j)

    if pts_new:
        combined = sorted(zip(pts_new, pts_old), key=lambda x: x[0])
        pn_s = [-np.inf] + [p[0] for p in combined] + [np.inf]
        po_s = [-np.inf] + [p[1] for p in combined] + [np.inf]
        return pn_s, po_s, len(combined) + 1

    return [-np.inf, np.inf], [-np.inf, np.inf], 1


def _build_offset_from_matched_landmarks(matched_new, df_new, df_old):
    pts_new, pts_old = [], []
    for idx_n, idx_o in matched_new.items():
        try:
            ft = str(df_new.at[idx_n, "feature_type"])
            if ft not in LANDMARK_TYPES:
                continue
            d_n = float(df_new.at[idx_n, "log_distance_m"])
            d_o = float(df_old.at[idx_o, "log_distance_m"])
            if not (np.isnan(d_n) or np.isnan(d_o)):
                pts_new.append(d_n)
                pts_old.append(d_o)
        except: continue

    if not pts_new:
        return [-np.inf, np.inf], [-np.inf, np.inf], 1

    combined = sorted(zip(pts_new, pts_old), key=lambda x: x[0])
    pn_s = [-np.inf] + [p[0] for p in combined] + [np.inf]
    po_s = [-np.inf] + [p[1] for p in combined] + [np.inf]
    n_seg = len(combined) + 1
    print(f"   Offset model rebuilt: {len(combined)} landmark pairs → {n_seg} segments")
    return pn_s, po_s, n_seg


def _get_offset(d, seg_n, seg_o):
    sna = np.array(seg_n)
    idx = int(np.searchsorted(sna[1:-1], d))
    lo_n, hi_n = seg_n[idx], seg_n[idx+1]
    lo_o, hi_o = seg_o[idx], seg_o[idx+1]
    lo_n = lo_n if not np.isinf(lo_n) else (hi_n - 20 if not np.isinf(hi_n) else d - 20)
    hi_n = hi_n if not np.isinf(hi_n) else lo_n + 20
    lo_o = lo_o if not np.isinf(lo_o) else (hi_o - 20 if not np.isinf(hi_o) else d - 20)
    hi_o = hi_o if not np.isinf(hi_o) else lo_o + 20
    span = hi_n - lo_n
    if span > 0:
        t = max(0.0, min(1.0, (d - lo_n) / span))
        return (lo_o + t * (hi_o - lo_o)) - d
    return lo_o - lo_n


# ══════════════════════════════════════════════════════════════════════════════════
#  BAGIAN 8 — ODO TOLERANCE
# ══════════════════════════════════════════════════════════════════════════════════

def compute_pipeline_length(df_new, df_old):
    all_dist = pd.concat([
        df_new["log_distance_m"].dropna(),
        df_old["log_distance_m"].dropna()
    ])
    if len(all_dist) == 0: return 1000.0
    total_len = float(all_dist.max() - all_dist.min())
    return total_len if total_len > 0 else 1000.0


def get_anomaly_odo_tolerance(pipeline_length, pass_idx):
    if pass_idx == 0:
        return ANOMALY_ODO_ABS
    pct   = ANOMALY_ODO_PCT[pass_idx]
    tol   = pipeline_length * pct
    min_t = ANOMALY_ODO_MIN.get(pass_idx, 1.0)
    max_t = ANOMALY_ODO_CAP.get(pass_idx, 35.0)
    return max(min_t, min(tol, max_t))


def get_effective_odo_tol(global_tol, position, pass_idx):
    if pass_idx == 0:
        return ANOMALY_ODO_ABS
    drift_rate = ANOMALY_ODO_PCT[pass_idx]
    min_floor  = ANOMALY_ODO_MIN.get(pass_idx, 1.0)
    pos_tol    = abs(position) * drift_rate
    return min(global_tol, max(min_floor, pos_tol))


# ══════════════════════════════════════════════════════════════════════════════════
#  BAGIAN 9 — HUNGARIAN CORE
# ══════════════════════════════════════════════════════════════════════════════════

def _hungarian_pass_anomaly(rows_new, avail_old, seg_n, seg_o,
                             odo_max, clock_max_deg, pass_idx,
                             dtw_corrections=None):
    """
    Hungarian dengan DTW correction pada odometer NEW.
    Digunakan untuk fallback global anomaly matching (FASE 3d).
    """
    na, nb = len(rows_new), len(avail_old)
    if na == 0 or nb == 0:
        return [], 0, 0, 0, 0

    side = max(na, nb)
    cost_mat = np.full((side, side), PENALTY)

    idx_n_list = rows_new.index.tolist()
    idx_o_list = avail_old.index.tolist()

    # Hitung jarak NEW yang sudah dikoreksi
    d_new_adj = []
    for i in idx_n_list:
        d_orig = float(rows_new.at[i, "log_distance_m"])
        if dtw_corrections:
            d_corr = dtw_correct_distance(d_orig, dtw_corrections)
        else:
            d_corr = d_orig + _get_offset(d_orig, seg_n, seg_o)
        d_new_adj.append(d_corr)

    d_old_vals = [float(avail_old.at[j, "log_distance_m"]) for j in idx_o_list]
    original_pos = [float(rows_new.at[i, "log_distance_m"]) for i in idx_n_list]

    reject_odo = 0; reject_clock = 0; reject_surface = 0; candidates = 0

    for i in range(na):
        idx_n = idx_n_list[i]
        rn = rows_new.loc[idx_n]
        cn = rn.get("clock_position")
        sn = _sstr(rn.get("surface_location"))
        pos_orig = original_pos[i]
        eff_tol  = get_effective_odo_tol(odo_max, pos_orig, pass_idx)

        for j in range(nb):
            odo_diff = abs(d_new_adj[i] - d_old_vals[j])
            if odo_diff > eff_tol:
                reject_odo += 1
                continue

            idx_o = idx_o_list[j]
            ro = avail_old.loc[idx_o]
            co = ro.get("clock_position")
            so = _sstr(ro.get("surface_location"))

            cd = _clock_diff(cn, co)
            if cd is not None and cd > clock_max_deg:
                reject_clock += 1
                continue

            if not _surface_compatible(sn, so):
                reject_surface += 1
                continue

            candidates += 1
            cost_mat[i, j] = compute_cost_ml(
                odo_diff, cn, co,
                rn.get("depth_pct"),        ro.get("depth_pct"),
                rn.get("length_mm"),        ro.get("length_mm"),
                rn.get("width_mm"),         ro.get("width_mm"),
                rn.get("dist_to_us_gw_m"),  ro.get("dist_to_us_gw_m"),
                rn.get("joint_length_m"),   ro.get("joint_length_m"),
                clock_gate_deg=clock_max_deg,
            )

    ri, ci = linear_sum_assignment(cost_mat)
    result = []
    for r, c in zip(ri, ci):
        if r < na and c < nb and cost_mat[r, c] < PENALTY * 0.5:
            result.append((idx_n_list[r], idx_o_list[c], cost_mat[r, c]))

    return result, reject_odo, reject_clock, reject_surface, candidates


def _hungarian_pass_generic(rows_new, avail_old, seg_n, seg_o, odo_max,
                             dtw_corrections=None):
    """
    Hungarian untuk fitur non-anomali (Landmark, Bend, Secondary).
    """
    na, nb = len(rows_new), len(avail_old)
    if na == 0 or nb == 0:
        return []

    side = max(na, nb)
    cost_mat = np.full((side, side), PENALTY)

    idx_n_list = rows_new.index.tolist()
    idx_o_list = avail_old.index.tolist()

    d_new_adj = []
    for i in idx_n_list:
        d_orig = float(rows_new.at[i, "log_distance_m"])
        if dtw_corrections:
            d_corr = dtw_correct_distance(d_orig, dtw_corrections)
        else:
            d_corr = d_orig + _get_offset(d_orig, seg_n, seg_o)
        d_new_adj.append(d_corr)

    d_old_vals = [float(avail_old.at[j, "log_distance_m"]) for j in idx_o_list]

    for i in range(na):
        rn = rows_new.loc[idx_n_list[i]]
        for j in range(nb):
            odo_diff = abs(d_new_adj[i] - d_old_vals[j])
            if odo_diff <= odo_max:
                cost_mat[i, j] = compute_cost_generic(
                    odo_diff, rn, avail_old.loc[idx_o_list[j]])

    ri, ci = linear_sum_assignment(cost_mat)
    result = []
    for r, c in zip(ri, ci):
        if r < na and c < nb and cost_mat[r, c] < PENALTY * 0.5:
            result.append((idx_n_list[r], idx_o_list[c], cost_mat[r, c]))
    return result


def _commit_pairs(pairs, matched_new, matched_old, used_old):
    added = 0
    used_this = set()
    for (in_n, in_o, c) in sorted(pairs, key=lambda x: x[2]):
        if (in_n not in matched_new and
                in_o not in used_old and
                in_o not in used_this):
            matched_new[in_n] = in_o
            matched_old[in_o] = in_n
            used_old.add(in_o)
            used_this.add(in_o)
            added += 1
    return added


def _enforce_monotonicity(matched_new, matched_old, df_new, df_old):
    """
    ANTI-JUMP FILTER: Valve + Tee sebagai Ground Truth (Tier-1, kebal LIS).

    [FIX-4 v8.1]: Implementasi LIS (Longest Increasing Subsequence) menggunakan
    patience sorting yang benar (O(n log n)):
    - tails[k] = nilai OLD terkecil yang bisa mengakhiri LIS panjang (k+1)
    - back_ptr[i] = index ke elemen sebelumnya dalam LIS untuk traceback

    Ini menghindari bug pada implementasi sebelumnya di mana tail_indices
    bisa menunjuk ke index yang sudah diupdate.
    """
    if not matched_new:
        return matched_new, matched_old

    anchor_pairs = []  # Tier-1: Valve & Tee
    other_pairs  = []

    for n_idx, o_idx in matched_new.items():
        d_n = float(df_new.at[n_idx, "log_distance_m"])
        d_o = float(df_old.at[o_idx, "log_distance_m"])
        ft  = str(df_new.at[n_idx, "feature_type"])

        if ft in {"Valve", "Tee"}:
            anchor_pairs.append((d_n, d_o, n_idx, o_idx))
        else:
            other_pairs.append((d_n, d_o, n_idx, o_idx))

    # Pastikan anchor pairs sendiri monoton
    anchor_pairs.sort(key=lambda x: x[0])
    keep_anchors = []
    last_do = -np.inf
    for p in anchor_pairs:
        if p[1] > last_do:
            keep_anchors.append(p)
            last_do = p[1]

    # Buang non-anchor yang menyilang anchor
    valid_others = []
    for p in other_pairs:
        dn, do = p[0], p[1]
        crosses = any(
            (dn < v[0] and do > v[1]) or (dn > v[0] and do < v[1])
            for v in keep_anchors
        )
        if not crosses:
            valid_others.append(p)

    # [FIX-4]: LIS dengan patience sorting + back pointer yang benar
    valid_others.sort(key=lambda x: x[0])

    if not valid_others:
        keep_new = set(v[2] for v in keep_anchors)
    else:
        # tails[k] = nilai OLD terkecil yang bisa mengakhiri subsequence panjang k+1
        tails     = []  # nilai OLD
        tail_pos  = []  # index ke valid_others yang menjadi elemen terakhir
        back_ptr  = [-1] * len(valid_others)

        for i, p in enumerate(valid_others):
            d_o = p[1]
            pos = bisect.bisect_left(tails, d_o)  # bisect_left: strictly increasing

            if pos == len(tails):
                tails.append(d_o)
                tail_pos.append(i)
            else:
                tails[pos] = d_o
                tail_pos[pos] = i

            back_ptr[i] = tail_pos[pos - 1] if pos > 0 else -1

        # Traceback dari ujung LIS
        keep_new = set(v[2] for v in keep_anchors)
        curr = tail_pos[-1] if tail_pos else -1
        while curr != -1:
            keep_new.add(valid_others[curr][2])
            curr = back_ptr[curr]

    clean_matched_new = {}
    clean_matched_old = {}
    for n_idx, o_idx in matched_new.items():
        if n_idx in keep_new:
            clean_matched_new[n_idx] = o_idx
            clean_matched_old[o_idx] = n_idx

    dropped = len(matched_new) - len(clean_matched_new)
    if dropped > 0:
        print(f"   [ANTI-JUMP] LIS memutus {dropped} cross-match "
              f"(Valve+Tee 100% dipertahankan sebagai Ground Truth).")

    return clean_matched_new, clean_matched_old


# ══════════════════════════════════════════════════════════════════════════════════
