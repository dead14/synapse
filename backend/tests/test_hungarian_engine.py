import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "python_engines"))

from hungarian_engine import HungarianAnomalyAlignmentEngine


class HungarianToleranceTests(unittest.TestCase):
    def setUp(self):
        # Construct without a database session: these tests exercise the pure cost policy.
        self.engine = HungarianAnomalyAlignmentEngine.__new__(HungarianAnomalyAlignmentEngine)
        self.engine.distance_tolerance_m = 0.5
        self.engine.us_gw_distance_tolerance = 0.2
        self.engine.ds_gw_distance_tolerance = 0.4
        self.engine.clock_tolerance = 15.0
        self.engine.depth_tolerance = 10.0
        self.engine.length_tolerance = 50.0

    @staticmethod
    def feature(distance, **values):
        return {
            "abs_distance_m": distance,
            "dist_to_us_gw_m": None,
            "clock_position": None,
            "depth_pct": None,
            "length_mm": None,
            "width_mm": None,
            **values,
        }

    def test_uses_directional_distance_tolerances_from_the_wizard(self):
        old = self.feature(100.0)
        upstream_new = self.feature(99.4)
        downstream_new = self.feature(100.3)

        upstream_cost = self.engine.build_cost_matrix([old], [upstream_new], [], [])[0][0]
        downstream_cost = self.engine.build_cost_matrix([old], [downstream_new], [], [])[0][0]

        self.assertEqual(upstream_cost, self.engine.INF_COST)
        self.assertLess(downstream_cost, self.engine.INF_COST)

    def test_scores_depth_difference_instead_of_splitting_anomaly_pair(self):
        old = self.feature(100.0, depth_pct=10.0)
        new = self.feature(100.1, depth_pct=25.0)

        cost = self.engine.build_cost_matrix([old], [new], [], [])[0][0]

        self.assertLess(cost, self.engine.INF_COST)


if __name__ == "__main__":
    unittest.main()
