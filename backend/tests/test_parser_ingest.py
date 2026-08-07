import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker


PYTHON_ENGINES = Path(__file__).resolve().parents[1] / "src" / "python_engines"
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PYTHON_ENGINES))
sys.path.insert(0, str(REPOSITORY_ROOT))

import db_ingest
import seed_dictionary
from backend.engine.parser_dict import build_field_synonym_lookup
from models import Base, ILIFeature, Pipeline, SurveyRun


class ParserIngestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        field_records, _ = seed_dictionary.load_seed_records()
        cls.lookup = build_field_synonym_lookup(field_records)

    def test_styled_template_header_is_detected_from_synonyms(self):
        preview = pd.DataFrame(
            [
                ["ILI UNIVERSAL DATA TEMPLATE v2.1", None, None, None],
                ["Pipeline Name:", "CPA", "Vendor:", "Vendor X"],
                ["IDENTIFICATION", None, "FEATURE", None],
                ["Feature #", "Abs. distance (m)", "Joint number", "Feature type *"],
                [1, 0.0, 10, "Weld"],
            ]
        )

        header_index, matched_fields = db_ingest.detect_header_row(preview, self.lookup)

        self.assertEqual(header_index, 3)
        self.assertGreaterEqual(matched_fields, 4)

    def test_csv_source_is_read_once_for_preview_and_once_for_data(self):
        csv_text = "\n".join(
            [
                "ILI UNIVERSAL DATA TEMPLATE v2.1,,,,",
                "Pipeline Name:,CPA,Vendor:,Vendor X,",
                "IDENTIFICATION,,FEATURE,,",
                "Feature #,Abs. distance (m),Joint number,Feature type *,Depth [%]",
                "1,0,10,Weld,",
            ]
        )
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "styled.csv"
            source.write_text(csv_text, encoding="utf-8")
            original_read_csv = pd.read_csv
            with patch.object(db_ingest.pd, "read_csv", wraps=original_read_csv) as read_csv:
                frame, header_index, matched_fields = db_ingest.load_source_table(
                    source,
                    self.lookup,
                )

        self.assertEqual(read_csv.call_count, 2)
        self.assertEqual(header_index, 3)
        self.assertGreaterEqual(matched_fields, 5)
        self.assertEqual(len(frame), 1)
        self.assertIn("Abs. distance (m)", frame.columns)

    def test_normalization_reports_invalid_distance_rows_instead_of_silently_dropping(self):
        raw = pd.DataFrame(
            {
                "Feature #": [1, 2, 3],
                "Abs. distance (m)": [0.0, "not-a-distance", float("inf")],
                "Feature type *": ["WELD", "ANOM", "VALV"],
            }
        )
        field_map = db_ingest.auto_detect_field_map(raw.columns, self.lookup)

        normalized, audit = db_ingest.normalize_ingestion_frame(raw, field_map)

        self.assertEqual(len(normalized), 1)
        self.assertEqual(audit["source_rows"], 3)
        self.assertEqual(audit["accepted_rows"], 1)
        self.assertEqual(audit["rejected_rows"], 2)
        self.assertEqual(audit["rejection_reasons"], {"invalid_log_distance_m": 2})
        self.assertEqual(audit["quality_gate"]["status"], "REVIEW_REQUIRED")
        self.assertTrue(audit["quality_gate"]["requires_engineering_review"])

    def test_normalization_marks_out_of_range_depth_for_engineering_review(self):
        raw = pd.DataFrame(
            {
                "Feature #": [1],
                "Abs. distance (m)": [0.0],
                "Feature type *": ["Metal Loss"],
                "Depth [%]": [125],
            }
        )
        field_map = db_ingest.auto_detect_field_map(raw.columns, self.lookup)

        _, audit = db_ingest.normalize_ingestion_frame(raw, field_map)

        self.assertEqual(audit["quality_gate"]["status"], "REVIEW_REQUIRED")
        self.assertIn("depth_pct_out_of_range", audit["quality_gate"]["review_reasons"])

    def test_compact_feature_summary_counts_categories_without_returning_rows(self):
        summary = db_ingest.summarize_feature_counts(
            pd.DataFrame(
                {
                    "feature_type": [
                        "Metal Loss",
                        "Girth Weld",
                        "Valve",
                        "Tee",
                        "Offtake",
                        "Bend",
                        "Marker",
                    ]
                }
            )
        )

        self.assertEqual(
            summary,
            {
                "total": 7,
                "anomalies": 1,
                "welds": 1,
                "valves": 1,
                "tees": 1,
                "offtakes": 1,
                "bends": 1,
                "others": 1,
                # Welds, valves, tees and offtakes: dtw_engine normalises an
                # offtake to a tee, so it is a Tier-1 anchor there and the
                # intake summary must promise the same set.
                "gw_anchors": 4,
                "invalid_anchor_distances": 0,
            },
        )

    def test_header_without_absolute_distance_fails_clearly(self):
        preview = pd.DataFrame(
            [
                ["Inspection report", None],
                ["Feature #", "Feature type"],
            ]
        )

        with self.assertRaisesRegex(ValueError, "log_distance_m"):
            db_ingest.detect_header_row(preview, self.lookup)

    def test_extensionless_xlsx_from_multer_is_detected_by_file_signature(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "multer-generated-name"
            workbook = Workbook()
            sheet = workbook.active
            sheet.append(["ILI UNIVERSAL DATA TEMPLATE v2.1"])
            sheet.append(["Pipeline Name:", "CPA", "Vendor:", "Vendor X"])
            sheet.append(["IDENTIFICATION", None, "FEATURE", None])
            sheet.append(["Feature #", "Abs. distance (m)", "Joint number", "Feature type *"])
            sheet.append([1, 0.0, 10, "Weld"])
            workbook.save(source)

            frame, header_index, matched_fields = db_ingest.load_source_table(
                source,
                self.lookup,
            )

        self.assertEqual(header_index, 3)
        self.assertGreaterEqual(matched_fields, 4)
        self.assertEqual(len(frame), 1)

    def test_database_insert_failure_rolls_back_pipeline_run_and_features(self):
        database = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(database)
        local_session = sessionmaker(bind=database)
        csv_text = "\n".join(
            [
                "Feature #,Abs. distance (m),Joint number,Feature type *",
                "1,0,10,Weld",
            ]
        )

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "valid.csv"
            source.write_text(csv_text, encoding="utf-8")
            with (
                patch.object(db_ingest, "SessionLocal", local_session),
                patch.object(db_ingest, "load_field_synonym_lookup", return_value=self.lookup),
                patch.object(db_ingest, "load_feature_type_normalization", return_value={}),
                patch.object(db_ingest, "_insert_feature_batches", side_effect=RuntimeError("insert failed")),
            ):
                with self.assertRaisesRegex(RuntimeError, "insert failed"):
                    db_ingest.ingest_csv(source, "CPA", 2025, "Vendor X", 1)

        with Session(database) as session:
            self.assertEqual(session.query(Pipeline).count(), 0)
            self.assertEqual(session.query(SurveyRun).count(), 0)
            self.assertEqual(session.query(ILIFeature).count(), 0)

    def test_successful_ingestion_persists_parser_provenance_and_quality_audit(self):
        database = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(database)
        local_session = sessionmaker(bind=database)
        csv_text = "\n".join(
            [
                "Feature #,Abs. distance (m),Joint number,Feature type *,Depth [%]",
                "1,0,10,Weld,",
                "2,12.5,10,Metal Loss,18",
            ]
        )

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "vendor-export.csv"
            source.write_text(csv_text, encoding="utf-8")
            with (
                patch.object(db_ingest, "SessionLocal", local_session),
                patch.object(db_ingest, "load_field_synonym_lookup", return_value=self.lookup),
                patch.object(db_ingest, "load_feature_type_normalization", return_value={}),
            ):
                result = db_ingest.ingest_csv(
                    source,
                    "CPA",
                    2026,
                    "Vendor X",
                    7,
                    user_id=42,
                    source_name="vendor-export.csv",
                )

        with Session(database) as session:
            run = session.query(SurveyRun).one()
            self.assertEqual(run.uploaded_by, 42)
            self.assertEqual(run.parser_version, db_ingest.PARSER_VERSION)
            self.assertEqual(run.schema_version, db_ingest.SCHEMA_VERSION)
            self.assertEqual(run.ingestion_audit["source_rows"], 2)
            self.assertEqual(run.ingestion_audit["accepted_rows"], 2)
            self.assertEqual(run.ingestion_audit["recognized_header_fields"], 5)
            self.assertEqual(len(run.source_sha256), 64)

        self.assertEqual(result["parser_version"], db_ingest.PARSER_VERSION)
        self.assertEqual(result["schema_version"], db_ingest.SCHEMA_VERSION)
        self.assertEqual(result["source_sha256"], run.source_sha256)
        self.assertEqual(result["summary"]["total"], 2)
        self.assertEqual(result["summary"]["welds"], 1)
        self.assertEqual(result["summary"]["anomalies"], 1)


class FeatureClassificationTests(unittest.TestCase):
    """POF short codes must classify, not fall through to 'other'.

    Regression: the patterns were written as r"\\banom\\b" inside a raw
    string, which matches a literal backslash-b rather than a word boundary.
    Every vendor exporting short codes reported anomalies: 0, welds: 0.
    """

    def _summarize(self, labels):
        return db_ingest.summarize_feature_counts(
            pd.DataFrame({"feature_type": labels})
        )

    def test_pof_short_codes_are_classified(self):
        summary = self._summarize(
            ["ANOM", "ML", "COCL", "CORR", "GW", "VALV", "OFFT"]
        )
        self.assertEqual(summary["anomalies"], 4)
        self.assertEqual(summary["welds"], 1)
        self.assertEqual(summary["valves"], 1)
        self.assertEqual(summary["offtakes"], 1)
        self.assertEqual(summary["others"], 0)

    def test_long_form_labels_still_classify(self):
        summary = self._summarize(
            ["Metal Loss", "Corrosion", "Girth Weld", "Valve", "Offtake", "Tee", "Bend"]
        )
        self.assertEqual(summary["anomalies"], 2)
        self.assertEqual(summary["welds"], 1)
        self.assertEqual(summary["tees"], 1)
        self.assertEqual(summary["bends"], 1)

    def test_word_boundaries_still_exclude_substring_matches(self):
        # 'html' must not match \bml\b, 'gwen' must not match \bgw\b.
        summary = self._summarize(["html report", "gwen", "normalize"])
        self.assertEqual(summary["anomalies"], 0)
        self.assertEqual(summary["welds"], 0)
        self.assertEqual(summary["others"], 3)


class UnitDetectionTests(unittest.TestCase):
    """Units are read per mapped column, from that column's own header only."""

    def test_imperial_distance_detected_from_the_mapped_header(self):
        units = db_ingest.detect_source_units({"log_distance_m": ["Distance (ft)"]})
        self.assertEqual(units["log_distance_m"], "imperial")

    def test_metric_distance_detected_from_the_mapped_header(self):
        units = db_ingest.detect_source_units({"log_distance_m": ["Log Distance (m)"]})
        self.assertEqual(units["log_distance_m"], "metric")

    def test_imperial_dimensions_detected(self):
        units = db_ingest.detect_source_units({
            "length_mm": ["Length (in)"],
            "width_mm": ["Width (inches)"],
        })
        self.assertEqual(units["length_mm"], "imperial")
        self.assertEqual(units["width_mm"], "imperial")

    def test_no_units_when_headers_are_ambiguous(self):
        units = db_ingest.detect_source_units({
            "log_distance_m": ["Log Distance"],
            "length_mm": ["Length"],
        })
        self.assertIsNone(units["log_distance_m"])
        self.assertIsNone(units["length_mm"])

    def test_bare_english_words_in_and_ft_are_not_unit_tokens(self):
        units = db_ingest.detect_source_units({
            "length_mm": ["Length in axial direction"],
            "log_distance_m": ["Distance ft from launcher"],
        })
        self.assertIsNone(units["length_mm"])
        self.assertIsNone(units["log_distance_m"])

    def test_dotted_and_bracketed_imperial_tokens_are_explicit(self):
        units = db_ingest.detect_source_units({
            "length_mm": ["Length in."],
            "width_mm": ["Width [in]"],
            "log_distance_m": ["Chainage ft."],
        })
        self.assertEqual(units["length_mm"], "imperial")
        self.assertEqual(units["width_mm"], "imperial")
        self.assertEqual(units["log_distance_m"], "imperial")

    def test_explicit_metric_marker_in_the_same_header_wins(self):
        units = db_ingest.detect_source_units({
            "length_mm": ["Length [in] (mm)"],
            "wall_thickness_mm": ["Wall thickness in mm"],
        })
        self.assertEqual(units["length_mm"], "metric")
        self.assertEqual(units["wall_thickness_mm"], "metric")


class PerColumnUnitConversionTests(unittest.TestCase):
    """Unit tokens must come from the mapped column's own header.

    Regression: the imperial regexes were matched against every header joined
    into one string, and the imperial branch was tested before metric.  The
    bare English word "in" (header "Depth in % WT") converted
    wall/length/width by 25.4 even when those columns said "(mm)", and a
    stray "ft" in an unrelated column rescaled the whole odometer axis.
    """

    CASES = [
        {
            "name": "metric_vendor_headers_containing_the_word_in_stay_metric",
            "raw": {
                "Abs. Distance (m)": [100.0],
                "Wall Thickness (mm)": [10.0],
                "Length (mm)": [50.0],
                "Width (mm)": [30.0],
                "Depth in % WT": [12.0],
                "Feature Type": ["Metal Loss"],
            },
            "field_map": {
                "Abs. Distance (m)": "log_distance_m",
                "Wall Thickness (mm)": "wall_thickness_mm",
                "Length (mm)": "length_mm",
                "Width (mm)": "width_mm",
                "Depth in % WT": "depth_pct",
                "Feature Type": "feature_type",
            },
            "expected_conversions": {},
            "expected_values": {
                "log_distance_m": 100.0,
                "wall_thickness_mm": 10.0,
                "length_mm": 50.0,
                "width_mm": 30.0,
            },
        },
        {
            "name": "true_imperial_vendor_headers_convert",
            "raw": {
                "Distance (ft)": [100.0],
                "Length (in)": [4.0],
                "Width [in]": [2.0],
                "Wall Thickness in.": [0.5],
                "Feature Type": ["Metal Loss"],
            },
            "field_map": {
                "Distance (ft)": "log_distance_m",
                "Length (in)": "length_mm",
                "Width [in]": "width_mm",
                "Wall Thickness in.": "wall_thickness_mm",
                "Feature Type": "feature_type",
            },
            "expected_conversions": {
                "log_distance_m": "ft_to_m",
                "length_mm": "in_to_mm",
                "width_mm": "in_to_mm",
                "wall_thickness_mm": "in_to_mm",
            },
            "expected_values": {
                "log_distance_m": 100.0 * 0.3048,
                "length_mm": 4.0 * 25.4,
                "width_mm": 2.0 * 25.4,
                "wall_thickness_mm": 0.5 * 25.4,
            },
        },
        {
            "name": "mixed_units_convert_only_the_imperial_columns",
            "raw": {
                "Distance (ft)": [100.0],
                "Length (mm)": [50.0],
                "Feature Type": ["Metal Loss"],
            },
            "field_map": {
                "Distance (ft)": "log_distance_m",
                "Length (mm)": "length_mm",
                "Feature Type": "feature_type",
            },
            "expected_conversions": {"log_distance_m": "ft_to_m"},
            "expected_values": {
                "log_distance_m": 100.0 * 0.3048,
                "length_mm": 50.0,
            },
        },
        {
            "name": "stray_ft_in_an_unmapped_column_does_not_rescale_the_odometer",
            "raw": {
                "Log Distance (m)": [100.0],
                "Elevation ft": [30.0],
                "Feature Type": ["Weld"],
            },
            "field_map": {
                "Log Distance (m)": "log_distance_m",
                "Feature Type": "feature_type",
            },
            "expected_conversions": {},
            "expected_values": {"log_distance_m": 100.0},
        },
    ]

    def test_unit_conversion_uses_only_the_mapped_columns_own_header(self):
        for case in self.CASES:
            with self.subTest(case=case["name"]):
                raw = pd.DataFrame(case["raw"])
                universal, audit = db_ingest.normalize_ingestion_frame(raw, case["field_map"])
                self.assertEqual(audit["unit_conversions"], case["expected_conversions"])
                for field, expected in case["expected_values"].items():
                    self.assertAlmostEqual(universal[field].iloc[0], expected, places=4)

    def test_imperial_distance_conversion_applied(self):
        raw = pd.DataFrame({
            "Distance (ft)": [100.0, 200.0, 300.0],
            "Feature Type": ["Weld", "Metal Loss", "Weld"],
        })
        field_map = {"Distance (ft)": "log_distance_m", "Feature Type": "feature_type"}
        universal, audit = db_ingest.normalize_ingestion_frame(raw, field_map)
        self.assertAlmostEqual(universal["log_distance_m"].iloc[0], 100.0 * 0.3048, places=4)
        self.assertAlmostEqual(universal["log_distance_m"].iloc[2], 300.0 * 0.3048, places=4)
        self.assertEqual(audit["unit_conversions"]["log_distance_m"], "ft_to_m")
        self.assertEqual(audit["source_units"]["distances"], "imperial")

    def test_imperial_dimension_conversion_applied(self):
        raw = pd.DataFrame({
            "Log Distance (m)": [10.0, 20.0],
            "Length (inches)": [4.0, 6.0],
            "Feature Type": ["Metal Loss", "Metal Loss"],
        })
        field_map = {
            "Log Distance (m)": "log_distance_m",
            "Length (inches)": "length_mm",
            "Feature Type": "feature_type",
        }
        universal, audit = db_ingest.normalize_ingestion_frame(raw, field_map)
        self.assertAlmostEqual(universal["length_mm"].iloc[0], 4.0 * 25.4, places=4)
        self.assertEqual(audit["unit_conversions"]["length_mm"], "in_to_mm")

    def test_metric_data_is_not_converted(self):
        raw = pd.DataFrame({
            "Log Distance (m)": [100.0, 200.0],
            "Feature Type": ["Weld", "Metal Loss"],
        })
        field_map = {"Log Distance (m)": "log_distance_m", "Feature Type": "feature_type"}
        universal, audit = db_ingest.normalize_ingestion_frame(raw, field_map)
        self.assertAlmostEqual(universal["log_distance_m"].iloc[0], 100.0)
        self.assertEqual(audit["unit_conversions"], {})


if __name__ == "__main__":
    unittest.main()
