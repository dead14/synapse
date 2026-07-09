import json
import sys
import os
import argparse

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from backend.models import SessionLocal, AlignmentResult, ILIFeature

def main(session_id):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        db_session = SessionLocal()
        
        # Get all results for the session
        results = db_session.query(AlignmentResult).filter(AlignmentResult.session_id == session_id).all()
        
        comparison = []
        residuals = []
        
        for r in results:
            row = {}
            fn = r.feature_new
            fo = r.feature_old
            
            # Map NEW features
            row['Log Dist NEW (m)'] = fn.log_distance_m if fn else None
            row['Feature Type NEW'] = fn.feature_type if fn else None
            row['Identif. NEW'] = fn.feature_identification if fn else None
            row['Joint No. NEW'] = fn.joint_number if fn else None
            row['Joint Len NEW (m)'] = fn.joint_length_m if fn else None
            row['Dist GW NEW (m)'] = fn.dist_to_us_gw_m if fn else None
            row['Wall WT NEW (mm)'] = fn.wall_thickness_mm if fn else None
            row["O'Clock NEW"] = fn.clock_position if fn else None
            row['Length NEW (mm)'] = fn.length_mm if fn else None
            row['Width NEW (mm)'] = fn.width_mm if fn else None
            row['Depth NEW (%WT)'] = fn.depth_pct if fn else None
            row['Surface NEW'] = fn.surface_location if fn else None
            row['ERF ASME NEW'] = fn.erf_asme if fn else None
            row['Psafe NEW (bar)'] = fn.psafe_bar if fn else None
            row['Comment NEW'] = fn.comment if fn else None
            
            # Map OLD features
            row['Log Dist OLD (m)'] = fo.log_distance_m if fo else None
            row['Feature Type OLD'] = fo.feature_type if fo else None
            row['Identif. OLD'] = fo.feature_identification if fo else None
            row['Joint No. OLD'] = fo.joint_number if fo else None
            row['Joint Len OLD (m)'] = fo.joint_length_m if fo else None
            row['Dist GW OLD (m)'] = fo.dist_to_us_gw_m if fo else None
            row['Wall WT OLD (mm)'] = fo.wall_thickness_mm if fo else None
            row["O'Clock OLD"] = fo.clock_position if fo else None
            row['Length OLD (mm)'] = fo.length_mm if fo else None
            row['Width OLD (mm)'] = fo.width_mm if fo else None
            row['Depth OLD (%WT)'] = fo.depth_pct if fo else None
            row['Surface OLD'] = fo.surface_location if fo else None
            row['ERF ASME OLD'] = fo.erf_asme if fo else None
            row['Psafe OLD (bar)'] = fo.psafe_bar if fo else None
            row['Comment OLD'] = fo.comment if fo else None
            
            # Map Comparison
            row['Match Status'] = r.match_status
            row['Odo Diff (m) NEW-OLD'] = r.odo_diff
            row['Dist GW Δ NEW-OLD'] = r.gw_diff
            row["O'Clock Berubah?"] = "Ya" if r.clock_changed else ("Tidak" if r.clock_changed is False else None)
            row['Clock Δ (deg)'] = r.clock_diff_deg
            row['Depth Δ (%) NEW-OLD'] = r.depth_diff
            row['Length Δ(mm) NEW-OLD'] = r.length_diff
            row['Width Δ(mm) NEW-OLD'] = r.width_diff
            row['Surface Berubah?'] = "Ya" if r.surf_changed else ("Tidak" if r.surf_changed is False else None)
            row['Growth Rate Flag'] = r.growth_flag
            row['Clock Shift Integrity'] = r.clock_integrity
            
            comparison.append(row)
            
            if r.odo_diff is not None:
                residuals.append({
                    "Idx_NEW": fn.id,
                    "Idx_OLD": fo.id,
                    "odo_new": fn.log_distance_m,
                    "odo_old": fo.log_distance_m,
                    "odo_diff": r.odo_diff
                })
        
        print(json.dumps({
            "comparison": comparison,
            "residual": residuals
        }))
        db_session.close()
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sessionId", type=int, required=True)
    args = parser.parse_args()
    main(args.sessionId)
