import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "python_engines"))

import gw_distance_derivation as derivation  # noqa: E402
from hungarian_engine import HungarianAnomalyAlignmentEngine  # noqa: E402


def feature(distance, feature_type="metal loss", *, identification="", dist_to_us_gw_m=None,
            mapped=None):
    """One canonical feature as ``fetch_data`` would have produced it."""
    return {
        "id": f"f{distance}",
        # The mapped distance may differ from the native one when a tie-in
        # transform is in play; derivation must not read the mapped value.
        "abs_distance_m": distance if mapped is None else mapped,
        "source_abs_distance_m": distance,
        "dist_to_us_gw_m": dist_to_us_gw_m,
        "dist_to_us_gw_source": (
            derivation.VENDOR_SOURCE if dist_to_us_gw_m is not None else None
        ),
        "originalType": feature_type,
        "raw": {"feature_identification": identification},
    }


IS_GIRTH_WELD = HungarianAnomalyAlignmentEngine._is_girth_weld_feature


class GirthWeldRecognitionTests(unittest.TestCase):
    def test_recognises_the_labels_vendors_actually_use(self):
        for label in ("Girth Weld", "GW", "weld", "girth weld (GW)"):
            with self.subTest(label=label):
                self.assertTrue(IS_GIRTH_WELD(feature(1.0, label)))

    def test_a_longitudinal_seam_is_not_a_joint_boundary(self):
        for label in ("Seam Weld", "long seam", "spiral weld", "ERW seam"):
            with self.subTest(label=label):
                self.assertFalse(IS_GIRTH_WELD(feature(1.0, label)))

    def test_pipe_furniture_is_never_a_derivation_reference(self):
        # These are all girth-weld *features* to Phase 1, but measuring a defect
        # from the nearest bend would produce a number no vendor column matches.
        for label in ("Bend", "Valve", "Flange", "Tee"):
            with self.subTest(label=label):
                self.assertFalse(IS_GIRTH_WELD(feature(1.0, label)))


class DerivationTests(unittest.TestCase):
    def test_measures_each_defect_from_the_weld_before_it(self):
        features = [
            feature(0.0, "girth weld"),
            feature(3.4),
            feature(9.8),
            feature(12.0, "girth weld"),
            feature(12.75),
        ]

        stats = derivation.derive_us_gw_distances(features, IS_GIRTH_WELD, overwrite=True)

        self.assertEqual(stats["girthWelds"], 2)
        self.assertEqual(stats["derived"], 3)
        self.assertAlmostEqual(features[1]["dist_to_us_gw_m"], 3.4)
        self.assertAlmostEqual(features[2]["dist_to_us_gw_m"], 9.8)
        self.assertAlmostEqual(features[4]["dist_to_us_gw_m"], 0.75)

    def test_marks_every_derived_value_as_derived(self):
        features = [feature(0.0, "girth weld"), feature(2.0)]

        derivation.derive_us_gw_distances(features, IS_GIRTH_WELD, overwrite=True)

        self.assertEqual(features[1]["dist_to_us_gw_source"], derivation.DERIVED_SOURCE)

    def test_reads_the_native_odometer_not_the_transformed_one(self):
        """A tie-in transform stretches the master axis; a joint does not."""
        features = [
            feature(100.0, "girth weld", mapped=140.0),
            feature(104.0, mapped=146.0),
        ]

        derivation.derive_us_gw_distances(features, IS_GIRTH_WELD, overwrite=True)

        self.assertAlmostEqual(features[1]["dist_to_us_gw_m"], 4.0)

    def test_a_defect_before_the_first_weld_has_no_upstream_weld(self):
        features = [feature(2.0), feature(10.0, "girth weld"), feature(11.0)]

        stats = derivation.derive_us_gw_distances(features, IS_GIRTH_WELD, overwrite=True)

        self.assertIsNone(features[0]["dist_to_us_gw_m"])
        self.assertEqual(stats["noUpstreamWeld"], 1)
        self.assertEqual(stats["derived"], 1)

    def test_a_defect_sitting_on_a_weld_is_measured_from_that_weld(self):
        features = [feature(0.0, "girth weld"), feature(12.0, "girth weld"), feature(12.0)]

        derivation.derive_us_gw_distances(features, IS_GIRTH_WELD, overwrite=True)

        self.assertAlmostEqual(features[2]["dist_to_us_gw_m"], 0.0)

    def test_without_overwrite_a_vendor_reading_is_left_alone(self):
        features = [
            feature(0.0, "girth weld"),
            feature(4.0, dist_to_us_gw_m=3.91),
            feature(8.0),
        ]

        stats = derivation.derive_us_gw_distances(features, IS_GIRTH_WELD, overwrite=False)

        self.assertAlmostEqual(features[1]["dist_to_us_gw_m"], 3.91)
        self.assertEqual(features[1]["dist_to_us_gw_source"], derivation.VENDOR_SOURCE)
        self.assertAlmostEqual(features[2]["dist_to_us_gw_m"], 8.0)
        self.assertEqual(stats["keptVendor"], 1)
        self.assertEqual(stats["derived"], 1)

    def test_a_run_with_no_girth_welds_keeps_whatever_the_vendor_gave(self):
        features = [feature(4.0, dist_to_us_gw_m=1.2), feature(9.0)]

        stats = derivation.derive_us_gw_distances(features, IS_GIRTH_WELD, overwrite=True)

        self.assertEqual(stats["girthWelds"], 0)
        self.assertEqual(stats["derived"], 0)
        self.assertAlmostEqual(features[0]["dist_to_us_gw_m"], 1.2)


class CoverageTests(unittest.TestCase):
    def test_coverage_counts_anomalies_and_ignores_the_welds(self):
        features = [
            feature(0.0, "girth weld"),
            feature(3.0, dist_to_us_gw_m=3.0),
            feature(6.0),
        ]

        coverage = derivation.vendor_coverage(features, IS_GIRTH_WELD)

        self.assertEqual(coverage["features"], 2)
        self.assertEqual(coverage["reported"], 1)
        self.assertAlmostEqual(coverage["coverage"], 0.5)


class JointLengthTests(unittest.TestCase):
    def test_measures_the_line_rather_than_assuming_twelve_metres(self):
        features = [feature(distance, "girth weld") for distance in (0.0, 6.1, 12.2, 18.0)]

        self.assertAlmostEqual(
            derivation.median_joint_length(features, IS_GIRTH_WELD), 6.1, places=6,
        )

    def test_returns_nothing_when_the_run_reports_no_welds(self):
        self.assertIsNone(derivation.median_joint_length([feature(4.0)], IS_GIRTH_WELD))


class PolicyTests(unittest.TestCase):
    """The provenance rule: both runs derive, or neither does."""

    def setUp(self):
        self.engine = HungarianAnomalyAlignmentEngine.__new__(HungarianAnomalyAlignmentEngine)

    @staticmethod
    def run_features(with_vendor: bool):
        return [
            feature(0.0, "girth weld"),
            feature(4.0, dist_to_us_gw_m=4.0 if with_vendor else None),
            feature(8.0, dist_to_us_gw_m=8.0 if with_vendor else None),
        ]

    def test_auto_keeps_the_vendor_column_when_both_runs_report_it(self):
        old, new = self.run_features(True), self.run_features(True)

        audit = self.engine._resolve_us_gw_distance_policy(
            old, new, {"us_gw_distance_source": "auto"},
        )

        self.assertEqual(audit["resolvedMode"], "uploaded")
        self.assertEqual(old[1]["dist_to_us_gw_source"], derivation.VENDOR_SOURCE)

    def test_auto_derives_both_runs_when_either_one_is_missing_the_column(self):
        old, new = self.run_features(True), self.run_features(False)

        audit = self.engine._resolve_us_gw_distance_policy(
            old, new, {"us_gw_distance_source": "auto"},
        )

        self.assertEqual(audit["resolvedMode"], "derived")
        # The run that *did* have a vendor column is re-derived too: mixing a
        # vendor measurement against a computed one would feed the difference
        # between the two conventions straight into the identity gate.
        self.assertEqual(old[1]["dist_to_us_gw_source"], derivation.DERIVED_SOURCE)
        self.assertEqual(new[1]["dist_to_us_gw_source"], derivation.DERIVED_SOURCE)

    def test_a_session_saved_with_the_old_unchecked_box_still_means_off(self):
        old, new = self.run_features(True), self.run_features(True)

        audit = self.engine._resolve_us_gw_distance_policy(
            old, new, {"use_us_gw_distance": False},
        )

        self.assertEqual(audit["resolvedMode"], "off")
        self.assertFalse(self.engine.use_us_gw_distance)

    def test_a_session_saved_before_the_selector_existed_keeps_the_vendor_column(self):
        old, new = self.run_features(True), self.run_features(False)

        audit = self.engine._resolve_us_gw_distance_policy(old, new, {})

        self.assertEqual(audit["resolvedMode"], "uploaded")
        self.assertIsNone(new[1]["dist_to_us_gw_m"])
        self.assertTrue(self.engine.use_us_gw_distance)

    def test_an_unrecognised_mode_falls_back_instead_of_failing_the_run(self):
        old, new = self.run_features(True), self.run_features(True)

        audit = self.engine._resolve_us_gw_distance_policy(
            old, new, {"us_gw_distance_source": "telepathy"},
        )

        self.assertEqual(audit["resolvedMode"], "uploaded")

    def test_the_policy_reports_what_it_did(self):
        old, new = self.run_features(False), self.run_features(False)

        audit = self.engine._resolve_us_gw_distance_policy(
            old, new, {"us_gw_distance_source": "derived"},
        )

        self.assertEqual(audit["old"]["derivation"]["derived"], 2)
        self.assertEqual(audit["new"]["derivation"]["derived"], 2)
        self.assertEqual(audit["old"]["coverage"], 0.0)


if __name__ == "__main__":
    unittest.main()
