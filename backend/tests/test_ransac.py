"""Compatibility regression for the dependency-free robust affine fit."""

import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "python_engines"))

import tiein_engine


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


if __name__ == "__main__":
    unittest.main()

