import pandas as pd
import numpy as np
from .constants import *
from .math_utils import _sf, _clock_diff

#  BAGIAN 10 — PHYSICS VALIDATION
# ══════════════════════════════════════════════════════════════════════════════════

def validate_growth_rate(matched_new, df_new, df_old):
    """
    GROWTH RATE CHECK:
    Korosi seharusnya tumbuh atau stabil, tidak tiba-tiba mengecil (kecuali
    ada perbaikan/sleeve). Penurunan depth yang drastis adalah sinyal false match.
    """
    suspect_pairs = {}

    for idx_n, idx_o in matched_new.items():
        ft_n = str(df_new.at[idx_n, "feature_type"])
        if ft_n not in ANOMALY_TYPES:
            continue

        dep_n = _sf(df_new.at[idx_n, "depth_pct"])
        dep_o = _sf(df_old.at[idx_o, "depth_pct"])

        if dep_n is None or dep_o is None:
            continue

        depth_change = dep_n - dep_o  # negatif = depth mengecil

        comment_n = _sstr(df_new.at[idx_n, "comment"]) or ""
        comment_o = _sstr(df_old.at[idx_o, "comment"]) or ""
        has_repair = any(kw in (comment_n + comment_o).lower()
                         for kw in ["sleeve", "repair", "repa", "clamp", "fitting",
                                    "rehabilit", "patch"])

        if has_repair:
            continue

        if depth_change < -GROWTH_DEPTH_IMPOSSIBLE:
            reason = (f"IMPOSSIBLE_DECREASE: {dep_o:.1f}%→{dep_n:.1f}% "
                      f"(Δ={depth_change:.1f}%WT)")
            suspect_pairs[idx_n] = (idx_o, depth_change, reason)
        elif depth_change < -GROWTH_DEPTH_SUSPECT_DECREASE:
            reason = (f"SUSPECT_DECREASE: {dep_o:.1f}%→{dep_n:.1f}% "
                      f"(Δ={depth_change:.1f}%WT)")
            suspect_pairs[idx_n] = (idx_o, depth_change, reason)

    if suspect_pairs:
        impossible = sum(1 for v in suspect_pairs.values() if "IMPOSSIBLE" in v[2])
        suspect    = len(suspect_pairs) - impossible
        print(f"   [GROWTH RATE] {len(suspect_pairs)} pair di-flag: "
              f"{impossible} IMPOSSIBLE + {suspect} SUSPECT_DECREASE")
    else:
        print("   [GROWTH RATE] Semua pair lolos validasi fisika")

    return suspect_pairs


def validate_clock_shift_integrity(matched_new, df_new, df_old):
    """
    CLOCK SHIFT INTEGRITY CHECK:
    Pergeseran orientasi (clock) seharusnya konsisten secara lokal.
    Jika satu anomali bergeser berlawanan arah dengan tetangganya,
    kemungkinan besar itu adalah false match.
    """
    clock_suspect = {}

    shifts = []
    for idx_n, idx_o in matched_new.items():
        ft_n = str(df_new.at[idx_n, "feature_type"])
        if ft_n not in ANOMALY_TYPES:
            continue
        cn = df_new.at[idx_n, "clock_position"]
        co = df_old.at[idx_o, "clock_position"]
        cd = _clock_diff(cn, co)
        if cd is None:
            continue
        d_n = _sf(df_new.at[idx_n, "log_distance_m"])
        if d_n is None:
            continue
        an = _clock_to_deg(cn)
        ao = _clock_to_deg(co)
        if an is None or ao is None:
            continue
        signed_shift = an - ao
        while signed_shift >  180: signed_shift -= 360
        while signed_shift < -180: signed_shift += 360
        shifts.append((d_n, signed_shift, idx_n, idx_o))

    if len(shifts) < CLOCK_SHIFT_NEIGHBOR_WINDOW * 2:
        print(f"   [CLOCK INTEGRITY] Data terlalu sedikit ({len(shifts)}) → skip")
        return clock_suspect

    shifts.sort(key=lambda x: x[0])
    shift_vals = [s[1] for s in shifts]
    w = CLOCK_SHIFT_NEIGHBOR_WINDOW

    for i, (d_n, my_shift, idx_n, idx_o) in enumerate(shifts):
        lo = max(0, i - w)
        hi = min(len(shifts), i + w + 1)
        neighbor_shifts = shift_vals[lo:i] + shift_vals[i+1:hi]
        if len(neighbor_shifts) < 3:
            continue
        local_median = float(np.median(neighbor_shifts))
        deviation = abs(my_shift - local_median)
        if deviation > CLOCK_SHIFT_OUTLIER_THRESHOLD:
            reason = (f"CLOCK_OUTLIER: shift={my_shift:.1f}° "
                      f"local_median={local_median:.1f}° "
                      f"deviation={deviation:.1f}°")
            clock_suspect[idx_n] = (idx_o, my_shift, local_median, reason)

    if clock_suspect:
        print(f"   [CLOCK INTEGRITY] {len(clock_suspect)} pair di-flag "
              f"sebagai clock-shift outlier")
    else:
        print("   [CLOCK INTEGRITY] Semua clock shift dalam rentang konsisten lokal")

    return clock_suspect


def compute_residual_errors(matched_new, df_new, df_old):
    """
    Hitung Delta Odometer (NEW - OLD) untuk setiap matched pair.
    Digunakan untuk debugging misalignment lokal di sheet Residual_Plot.
    """
    residuals = []
    for idx_n, idx_o in matched_new.items():
        d_n = _sf(df_new.at[idx_n, "log_distance_m"])
        d_o = _sf(df_old.at[idx_o, "log_distance_m"])
        if d_n is not None and d_o is not None:
            ft = str(df_new.at[idx_n, "feature_type"])
            residuals.append({
                "log_dist_new": d_n,
                "delta_odo":    round(d_n - d_o, 4),
                "feature_type": ft,
            })
    residuals.sort(key=lambda x: x["log_dist_new"])
    return residuals


# ══════════════════════════════════════════════════════════════════════════════════
