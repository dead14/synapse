import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "python_engines"))

import wall_thickness_inheritance as inheritance  # noqa: E402
from hungarian_engine import HungarianAnomalyAlignmentEngine  # noqa: E402


def feature(distance, feature_type="metal loss", *, wall_thickness_mm=None, mapped=None,
            identification=""):
    """One canonical feature as ``fetch_data`` would have produced it."""
    return {
        "id": f"f{distance}",
        # The mapped distance may differ from the native one under a tie-in
        # transform; which joint a feature sits in is a fact about its own run.
        "abs_distance_m": distance if mapped is None else mapped,
        "source_abs_distance_m": distance,
        "wall_thickness_mm": wall_thickness_mm,
        "wall_thickness_source": (
            inheritance.REPORTED_SOURCE if wall_thickness_mm is not None else None
        ),
        "originalType": feature_type,
        "raw": {"feature_identification": identification},
    }


IS_GIRTH_WELD = HungarianAnomalyAlignmentEngine._is_girth_weld_feature


class ReadableThicknessTests(unittest.TestCase):
    def test_accepts_the_shapes_a_pipetally_actually_carries(self):
        self.assertEqual(inheritance.readable_thickness(9.53), 9.53)
        self.assertEqual(inheritance.readable_thickness("12.7"), 12.7)

    def test_rejects_anything_that_would_divide_a_depth_by_nothing(self):
        for value in (None, "", "-", "N/A", 0, -6.4, float("nan"), float("inf")):
            with self.subTest(value=value):
                self.assertIsNone(inheritance.readable_thickness(value))


class InheritanceTests(unittest.TestCase):
    def test_takes_the_reading_from_the_weld_that_opens_the_joint(self):
        features = [
            feature(0.0, "girth weld", wall_thickness_mm=9.5),
            feature(3.4),
            feature(9.8),
            feature(12.0, "girth weld", wall_thickness_mm=12.7),
            feature(12.75),
        ]

        stats = inheritance.inherit_wall_thickness(features, IS_GIRTH_WELD)

        self.assertEqual(features[1]["wall_thickness_mm"], 9.5)
        self.assertEqual(features[2]["wall_thickness_mm"], 9.5)
        # Sitting past the second weld puts it in the 12.7 mm joint, not the one
        # before it.
        self.assertEqual(features[4]["wall_thickness_mm"], 12.7)
        self.assertEqual(stats["inheritedUpstream"], 3)
        self.assertEqual(stats["jointReferences"], 2)

    def test_a_defect_on_the_weld_belongs_to_the_joint_that_weld_opens(self):
        features = [
            feature(0.0, "girth weld", wall_thickness_mm=9.5),
            feature(12.0, "girth weld", wall_thickness_mm=12.7),
            feature(12.0),
        ]

        inheritance.inherit_wall_thickness(features, IS_GIRTH_WELD)

        self.assertEqual(features[2]["wall_thickness_mm"], 12.7)

    def test_a_reported_reading_is_never_replaced(self):
        features = [
            feature(0.0, "girth weld", wall_thickness_mm=9.5),
            feature(4.0, wall_thickness_mm=11.0),
        ]

        stats = inheritance.inherit_wall_thickness(features, IS_GIRTH_WELD)

        self.assertEqual(features[1]["wall_thickness_mm"], 11.0)
        self.assertEqual(features[1]["wall_thickness_source"], inheritance.REPORTED_SOURCE)
        self.assertEqual(stats["reported"], 1)
        self.assertEqual(stats["inheritedUpstream"], 0)

    def test_a_defect_before_the_first_weld_reads_the_weld_that_closes_its_joint(self):
        features = [
            feature(1.5),
            feature(12.0, "girth weld", wall_thickness_mm=12.7),
        ]

        stats = inheritance.inherit_wall_thickness(features, IS_GIRTH_WELD)

        self.assertEqual(features[0]["wall_thickness_mm"], 12.7)
        self.assertEqual(features[0]["wall_thickness_source"], inheritance.INHERITED_SOURCE)
        self.assertEqual(stats["inheritedDownstream"], 1)

    def test_a_weld_with_no_reading_does_not_blank_the_joint_it_bounds(self):
        features = [
            feature(0.0, "girth weld", wall_thickness_mm=9.5),
            feature(12.0, "girth weld"),
            feature(15.0),
        ]

        inheritance.inherit_wall_thickness(features, IS_GIRTH_WELD)

        # The 12.0 m weld carries nothing, so the joint is read from the weld
        # that does — never left blank while a bounding weld has the answer.
        self.assertEqual(features[2]["wall_thickness_mm"], 9.5)

    def test_a_run_whose_welds_report_nothing_leaves_every_blank_alone(self):
        features = [
            feature(0.0, "girth weld"),
            feature(4.0),
        ]

        stats = inheritance.inherit_wall_thickness(features, IS_GIRTH_WELD)

        self.assertIsNone(features[1]["wall_thickness_mm"])
        self.assertEqual(stats["noJointThickness"], 1)
        self.assertEqual(stats["jointReferences"], 0)

    def test_reads_the_run_native_odometer_not_the_mapped_one(self):
        # OLD mapped forward past the second weld. Reading the mapped value
        # would file this defect in the wrong joint and hand it 12.7 mm.
        features = [
            feature(0.0, "girth weld", wall_thickness_mm=9.5, mapped=0.0),
            feature(4.0, mapped=13.0),
            feature(12.0, "girth weld", wall_thickness_mm=12.7, mapped=12.0),
        ]

        inheritance.inherit_wall_thickness(features, IS_GIRTH_WELD)

        self.assertEqual(features[1]["wall_thickness_mm"], 9.5)

    def test_a_seam_weld_is_not_a_joint_boundary(self):
        features = [
            feature(0.0, "girth weld", wall_thickness_mm=9.5),
            feature(6.0, "long seam weld", wall_thickness_mm=25.0),
            feature(8.0),
        ]

        inheritance.inherit_wall_thickness(features, IS_GIRTH_WELD)

        # The seam runs along the pipe rather than closing a joint, so its
        # thickness must not become the reference for anything downstream.
        self.assertEqual(features[2]["wall_thickness_mm"], 9.5)


class CoverageTests(unittest.TestCase):
    def test_measures_the_population_that_would_block_an_assessment(self):
        features = [
            feature(0.0, "girth weld", wall_thickness_mm=9.5),
            feature(3.0, wall_thickness_mm=9.5),
            feature(6.0),
            feature(9.0),
        ]

        report = inheritance.coverage(features, IS_GIRTH_WELD)

        # The weld is a donor, not a subject: counting it would make a run whose
        # anomalies are all blank look two-thirds populated.
        self.assertEqual(report["features"], 3)
        self.assertEqual(report["reported"], 1)
        self.assertAlmostEqual(report["coverage"], 1 / 3)


if __name__ == "__main__":
    unittest.main()
