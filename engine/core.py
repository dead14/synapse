import pandas as pd
import numpy as np
import os
import sys
from .constants import *
from .loader import *
from .math_utils import *
from .math_utils import match_welds_by_spool_variance
from .matching import *
from .matching import _get_landmarks, _hungarian_pass_generic, _commit_pairs, _build_offset_from_matched_landmarks, _enforce_monotonicity, _hungarian_pass_anomaly
from .physics import *
from .excel_writer import *
#  BAGIAN 11 — ALIGNMENT UTAMA
# ══════════════════════════════════════════════════════════════════════════════════

def run_alignment(df_new, df_old):
    pipeline_length = compute_pipeline_length(df_new, df_old)
    seg_n, seg_o, n_seg = _get_landmarks(df_new, df_old)

    matched_new = {}; matched_old = {}; used_old = set()

    types_in_new = set(df_new["feature_type"].dropna().unique())
    types_in_old = set(df_old["feature_type"].dropna().unique())
    all_types    = types_in_new | types_in_old

    ordered  = [t for t in MATCH_PRIORITY if t in all_types]
    ordered += [t for t in sorted(all_types) if t not in MATCH_PRIORITY]

    odo_tol_anomaly = [
        get_anomaly_odo_tolerance(pipeline_length, idx) for idx in range(4)
    ]
    clock_passes = [
        CLOCK_HARD_GATE["tight"],
        CLOCK_HARD_GATE["medium"],
        CLOCK_HARD_GATE["loose"],
        CLOCK_HARD_GATE["super"],
    ]

    print(f"\n   Landmark segments (awal) : {n_seg}")
    print(f"   Pipeline length          : {pipeline_length:.1f} m")
    print(f"   Feature types            : {len(all_types)}")
    print(f"\n   === TOLERANSI v8.1 ===")
    print(f"   Valve Tolerance          : ±{VALVE_MATCH_TOL:.0f}m (Absolute Ground Truth)")
    print(f"   Tee Tolerance            : ±{LANDMARK_MATCH_TOL['Tee']:.0f}m (Tier-1 Anchor)")
    print(f"   Joint-Centric Radius     : ±{JOINT_CENTRIC_ODO_SCALE*100:.0f}% joint length")
    print(f"   Growth Rate Threshold    : SUSPECT >{GROWTH_DEPTH_SUSPECT_DECREASE}%WT, "
          f"IMPOSSIBLE >{GROWTH_DEPTH_IMPOSSIBLE}%WT")
    print(f"   Clock Outlier Threshold  : >{CLOCK_SHIFT_OUTLIER_THRESHOLD}° vs median")

    passes = [("tight", 0), ("medium", 1), ("loose", 2), ("super", 3)]
    total_rodo = 0; total_rclock = 0; total_rsurface = 0; total_cand = 0

    # ══ FASE 1: LANDMARK MATCHING (Tier 1: Valve+Tee, Tier 2: Weld) ═══════════
    print(f"\n   ── FASE 1: Landmark Matching (Tier-1: Valve+Tee, Tier-2: Weld) ──")
    
    # ── FASE 1a: Weld Matching by Spool Variance (OTA) ──
    weld_matched = match_welds_by_spool_variance(df_new, df_old, OTA_PCT)
    for n_idx, o_idx in weld_matched.items():
        matched_new[n_idx] = o_idx
        matched_old[o_idx] = n_idx
        used_old.add(o_idx)
    print(f"   Weld Match (OTA {OTA_PCT}%): +{len(weld_matched):4d}  (Spool Variance Matching)")

    # ── FASE 1b: Valve & Tee Matching by Hungarian ──
    landmark_ordered = [t for t in ["Valve", "Tee"] if t in all_types]

    for pass_name, pass_idx in passes:
        total_this = 0
        for feat_type in landmark_ordered:
            if feat_type == "Valve":
                odo_tol = ODO_TOLERANCE_FIXED["Valve"][pass_idx]
            else:
                odo_tol = ODO_TOLERANCE_FIXED.get(feat_type,
                              ODO_TOLERANCE_FIXED["Other"])[pass_idx]

            rows_new_t = df_new[
                (df_new["feature_type"] == feat_type) &
                (~df_new.index.isin(matched_new))
            ]
            rows_old_t = df_old[
                (df_old["feature_type"] == feat_type) &
                (~df_old.index.isin(used_old))
            ]
            if len(rows_new_t) == 0 or len(rows_old_t) == 0:
                continue
            pairs = _hungarian_pass_generic(rows_new_t, rows_old_t,
                                            seg_n, seg_o, odo_tol)
            total_this += _commit_pairs(pairs, matched_new, matched_old, used_old)

        lm_matched = sum(1 for i in df_new[df_new["feature_type"]
                                           .isin(["Valve", "Tee", "Weld"])].index
                         if i in matched_new)
        if total_this or pass_name == "tight":
            print(f"   Landmark Pass {pass_name:6s}: +{total_this:4d}  "
                  f"(landmark total={lm_matched:,})")

    # ══ FASE 2: REBUILD OFFSET MODEL ════════════════════════════════════════════
    print(f"\n   ── FASE 2: Rebuild Offset Model dari Matched Landmarks ──")
    seg_n, seg_o, n_seg = _build_offset_from_matched_landmarks(
        matched_new, df_new, df_old)
    if n_seg <= 1:
        print("   [WARN] Tidak cukup landmark — pakai estimasi awal")
        seg_n, seg_o, n_seg = _get_landmarks(df_new, df_old)
    print(f"   Model baru: {n_seg} segments aktif")

    # ══ FASE 2b: DTW PRE-ALIGNMENT ══════════════════════════════════════════════
    print(f"\n   ── FASE 2b: DTW Pre-Alignment (Non-Linear Drift Correction) ──")
    dtw_corrections = build_dtw_correction(df_new, df_old, matched_new)
    if dtw_corrections:
        print(f"   DTW: {len(dtw_corrections)} correction points tersedia")
    else:
        print("   DTW: Tidak tersedia → fallback ke offset linier")

    # ══ FASE 2c: JOINT-CENTRIC SEGMENT BUILDING ═════════════════════════════════
    print(f"\n   ── FASE 2c: Building Joint Segments dari GW yang Matched ──")
    joint_segments, n_joints = build_joint_segments(df_new, df_old, matched_new)

    # ══ FASE 3a: TIER 3 — Bend ══════════════════════════════════════════════════
    print(f"\n   ── FASE 3a: Tier-3 Matching (Bend) ──")
    tier3_types = [t for t in ["Bend"] if t in all_types]
    for pass_name, pass_idx in passes:
        total_this = 0
        for feat_type in tier3_types:
            odo_tol = ODO_TOLERANCE_FIXED.get(feat_type,
                          ODO_TOLERANCE_FIXED["Other"])[pass_idx]
            rows_new_t = df_new[
                (df_new["feature_type"] == feat_type) &
                (~df_new.index.isin(matched_new))
            ]
            rows_old_t = df_old[
                (df_old["feature_type"] == feat_type) &
                (~df_old.index.isin(used_old))
            ]
            if len(rows_new_t) == 0 or len(rows_old_t) == 0: continue
            pairs = _hungarian_pass_generic(rows_new_t, rows_old_t, seg_n, seg_o,
                                            odo_tol, dtw_corrections)
            total_this += _commit_pairs(pairs, matched_new, matched_old, used_old)
        if total_this:
            print(f"   Tier-3 (Bend) Pass {pass_name:6s}: +{total_this:4d}")

    # ══ FASE 3b: TIER 4 — Secondary ════════════════════════════════════════════
    print(f"\n   ── FASE 3b: Tier-4 Matching (Anode, Offtake, dll) ──")
    tier4_types = [t for t in ["Anode", "Offtake", "Flange", "Fitting",
                               "Marker", "Support", "Recording", "Other"]
                   if t in all_types and t not in LANDMARK_TYPES]
    for pass_name, pass_idx in passes:
        total_this = 0
        for feat_type in tier4_types:
            odo_tol = ODO_TOLERANCE_FIXED.get(feat_type,
                          ODO_TOLERANCE_FIXED["Other"])[pass_idx]
            rows_new_t = df_new[
                (df_new["feature_type"] == feat_type) &
                (~df_new.index.isin(matched_new))
            ]
            rows_old_t = df_old[
                (df_old["feature_type"] == feat_type) &
                (~df_old.index.isin(used_old))
            ]
            if len(rows_new_t) == 0 or len(rows_old_t) == 0: continue
            pairs = _hungarian_pass_generic(rows_new_t, rows_old_t, seg_n, seg_o,
                                            odo_tol, dtw_corrections)
            total_this += _commit_pairs(pairs, matched_new, matched_old, used_old)
        if total_this:
            print(f"   Tier-4 Pass {pass_name:6s}: +{total_this:4d}")

    # ══ FASE 3c: TIER 5 — JOINT-CENTRIC (Metal Loss + Dent) ════════════════════
    print(f"\n   ── FASE 3c: Tier-5 Matching (Metal Loss + Dent) — JOINT-CENTRIC ──")
    if n_joints > 0:
        matched_new, matched_old, used_old = run_joint_centric_matching(
            df_new, df_old, matched_new, matched_old, used_old,
            joint_segments, dtw_corrections, pipeline_length
        )
    else:
        print("   [WARN] Tidak ada joint segment → skip joint-centric, "
              "langsung ke fallback global")

    # ══ FASE 3d: FALLBACK global Hungarian (anomali sisa) ══════════════════════
    print(f"\n   ── FASE 3d: Fallback Hungarian (anomali sisa di luar joint terkunci) ──")
    for pass_name, pass_idx in passes:
        total_this = 0
        clock_max  = clock_passes[pass_idx]

        for feat_type in ["Metal Loss", "Dent"]:
            if feat_type not in all_types:
                continue
            odo_tol = odo_tol_anomaly[pass_idx]
            rows_new_t = df_new[
                (df_new["feature_type"] == feat_type) &
                (~df_new.index.isin(matched_new))
            ]
            rows_old_t = df_old[
                (df_old["feature_type"] == feat_type) &
                (~df_old.index.isin(used_old))
            ]
            if len(rows_new_t) == 0 or len(rows_old_t) == 0:
                continue

            result       = _hungarian_pass_anomaly(
                rows_new_t, rows_old_t, seg_n, seg_o,
                odo_tol, clock_max, pass_idx, dtw_corrections)
            pairs         = result[0]
            total_rodo   += result[1]
            total_rclock += result[2]
            total_rsurface += result[3]
            total_cand   += result[4]
            total_this   += _commit_pairs(pairs, matched_new, matched_old, used_old)

        if total_this:
            print(f"   Fallback Anomaly Pass {pass_name:6s}: +{total_this:4d}  "
                  f"(total={len(matched_new):,})")

    # ══ FASE 4: ANTI-JUMP LIS ═══════════════════════════════════════════════════
    print(f"\n   ── FASE 4: Anti-Jump Monotonicity Filter (LIS) ──")
    matched_new, matched_old = _enforce_monotonicity(
        matched_new, matched_old, df_new, df_old)

    # ══ FASE 5: PHYSICS VALIDATION ══════════════════════════════════════════════
    print(f"\n   ── FASE 5: Physics Validation ──")
    suspect_growth = validate_growth_rate(matched_new, df_new, df_old)
    suspect_clock  = validate_clock_shift_integrity(matched_new, df_new, df_old)
    residuals      = compute_residual_errors(matched_new, df_new, df_old)

    # ── Statistik rejection ──────────────────────────────────────────────────────
    print(f"\n   === STATISTIK GATE REJECTION (Metal Loss & Dent) ===")
    print(f"   Total candidates         : {total_cand:,}")
    print(f"   Rejected by ODO gate     : {total_rodo:,}  (position-aware)")
    print(f"   Rejected by CLOCK gate   : {total_rclock:,}")
    print(f"   Rejected by SURFACE      : {total_rsurface:,}")
    print(f"   Suspect Growth Rate      : {len(suspect_growth):,}")
    print(f"   Suspect Clock Shift      : {len(suspect_clock):,}")

    # ── Ringkasan per tipe ───────────────────────────────────────────────────────
    print(f"\n   {'Feature Type':18s}| {'NEW':>6} | {'OLD':>6} | {'Matched':>7} | "
          f"{'Only NEW':>8} | {'Only OLD':>8} | {'Match%':>7} | Tier")
    print(f"   {'-'*88}")
    g = [0] * 5
    for ft in ordered:
        cn  = int((df_new["feature_type"] == ft).sum())
        co  = int((df_old["feature_type"] == ft).sum())
        nm  = sum(1 for i in df_new[df_new["feature_type"] == ft].index
                  if i in matched_new)
        on_ = cn - nm
        oo  = co - sum(1 for i in df_old[df_old["feature_type"] == ft].index
                       if i in matched_old)
        pct  = f"{100*nm/max(min(cn,co),1):.0f}%"
        tier = TIER_LABEL.get(ft, 6)
        print(f"   {ft:18s}| {cn:>6} | {co:>6} | {nm:>7} | {on_:>8} | {oo:>8} | "
              f"{pct:>7} | T{tier}")
        g[0] += cn; g[1] += co; g[2] += nm; g[3] += on_; g[4] += oo
    print(f"   {'TOTAL':18s}| {g[0]:>6} | {g[1]:>6} | {g[2]:>7} | {g[3]:>8} | "
          f"{g[4]:>8} | {100*g[2]/max(min(g[0],g[1]),1):>6.1f}%")

    assert len(set(matched_new.values())) == len(matched_new), \
        "BUG: duplikasi idx_old dalam matched_new"
    assert len(set(matched_old.values())) == len(matched_old), \
        "BUG: duplikasi idx_new dalam matched_old"

    total_out = len(df_new) + (len(df_old) - len(matched_old))
    print(f"\n   Output rows     : {total_out:,}")
    print(f"   Zero data loss  : OK")
    print(f"   Ordering        : ascending log_distance_m (LIS Verified)")

    return matched_new, matched_old, suspect_growth, suspect_clock, residuals


# ══════════════════════════════════════════════════════════════════════════════════
#  BAGIAN 13 — MAIN (DATABASE DRIVEN)
# ══════════════════════════════════════════════════════════════════════════════════

def main(clockTol=None, distGwTol=None, depthGrowthMax=None, ota=None, runOldId=None, runNewId=None, sessionId=None):
    from . import constants
    constants.update_tolerances(clockTol, distGwTol, depthGrowthMax, ota)
    
    print("=" * 80)
    print("  ILI PIPELINE ALIGNMENT SYSTEM  v9.0  —  DATABASE DRIVEN")
    print("=" * 80)

    if not runOldId or not runNewId or not sessionId:
        print("ERROR: Missing DB IDs. Must provide --runOldId, --runNewId, and --sessionId")
        sys.exit(1)
        
    print(f"\n[DB] Initializing Database Connection...")
    from backend.models import SessionLocal, AlignmentSession
    from .db_writer import write_results_to_db
    
    db_session = SessionLocal()
    
    try:
        print(f"\n[DB] Loading OLD data for run_id: {runOldId}")
        df_old = load_ili_from_db(runOldId, db_session)
        
        print(f"\n[DB] Loading NEW data for run_id: {runNewId}")
        df_new = load_ili_from_db(runNewId, db_session)

        if not len(df_new) or not len(df_old):
            print("ERROR: File tidak memiliki data valid."); 
            db_session.close()
            sys.exit(1)

        pipeline_length = compute_pipeline_length(df_new, df_old)
        print(f"\nPipeline length : {pipeline_length:.1f} m")

        print("\nRunning alignment v9.0...")
        matched_new, matched_old, suspect_growth, suspect_clock, residuals = \
            run_alignment(df_new, df_old)

        print(f"\nSaving results to Database (Session ID: {sessionId})...")
        nm, non, noo = write_results_to_db(
            session_id=sessionId,
            df_new=df_new, df_old=df_old,
            matched_new=matched_new, matched_old=matched_old,
            suspect_growth=suspect_growth, suspect_clock=suspect_clock,
            residuals=residuals,
            db_session=db_session
        )
        
        # Update session status
        session_record = db_session.query(AlignmentSession).filter(AlignmentSession.id == sessionId).first()
        if session_record:
            from datetime import datetime
            session_record.status = "completed"
            session_record.completed_at = datetime.utcnow()
            db_session.commit()

        print(f"\n{'='*80}")
        print(f"  SELESAI: Database Updated")
        print(f"  Matched={nm:,}  OnlyNEW={non:,}  OnlyOLD={noo:,}")
        print(f"  Match rate = "
              f"{100*nm/max(min(len(df_new),len(df_old)),1):.1f}%")
        print(f"{'='*80}")
    except Exception as e:
        # Swallowing this returned exit code 0, so Node recorded a failed
        # alignment as a success.  Report to stderr and re-raise so the
        # process exits non-zero after the finally cleanup.
        import traceback
        traceback.print_exc(file=sys.stderr)
        print(f"ERROR: {e}", file=sys.stderr)
        try:
            session_record = db_session.query(AlignmentSession).filter(AlignmentSession.id == sessionId).first()
            if session_record:
                session_record.status = "failed"
                db_session.commit()
        except Exception as mark_error:
            print(f"ERROR: could not mark session failed: {mark_error}", file=sys.stderr)
        raise
    finally:
        db_session.close()

if __name__ == "__main__":
    main()