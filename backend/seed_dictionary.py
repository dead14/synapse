import os
import sys
import pandas as pd
from sqlalchemy.orm import Session

# Add backend dir to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from models import engine, init_db, FieldSynonymDictionary, FeatureTypeSynonym

EXCEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "Parser ingestion.xlsx")

# Bridge mapping from Excel 'STD Code' to our database 'UNIVERSAL_COLS'
STD_CODE_TO_DB_COL = {
    "log_dist": "log_distance_m",
    "feat_num": "feature_id",
    "joint_num": "joint_number",
    "DIST_US_GW": "dist_to_us_gw_m",
    "JOINT_LEN": "joint_length_m",
    "FEAT_TYPE": "feature_type",
    "FEAT_IDENT": "feature_identification",
    "DIM_CLASS": "dim_classification",
    "CLOCK_POS": "clock_position",
    "NOM_WT": "wall_thickness_mm",
    "AXIAL_LEN": "length_mm",
    "CIRC_WIDTH": "width_mm",
    "DEPTH_PCT": "depth_pct",
    "SURF_LOC": "surface_location",
    "ERF": "erf_asme",
    "P_SAFE": "psafe_bar",
    "COMMENT": "comment"
}

def seed_database():
    print("Initializing Database tables...")
    init_db()

    print(f"Reading dictionary from {EXCEL_PATH}...")
    if not os.path.exists(EXCEL_PATH):
        print("ERROR: Parser ingestion.xlsx not found.")
        return

    with Session(engine) as session:
        # Clear existing tables (optional, but good for fresh seeding)
        session.query(FieldSynonymDictionary).delete()
        session.query(FeatureTypeSynonym).delete()
        
        # 1. FIELD SYNONYMS
        df_map = pd.read_excel(EXCEL_PATH, sheet_name='1. DATA FIELD MAP', header=1)
        vendor_cols = [c for c in df_map.columns if c not in ('#', 'Standard Field Name (STD)', 'STD Code', 'Unit', 'Notes / Description', 'Unnamed: 0')]
        
        field_count = 0
        for _, row in df_map.iterrows():
            std_code = str(row.get('STD Code', '')).strip()
            if not std_code or std_code == 'nan' or std_code.startswith('─'):
                continue
                
            db_col = STD_CODE_TO_DB_COL.get(std_code)
            if not db_col:
                continue

            for vendor in vendor_cols:
                synonym = str(row.get(vendor, '')).strip()
                if synonym and synonym != 'nan' and synonym != '—':
                    # Avoid duplicates
                    exists = session.query(FieldSynonymDictionary).filter_by(universal_column=db_col, known_synonym=synonym).first()
                    if not exists:
                        session.add(FieldSynonymDictionary(universal_column=db_col, known_synonym=synonym))
                        field_count += 1

        # 2. FEATURE TYPES
        df_feat = pd.read_excel(EXCEL_PATH, sheet_name='2. FEATURE TYPE', header=1)
        feat_count = 0
        for _, row in df_feat.iterrows():
            std_code = str(row.get('STD Code', '')).strip() # Short Code
            short_code_raw = str(row.get('Short Code\n(POF)', '')).strip()
            full_name = str(row.get('Full Name (English)', '')).strip()
            
            if not std_code or std_code == 'nan' or std_code.startswith('─'):
                continue
                
            if full_name and full_name != 'nan':
                synonyms = set()
                synonyms.add(std_code.lower())
                if short_code_raw and short_code_raw != 'nan':
                    synonyms.add(short_code_raw.lower())
                synonyms.add(full_name.lower())
                
                for syn in synonyms:
                    exists = session.query(FeatureTypeSynonym).filter_by(standard_name=full_name, known_synonym=syn).first()
                    if not exists:
                        session.add(FeatureTypeSynonym(standard_name=full_name, known_synonym=syn))
                        feat_count += 1
                        
        session.commit()
        print(f"Successfully seeded {field_count} field synonyms and {feat_count} feature type synonyms!")

if __name__ == "__main__":
    seed_database()
