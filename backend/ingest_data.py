import pandas as pd
import numpy as np
import time
from models import SessionLocal, ILIFeature, init_db

def clean_val(val):
    if pd.isna(val) or val == ' ' or val == '':
        return None
    return val

def ingest_file(filepath, year):
    print(f"Ingesting {filepath} for year {year}...")
    
    # Read the data sheet skipping the first 3 rows of headers/instructions
    # Actual columns start at row 3 (0-indexed 2)
    # The actual data starts at row 4 (0-indexed 3)
    df = pd.read_excel(filepath, sheet_name='ILI_DATA', skiprows=2)
    
    # The columns are now correctly loaded. Let's map them.
    # Note: Pandas might name the first column differently based on its content or unnamned columns.
    # We will map by index to be safe.
    
    session = SessionLocal()
    
    count = 0
    # Process row by row starting from index 1 (since index 0 is the sub-header row)
    for index, row in df.iterrows():
        if index == 0:
            continue # skip the subheader row
            
        # Extract columns by positional index
        # 0: Feature #
        # 1: Abs. distance (m)
        # 2: Joint number
        # 3: Dist. U/S GW (m)
        # 4: Joint length (m)
        # 5: Feature type *
        # 6: Feature identification
        # 7: Dimension classification
        # 8: Orientation o'clock
        # 9: Wall thickness (mm)
        # 10: Axial length (mm)
        # 11: Width (mm)
        # 12: Depth, % WT
        # 13: Location
        # 14: ERF ASME B31G
        # 15: Psafe ASME B31G (bar)
        # 16: Comments
        
        feature_id = str(clean_val(row.iloc[0]))
        abs_distance = clean_val(row.iloc[1])
        joint_num = str(clean_val(row.iloc[2])) if clean_val(row.iloc[2]) else None
        dist_us_gw = clean_val(row.iloc[3])
        joint_len = clean_val(row.iloc[4])
        feat_type = str(clean_val(row.iloc[5]))
        feat_id = str(clean_val(row.iloc[6])) if clean_val(row.iloc[6]) else None
        dim_class = str(clean_val(row.iloc[7])) if clean_val(row.iloc[7]) else None
        orientation = str(clean_val(row.iloc[8])) if clean_val(row.iloc[8]) else None
        
        wt = clean_val(row.iloc[9])
        length = clean_val(row.iloc[10])
        width = clean_val(row.iloc[11])
        depth = clean_val(row.iloc[12])
        
        loc = str(clean_val(row.iloc[13])) if clean_val(row.iloc[13]) else None
        erf = clean_val(row.iloc[14])
        psafe = clean_val(row.iloc[15])
        comments = str(clean_val(row.iloc[16])) if clean_val(row.iloc[16]) else None
        
        # Validation
        if abs_distance is None or feat_type == 'None':
            continue
            
        feature = ILIFeature(
            survey_year=year,
            feature_id=feature_id,
            abs_distance_m=float(abs_distance) if abs_distance is not None else None,
            joint_number=joint_num,
            dist_to_us_gw_m=float(dist_us_gw) if dist_us_gw is not None else None,
            joint_length_m=float(joint_len) if joint_len is not None else None,
            feature_type=feat_type,
            feature_identification=feat_id,
            dimension_classification=dim_class,
            orientation=orientation,
            wt_mm=float(wt) if wt is not None else None,
            length_mm=float(length) if length is not None else None,
            width_mm=float(width) if width is not None else None,
            depth_pct=float(depth) if depth is not None else None,
            location=loc,
            erf_b31g=float(erf) if erf is not None else None,
            psafe_b31g_bar=float(psafe) if psafe is not None else None,
            comments=comments
        )
        session.add(feature)
        count += 1
        
        if count % 1000 == 0:
            session.commit()
            print(f"Inserted {count} rows...")
            
    session.commit()
    session.close()
    print(f"Done ingesting {filepath}. Total rows: {count}")


if __name__ == "__main__":
    print("Initializing Database...")
    init_db()
    
    ingest_file(r"D:\Project PHM\Synapse\ILI_Data_2020.xlsx", 2020)
    ingest_file(r"D:\Project PHM\Synapse\ILI_Data_2025.xlsx", 2025)
    print("Ingestion Completed Successfully!")
