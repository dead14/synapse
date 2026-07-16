import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
import numpy as np


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

    def test_rejects_pair_when_upstream_gw_relative_distance_is_inconsistent(self):
        old = self.feature(100.0, dist_to_us_gw_m=2.0)
        consistent_new = self.feature(100.1, dist_to_us_gw_m=2.1)
        inconsistent_new = self.feature(100.1, dist_to_us_gw_m=3.0)

        consistent_cost = self.engine.build_cost_matrix([old], [consistent_new], [], [])[0][0]
        inconsistent_cost = self.engine.build_cost_matrix([old], [inconsistent_new], [], [])[0][0]

        self.assertLess(consistent_cost, self.engine.INF_COST)
        self.assertEqual(inconsistent_cost, self.engine.INF_COST)

    def test_reads_common_upstream_gw_distance_column_alias(self):
        value = self.engine._read_us_gw_distance({"Dist. to U/S GW (m)": "2.35"})

        self.assertEqual(value, 2.35)

    def test_onedirection_strategy_requires_upstream_gw_distance_on_both_runs(self):
        self.engine.require_us_gw_distance = True
        old = self.feature(100.0, dist_to_us_gw_m=2.0)
        new_without_us_distance = self.feature(100.1)

        cost = self.engine.build_cost_matrix([old], [new_without_us_distance], [], [])[0][0]

        self.assertEqual(cost, self.engine.INF_COST)

    def test_depth_decrease_is_preserved_as_a_physics_review_warning(self):
        warnings = self.engine._physics_warnings(
            self.feature(100.0, depth_pct=10.0),
            self.feature(100.1, depth_pct=8.0),
        )

        self.assertEqual(warnings[0]["code"], "DEPTH_DECREASE")
        self.assertEqual(warnings[0]["deltaPctWt"], -2.0)


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


class HungarianGwLockTests(unittest.TestCase):
    def test_uses_final_gw_pairs_as_the_only_anomaly_segment_boundaries(self):
        """A stale legacy DTW payload must not rematch or move locked GWs."""
        params_json = {
            "gwMatches": [
                {"oldDist": 10.0, "newDist": 999.0, "status": "Match"},
            ],
            "gwMatchesFinal": [
                {
                    "old_id": "old-gw-1",
                    "new_id": "new-gw-1",
                    "old_odometer": 10.0,
                    "new_odometer": 12.0,
                    "status": "MATCHED",
                },
            ],
        }
        engine = HungarianAnomalyAlignmentEngine.__new__(HungarianAnomalyAlignmentEngine)
        engine.session_id = 42
        engine.session = FakeSession(SimpleNamespace(params_json=params_json))

        locked_pairs = engine.get_gw_matches()

        self.assertEqual(locked_pairs, [{"oldVal": 10.0, "newVal": 12.0, "offset": 2.0, "status": "Match"}])
        self.assertEqual(engine.assign_to_segment(10.1, [pair["oldVal"] for pair in locked_pairs]), 1)

    def test_only_anomaly_or_metal_loss_is_eligible_for_hungarian(self):
        self.assertTrue(HungarianAnomalyAlignmentEngine._is_matchable_anomaly({"originalType": "Metal loss"}))
        self.assertTrue(HungarianAnomalyAlignmentEngine._is_matchable_anomaly({"raw": {"type": "anomaly"}}))
        self.assertFalse(HungarianAnomalyAlignmentEngine._is_matchable_anomaly({"originalType": "weld"}))
        self.assertFalse(HungarianAnomalyAlignmentEngine._is_matchable_anomaly({"originalType": "marker"}))

    def test_phase_one_gws_are_not_duplicated_as_hungarian_bypasses(self):
        features = [
            {"id": "gw-matched", "originalType": "weld"},
            {"id": "gw-unmatched", "originalType": "tee"},
            {"id": "defect", "originalType": "metal loss"},
            {"id": "support", "originalType": "support"},
        ]

        anomalies, bypassed = HungarianAnomalyAlignmentEngine._partition_hungarian_features(
            features,
            locked_ids={"gw-matched"},
        )

        self.assertEqual([feature["id"] for feature in anomalies], ["defect"])
        self.assertEqual([feature["id"] for feature in bypassed], ["support"])

    def test_scenario_filter_partitions_instead_of_dropping_shallow_anomalies(self):
        engine = HungarianAnomalyAlignmentEngine.__new__(HungarianAnomalyAlignmentEngine)
        engine.depth_thresh = 10
        features = [
            {"id": "shallow", "depth_pct": 5},
            {"id": "eligible", "depth_pct": 20},
        ]

        eligible, filtered = engine._partition_scenario_features(features)

        self.assertEqual([feature["id"] for feature in eligible], ["eligible"])
        self.assertEqual([feature["id"] for feature in filtered], ["shallow"])

    def test_conservation_audit_reports_missing_and_duplicate_source_keys(self):
        audit = HungarianAnomalyAlignmentEngine._build_conservation_audit(
            old_features=[{"source_key": "OLD:1"}, {"source_key": "OLD:2"}],
            new_features=[{"source_key": "NEW:1"}],
            output_rows=[
                {"Source Key OLD": "OLD:1", "Source Key NEW": "NEW:1"},
                {"Source Key OLD": "OLD:1", "Source Key NEW": "-"},
            ],
        )

        self.assertFalse(audit["isConserved"])
        self.assertEqual(audit["old"]["missingKeys"], ["OLD:2"])
        self.assertEqual(audit["old"]["duplicateKeys"], ["OLD:1"])


class OrderedAnomalyMatchingTests(unittest.TestCase):
    def test_crossing_pairs_are_never_returned_even_when_they_are_cheapest(self):
        inf = HungarianAnomalyAlignmentEngine.INF_COST
        crossing_cost = np.array([
            [5.0, 0.0],
            [0.0, 5.0],
        ])

        pairs = HungarianAnomalyAlignmentEngine.solve_monotonic_assignment(crossing_cost)

        self.assertEqual(pairs, [(0, 0), (1, 1)])
        self.assertTrue(all(
            old_a < old_b and new_a < new_b
            for (old_a, new_a), (old_b, new_b) in zip(pairs, pairs[1:])
        ))
        self.assertTrue(all(crossing_cost[i, j] < inf for i, j in pairs))

    def test_invalid_diagonal_does_not_force_a_crossing_assignment(self):
        inf = HungarianAnomalyAlignmentEngine.INF_COST
        crossing_only_cost = np.array([
            [inf, 0.0],
            [0.0, inf],
        ])

        pairs = HungarianAnomalyAlignmentEngine.solve_monotonic_assignment(crossing_only_cost)

        self.assertEqual(len(pairs), 1)
        self.assertIn(pairs[0], {(0, 1), (1, 0)})

    def test_section_boundaries_must_use_locked_gw_pairs_and_not_overlap(self):
        locked = [
            {"old_id": "o1", "new_id": "n1", "old_odometer": 0.0, "new_odometer": 1.0},
            {"old_id": "o2", "new_id": "n2", "old_odometer": 10.0, "new_odometer": 11.0},
            {"old_id": "o3", "new_id": "n3", "old_odometer": 20.0, "new_odometer": 21.0},
        ]
        key = HungarianAnomalyAlignmentEngine._gw_pair_key

        sections = HungarianAnomalyAlignmentEngine.compile_sections([
            {"id": "a", "name": "A", "startGwKey": key(locked[0]), "endGwKey": key(locked[2]), "policy": "MATCH"},
            {"id": "b", "name": "B", "startGwKey": key(locked[1]), "endGwKey": key(locked[2]), "policy": "MATCH"},
        ], locked)

        self.assertFalse(sections.is_valid)
        self.assertIn("overlap", " ".join(sections.errors).lower())

    def test_section_compilation_resolves_old_and_new_boundaries_from_same_gw_pairs(self):
        locked = [
            {"old_id": "o1", "new_id": "n1", "old_odometer": 0.0, "new_odometer": 1.0},
            {"old_id": "o2", "new_id": "n2", "old_odometer": 10.0, "new_odometer": 12.0},
        ]
        key = HungarianAnomalyAlignmentEngine._gw_pair_key

        result = HungarianAnomalyAlignmentEngine.compile_sections([
            {"id": "main", "name": "Main", "startGwKey": key(locked[0]), "endGwKey": key(locked[1]), "policy": "MATCH"},
        ], locked)

        self.assertTrue(result.is_valid)
        self.assertEqual(
            (result.sections[0]["old_start"], result.sections[0]["old_end"]),
            (0.0, 10.0),
        )
        self.assertEqual(
            (result.sections[0]["new_start"], result.sections[0]["new_end"]),
            (1.0, 12.0),
        )
        self.assertEqual(result.sections[0]["reference_run"], "NEW")

    def test_section_compilation_rejects_crossing_locked_gw_pairs(self):
        locked = [
            {"old_id": "o1", "new_id": "n1", "old_odometer": 10.0, "new_odometer": 1.0},
            {"old_id": "o2", "new_id": "n2", "old_odometer": 5.0, "new_odometer": 12.0},
        ]
        key = HungarianAnomalyAlignmentEngine._gw_pair_key

        result = HungarianAnomalyAlignmentEngine.compile_sections([{
            "name": "Main",
            "startGwKey": key(locked[0]),
            "endGwKey": key(locked[1]),
            "policy": "MATCH",
        }], locked)

        self.assertFalse(result.is_valid)
        self.assertIn("strictly", " ".join(result.errors))


if __name__ == "__main__":
    unittest.main()
