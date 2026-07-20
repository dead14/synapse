import sys
from pathlib import Path

import pandas as pd
from sqlalchemy.orm import Session


CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from models import (
    Base,
    FeatureTypeSynonym,
    FieldSynonymDictionary,
    engine,
    require_engine,
)


EXCEL_PATH = str(CURRENT_DIR.parents[2] / "Parser ingestion.xlsx")

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
    "COMMENT": "comment",
}

_STD_CODE_LOOKUP = {key.casefold(): value for key, value in STD_CODE_TO_DB_COL.items()}
_FIELD_METADATA_COLUMNS = {
    "#",
    "Standard Field Name (STD)",
    "STD Code",
    "Unit",
    "Notes / Description",
    "Unnamed: 0",
}


def _clean_cell(value):
    if pd.isna(value):
        return None
    cleaned = str(value).strip()
    if not cleaned or cleaned.casefold() in {"nan", "none"}:
        return None
    if cleaned in {"-", "\u2013", "\u2014"} or cleaned.startswith("\u2500"):
        return None
    return cleaned


def load_seed_records(workbook_path=EXCEL_PATH):
    workbook = Path(workbook_path).resolve()
    if not workbook.is_file():
        raise FileNotFoundError(f"Parser dictionary workbook not found: {workbook}")

    field_map = pd.read_excel(workbook, sheet_name="1. DATA FIELD MAP", header=1)
    vendor_columns = [
        column for column in field_map.columns if column not in _FIELD_METADATA_COLUMNS
    ]
    field_records = set()

    for _, row in field_map.iterrows():
        standard_code = _clean_cell(row.get("STD Code"))
        if not standard_code:
            continue
        universal_column = _STD_CODE_LOOKUP.get(standard_code.casefold())
        if not universal_column:
            continue

        aliases = {
            universal_column,
            _clean_cell(row.get("Standard Field Name (STD)")),
            *(_clean_cell(row.get(column)) for column in vendor_columns),
        }
        field_records.update(
            (universal_column, alias) for alias in aliases if alias is not None
        )

    feature_map = pd.read_excel(workbook, sheet_name="2. FEATURE TYPE", header=1)
    feature_records = set()
    for _, row in feature_map.iterrows():
        standard_name = _clean_cell(row.get("Full Name (English)"))
        if not standard_name:
            continue

        aliases = {
            _clean_cell(row.get("STD Code")),
            _clean_cell(row.get("Short Code\n(POF)")),
            standard_name,
        }
        feature_records.update(
            (standard_name, alias.casefold()) for alias in aliases if alias is not None
        )

    return (
        tuple(sorted(field_records, key=lambda item: (item[0], item[1].casefold()))),
        tuple(sorted(feature_records, key=lambda item: (item[0], item[1]))),
    )


def seed_database(database_engine=None, workbook_path=EXCEL_PATH):
    active_engine = database_engine or require_engine()
    Base.metadata.create_all(active_engine)
    field_records, feature_records = load_seed_records(workbook_path)

    with Session(active_engine) as session:
        existing_fields = {
            (item.universal_column.casefold(), item.known_synonym.casefold())
            for item in session.query(FieldSynonymDictionary).all()
        }
        existing_features = {
            (item.standard_name.casefold(), item.known_synonym.casefold())
            for item in session.query(FeatureTypeSynonym).all()
        }

        new_fields = [
            FieldSynonymDictionary(universal_column=universal, known_synonym=synonym)
            for universal, synonym in field_records
            if (universal.casefold(), synonym.casefold()) not in existing_fields
        ]
        new_features = [
            FeatureTypeSynonym(standard_name=standard, known_synonym=synonym)
            for standard, synonym in feature_records
            if (standard.casefold(), synonym.casefold()) not in existing_features
        ]

        session.add_all(new_fields)
        session.add_all(new_features)
        session.commit()

    return {
        "field_synonyms_added": len(new_fields),
        "feature_type_synonyms_added": len(new_features),
        "field_synonyms_available": len(field_records),
        "feature_type_synonyms_available": len(feature_records),
    }


if __name__ == "__main__":
    result = seed_database(engine)
    print(
        "Parser dictionary synchronized: "
        f"{result['field_synonyms_added']} field aliases and "
        f"{result['feature_type_synonyms_added']} feature aliases added."
    )
