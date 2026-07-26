"""Compatibility regression for the dependency-free robust affine fit."""

import math
import sys
import unittest
from pathlib import Path

import numpy as np


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "python_engines"))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import tiein_engine
from engine.phylogenesis import filogenesis_core


class DeterministicRobustFitTests(unittest.TestCase):
    def test_outlier_rejection_does_not_require_scikit_learn(self):
        source = [0.0, 10.0, 20.0, 30.0, 40.0, 50.0, 60.0]
        target = [100.0, 110.0, 120.0, 130.0, 140.0, 150.0, 174.0]

        scale, offset, inliers, _, rmse = tiein_engine._fit_affine(source, target)

        self.assertEqual(tiein_engine.ROBUST_FIT_METHOD, "DETERMINISTIC_THEIL_SEN_IRLS")
        self.assertAlmostEqual(scale, 1.0, places=9)
        self.assertAlmostEqual(offset, 100.0, places=9)
        self.assertEqual(inliers.tolist(), [True, True, True, True, True, True, False])
        self.assertAlmostEqual(rmse, 0.0, places=9)


class RansacLinearFitTests(unittest.TestCase):
    @staticmethod
    def anchor(canonical_id, odom, chainage):
        return filogenesis_core.AncestralAnchor(
            canonical_id=canonical_id,
            odom_source=odom,
            abs_chainage=chainage,
            sigma=0.2,
            confidence=0.9,
            is_golden=False,
            anchor_type="Weld",
        )

    def test_no_valid_hypothesis_returns_an_explicit_failure(self):
        # Every sampled hypothesis has scale 2.0, outside [0.95, 1.05].
        # Pre-fix this returned scale=1.0/offset=0.0 with ALL anchors marked
        # inliers — indistinguishable from a successful fit.
        anchors = [
            self.anchor(i, odom, 2.0 * odom)
            for i, odom in enumerate([0.0, 10.0, 20.0, 30.0])
        ]

        inliers, outliers, scale, offset, success = filogenesis_core.ransac_linear_fit(
            anchors, rng_seed=1
        )

        self.assertFalse(success)
        self.assertEqual(inliers, [])
        self.assertEqual(outliers, [])
        self.assertEqual(scale, 1.0)
        self.assertEqual(offset, 0.0)

    def test_successful_fit_reports_success_and_rejects_the_outlier(self):
        anchors = [
            self.anchor(i, odom, odom + 100.0)
            for i, odom in enumerate([0.0, 10.0, 20.0, 30.0, 40.0])
        ]
        anchors.append(self.anchor(99, 25.0, 180.0))  # gross historical error

        inliers, outliers, scale, offset, success = filogenesis_core.ransac_linear_fit(
            anchors, rng_seed=7
        )

        self.assertTrue(success)
        self.assertEqual(len(inliers), 5)
        self.assertEqual([a.canonical_id for a in outliers], [99])
        self.assertAlmostEqual(scale, 1.0, places=6)
        self.assertAlmostEqual(offset, 100.0, places=6)

    def test_best_hypothesis_is_refined_with_a_least_squares_refit(self):
        # All four anchors are inliers of several 2-point hypotheses whose
        # raw scale/offset differ. The least-squares refit over the inlier
        # set makes the returned model unique and hypothesis-independent:
        # slope 498/500 = 0.996, offset 115 - 0.996 * 15 = 100.06.
        odoms = [0.0, 10.0, 20.0, 30.0]
        chainages = [100.0, 110.2, 119.8, 130.0]
        anchors = [
            self.anchor(i, odom, chainage)
            for i, (odom, chainage) in enumerate(zip(odoms, chainages))
        ]

        inliers, outliers, scale, offset, success = filogenesis_core.ransac_linear_fit(
            anchors, rng_seed=3
        )

        self.assertTrue(success)
        self.assertEqual(len(inliers), 4)
        self.assertEqual(outliers, [])
        self.assertAlmostEqual(scale, 0.996, places=6)
        self.assertAlmostEqual(offset, 100.06, places=6)

    def test_fewer_than_two_anchors_still_skips_sanitization_successfully(self):
        anchors = [self.anchor(1, 5.0, 105.0)]

        inliers, outliers, scale, offset, success = filogenesis_core.ransac_linear_fit(
            anchors
        )

        self.assertTrue(success)
        self.assertEqual(inliers, anchors)
        self.assertEqual(outliers, [])


class ConstrainedDtwTracebackTests(unittest.TestCase):
    """The traceback appends (i-1, j-1) before checking i == 0 / j == 0, so
    a traceback that touches row/column 0 could emit index -1 pairs into the
    warp path. The path must be filtered exactly like dtw_joint_sequence in
    engine/math_utils.py does."""

    def test_warping_path_never_contains_negative_indices(self):
        rng = np.random.RandomState(0)
        source = rng.rand(40)
        target = rng.rand(55)
        cost = filogenesis_core._compute_cost_matrix(source, target)
        masks = [
            None,
            filogenesis_core._build_constraint_mask(
                40, 55, [(5, 7, 0.4), (30, 41, 0.4)]
            ),
        ]

        for mask in masks:
            path, total_cost = filogenesis_core.dtw_constrained(cost, mask)
            self.assertTrue(path, "expected a warping path")
            self.assertTrue(all(a >= 0 and b >= 0 for a, b in path))
            self.assertEqual(path[0], (0, 0))
            self.assertEqual(path[-1], (39, 54))
            self.assertTrue(math.isfinite(total_cost))

    def test_fully_masked_matrix_reports_no_path_instead_of_garbage(self):
        cost = filogenesis_core._compute_cost_matrix(np.zeros(5), np.zeros(6))
        mask = np.full((5, 6), np.inf)

        path, total_cost = filogenesis_core.dtw_constrained(cost, mask)

        self.assertEqual(path, [])
        self.assertTrue(math.isinf(total_cost))


if __name__ == "__main__":
    unittest.main()
