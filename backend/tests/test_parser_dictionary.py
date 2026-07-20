import sys
import unittest
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session


PYTHON_ENGINES = Path(__file__).resolve().parents[1] / "src" / "python_engines"
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PYTHON_ENGINES))
sys.path.insert(0, str(REPOSITORY_ROOT))

import seed_dictionary
from models import FeatureTypeSynonym, FieldSynonymDictionary
from engine.loader import normalize_feature_type


class ParserDictionaryTests(unittest.TestCase):
    def test_feature_type_fuzzy_aliases_normalize_to_canonical_metal_loss(self):
        self.assertEqual(normalize_feature_type("Anomaly (General)"), "Metal Loss")
        self.assertEqual(normalize_feature_type("metal-loss"), "Metal Loss")
        self.assertEqual(normalize_feature_type("corosion"), "Metal Loss")

    def test_dictionary_workbook_resolves_to_the_repository_root(self):
        workbook = Path(seed_dictionary.EXCEL_PATH).resolve()

        self.assertTrue(workbook.is_file())
        self.assertEqual(workbook.name, "Parser ingestion.xlsx")
        self.assertEqual(workbook.parent, Path(__file__).resolve().parents[2])

    def test_dictionary_records_cover_representative_vendor_fields_and_feature_types(self):
        field_records, feature_records = seed_dictionary.load_seed_records()

        self.assertGreaterEqual(len(field_records), 60)
        self.assertIn(("log_distance_m", "Absolute Distance, m"), field_records)
        self.assertIn(("log_distance_m", "log. distance"), field_records)
        self.assertIn(("feature_type", "component/anomaly type"), field_records)

        self.assertGreaterEqual(len(feature_records), 30)
        self.assertIn(("Girth Weld", "weld"), feature_records)
        self.assertIn(("Anomaly (General)", "anom"), feature_records)

    def test_dictionary_records_are_unique_and_repeatable(self):
        first = seed_dictionary.load_seed_records()
        second = seed_dictionary.load_seed_records()

        self.assertEqual(first, second)
        self.assertEqual(len(first[0]), len(set(first[0])))
        self.assertEqual(len(first[1]), len(set(first[1])))

    def test_database_sync_is_idempotent_and_preserves_custom_aliases(self):
        database = create_engine("sqlite+pysqlite:///:memory:")
        seed_dictionary.Base.metadata.create_all(database)
        with Session(database) as session:
            session.add(
                FieldSynonymDictionary(
                    universal_column="log_distance_m",
                    known_synonym="Customer Stationing",
                )
            )
            session.commit()

        first = seed_dictionary.seed_database(database)
        second = seed_dictionary.seed_database(database)

        self.assertGreater(first["field_synonyms_added"], 0)
        self.assertGreater(first["feature_type_synonyms_added"], 0)
        self.assertEqual(second["field_synonyms_added"], 0)
        self.assertEqual(second["feature_type_synonyms_added"], 0)

        with Session(database) as session:
            self.assertEqual(
                session.query(FieldSynonymDictionary)
                .filter_by(known_synonym="Customer Stationing")
                .count(),
                1,
            )
            self.assertEqual(
                session.query(FeatureTypeSynonym).count(),
                first["feature_type_synonyms_available"],
            )


if __name__ == "__main__":
    unittest.main()
