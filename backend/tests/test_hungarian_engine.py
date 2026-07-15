import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


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


class FakeQuery:
    def __init__(self, record):
        self.record = record

    def filter(self, *_args, **_kwargs):
        return self

    def first(self):
        return self.record


class FakeSession:
    def __init__(self, record):
        self.record = record

    def query(self, *_args, **_kwargs):
        return FakeQuery(self.record)


class HungarianTieInOffsetTests(unittest.TestCase):
    @staticmethod
    def engine_with_params(params_json):
        engine = HungarianAnomalyAlignmentEngine.__new__(HungarianAnomalyAlignmentEngine)
        engine.session_id = 42
        engine.session = FakeSession(SimpleNamespace(params_json=params_json))
        return engine

    @staticmethod
    def params(offsets):
        return {
            **offsets,
            "summaryData": {
                "newRun": {
                    "rawFeatures": [
                        {
                            "id": "new-anomaly",
                            "type": "metal loss",
                            "dist": 100.0,
                        }
                    ]
                }
            },
        }

    def test_global_offset_from_the_wizard_is_applied_to_new_run_coordinates(self):
        engine = self.engine_with_params(self.params({"globalOffset": 12.5}))

        features = engine.fetch_data(is_old_run=False)

        self.assertEqual(features[0]["abs_distance_m"], 112.5)

    def test_global_offset_takes_precedence_over_the_legacy_key(self):
        engine = self.engine_with_params(
            self.params({"globalOffset": 12.5, "tieInOffset": 99.0})
        )

        features = engine.fetch_data(is_old_run=False)

        self.assertEqual(features[0]["abs_distance_m"], 112.5)

    def test_legacy_tie_in_offset_remains_supported(self):
        engine = self.engine_with_params(self.params({"tieInOffset": -5.0}))

        features = engine.fetch_data(is_old_run=False)

        self.assertEqual(features[0]["abs_distance_m"], 95.0)


if __name__ == "__main__":
    unittest.main()
