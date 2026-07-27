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


def _full_matrix_dtw(cost_matrix, constraint_mask=None, sakoe_chiba_band=None):
    """The pre-band reference DP, kept in the test rather than the engine.

    Materialises the whole (n+1) x (m+1) accumulator, which is exactly what the
    production implementation must never do; keeping it here lets the banded
    solver be checked against it on inputs small enough to afford it.
    """
    n, m = cost_matrix.shape
    combined = (
        cost_matrix + constraint_mask if constraint_mask is not None
        else cost_matrix.copy()
    )
    accumulated = np.full((n + 1, m + 1), np.inf)
    accumulated[0, 0] = 0.0
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if sakoe_chiba_band is not None and abs(i * m / n - j) > sakoe_chiba_band:
                continue
            accumulated[i, j] = combined[i - 1, j - 1] + min(
                accumulated[i - 1, j],
                accumulated[i, j - 1],
                accumulated[i - 1, j - 1],
            )
    if np.isinf(accumulated[n, m]):
        return [], float("inf")
    path = []
    i, j = n, m
    while i > 0 or j > 0:
        path.append((i - 1, j - 1))
        if i == 0:
            j -= 1
        elif j == 0:
            i -= 1
        else:
            _, i, j = min(
                [
                    (accumulated[i - 1, j - 1], i - 1, j - 1),
                    (accumulated[i - 1, j], i - 1, j),
                    (accumulated[i, j - 1], i, j - 1),
                ],
                key=lambda candidate: candidate[0],
            )
    path.reverse()
    return [(a, b) for (a, b) in path if a >= 0 and b >= 0], accumulated[n, m]


class BandedDtwEquivalenceTests(unittest.TestCase):
    """The banded solver must reproduce the full-matrix DP exactly.

    Production signals are sampled at 0.1 m, so a 4 km run is 40k x 40k: four
    float64 grids of 12.8 GB each, plus a pure-Python double loop over 1.6e9
    cells. Nothing may allocate n*m any more, and the banded replacement has to
    stay bit-compatible with the DP it replaces.
    """

    def _assert_same(self, source, target, constraints=None, band=None):
        cost = filogenesis_core._compute_cost_matrix(source, target)
        mask = (
            filogenesis_core._build_constraint_mask(
                len(source), len(target), constraints
            )
            if constraints
            else None
        )
        expected_path, expected_cost = _full_matrix_dtw(cost, mask, band)

        dense_path, dense_cost = filogenesis_core.dtw_constrained(cost, mask, band)
        signal_path, signal_cost, stats = filogenesis_core.dtw_constrained_signals(
            source, target, constraints, 0.1, band
        )

        self.assertEqual(dense_path, expected_path)
        self.assertEqual(signal_path, expected_path)
        if math.isinf(expected_cost):
            self.assertTrue(math.isinf(dense_cost))
            self.assertTrue(math.isinf(signal_cost))
        else:
            self.assertAlmostEqual(dense_cost, expected_cost, places=9)
            self.assertAlmostEqual(signal_cost, expected_cost, places=9)
        self.assertLessEqual(stats["banded_cells"], stats["full_cells"])

    def test_unconstrained_signals_match_the_full_matrix(self):
        rng = np.random.RandomState(0)
        for _ in range(12):
            n, m = int(rng.randint(3, 70)), int(rng.randint(3, 70))
            self._assert_same(rng.rand(n), rng.rand(m))

    def test_anchor_constrained_signals_match_the_full_matrix(self):
        rng = np.random.RandomState(7)
        for _ in range(12):
            n, m = int(rng.randint(20, 80)), int(rng.randint(20, 80))
            constraints = [
                (int(rng.randint(0, n)), int(rng.randint(0, m)), float(rng.rand()))
                for _ in range(int(rng.randint(1, 4)))
            ]
            self._assert_same(rng.rand(n), rng.rand(m), constraints)

    def test_sakoe_chiba_band_matches_the_full_matrix(self):
        rng = np.random.RandomState(11)
        for _ in range(8):
            n, m = int(rng.randint(20, 60)), int(rng.randint(20, 60))
            self._assert_same(
                rng.rand(n), rng.rand(m), band=int(rng.randint(1, 25))
            )

    def test_impulse_signals_match_the_full_matrix(self):
        # Production signals are sparse impulses, so most costs are exactly 0
        # and ties are everywhere. Tie-breaking must survive the rewrite.
        rng = np.random.RandomState(3)
        for _ in range(4):
            source = np.zeros(150)
            target = np.zeros(180)
            source[rng.choice(150, 15, replace=False)] = 1.0
            target[rng.choice(180, 15, replace=False)] = 1.0
            self._assert_same(source, target)


class BandedDtwMemoryTests(unittest.TestCase):
    def test_twenty_thousand_samples_evaluate_far_fewer_than_n_times_m_cells(self):
        size = 20_000
        rng = np.random.RandomState(1)
        source = np.zeros(size)
        target = np.zeros(size)
        source[rng.choice(size, size // 100, replace=False)] = 1.0
        target[rng.choice(size, size // 100, replace=False)] = 1.0

        path, total_cost, stats = filogenesis_core.dtw_constrained_signals(
            source, target, None, 0.1
        )

        self.assertEqual(stats["full_cells"], size * size)
        # Band bookkeeping, not RSS: the DP may only touch a Sakoe-Chiba strip.
        radius = filogenesis_core.DTW_BAND_RADIUS_SAMPLES
        self.assertLessEqual(stats["banded_cells"], size * (2 * radius + 1))
        self.assertLess(stats["banded_cells"] * 10, stats["full_cells"])
        self.assertTrue(path)
        self.assertEqual(path[0], (0, 0))
        self.assertEqual(path[-1], (size - 1, size - 1))
        self.assertTrue(math.isfinite(total_cost))

    def test_small_grids_still_run_unbanded(self):
        # Below the cell budget the band is the whole grid, so results stay
        # identical to the pre-band engine without any radius tuning.
        rng = np.random.RandomState(2)
        _path, _cost, stats = filogenesis_core.dtw_constrained_signals(
            rng.rand(300), rng.rand(400), None, 0.1
        )
        self.assertEqual(stats["banded_cells"], stats["full_cells"])


class SignalResolutionTests(unittest.TestCase):
    def test_sampling_stays_native_below_the_cap(self):
        interval, coarsened = filogenesis_core.resolve_sampling_interval(
            1_000.0, 0.1, 20_000
        )
        self.assertEqual(interval, 0.1)
        self.assertFalse(coarsened)

    def test_sampling_coarsens_above_the_cap(self):
        interval, coarsened = filogenesis_core.resolve_sampling_interval(
            4_000.0, 0.1, 20_000
        )
        self.assertTrue(coarsened)
        self.assertGreater(interval, 0.1)
        self.assertLessEqual(4_000.0 / interval, 20_000)

    def test_coarsened_step_stays_on_the_native_grid(self):
        interval, _coarsened = filogenesis_core.resolve_sampling_interval(
            9_999.0, 0.1, 20_000
        )
        self.assertAlmostEqual(interval / 0.1, round(interval / 0.1), places=9)

    def test_empty_or_degenerate_runs_keep_the_native_step(self):
        self.assertEqual(
            filogenesis_core.resolve_sampling_interval(0.0), (0.1, False)
        )
        self.assertEqual(
            filogenesis_core.resolve_sampling_interval(float("nan")), (0.1, False)
        )


if __name__ == "__main__":
    unittest.main()
