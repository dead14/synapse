import pandas as pd
import numpy as np
import bisect
from .constants import *
#  BAGIAN 4 — HELPER FUNGSI
# ══════════════════════════════════════════════════════════════════════════════════

def _clock_to_deg(s):
    if s is None: return None
    try:
        p = str(s).split(":")
        h = int(p[0]) % 12
        m = int(p[1]) if len(p) > 1 else 0
        return h * 30 + m * 0.5
    except: return None

def _clock_diff(cn, co):
    an = _clock_to_deg(cn)
    ao = _clock_to_deg(co)
    if an is None or ao is None: return None
    d = abs(an - ao)
    return min(d, 360 - d)

def _sf(v):
    if v is None: return None
    try:
        f = float(v)
        return None if np.isnan(f) else f
    except: return None

def _sstr(v):
    if v is None: return None
    try:
        if isinstance(v, float) and np.isnan(v): return None
    except: pass
    s = str(v).strip()
    return None if s.lower() in ("nan", "none", "") else s

def _surface_compatible(sn, so):
    if sn is None or so is None: return True
    return sn == so

def compute_cost_ml(odo_diff, cn, co, dep_n, dep_o, len_n, len_o,
                    wid_n, wid_o, gw_n, gw_o, jlen_n, jlen_o, clock_gate_deg):
    cost = float(odo_diff)
    gn, go = _sf(gw_n), _sf(gw_o)
    if gn is not None and go is not None:
        cost += W["gw_max_penalty_m"] * (min(abs(gn - go), 2.0) / 2.0)
    cd = _clock_diff(cn, co)
    if cd is not None:
        cost += W["clock_max_penalty_m"] * min(cd / max(clock_gate_deg, 1.0), 1.0)
    dn, do_ = _sf(dep_n), _sf(dep_o)
    if dn is not None and do_ is not None:
        cost += W["depth_max_penalty_m"] * (min(abs(dn - do_), 50.0) / 50.0)
    ln, lo_ = _sf(len_n), _sf(len_o)
    if ln is not None and lo_ is not None:
        cost += W["length_max_penalty_m"] * (min(abs(ln - lo_), 400.0) / 400.0)
    wn, wo = _sf(wid_n), _sf(wid_o)
    if wn is not None and wo is not None:
        cost += W["width_max_penalty_m"] * (min(abs(wn - wo), 200.0) / 200.0)
    # Bonus jika panjang joint sangat mirip (<2% beda) → indikasi pipa yang sama
    jn, jo = _sf(jlen_n), _sf(jlen_o)
    if jn is not None and jo is not None and jn > 0 and jo > 0:
        jl_diff_pct = abs(jn - jo) / max(jn, jo)
        if jl_diff_pct < 0.02:
            cost -= W["joint_length_match_bonus"]
    return max(cost, 0.0)

def compute_cost_generic(odo_diff, rn, ro):
    cost = float(odo_diff)
    cd = _clock_diff(rn.get("clock_position"), ro.get("clock_position"))
    if cd is not None:
        cost += 2.0 * (cd / 180.0)
    gn = _sf(rn.get("dist_to_us_gw_m"))
    go = _sf(ro.get("dist_to_us_gw_m"))
    if gn is not None and go is not None:
        cost += W["gw_max_penalty_m"] * (min(abs(gn - go), 2.0) / 2.0)
    return cost


def match_welds_by_spool_variance(df_new, df_old, ota_pct):
    # Retrieve all Weld features ordered by distance
    welds_new = df_new[df_new["feature_type"] == "Weld"].sort_values("log_distance_m")
    welds_old = df_old[df_old["feature_type"] == "Weld"].sort_values("log_distance_m")
    
    if len(welds_new) == 0 or len(welds_old) == 0:
        return {}

    idx_n = welds_new.index.tolist()
    idx_o = welds_old.index.tolist()
    d_n = [float(v) for v in welds_new["log_distance_m"].values]
    d_o = [float(v) for v in welds_old["log_distance_m"].values]

    matched_new = {}
    
    # First GW is matched by default (benchmark anchor)
    matched_new[idx_n[0]] = idx_o[0]
    
    i = 1
    j = 1
    
    while i < len(d_o) and j < len(d_n):
        # Find the last matched pair
        last_n = idx_n[0]
        last_o = idx_o[0]
        for rev_j in range(j-1, -1, -1):
            if idx_n[rev_j] in matched_new:
                last_n = idx_n[rev_j]
                last_o = matched_new[last_n]
                break
                
        prev_n_val = df_new.at[last_n, "log_distance_m"]
        prev_o_val = df_old.at[last_o, "log_distance_m"]
        
        found_match = False
        # Search window ahead to recover from anomalies (simulating StepGwSimulator logic)
        for window in range(7):
            for di in range(window + 1):
                dj = window - di
                if i + di < len(d_o) and j + dj < len(d_n):
                    sOld = d_o[i + di] - prev_o_val
                    sNew = d_n[j + dj] - prev_n_val
                    
                    if sNew <= 0: continue
                    
                    v = abs((sOld / sNew) - 1.0) * 100.0
                    if v <= ota_pct:
                        # Found match!
                        matched_new[idx_n[j + dj]] = idx_o[i + di]
                        i += di + 1
                        j += dj + 1
                        found_match = True
                        break
            if found_match:
                break
                
        if not found_match:
            # Skip both if no valid pair found within window
            i += 1
            j += 1

    return matched_new


# ══════════════════════════════════════════════════════════════════════════════════
#  BAGIAN 5 — DTW PRE-ALIGNMENT
# ══════════════════════════════════════════════════════════════════════════════════

def dtw_joint_sequence(seq_new, seq_old, window=None):
    """
    Dynamic Time Warping untuk mencocokkan urutan jarak joint.

    Mendeteksi pola rangkaian joint yang mirip meski terjadi non-linear
    odometer drift (roda slip di area basah → satu segmen 'melar' di
    salah satu dataset).

    [FIX-2 v8.1]: Traceback menggunakan while loop dengan termination condition
    eksplisit — tidak bisa infinite loop karena selalu i atau j berkurang.
    """
    n, m = len(seq_new), len(seq_old)
    if n == 0 or m == 0:
        return [], 0.0

    # Normalisasi ke [0, 1] agar skala tidak dominan
    all_vals = seq_new + seq_old
    vmin = min(all_vals)
    vmax = max(all_vals)
    scale = vmax - vmin if vmax != vmin else 1.0
    sn = [(v - vmin) / scale for v in seq_new]
    so = [(v - vmin) / scale for v in seq_old]

    INF = float('inf')
    # Gunakan array 2D (n+1 x m+1) dengan boundary infinity
    dtw = [[INF] * (m + 1) for _ in range(n + 1)]
    dtw[0][0] = 0.0

    w = window if window else max(n, m)

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if window and abs(i - j) > w:
                continue
            c = abs(sn[i-1] - so[j-1])
            dtw[i][j] = c + min(dtw[i-1][j], dtw[i][j-1], dtw[i-1][j-1])

    # [FIX-2]: Traceback — selalu gerak ke (i-1, j-1), (i-1, j), atau (i, j-1)
    # Sehingga i+j selalu berkurang → tidak infinite
    path = []
    i, j = n, m
    while i > 0 or j > 0:
        path.append((i - 1, j - 1))
        if i == 0:
            j -= 1
        elif j == 0:
            i -= 1
        else:
            # Pilih arah dengan cost minimum
            v_diag = dtw[i-1][j-1]
            v_up   = dtw[i-1][j]
            v_left = dtw[i][j-1]
            m_val  = min(v_diag, v_up, v_left)
            if m_val == v_diag:
                i -= 1; j -= 1
            elif m_val == v_up:
                i -= 1
            else:
                j -= 1

    path.reverse()
    # Hapus entri dengan index negatif (bisa muncul dari i=0 atau j=0)
    path = [(a, b) for (a, b) in path if a >= 0 and b >= 0]

    total_cost = dtw[n][m]
    return path, total_cost


def build_dtw_correction(df_new, df_old, matched_new):
    """
    Bangun tabel koreksi odometer per segmen menggunakan DTW.

    Langkah:
    1. Ambil semua Landmark (GW/Valve/Tee) yang sudah matched di Fase 1.
    2. Jalankan DTW pada urutan landmark tersebut.
    3. Hitung offset lokal per segmen: interpolasi linier antara correction points.
    4. Return list of (d_new, offset) untuk fungsi dtw_correct_distance().
    """
    pts_new, pts_old = [], []
    for idx_n, idx_o in matched_new.items():
        ft = str(df_new.at[idx_n, "feature_type"])
        if ft not in LANDMARK_TYPES:
            continue
        d_n = _sf(df_new.at[idx_n, "log_distance_m"])
        d_o = _sf(df_old.at[idx_o, "log_distance_m"])
        if d_n is not None and d_o is not None:
            pts_new.append(d_n)
            pts_old.append(d_o)

    if len(pts_new) < 2:
        print("   [DTW] Tidak cukup landmark → skip DTW, pakai offset linier saja")
        return None

    # Sort berdasarkan NEW distance
    combined = sorted(zip(pts_new, pts_old), key=lambda x: x[0])
    seq_n = [p[0] for p in combined]
    seq_o = [p[1] for p in combined]

    # DTW window = 10% dari jumlah titik (heuristik pipeline)
    w = max(3, len(seq_n) // 10)
    path, cost = dtw_joint_sequence(seq_n, seq_o, window=w)

    # Bangun lookup: NEW_dist → offset (OLD_dist - NEW_dist)
    correction_pts = []
    for (i, j) in path:
        if i < len(seq_n) and j < len(seq_o):
            d_n = seq_n[i]
            d_o = seq_o[j]
            correction_pts.append((d_n, d_o - d_n))

    if not correction_pts:
        return None

    print(f"   [DTW] {len(correction_pts)} correction points | DTW cost={cost:.4f} "
          f"| window={w}")

    correction_pts.sort(key=lambda x: x[0])
    return correction_pts


def dtw_correct_distance(d, correction_pts):
    """
    Koreksi log_distance NEW menggunakan tabel DTW.
    Interpolasi linier antara dua correction_point terdekat.
    """
    if not correction_pts:
        return d

    xs = [p[0] for p in correction_pts]
    ys = [p[1] for p in correction_pts]  # offset = OLD - NEW

    if d <= xs[0]:
        return d + ys[0]
    if d >= xs[-1]:
        return d + ys[-1]

    idx = bisect.bisect_right(xs, d) - 1
    if idx >= len(xs) - 1:
        return d + ys[-1]

    x0, y0 = xs[idx],   ys[idx]
    x1, y1 = xs[idx+1], ys[idx+1]
    span = x1 - x0
    if span <= 0:
        return d + y0

    t = (d - x0) / span
    return d + (y0 + t * (y1 - y0))


# ══════════════════════════════════════════════════════════════════════════════════
