import sys
import os
import argparse
import pandas as pd
import numpy as np

# Add parent directory to path so we can import engine and models
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.models import SessionLocal, Pipeline, SurveyRun, ILIFeature, init_db
from engine.constants import UNIVERSAL_COLS, UNIVERSAL_SCHEMA
from engine.loader import find_best_col, normalize_clock, normalize_surface, normalize_feature_type
from datetime import datetime

def _autodetect_header(path, field_map, max_scan=8):
    best_row, best_score = 0, -1
    is_excel = path.lower().endswith('.xlsx') or path.lower().endswith('.xls')
    for hr in range(max_scan):
        try:
            if is_excel:
                df_p = pd.read_excel(path, header=hr, nrows=1)
            else:
                df_p = pd.read_csv(path, header=hr, nrows=1)
            cols = [str(c) for c in df_p.columns]
            score = sum(find_best_col(mk, cols, 0.3)[1] for mk in field_map.keys())
            if score > best_score: 
                best_score, best_row = score, hr
        except: 
            continue
    return best_row, best_score

def ingest_csv(file_path, pipeline_name, survey_year, vendor):
    print(f"Ingesting CSV: {file_path}")
    
    session = SessionLocal()
    try:
        # Create or Get Pipeline
        pipeline = session.query(Pipeline).filter(Pipeline.name == pipeline_name).first()
        if not pipeline:
            pipeline = Pipeline(name=pipeline_name)
            session.add(pipeline)
            session.commit()
            
        # Create Survey Run
        run = SurveyRun(
            pipeline_id=pipeline.id,
            survey_year=survey_year,
            vendor=vendor,
            source_file=os.path.basename(file_path)
        )
        session.add(run)
        session.commit()
        run_id = run.id

        # Dummy field map since we don't have FIELD_MAP sheet in CSV
        # We'll use the UNIVERSAL_COLS as the field map itself to fuzzy match
        field_map = {c: c for c in UNIVERSAL_COLS}
        
        header_row, score = _autodetect_header(file_path, field_map)
        print(f"Detected header at row {header_row} with score {score}")

        if file_path.lower().endswith('.xlsx') or file_path.lower().endswith('.xls'):
            df_raw = pd.read_excel(file_path, header=header_row)
        else:
            df_raw = pd.read_csv(file_path, header=header_row)
            
        df_raw = df_raw.dropna(how="all").reset_index(drop=True)
        df_raw.columns = [str(c).strip() if pd.notna(c) else f"_col{i}" for i, c in enumerate(df_raw.columns)]
        
        n = len(df_raw)
        df_uni = pd.DataFrame({col: pd.Series([np.nan]*n) for col in UNIVERSAL_COLS})

        # Map columns
        for vc, uc in field_map.items():
            if uc not in UNIVERSAL_COLS: continue
            mc, sim = find_best_col(vc, df_raw.columns, 0.4)
            if mc:
                df_uni[uc] = df_raw[mc].values

        # Fallback for required columns
        for uc in UNIVERSAL_COLS[:17]:
            if df_uni[uc].notna().sum() > 0: continue
            for rc in df_raw.columns:
                _, s = find_best_col(uc, [rc], 0.5)
                if s >= 0.5:
                    df_uni[uc] = df_raw[rc].values
                    break

        # Normalize data
        df_uni["clock_position"] = df_uni["clock_position"].apply(normalize_clock)
        df_uni["surface_location"] = df_uni["surface_location"].apply(normalize_surface)
        ft = df_uni["feature_type"].values
        fi = df_uni["feature_identification"].values
        df_uni["feature_type"] = [normalize_feature_type(ft[i], fi[i]) for i in range(n)]

        # Drop invalid log_distance rows
        mask = pd.to_numeric(df_uni["log_distance_m"], errors="coerce").notna()
        df_uni = df_uni[mask].copy()
        df_uni["log_distance_m"] = pd.to_numeric(df_uni["log_distance_m"], errors="coerce")
        df_uni = df_uni.sort_values("log_distance_m", kind="stable").reset_index(drop=True)

        features = []
        for _, row in df_uni.iterrows():
            features.append(ILIFeature(
                run_id=run_id,
                feature_id=str(row["feature_id"]) if pd.notna(row["feature_id"]) else None,
                log_distance_m=float(row["log_distance_m"]) if pd.notna(row["log_distance_m"]) else None,
                joint_number=int(row["joint_number"]) if pd.notna(row["joint_number"]) else None,
                dist_to_us_gw_m=float(row["dist_to_us_gw_m"]) if pd.notna(row["dist_to_us_gw_m"]) else None,
                joint_length_m=float(row["joint_length_m"]) if pd.notna(row["joint_length_m"]) else None,
                feature_type=str(row["feature_type"]) if pd.notna(row["feature_type"]) else None,
                feature_identification=str(row["feature_identification"]) if pd.notna(row["feature_identification"]) else None,
                dim_classification=str(row["dim_classification"]) if pd.notna(row["dim_classification"]) else None,
                clock_position=str(row["clock_position"]) if pd.notna(row["clock_position"]) else None,
                wall_thickness_mm=float(row["wall_thickness_mm"]) if pd.notna(row["wall_thickness_mm"]) else None,
                length_mm=float(row["length_mm"]) if pd.notna(row["length_mm"]) else None,
                width_mm=float(row["width_mm"]) if pd.notna(row["width_mm"]) else None,
                depth_pct=float(row["depth_pct"]) if pd.notna(row["depth_pct"]) else None,
                surface_location=str(row["surface_location"]) if pd.notna(row["surface_location"]) else None,
                erf_asme=float(row["erf_asme"]) if pd.notna(row["erf_asme"]) else None,
                psafe_bar=float(row["psafe_bar"]) if pd.notna(row["psafe_bar"]) else None,
                comment=str(row["comment"]) if pd.notna(row["comment"]) else None
            ))

        # Bulk insert
        session.bulk_save_objects(features)
        
        # Update run stats
        run.row_count = len(features)
        session.commit()
        
        print(f"Successfully ingested {len(features)} records into DB for Run ID: {run_id}")
        import json
        print("JSON_OUTPUT:" + json.dumps({"status": "success", "run_id": run_id, "row_count": len(features)}))

    except Exception as e:
        session.rollback()
        import json
        print("JSON_OUTPUT:" + json.dumps({"status": "error", "message": str(e)}))
        sys.exit(1)
    finally:
        session.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--pipeline", required=True)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--vendor", required=True)
    args = parser.parse_args()
    
    init_db()
    ingest_csv(args.file, args.pipeline, args.year, args.vendor)
