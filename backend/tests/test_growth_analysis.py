import sys
import unittest
from pathlib import Path


# Match the other engine tests: resolve the module through the engine directory
# rather than a "backend." package root, which only exists when the suite is
# invoked from the repository root and so kept this file out of the gate.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "python_engines"))

from growth_analysis import estimate_growth_rate


class GrowthAnalysisTests(unittest.TestCase):
    def test_estimates_weighted_multi_run_growth_with_review_only_status(self):
        result = estimate_growth_rate([
            {"observed_at": "2022-01-01", "depth_pct": 10, "uncertainty_pct": 1},
            {"observed_at": "2023-01-01", "depth_pct": 12, "uncertainty_pct": 1},
            {"observed_at": "2024-01-01", "depth_pct": 14, "uncertainty_pct": 1},
        ])

        self.assertEqual(result["status"], "REVIEW_REQUIRED")
        self.assertEqual(result["measurement_count"], 3)
        self.assertAlmostEqual(result["estimated_growth_pct_per_year"], 2.0, places=2)
        self.assertLess(result["confidence_interval_95_pct_per_year"][0], 2.0)
        self.assertGreater(result["confidence_interval_95_pct_per_year"][1], 2.0)

    def test_rejects_two_run_or_missing_uncertainty_inputs(self):
        with self.assertRaisesRegex(ValueError, "at least three"):
            estimate_growth_rate([
                {"observed_at": "2022-01-01", "depth_pct": 10, "uncertainty_pct": 1},
                {"observed_at": "2023-01-01", "depth_pct": 12, "uncertainty_pct": 1},
            ])
        with self.assertRaisesRegex(ValueError, "uncertainty_pct"):
            estimate_growth_rate([
                {"observed_at": "2022-01-01", "depth_pct": 10, "uncertainty_pct": 1},
                {"observed_at": "2023-01-01", "depth_pct": 12},
                {"observed_at": "2024-01-01", "depth_pct": 14, "uncertainty_pct": 1},
            ])


if __name__ == "__main__":
    unittest.main()
