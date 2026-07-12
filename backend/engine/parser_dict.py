import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sqlalchemy.orm import Session
from models import SessionLocal, FieldSynonymDictionary, FeatureTypeSynonym

def auto_detect_field_map(df_columns):
    """
    Takes a list of raw column headers from the uploaded file and checks
    the FieldSynonymDictionary in PostgreSQL for known synonyms.
    Returns a mapping dict: {'raw_col_name': 'universal_column'}
    """
    mapping = {}
    with SessionLocal() as session:
        # Load all field synonyms into memory (small table)
        synonyms = session.query(FieldSynonymDictionary).all()
        synonym_map = {}
        for syn in synonyms:
            # lowercased for case-insensitive matching
            synonym_map[syn.known_synonym.lower()] = syn.universal_column

        for col in df_columns:
            col_lower = str(col).strip().lower()
            if col_lower in synonym_map:
                mapping[str(col)] = synonym_map[col_lower]
                
    print(f"   [INFO] Auto-detected {len(mapping)} columns from Synonym Dictionary.")
    return mapping

def load_feature_type_normalization():
    """
    Queries FeatureTypeSynonym from PostgreSQL and builds a normalization dictionary
    mapping aliases to Standard Full Names.
    """
    with SessionLocal() as session:
        synonyms = session.query(FeatureTypeSynonym).all()
        norm_dict = {}
        for syn in synonyms:
            norm_dict[syn.known_synonym.lower()] = syn.standard_name
        
    return norm_dict
