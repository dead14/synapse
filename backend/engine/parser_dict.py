import re
import sys
import unicodedata
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = BACKEND_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from python_engines.models import (
    FeatureTypeSynonym,
    FieldSynonymDictionary,
    SessionLocal,
)


def normalize_field_name(value):
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(character for character in text if not unicodedata.combining(character))
    text = text.replace("%", " percent ").replace("&", " and ")
    return re.sub(r"[^\w]+", " ", text, flags=re.UNICODE).replace("_", " ").strip().casefold()


def build_field_synonym_lookup(records):
    candidates = {}
    for record in records:
        if isinstance(record, (tuple, list)):
            universal_column, known_synonym = record[:2]
        else:
            universal_column = record.universal_column
            known_synonym = record.known_synonym

        normalized = normalize_field_name(known_synonym)
        if normalized:
            candidates.setdefault(normalized, set()).add(str(universal_column))

    return {
        synonym: next(iter(universal_columns))
        for synonym, universal_columns in candidates.items()
        if len(universal_columns) == 1
    }


def load_field_synonym_lookup():
    with SessionLocal() as session:
        synonyms = session.query(FieldSynonymDictionary).all()
    return build_field_synonym_lookup(synonyms)


def auto_detect_field_map(df_columns, synonym_lookup=None):
    lookup = synonym_lookup if synonym_lookup is not None else load_field_synonym_lookup()
    mapping = {}
    claimed_universal_columns = set()

    for column in df_columns:
        universal_column = lookup.get(normalize_field_name(column))
        if universal_column and universal_column not in claimed_universal_columns:
            mapping[str(column)] = universal_column
            claimed_universal_columns.add(universal_column)

    return mapping


def load_feature_type_normalization():
    with SessionLocal() as session:
        synonyms = session.query(FeatureTypeSynonym).all()
    return {
        str(synonym.known_synonym).strip().casefold(): synonym.standard_name
        for synonym in synonyms
        if str(synonym.known_synonym).strip()
    }
