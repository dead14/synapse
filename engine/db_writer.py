import sys
import os
import pandas as pd

# Ensure backend models can be imported
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def _safe(v):
    if v is None: return None
    try:
        if pd.isna(v): return None
    except: pass
    return v

def _diff(a, b):
    sa, sb = _safe(a), _safe(b)
    if sa is None or sb is None: return None
    try: return round(float(sa) - float(sb), 4)
    except: return None

def write_results_to_db(session_id, df_new, df_old, matched_new, matched_old, suspect_growth, suspect_clock, residuals, db_session):
    from backend.models import AlignmentResult
    
    print(f"\n   [DB WRITER] Menyimpan hasil ke database untuk sesi: {session_id}...")
    
    # 1. Bersihkan hasil lama jika ada (idempotent)
    db_session.query(AlignmentResult).filter(AlignmentResult.session_id == session_id).delete()
    db_session.commit()
    
    results_to_insert = []
    
    # PRE-COMPUTE ODO RESIDUALS (sama seperti excel_writer.py)
    res_map = {}
    for r in residuals:
        on_, oo_ = r["odo_new"], r["odo_old"]
        rn, ro = None, None
        if on_ is not None:
            c = df_new[df_new["log_distance_m"] == on_]
            if len(c): rn = c.index[0]
        if oo_ is not None:
            c = df_old[df_old["log_distance_m"] == oo_]
            if len(c): ro = c.index[0]
        if rn is not None and ro is not None:
            res_map[(rn, ro)] = r
            
    def calc_delta(idx_n, idx_o):
        r1 = df_new.loc[idx_n]
        r2 = df_old.loc[idx_o]
        
        odo_diff = _diff(r1["log_distance_m"], r2["log_distance_m"])
        gw_diff = _diff(r1["dist_to_us_gw_m"], r2["dist_to_us_gw_m"])
        
        c1, c2 = _safe(r1["clock_position"]), _safe(r2["clock_position"])
        clock_changed = (c1 != c2) if (c1 and c2) else None
        
        clock_diff_deg = None
        if (idx_n, idx_o) in res_map:
            clock_diff_deg = res_map[(idx_n, idx_o)]["clock_diff"]
            
        depth_diff = _diff(r1["depth_pct"], r2["depth_pct"])
        length_diff = _diff(r1["length_mm"], r2["length_mm"])
        width_diff = _diff(r1["width_mm"], r2["width_mm"])
        
        s1, s2 = _safe(r1["surface_location"]), _safe(r2["surface_location"])
        surf_changed = (str(s1).lower() != str(s2).lower()) if (s1 and s2) else None
        
        growth_flag = None
        if idx_n in suspect_growth:
            growth_flag = suspect_growth[idx_n]
            
        clock_integrity = None
        if idx_n in suspect_clock:
            clock_integrity = "FLAG: Clock outlier"
            
        return {
            "odo_diff": odo_diff,
            "gw_diff": gw_diff,
            "clock_changed": clock_changed,
            "clock_diff_deg": clock_diff_deg,
            "depth_diff": depth_diff,
            "length_diff": length_diff,
            "width_diff": width_diff,
            "surf_changed": surf_changed,
            "growth_flag": growth_flag,
            "clock_integrity": clock_integrity
        }

    # MATCHED
    for idx_n, idx_o in matched_new.items():
        delta = calc_delta(idx_n, idx_o)
        
        db_id_new = int(df_new.loc[idx_n, "_db_id"])
        db_id_old = int(df_old.loc[idx_o, "_db_id"])
        
        results_to_insert.append(AlignmentResult(
            session_id=session_id,
            feature_new_id=db_id_new,
            feature_old_id=db_id_old,
            match_status="Matched",
            **delta
        ))
        
    # ONLY NEW
    for idx_n in df_new.index:
        if idx_n not in matched_new:
            db_id_new = int(df_new.loc[idx_n, "_db_id"])
            results_to_insert.append(AlignmentResult(
                session_id=session_id,
                feature_new_id=db_id_new,
                feature_old_id=None,
                match_status="New in Run 2",
                odo_diff=None, gw_diff=None, clock_changed=None, clock_diff_deg=None,
                depth_diff=None, length_diff=None, width_diff=None, surf_changed=None,
                growth_flag=None, clock_integrity=None
            ))
            
    # ONLY OLD
    for idx_o in df_old.index:
        if idx_o not in matched_old:
            db_id_old = int(df_old.loc[idx_o, "_db_id"])
            results_to_insert.append(AlignmentResult(
                session_id=session_id,
                feature_new_id=None,
                feature_old_id=db_id_old,
                match_status="Missing in Run 2",
                odo_diff=None, gw_diff=None, clock_changed=None, clock_diff_deg=None,
                depth_diff=None, length_diff=None, width_diff=None, surf_changed=None,
                growth_flag=None, clock_integrity=None
            ))
            
    # Bulk insert
    if results_to_insert:
        db_session.bulk_save_objects(results_to_insert)
        db_session.commit()
        
    print(f"   [DB WRITER] Sukses menyimpan {len(results_to_insert)} baris hasil alignment.")
    
    return len(matched_new), len(df_new) - len(matched_new), len(df_old) - len(matched_old)
