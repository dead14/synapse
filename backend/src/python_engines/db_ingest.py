import argparse
import csv
import hashlib
import io
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from openpyxl import load_workbook


CURRENT_DIR = Path(__file__).resolve().parent
SRC_DIR = CURRENT_DIR.parent
BACKEND_DIR = SRC_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent
for module_path in (PROJECT_ROOT, SRC_DIR):
    if str(module_path) not in sys.path:
        sys.path.insert(0, str(module_path))

import engine.constants as constants
from backend.engine.parser_dict import (
    auto_detect_field_map,
    load_feature_type_normalization,
    load_field_synonym_lookup,
    normalize_field_name,
)
from engine.constants import UNIVERSAL_SCHEMA
from engine.loader import find_best_col, normalize_clock, normalize_feature_type, normalize_surface
from python_engines.models import ILIFeature, Pipeline, SessionLocal, SurveyRun, init_db


DATABASE_FIELDS = [
    field_name for field_name, *_ in UNIVERSAL_SCHEMA if not field_name.startswith("_")
]
NUMERIC_FIELDS = {
    "log_distance_m",
    "joint_number",
    "dist_to_us_gw_m",
    "joint_length_m",
    "wall_thickness_mm",
    "length_mm",
    "width_mm",
    "depth_pct",
    "erf_asme",
    "psafe_bar",
}
FLOAT_FIELDS = NUMERIC_FIELDS - {"joint_number"}
INSERT_BATCH_SIZE = 5_000
TRAILING_EMPTY_ROW_LIMIT = 256
XLSX_MAGIC = b"PK"
LEGACY_XLS_MAGIC = bytes.fromhex("D0CF11E0")
PARSER_VERSION = "agnostic-ili-parser-2026.07"
SCHEMA_VERSION = "universal-ili-v1"
QUALITY_GATE_VERSION = "ingestion-quality-gate-2026.07"

_IMPERIAL_DISTANCE_RE = re.compile(
    r"\b(?:ft|feet|foot)\b|(?<!\w)(?:\(ft\)|\(feet\))", re.IGNORECASE,
)
_IMPERIAL_DIMENSION_RE = re.compile(
    r"\b(?:in|inch|inches)\b|(?<!\w)(?:\(in\)|\(inch\)|\(inches\))", re.IGNORECASE,
)
_METRIC_DISTANCE_RE = re.compile(
    r"(?<!\w)\(m\)|(?<!\w)(?:meters?|metre)\b", re.IGNORECASE,
)
_METRIC_DIMENSION_RE = re.compile(
    r"(?<!\w)\(mm\)|(?<!\w)millimete?r", re.IGNORECASE,
)

DISTANCE_FIELDS = {"log_distance_m", "dist_to_us_gw_m", "joint_length_m"}
DIMENSION_FIELDS = {"wall_thickness_mm", "length_mm", "width_mm"}

FT_TO_M = 0.3048
IN_TO_MM = 25.4


def detect_source_units(raw_columns, field_map):
    """Infer the source unit system from column header text.

    Returns a dict ``{"distances": "imperial"|"metric"|None,
                       "dimensions": "imperial"|"metric"|None}``.
    """
    all_headers = " | ".join(str(c) for c in raw_columns)
    mapped_headers = " | ".join(str(c) for c in field_map.keys())
    combined = f"{all_headers} | {mapped_headers}"

    distances = None
    if _IMPERIAL_DISTANCE_RE.search(combined):
        distances = "imperial"
    elif _METRIC_DISTANCE_RE.search(combined):
        distances = "metric"

    dimensions = None
    if _IMPERIAL_DIMENSION_RE.search(combined):
        dimensions = "imperial"
    elif _METRIC_DIMENSION_RE.search(combined):
        dimensions = "metric"

    return {"distances": distances, "dimensions": dimensions}


def build_quality_gate(audit):
    """Return a conservative intake decision without approving engineering use."""
    review_reasons = []
    if int(audit.get("accepted_rows", 0)) == 0:
        return {
            "version": QUALITY_GATE_VERSION,
            "status": "BLOCKED",
            "requires_engineering_review": True,
            "review_reasons": ["no_accepted_rows"],
        }

    if int(audit.get("rejected_rows", 0)) > 0:
        review_reasons.append("rejected_source_rows")
    review_reasons.extend(
        f"numeric_coercion:{field}"
        for field, count in audit.get("numeric_coercions", {}).items()
        if int(count) > 0
    )
    review_reasons.extend(
        field
        for field, count in audit.get("quality_warnings", {}).items()
        if int(count) > 0
    )

    return {
        "version": QUALITY_GATE_VERSION,
        "status": "REVIEW_REQUIRED" if review_reasons else "READY_FOR_ENGINEERING_REVIEW",
        "requires_engineering_review": True,
        "review_reasons": review_reasons,
    }


def source_sha256(file_path, chunk_size=1024 * 1024):
    digest = hashlib.sha256()
    with Path(file_path).open("rb") as source:
        for chunk in iter(lambda: source.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _source_kind(file_path):
    path = Path(file_path)
    with path.open("rb") as source:
        magic = source.read(4)

    if magic.startswith(XLSX_MAGIC):
        return "excel"
    if magic.startswith(LEGACY_XLS_MAGIC):
        raise ValueError("Format .xls lama tidak didukung; simpan ulang sebagai .xlsx atau .csv.")
    if path.suffix.casefold() in {".xlsx", ".xlsm"}:
        return "excel"
    return "csv"


def detect_header_row(preview, synonym_lookup, max_scan=30):
    best_index = None
    best_fields = set()

    for index, row in enumerate(preview.head(max_scan).itertuples(index=False, name=None)):
        matched_fields = {
            synonym_lookup.get(normalize_field_name(value))
            for value in row
            if pd.notna(value)
        }
        matched_fields.discard(None)
        if "log_distance_m" in matched_fields and len(matched_fields) > len(best_fields):
            best_index = index
            best_fields = matched_fields

    if best_index is None or len(best_fields) < 2:
        raise ValueError(
            "Baris header tidak ditemukan: log_distance_m dan sedikitnya satu kolom ILI lain wajib dikenali."
        )

    return best_index, len(best_fields)


def _row_has_value(row):
    return any(value is not None and str(value).strip() != "" for value in row)


def _unique_headers(header_row):
    headers = []
    occurrences = {}
    for index, value in enumerate(header_row):
        base = str(value).strip() if value is not None and str(value).strip() else f"_col{index}"
        occurrence = occurrences.get(base, 0)
        occurrences[base] = occurrence + 1
        headers.append(base if occurrence == 0 else f"{base}.{occurrence}")
    return headers


def _load_xlsx_table(file_path, synonym_lookup, preview_rows):
    source = Path(file_path).open("rb")
    try:
        workbook = load_workbook(
            source,
            read_only=True,
            data_only=True,
            keep_links=False,
        )
    except Exception:
        source.close()
        raise

    try:
        selected = None
        for worksheet in workbook.worksheets:
            preview = []
            row_iterator = worksheet.iter_rows(values_only=True)
            for _ in range(preview_rows):
                try:
                    preview.append(tuple(next(row_iterator)))
                except StopIteration:
                    break
            if not preview:
                continue
            try:
                header_index, matched_fields = detect_header_row(
                    pd.DataFrame(preview),
                    synonym_lookup,
                    preview_rows,
                )
            except ValueError:
                continue
            if selected is None or matched_fields > selected[3]:
                selected = (worksheet, preview, header_index, matched_fields)

        if selected is None:
            raise ValueError("Tidak ada worksheet dengan header ILI yang dapat dikenali.")

        worksheet, preview, header_index, matched_fields = selected
        headers = _unique_headers(preview[header_index])
        data_rows = []
        trailing_empty_rows = 0

        for row_index, row in enumerate(worksheet.iter_rows(values_only=True)):
            if row_index <= header_index:
                continue
            values = tuple(row[: len(headers)])
            if _row_has_value(values):
                trailing_empty_rows = 0
                data_rows.append(values)
            else:
                trailing_empty_rows += 1
                if trailing_empty_rows >= TRAILING_EMPTY_ROW_LIMIT:
                    break

        return pd.DataFrame(data_rows, columns=headers), header_index, matched_fields
    finally:
        workbook.close()
        source.close()


def load_source_table(file_path, synonym_lookup, preview_rows=30):
    source_kind = _source_kind(file_path)
    if source_kind == "excel":
        raw, header_index, matched_fields = _load_xlsx_table(
            file_path,
            synonym_lookup,
            preview_rows,
        )
    else:
        preview = pd.read_csv(file_path, header=None, nrows=preview_rows)
        header_index, matched_fields = detect_header_row(preview, synonym_lookup, preview_rows)
        raw = pd.read_csv(file_path, header=header_index)

    raw = raw.dropna(how="all").reset_index(drop=True)
    raw.columns = [
        str(column).strip() if pd.notna(column) else f"_col{index}"
        for index, column in enumerate(raw.columns)
    ]
    if raw.empty:
        raise ValueError("File ILI tidak memiliki baris data setelah header.")
    return raw, header_index, matched_fields


def _nonempty_mask(series):
    return series.notna() & ~series.astype(str).str.strip().str.casefold().isin(
        {"", "nan", "none", "null", "n/a", "-"}
    )


def summarize_feature_counts(frame):
    """Build the wizard's small intake summary without exposing source rows."""
    feature_types = frame.get("feature_type", pd.Series(dtype="object"))
    labels = feature_types.fillna("").astype(str).str.casefold()
    categories = pd.Series("other", index=frame.index, dtype="object")

    # Keep the precedence consistent with the legacy browser parser: a metal
    # loss near a weld remains an anomaly, never an anchor.
    # NOTE: these must be single-backslash \b word boundaries.  Written as \\b
    # inside a raw string the pattern matches a *literal* backslash-b, so every
    # POF short code (ANOM, ML, COCL, GW, VALV, OFFT) silently fell through to
    # "other" and the wizard reported zero anomalies and zero welds.
    categories.loc[labels.str.contains(r"metal loss|corrosion|\banom\b|\bcocl\b|\bcorr\b|\bml\b", regex=True)] = "anomaly"
    categories.loc[(categories == "other") & labels.str.contains(r"weld|girth|seam|\bgw\b", regex=True)] = "weld"
    categories.loc[(categories == "other") & labels.str.contains(r"valve|\bvalv\b", regex=True)] = "valve"
    categories.loc[(categories == "other") & labels.str.contains(r"offtake|off take|\bofft\b", regex=True)] = "offtake"
    categories.loc[(categories == "other") & labels.str.contains(r"tee", regex=True)] = "tee"
    categories.loc[(categories == "other") & labels.str.contains(r"bend|elbow", regex=True)] = "bend"

    counts = categories.value_counts()
    welds = int(counts.get("weld", 0))
    valves = int(counts.get("valve", 0))
    tees = int(counts.get("tee", 0))
    return {
        "total": int(len(frame)),
        "anomalies": int(counts.get("anomaly", 0)),
        "welds": welds,
        "valves": valves,
        "tees": tees,
        "offtakes": int(counts.get("offtake", 0)),
        "bends": int(counts.get("bend", 0)),
        "others": int(counts.get("other", 0)),
        "gw_anchors": welds + valves + tees,
        # Invalid distances are rejected before a canonical run is persisted.
        "invalid_anchor_distances": 0,
    }


def normalize_ingestion_frame(raw, field_map):
    if raw.empty:
        raise ValueError("File ILI tidak memiliki baris data.")

    universal = pd.DataFrame(
        {field: pd.Series(pd.NA, index=raw.index, dtype="object") for field in DATABASE_FIELDS}
    )

    for raw_column, universal_column in field_map.items():
        if universal_column not in DATABASE_FIELDS or raw_column not in raw.columns:
            continue
        if universal[universal_column].isna().all():
            universal[universal_column] = raw[raw_column].copy()
        else:
            universal[universal_column] = universal[universal_column].combine_first(raw[raw_column])

    for universal_column in DATABASE_FIELDS:
        if _nonempty_mask(universal[universal_column]).any():
            continue
        matched_column, similarity = find_best_col(universal_column, raw.columns, 0.55)
        if matched_column is not None and similarity >= 0.55:
            universal[universal_column] = raw[matched_column]

    if not _nonempty_mask(universal["log_distance_m"]).any():
        raise ValueError("Kolom log_distance_m tidak berhasil dipetakan.")

    numeric_coercions = {}
    for field in NUMERIC_FIELDS:
        source_has_value = _nonempty_mask(universal[field])
        converted = pd.to_numeric(universal[field], errors="coerce")
        finite = converted.notna() & np.isfinite(converted)

        if field == "joint_number":
            integer = finite & np.isclose(converted.fillna(0), np.round(converted.fillna(0)))
            finite &= integer

        coerced_count = int((source_has_value & ~finite).sum())
        if coerced_count:
            numeric_coercions[field] = coerced_count
        universal[field] = converted.where(finite, np.nan)

    source_units = detect_source_units(raw.columns, field_map)
    unit_conversions = {}
    if source_units["distances"] == "imperial":
        for field in DISTANCE_FIELDS:
            mask = universal[field].notna()
            if mask.any():
                universal.loc[mask, field] = universal.loc[mask, field] * FT_TO_M
                unit_conversions[field] = "ft_to_m"
    if source_units["dimensions"] == "imperial":
        for field in DIMENSION_FIELDS:
            mask = universal[field].notna()
            if mask.any():
                universal.loc[mask, field] = universal.loc[mask, field] * IN_TO_MM
                unit_conversions[field] = "in_to_mm"

    universal["clock_position"] = universal["clock_position"].apply(
        lambda value: None if pd.isna(value) else normalize_clock(value)
    )
    universal["surface_location"] = universal["surface_location"].apply(
        lambda value: None if pd.isna(value) else normalize_surface(value)
    )
    feature_types = universal["feature_type"].values
    feature_identifications = universal["feature_identification"].values
    universal["feature_type"] = [
        normalize_feature_type(
            None if pd.isna(feature_types[index]) else feature_types[index],
            None if pd.isna(feature_identifications[index]) else feature_identifications[index],
        )
        for index in range(len(universal))
    ]

    valid_distance = universal["log_distance_m"].notna()
    rejected_rows = int((~valid_distance).sum())
    universal = universal.loc[valid_distance].copy()
    if universal.empty:
        raise ValueError("Tidak ada baris dengan log_distance_m numerik dan finite.")

    universal["joint_number"] = universal["joint_number"].apply(
        lambda value: int(value) if pd.notna(value) else None
    )
    universal = universal.sort_values("log_distance_m", kind="stable").reset_index(drop=True)

    quality_warnings = {}
    invalid_depth = universal["depth_pct"].notna() & ~universal["depth_pct"].between(0, 100)
    if invalid_depth.any():
        quality_warnings["depth_pct_out_of_range"] = int(invalid_depth.sum())

    audit = {
        "source_rows": int(len(raw)),
        "accepted_rows": int(len(universal)),
        "rejected_rows": rejected_rows,
        "rejection_reasons": {"invalid_log_distance_m": rejected_rows} if rejected_rows else {},
        "numeric_coercions": numeric_coercions,
        "unit_conversions": unit_conversions,
        "source_units": source_units,
        "quality_warnings": quality_warnings,
        "feature_counts": summarize_feature_counts(universal),
    }
    audit["quality_gate"] = build_quality_gate(audit)
    return universal, audit


def _database_value(field, value):
    if value is None or pd.isna(value):
        return None
    if field == "joint_number":
        return int(value)
    if field in FLOAT_FIELDS:
        return float(value)
    if field == "feature_id" and isinstance(value, (float, np.floating)) and value.is_integer():
        return str(int(value))
    cleaned = str(value).strip()
    return cleaned or None


def _insert_feature_batches(session, run_id, frame, batch_size=INSERT_BATCH_SIZE):
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        _copy_insert_features(session, run_id, frame, batch_size=batch_size)
        return

    for start in range(0, len(frame), batch_size):
        chunk = frame.iloc[start : start + batch_size]
        mappings = []
        for record in chunk.to_dict(orient="records"):
            mapping = {"run_id": run_id}
            mapping.update(
                {field: _database_value(field, record.get(field)) for field in DATABASE_FIELDS}
            )
            mappings.append(mapping)
        session.bulk_insert_mappings(ILIFeature, mappings, return_defaults=False)


def _copy_insert_features(session, run_id, frame, batch_size=INSERT_BATCH_SIZE):
    """Bulk-load normalized rows with PostgreSQL COPY, retaining a test fallback."""
    raw_connection = session.connection().connection
    copy_columns = ["run_id", *DATABASE_FIELDS]
    copy_sql = (
        f"COPY ili_features ({', '.join(copy_columns)}) "
        "FROM STDIN WITH (FORMAT CSV, NULL '\\N')"
    )
    cursor = raw_connection.cursor()
    try:
        for start in range(0, len(frame), batch_size):
            chunk = frame.iloc[start : start + batch_size]
            buffer = io.StringIO()
            writer = csv.writer(buffer, lineterminator="\n")
            for values in chunk.itertuples(index=False, name=None):
                record = dict(zip(DATABASE_FIELDS, values))
                row_values = [run_id]
                for field in DATABASE_FIELDS:
                    value = _database_value(field, record.get(field))
                    row_values.append(r"\N" if value is None else value)
                writer.writerow(row_values)
            buffer.seek(0)
            cursor.copy_expert(copy_sql, buffer)
    finally:
        cursor.close()


def ingest_csv(
    file_path,
    pipeline_name,
    survey_year,
    vendor,
    organization_id,
    user_id=None,
    source_name=None,
    source_object_key=None,
):
    synonym_lookup = load_field_synonym_lookup()
    if not synonym_lookup:
        error = RuntimeError("Kamus sinonim parser kosong; jalankan seed_dictionary.py terlebih dahulu.")
        error.code = "PARSER_DICTIONARY_UNAVAILABLE"
        raise error

    feature_type_map = load_feature_type_normalization()
    if feature_type_map:
        constants.FEATURE_TYPE_NORMALIZATION.update(feature_type_map)

    raw, header_index, matched_fields = load_source_table(file_path, synonym_lookup)
    field_map = auto_detect_field_map(raw.columns, synonym_lookup)
    normalized, audit = normalize_ingestion_frame(raw, field_map)
    audit.update(
        {
            "header_row": header_index + 1,
            "recognized_header_fields": matched_fields,
            "mapped_columns": len(field_map),
        }
    )

    checksum = source_sha256(file_path)
    session = SessionLocal()
    try:
        pipeline = session.query(Pipeline).filter(
            Pipeline.name == pipeline_name,
            Pipeline.organization_id == organization_id,
        ).first()
        if pipeline is None:
            pipeline = Pipeline(name=pipeline_name, organization_id=organization_id)
            session.add(pipeline)
            session.flush()

        run = SurveyRun(
            pipeline_id=pipeline.id,
            survey_year=survey_year,
            vendor=vendor,
            source_file=source_name or Path(file_path).name,
            source_object_key=source_object_key,
            source_sha256=checksum,
            uploaded_by=user_id,
            row_count=len(normalized),
            parser_version=PARSER_VERSION,
            schema_version=SCHEMA_VERSION,
            ingestion_audit=audit,
        )
        session.add(run)
        session.flush()

        _insert_feature_batches(session, run.id, normalized)
        session.commit()
        run_id = run.id
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    return {
        "status": "success",
        "run_id": run_id,
        "row_count": len(normalized),
        "summary": audit["feature_counts"],
        "audit": audit,
        "parser_version": PARSER_VERSION,
        "schema_version": SCHEMA_VERSION,
        "source_sha256": checksum,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--pipeline", required=True)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--vendor", required=True)
    parser.add_argument("--organization-id", type=int, required=True)
    parser.add_argument("--user-id", type=int, required=True)
    parser.add_argument("--source-name")
    parser.add_argument("--source-object-key")
    args = parser.parse_args()

    try:
        init_db()
        result = ingest_csv(
            args.file,
            args.pipeline,
            args.year,
            args.vendor,
            args.organization_id,
            user_id=args.user_id,
            source_name=args.source_name,
            source_object_key=args.source_object_key,
        )
        print("JSON_OUTPUT:" + json.dumps(result))
        return 0
    except Exception as error:
        payload = {"status": "error", "message": str(error)}
        error_code = getattr(error, "code", None)
        if error_code:
            payload["code"] = error_code
        print("JSON_OUTPUT:" + json.dumps(payload))
        return 1


if __name__ == "__main__":
    sys.exit(main())
