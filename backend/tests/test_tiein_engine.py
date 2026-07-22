import sys
import unittest
from datetime import time
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "python_engines"))

import tiein_engine


class TieInEngineTests(unittest.TestCase):
    @staticmethod
    def feature(feature_id, feature_type, distance, **metadata):
        return {
            "id": feature_id,
            "type": feature_type,
            "dist": distance,
            **metadata,
        }

    def test_hu_cpa_launcher_is_excluded_from_first_physical_common_knot(self):
        old = [
            self.feature("o-launcher-valve", "valve", 0.000),
            self.feature("o-launcher-w1", "weld", 0.492),
            self.feature("o-launcher-w2", "weld", 0.581),
            self.feature("o-launcher-w3", "weld", 2.042),
            self.feature("o-launcher-w4", "weld", 2.327),
            self.feature("o-launcher-w5", "weld", 3.808, joint_length_m=0.110, feature_identification="Seamless pipe"),
            self.feature("o-launcher-w6", "weld", 3.918, wall_thickness_mm=12.7, joint_length_m=0.325, feature_identification="Seamless pipe"),
            self.feature("o-flange", "joint flange", 4.079, wall_thickness_mm=12.7),
            self.feature("o-common-1", "weld", 4.243, wall_thickness_mm=9.3, joint_length_m=1.594, feature_identification="Seamless pipe"),
            self.feature("o-tap", "offtake tap", 5.463, clock_position="12:00"),
            self.feature("o-common-2", "weld", 5.837, wall_thickness_mm=9.3),
            self.feature("o-common-3", "weld", 17.996, wall_thickness_mm=9.3),
            self.feature("o-common-4", "weld", 18.676, wall_thickness_mm=9.3),
            self.feature("o-extra-bend", "bend", 26.772, clock_position="12:00"),
            self.feature("o-common-5", "weld", 30.784, wall_thickness_mm=9.3),
            self.feature("o-common-6", "weld", 42.912, wall_thickness_mm=9.3),
            self.feature("o-common-7", "weld", 55.236, wall_thickness_mm=9.3),
            self.feature("o-common-8", "weld", 67.428, wall_thickness_mm=9.3),
            self.feature("o-common-9", "weld", 80.124, wall_thickness_mm=9.3),
        ]
        new = [
            self.feature("n-prefix-1", "weld", 1855.958, wall_thickness_mm=17.0),
            self.feature("n-prefix-2", "weld", 1862.182, wall_thickness_mm=17.0),
            self.feature("n-short-weld", "weld", 1868.476, wall_thickness_mm=9.27, joint_length_m=0.334, feature_identification="Seamless Pipe"),
            self.feature("n-flange", "weld", 1868.648, joint_length_m=0.334, feature_identification="Flanged"),
            self.feature("n-common-1", "weld", 1868.810, wall_thickness_mm=9.27, joint_length_m=1.544, feature_identification="Seamless Pipe"),
            self.feature("n-tap", "offtake tap", 1869.973, clock_position="12:00"),
            self.feature("n-common-2", "weld", 1870.354, wall_thickness_mm=9.27),
            self.feature("n-common-3", "weld", 1882.510, wall_thickness_mm=9.27),
            self.feature("n-common-4", "weld", 1883.203, wall_thickness_mm=9.27),
            self.feature("n-common-5", "weld", 1895.276, wall_thickness_mm=9.27),
            self.feature("n-common-6", "weld", 1907.315, wall_thickness_mm=9.27),
            self.feature("n-common-7", "weld", 1919.578, wall_thickness_mm=9.27),
            self.feature("n-common-8", "weld", 1931.700, wall_thickness_mm=9.27),
            self.feature("n-common-9", "weld", 1944.282, wall_thickness_mm=9.27),
        ]

        result = tiein_engine.calculate_tiein_offset(old, new)

        self.assertTrue(result["success"])
        self.assertEqual(result["decision"]["status"], "AUTO_ACCEPTED")
        self.assertAlmostEqual(result["tieIn"]["oldDistanceM"], 4.243, places=3)
        self.assertAlmostEqual(result["tieIn"]["newDistanceM"], 1868.810, places=3)
        self.assertEqual(result["transform"]["direction"], "OLD_TO_NEW")
        self.assertEqual(result["transform"]["model"], "MONOTONIC_PIECEWISE_LINEAR")
        self.assertFalse(result["transform"]["allowExtrapolation"])
        self.assertEqual(result["transform"]["knotCount"], len(result["transform"]["knots"]))

    def test_anchor_normalization_preserves_weld_role_and_normalizes_flange_and_clock(self):
        features = [
            self.feature(
                "valve-pipe-weld",
                "weld",
                0.0,
                feature_identification="Valve pipe",
                clock_position=time(11, 24),
            ),
            self.feature("joint-flange", "joint flange", 0.5),
            self.feature(
                "flanged-record",
                "weld",
                1.0,
                feature_identification="Flanged",
                clock_position=0.475,
            ),
            self.feature(
                "seamless-pipe-is-not-a-weld",
                "",
                1.5,
                feature_identification="Seamless Pipe",
            ),
        ]

        anchors = tiein_engine.extract_anchors(features)

        self.assertEqual([anchor.type for anchor in anchors], ["weld", "flange", "flange"])
        self.assertAlmostEqual(anchors[0].clock_position, 11.4, places=6)
        self.assertAlmostEqual(anchors[2].clock_position, 11.4, places=6)

    def test_facility_boundary_without_two_downstream_welds_is_rejected(self):
        old = [
            self.feature("old-flange", "flange", 0.0),
            self.feature("old-weld", "weld", 1.0),
        ]
        new = [
            self.feature("new-flange", "flange", 100.0),
            self.feature("new-weld", "weld", 101.0),
        ]

        result = tiein_engine.calculate_tiein_offset(old, new)

        self.assertFalse(result["success"])
        self.assertEqual(result["code"], "INSUFFICIENT_STABLE_TIEIN_KNOTS")

    def test_piecewise_transform_tracks_local_odometer_drift(self):
        old_distances = [100.0, 112.0, 124.4, 136.1, 148.8, 161.0, 173.6, 185.5]
        new_distances = [2100.0, 2112.1, 2124.2, 2136.4, 2148.5, 2160.7, 2172.9, 2185.0]
        old = [self.feature(f"o-{i}", "weld", distance) for i, distance in enumerate(old_distances)]
        new = [self.feature(f"n-{i}", "weld", distance) for i, distance in enumerate(new_distances)]

        result = tiein_engine.calculate_tiein_offset(old, new)

        self.assertTrue(result["success"])
        knots = result["transform"]["knots"]
        self.assertGreaterEqual(len(knots), 6)
        self.assertAlmostEqual(knots[0]["oldDistanceM"], 100.0, places=3)
        self.assertAlmostEqual(knots[0]["newDistanceM"], 2100.0, places=3)
        self.assertAlmostEqual(knots[-1]["oldDistanceM"], 185.5, places=3)
        self.assertAlmostEqual(knots[-1]["newDistanceM"], 2185.0, places=3)
        self.assertNotEqual(
            round(result["transform"]["localScaleRange"]["minimum"], 5),
            round(result["transform"]["localScaleRange"]["maximum"], 5),
        )

    def test_tiein_exposes_temporary_comparison_coordinates_without_mutating_raw_odometer(self):
        old = [
            self.feature("o-1", "weld", 10.0),
            self.feature("o-2", "weld", 22.0),
            self.feature("o-3", "weld", 34.0),
        ]
        new = [
            self.feature("n-1", "weld", 1010.0),
            self.feature("n-2", "weld", 1022.2),
            self.feature("n-3", "weld", 1034.4),
        ]

        result = tiein_engine.calculate_tiein_offset(old, new)

        self.assertTrue(result["success"])
        normalization = result["comparisonCoordinates"]
        self.assertEqual(normalization["direction"], "OLD_SHIFTED_TO_NEW")
        self.assertFalse(normalization["isFinalTransform"])
        self.assertAlmostEqual(normalization["provisionalOffsetM"], 1000.2, places=3)
        first_pair = result["pairs"][0]
        self.assertEqual(first_pair["oldDistanceM"], 10.0)
        self.assertEqual(first_pair["newDistanceM"], 1010.0)
        self.assertAlmostEqual(first_pair["oldComparisonDistanceM"], 1010.2, places=3)
        self.assertAlmostEqual(first_pair["newComparisonDistanceM"], 1010.0, places=3)

    def test_repeated_spool_pattern_requires_review_instead_of_auto_apply(self):
        old = [self.feature(f"o-{i}", "weld", i * 12.0) for i in range(8)]
        new = [self.feature(f"n-{i}", "weld", i * 12.0) for i in range(20)]

        result = tiein_engine.calculate_tiein_offset(old, new)

        self.assertTrue(result["success"])
        self.assertEqual(result["decision"]["status"], "REVIEW_REQUIRED")
        self.assertIn("AMBIGUOUS_OVERLAP", result["decision"]["reasons"])
        self.assertGreaterEqual(len(result["candidates"]), 2)

    def test_adjacent_repeated_pattern_is_not_deduplicated_as_same_candidate(self):
        old = [self.feature(f"o-{i}", "weld", i * 12.0) for i in range(8)]
        new = [self.feature(f"n-{i}", "weld", i * 12.0) for i in range(9)]

        result = tiein_engine.calculate_tiein_offset(old, new)

        self.assertEqual(result["decision"]["status"], "REVIEW_REQUIRED")
        self.assertIn("AMBIGUOUS_OVERLAP", result["decision"]["reasons"])

    def test_quadratic_overlap_search_has_a_controlled_cell_limit(self):
        old = [self.feature(f"o-{i}", "weld", i * 12.0) for i in range(1001)]
        new = [self.feature(f"n-{i}", "weld", i * 12.0) for i in range(1000)]

        result = tiein_engine.calculate_tiein_offset(old, new)

        self.assertFalse(result["success"])
        self.assertEqual(result["code"], "TIEIN_INPUT_TOO_LARGE")

    def test_short_spool_offset_jump_requires_review(self):
        old_distances = [0, 12, 24, 25, 37, 49, 61, 73]
        new_distances = [0, 12, 24, 27, 39, 51, 63, 75]
        old = [self.feature(f"o-{i}", "weld", value) for i, value in enumerate(old_distances)]
        new = [self.feature(f"n-{i}", "weld", value) for i, value in enumerate(new_distances)]

        result = tiein_engine.calculate_tiein_offset(old, new)

        self.assertEqual(result["decision"]["status"], "REVIEW_REQUIRED")
        self.assertIn("ABRUPT_OFFSET_CHANGE", result["decision"]["reasons"])
        self.assertAlmostEqual(result["transform"]["maximumOffsetStepM"], 2.0)

    def test_missed_anchor_is_preserved_in_skip_audit(self):
        old = [
            self.feature(f"o-{i}", "weld", distance)
            for i, distance in enumerate([0, 12, 18, 24, 36, 48])
        ]
        new = [
            self.feature(f"n-{i}", "weld", distance)
            for i, distance in enumerate([100, 112, 124, 136, 148])
        ]

        result = tiein_engine.calculate_tiein_offset(old, new)

        self.assertEqual(result["skippedOldAnchorCount"], 1)
        self.assertEqual(result["skippedNewAnchorCount"], 0)
        self.assertEqual(result["skippedAnchors"]["old"], [
            {"id": "o-2", "distanceM": 18.0, "type": "weld"},
        ])

    def test_partial_run_returns_offset_overlap_and_residual_diagnostics(self):
        old = [
            self.feature("o-valve-a", "valve", 0.0),
            self.feature("o-tee-a", "tee", 100.0),
            self.feature("o-bend", "bend", 250.0),
            self.feature("o-valve-b", "valve", 400.0),
            self.feature("o-tee-b", "tee", 620.0),
        ]
        new_partial = [
            self.feature("n-bend", "bend", 0.0),
            self.feature("n-valve", "valve", 150.0),
            self.feature("n-tee", "tee", 370.0),
        ]

        result = tiein_engine.calculate_tiein_offset(old, new_partial)

        self.assertTrue(result["success"])
        self.assertAlmostEqual(result["offset"], 250.0, places=3)
        self.assertEqual(result["matchedPairCount"], 3)
        self.assertEqual(result["overlap"]["oldStartM"], 250.0)
        self.assertEqual(result["overlap"]["oldEndM"], 620.0)
        self.assertLess(result["residualRmseM"], 0.001)

    def test_welds_are_supported_as_partial_run_anchors(self):
        old = [
            self.feature("o-1", "weld", 1000.0),
            self.feature("o-2", "weld", 1012.0),
            self.feature("o-3", "weld", 1029.0),
        ]
        new = [
            self.feature("n-1", "girth weld", 0.0),
            self.feature("n-2", "girth weld", 12.0),
            self.feature("n-3", "girth weld", 29.0),
        ]

        result = tiein_engine.calculate_tiein_offset(old, new)

        self.assertTrue(result["success"])
        self.assertAlmostEqual(result["offset"], 1000.0, places=3)

    def test_excluded_area_is_ignored_without_deleting_source_data(self):
        old = [
            self.feature("o-noise", "valve", 50.0),
            self.feature("o-1", "weld", 1000.0),
            self.feature("o-2", "weld", 1012.0),
            self.feature("o-3", "weld", 1029.0),
        ]
        new = [
            self.feature("n-noise", "valve", 9000.0),
            self.feature("n-1", "weld", 0.0),
            self.feature("n-2", "weld", 12.0),
            self.feature("n-3", "weld", 29.0),
        ]

        result = tiein_engine.calculate_tiein_offset(
            old,
            new,
            excluded_ranges=[
                {"run": "OLD", "startM": 0.0, "endM": 100.0},
                {"run": "NEW", "startM": 8000.0, "endM": 10000.0},
            ],
        )

        self.assertTrue(result["success"])
        self.assertAlmostEqual(result["offset"], 1000.0, places=3)
        self.assertEqual(result["excludedAnchorCount"], 2)

    def test_normal_ili_scale_drift_and_sub_meter_residual_keep_high_confidence(self):
        new = [
            self.feature(f"n-{index}", "weld", index * 12.0)
            for index in range(30)
        ]
        old = [
            self.feature(
                f"o-{index}",
                "weld",
                1000.0
                + 1.006 * (index * 12.0)
                + (0.45 if index % 2 else -0.45),
            )
            for index in range(30)
        ]

        result = tiein_engine.calculate_tiein_offset(old, new)

        self.assertTrue(result["success"])
        self.assertEqual(result["alignedPairCount"], 30)
        self.assertGreaterEqual(result["confidence"], 85.0)

    def test_robust_affine_outlier_is_reported_as_unaligned_gw(self):
        old = [
            self.feature(f"o-{index}", "weld", distance)
            for index, distance in enumerate([1000, 1012, 1024, 1036, 1048, 1060])
        ]
        new = [
            self.feature(f"n-{index}", "weld", distance)
            for index, distance in enumerate([0, 12, 24, 38.5, 48, 60])
        ]

        result = tiein_engine.calculate_tiein_offset(old, new)

        self.assertTrue(result["success"])
        self.assertEqual(result["candidatePairCount"], 6)
        self.assertEqual(result["alignedPairCount"], 5)
        self.assertEqual(result["unalignedPairCount"], 1)
        self.assertNotIn("o-3", {pair["oldId"] for pair in result["pairs"]})
        self.assertEqual(result["unalignedPairs"][0]["oldId"], "o-3")
        self.assertEqual(result["unalignedPairs"][0]["newId"], "n-3")
        self.assertEqual(result["robustFit"]["method"], "DETERMINISTIC_THEIL_SEN_IRLS")
        self.assertTrue(result["robustFit"]["dependencyFree"])

    def test_reported_overlap_never_exceeds_piecewise_transform_domain(self):
        old = [
            self.feature("o-1", "weld", 0.0),
            self.feature("o-2", "weld", 12.0),
            self.feature("o-3", "weld", 24.0),
            self.feature("o-bend", "bend", 25.0),
        ]
        new = [
            self.feature("n-1", "weld", 100.0),
            self.feature("n-2", "weld", 112.1),
            self.feature("n-3", "weld", 124.2),
            self.feature("n-bend", "bend", 125.2),
        ]

        result = tiein_engine.calculate_tiein_offset(old, new)

        self.assertTrue(result["success"])
        self.assertEqual(result["overlap"], {
            "oldStartM": result["transform"]["domain"]["oldStartM"],
            "oldEndM": result["transform"]["domain"]["oldEndM"],
            "newStartM": result["transform"]["domain"]["newStartM"],
            "newEndM": result["transform"]["domain"]["newEndM"],
        })
        self.assertEqual(result["evidenceOverlap"]["oldEndM"], 25.0)
        self.assertEqual(result["evidenceOverlap"]["newEndM"], 125.2)
        self.assertLessEqual(result["overlap"]["oldEndM"], result["evidenceOverlap"]["oldEndM"])


class WallThicknessTransitionTests(unittest.TestCase):
    """A chain must be able to *start* at anchors whose node score is <= 0.

    Regression: the DP rejected any predecessor whose running score was
    ``<= 0.0``, conflating "unreachable" with "legitimately penalised".
    Because the running score is cumulative, this bites hardest at the head of
    a chain -- exactly where a tie-in sits, since a replaced spool is precisely
    where wall thickness and joint length change.  The leading anchors were
    then dropped and only the clean tail survived as the overlap.
    """

    @staticmethod
    def pair(idx, wall_old, wall_new, joint_old, joint_new):
        return (
            tiein_engine.Anchor(
                idx=idx, dist=100.0 + idx * 12.0, type="weld", feature_id=f"o{idx}",
                wall_thickness_mm=wall_old, joint_length_m=joint_old,
            ),
            tiein_engine.Anchor(
                idx=idx, dist=500.0 + idx * 12.0, type="weld", feature_id=f"n{idx}",
                wall_thickness_mm=wall_new, joint_length_m=joint_new,
            ),
        )

    def _runs(self):
        old, new = [], []
        for idx in range(10):
            # First five welds sit in the replaced spool: wall steps 9.3 -> 12.7
            # and joint length differs, scoring 2.0 - 2.0 - 1.5 = -1.5 each.
            # The last five are clean, scoring 2.0 + 1.5 + 2.5 = 6.0.
            args = (9.3, 12.7, 1.0, 3.0) if idx < 5 else (9.3, 9.3, 12.0, 12.0)
            old_anchor, new_anchor = self.pair(idx, *args)
            old.append(old_anchor)
            new.append(new_anchor)
        return old, new

    def test_penalised_leading_anchors_stay_in_the_overlap(self):
        old, new = self._runs()
        self.assertLess(tiein_engine._node_score(old[0], new[0]), 0.0)

        candidates = tiein_engine.find_overlap_candidates(old, new, max_candidates=1)
        self.assertTrue(candidates, "expected an alignment candidate")
        path = candidates[0]["path"]

        # Pre-fix this returned only [(5,5)..(9,9)] -- the first five welds,
        # half the real overlap, were discarded.
        self.assertEqual(len(path), 10, f"overlap truncated to {len(path)} anchors")
        self.assertEqual(min(pair[0] for pair in path), 0)

    def test_non_finite_nodes_are_still_unreachable(self):
        # Type mismatch yields -inf and must not become a chain predecessor.
        old = [
            tiein_engine.Anchor(idx=0, dist=10.0, type="weld", feature_id="a"),
            tiein_engine.Anchor(idx=1, dist=22.0, type="weld", feature_id="b"),
        ]
        new = [
            tiein_engine.Anchor(idx=0, dist=10.0, type="valve", feature_id="c"),
            tiein_engine.Anchor(idx=1, dist=22.0, type="valve", feature_id="d"),
        ]
        self.assertEqual(tiein_engine.find_overlap_candidates(old, new), [])


if __name__ == "__main__":
    unittest.main()
