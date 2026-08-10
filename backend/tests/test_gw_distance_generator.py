import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "python_engines"))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

import gw_distance_generator as generator  # noqa: E402
from models import Base, ILIFeature, Pipeline, RunGwDistanceGeneration, SurveyRun  # noqa: E402


class GeneratorTestCase(unittest.TestCase):
    """Runs against a real (in-memory) database, so the writes are real writes."""

    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.session = self.Session()
        self.session.add(Pipeline(id=1, name="Test line"))
        self.session.add(SurveyRun(id=1, pipeline_id=1, survey_year=2024, source_file="a.xlsx"))
        self.session.commit()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def add_features(self, rows):
        for index, (distance, feature_type, vendor) in enumerate(rows):
            self.session.add(ILIFeature(
                run_id=1,
                feature_id=f"F{index}",
                log_distance_m=distance,
                feature_type=feature_type,
                dist_to_us_gw_m=vendor,
            ))
        self.session.commit()

    def features(self):
        return (
            self.session.query(ILIFeature)
            .filter(ILIFeature.run_id == 1)
            .order_by(ILIFeature.log_distance_m.asc(), ILIFeature.id.asc())
            .all()
        )


class PreviewTests(GeneratorTestCase):
    def setUp(self):
        super().setUp()
        self.add_features([
            (0.0, "Girth Weld", None),
            (3.4, "Metal Loss", None),
            (9.8, "Metal Loss", None),
            (12.0, "Girth Weld", None),
            (12.75, "Metal Loss", None),
        ])

    def test_a_preview_writes_nothing(self):
        summary = generator.generate_for_run(self.session, 1, apply=False)

        self.assertFalse(summary["applied"])
        self.assertEqual(summary["derivedCount"], 3)
        self.session.expire_all()
        for feature in self.features():
            self.assertIsNone(feature.dist_to_us_gw_derived_m)
        self.assertIsNone(
            self.session.query(RunGwDistanceGeneration).filter_by(run_id=1).first(),
        )

    def test_the_preview_shows_workable_examples(self):
        summary = generator.generate_for_run(self.session, 1, apply=False)

        sample = {row["logDistanceM"]: row for row in summary["sample"]}
        # 3.4 m along the line, first weld at 0.0 -> 3.4 m into the joint.
        self.assertAlmostEqual(sample[3.4]["derivedM"], 3.4)
        self.assertAlmostEqual(sample[3.4]["referenceWeldM"], 0.0)
        # 12.75 m, weld at 12.0 -> 0.75 m into the second joint.
        self.assertAlmostEqual(sample[12.75]["derivedM"], 0.75)
        self.assertAlmostEqual(sample[12.75]["referenceWeldM"], 12.0)

    def test_it_reports_the_geometry_it_measured(self):
        summary = generator.generate_for_run(self.session, 1, apply=False)

        self.assertEqual(summary["girthWelds"], 2)
        self.assertAlmostEqual(summary["medianJointLengthM"], 12.0)
        self.assertAlmostEqual(summary["firstGirthWeldM"], 0.0)
        self.assertAlmostEqual(summary["lastGirthWeldM"], 12.0)

    def test_preview_and_apply_agree(self):
        """The preview must be the same pass, not a second estimate of it."""
        preview = generator.generate_for_run(self.session, 1, apply=False)
        applied = generator.generate_for_run(self.session, 1, apply=True)

        for key in ("derivedCount", "girthWelds", "noUpstreamWeldCount", "sample"):
            self.assertEqual(preview[key], applied[key], key)


class ApplyTests(GeneratorTestCase):
    def setUp(self):
        super().setUp()
        self.add_features([
            (0.0, "Girth Weld", None),
            (4.0, "Metal Loss", 3.91),
            (12.0, "Girth Weld", None),
            (14.5, "Metal Loss", None),
        ])

    def test_it_writes_the_derived_column_and_its_reference(self):
        generator.generate_for_run(self.session, 1, apply=True)

        self.session.expire_all()
        loss_at_four, loss_at_fourteen = [
            feature for feature in self.features() if feature.feature_type == "Metal Loss"
        ]
        self.assertAlmostEqual(loss_at_four.dist_to_us_gw_derived_m, 4.0)
        self.assertAlmostEqual(loss_at_four.us_gw_reference_m, 0.0)
        self.assertAlmostEqual(loss_at_fourteen.dist_to_us_gw_derived_m, 2.5)
        self.assertAlmostEqual(loss_at_fourteen.us_gw_reference_m, 12.0)

    def test_the_vendor_column_is_never_touched(self):
        # A vendor measures to the weld centreline and this measures to the
        # reported weld position; destroying the surveyed number would leave
        # nothing able to tell the two apart afterwards.
        generator.generate_for_run(self.session, 1, apply=True)

        self.session.expire_all()
        vendor_row = next(
            feature for feature in self.features() if feature.log_distance_m == 4.0
        )
        self.assertAlmostEqual(vendor_row.dist_to_us_gw_m, 3.91)
        self.assertNotAlmostEqual(
            vendor_row.dist_to_us_gw_derived_m, vendor_row.dist_to_us_gw_m,
        )

    def test_it_records_what_it_did(self):
        generator.generate_for_run(self.session, 1, apply=True, generated_by=None)

        record = self.session.query(RunGwDistanceGeneration).filter_by(run_id=1).one()
        self.assertEqual(record.girth_welds, 2)
        self.assertEqual(record.derived_count, 2)
        self.assertEqual(record.feature_count, 4)
        self.assertEqual(record.vendor_reported_count, 1)

    def test_re_running_replaces_the_record_instead_of_stacking_them(self):
        generator.generate_for_run(self.session, 1, apply=True)
        generator.generate_for_run(self.session, 1, apply=True)

        self.assertEqual(self.session.query(RunGwDistanceGeneration).count(), 1)


class RefusalTests(GeneratorTestCase):
    def test_a_run_with_no_girth_welds_refuses_to_apply(self):
        self.add_features([(4.0, "Metal Loss", None), (9.0, "Metal Loss", None)])

        preview = generator.generate_for_run(self.session, 1, apply=False)
        self.assertEqual(preview["girthWelds"], 0)
        self.assertTrue(any("no girth welds" in w for w in preview["warnings"]))

        # Previewing an impossible generation is fine; committing one is not.
        with self.assertRaises(ValueError):
            generator.generate_for_run(self.session, 1, apply=True)

    def test_features_before_the_first_weld_are_reported_not_invented(self):
        self.add_features([
            (2.0, "Metal Loss", None),
            (10.0, "Girth Weld", None),
            (11.0, "Metal Loss", None),
        ])

        summary = generator.generate_for_run(self.session, 1, apply=True)

        self.assertEqual(summary["noUpstreamWeldCount"], 1)
        self.assertTrue(any("upstream of the first girth weld" in w for w in summary["warnings"]))
        self.session.expire_all()
        orphan = next(f for f in self.features() if f.log_distance_m == 2.0)
        self.assertIsNone(orphan.dist_to_us_gw_derived_m)
        self.assertIsNone(orphan.us_gw_reference_m)

    def test_an_unknown_run_is_refused(self):
        with self.assertRaises(LookupError):
            generator.generate_for_run(self.session, 999, apply=False)

    def test_a_run_with_no_features_is_refused(self):
        with self.assertRaises(LookupError):
            generator.generate_for_run(self.session, 1, apply=False)

    def test_a_seam_weld_is_not_a_reference(self):
        self.add_features([
            (0.0, "Seam Weld", None),
            (5.0, "Metal Loss", None),
            (10.0, "Girth Weld", None),
            (13.0, "Metal Loss", None),
        ])

        summary = generator.generate_for_run(self.session, 1, apply=False)

        # A longitudinal seam runs along the pipe; it is not a joint boundary,
        # so the only reference here is the girth weld at 10.0 m.
        self.assertEqual(summary["girthWelds"], 1)
        # Both the seam weld itself and the metal loss at 5.0 m sit upstream of
        # that weld, so neither gets a value.
        self.assertEqual(summary["noUpstreamWeldCount"], 2)
        self.assertEqual(summary["derivedCount"], 1)


class ProvenanceTests(GeneratorTestCase):
    def test_the_generator_and_the_alignment_engine_classify_welds_identically(self):
        """One regex, one place — or the two disagree about what a joint is."""
        from hungarian_engine import HungarianAnomalyAlignmentEngine

        for label in ("Girth Weld", "GW", "Seam Weld", "Bend", "Valve", "Metal Loss"):
            feature = {"originalType": label, "raw": {}}
            with self.subTest(label=label):
                self.assertEqual(
                    generator.derivation.is_girth_weld_feature(feature),
                    HungarianAnomalyAlignmentEngine._is_girth_weld_feature(feature),
                )


if __name__ == "__main__":
    unittest.main()
