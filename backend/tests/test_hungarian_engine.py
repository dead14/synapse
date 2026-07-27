import io
import json
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
import numpy as np


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "python_engines"))

import hungarian_engine
from hungarian_engine import HungarianAnomalyAlignmentEngine


class HungarianToleranceTests(unittest.TestCase):
    def setUp(self):
        # Construct without a database session: these tests exercise the pure cost policy.
        self.engine = HungarianAnomalyAlignmentEngine.__new__(HungarianAnomalyAlignmentEngine)
        self.engine.distance_tolerance_m = 0.5
        self.engine.us_gw_distance_tolerance = 0.2
        self.engine.ds_gw_distance_tolerance = 0.4
        self.engine.clock_tolerance = 15.0
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

    def test_depth_does_not_change_hungarian_pair_cost(self):
        old = self.feature(100.0, depth_pct=10.0)
        same_depth_new = self.feature(100.1, depth_pct=10.0)
        lower_depth_new = self.feature(100.1, depth_pct=2.0)

        same_depth_cost = self.engine.build_cost_matrix([old], [same_depth_new], [], [])[0][0]
        lower_depth_cost = self.engine.build_cost_matrix([old], [lower_depth_new], [], [])[0][0]

        self.assertEqual(lower_depth_cost, same_depth_cost)

    def test_rejects_pair_when_upstream_gw_relative_distance_is_inconsistent(self):
        old = self.feature(100.0, dist_to_us_gw_m=2.0)
        consistent_new = self.feature(100.1, dist_to_us_gw_m=2.1)
        inconsistent_new = self.feature(100.1, dist_to_us_gw_m=3.0)

        consistent_cost = self.engine.build_cost_matrix([old], [consistent_new], [], [])[0][0]
        inconsistent_cost = self.engine.build_cost_matrix([old], [inconsistent_new], [], [])[0][0]

        self.assertLess(consistent_cost, self.engine.INF_COST)
        self.assertEqual(inconsistent_cost, self.engine.INF_COST)

    def test_can_ignore_upstream_gw_distance_when_disabled(self):
        old = self.feature(100.0, dist_to_us_gw_m=2.0)
        new = self.feature(100.1, dist_to_us_gw_m=3.0)

        cost = self.engine.build_cost_matrix(
            [old], [new], [], [], {"use_us_gw_distance": False},
        )[0][0]

        self.assertLess(cost, self.engine.INF_COST)

    def test_disabling_upstream_gw_distance_overrides_onedirection_requirement(self):
        self.engine.require_us_gw_distance = True
        old = self.feature(100.0, dist_to_us_gw_m=2.0)
        new_without_us_distance = self.feature(100.1)

        cost = self.engine.build_cost_matrix(
            [old], [new_without_us_distance], [], [], {"use_us_gw_distance": False},
        )[0][0]

        self.assertLess(cost, self.engine.INF_COST)

    def test_rejects_pair_when_circular_clock_difference_exceeds_tolerance(self):
        old = self.feature(100.0, clock_position="12:00")
        near_clock_new = self.feature(100.1, clock_position="12:15")
        far_clock_new = self.feature(100.1, clock_position="06:00")

        near_cost = self.engine.build_cost_matrix([old], [near_clock_new], [], [])[0][0]
        far_cost = self.engine.build_cost_matrix([old], [far_clock_new], [], [])[0][0]

        self.assertLess(near_cost, self.engine.INF_COST)
        self.assertEqual(far_cost, self.engine.INF_COST)

    def test_clock_tolerance_override_controls_the_hard_gate(self):
        old = self.feature(100.0, clock_position="12:00")
        new = self.feature(100.1, clock_position="01:00")

        strict_scale_cost = self.engine.build_cost_matrix(
            [old], [new], [], [], {"clock_tolerance": 10}
        )[0][0]
        forgiving_scale_cost = self.engine.build_cost_matrix(
            [old], [new], [], [], {"clock_tolerance": 30}
        )[0][0]

        self.assertEqual(strict_scale_cost, self.engine.INF_COST)
        self.assertLess(forgiving_scale_cost, self.engine.INF_COST)

    def test_clock_tolerance_uses_the_shortest_distance_across_twelve_oclock(self):
        old = self.feature(100.0, clock_position="11:50")
        new = self.feature(100.1, clock_position="12:10")

        cost = self.engine.build_cost_matrix(
            [old], [new], [], [], {"clock_tolerance": 15}
        )[0][0]

        self.assertLess(cost, self.engine.INF_COST)

    def test_missing_clock_evidence_does_not_reject_an_otherwise_valid_pair(self):
        old = self.feature(100.0, clock_position=None)
        new = self.feature(100.1, clock_position="04:00")

        cost = self.engine.build_cost_matrix([old], [new], [], [])[0][0]

        self.assertLess(cost, self.engine.INF_COST)

    def test_rejects_pair_when_length_difference_exceeds_tolerance(self):
        old = self.feature(100.0, length_mm=10.0)
        new = self.feature(100.1, length_mm=61.0)

        cost = self.engine.build_cost_matrix([old], [new], [], [])[0][0]

        self.assertEqual(cost, self.engine.INF_COST)

    def test_length_difference_at_tolerance_boundary_remains_eligible(self):
        old = self.feature(100.0, length_mm=10.0)
        new = self.feature(100.1, length_mm=60.0)

        cost = self.engine.build_cost_matrix([old], [new], [], [])[0][0]

        self.assertLess(cost, self.engine.INF_COST)

    def test_dense_and_sparse_solvers_cannot_force_a_length_invalid_match(self):
        old = self.feature(100.0, length_mm=10.0)
        new = self.feature(100.1, length_mm=61.0)

        matrix = self.engine.build_cost_matrix([old], [new], [], [])
        edges = self.engine.build_sparse_cost_edges([old], [new], [], [])

        self.assertEqual(self.engine.solve_monotonic_assignment(matrix), [])
        self.assertEqual(edges, [])
        self.assertEqual(self.engine.solve_sparse_monotonic_assignment(1, 1, edges), [])

    def test_dense_and_sparse_candidate_builders_apply_every_hard_tolerance(self):
        invalid_pairs = [
            (self.feature(100.0), self.feature(99.7)),
            (self.feature(100.0), self.feature(100.5)),
            (
                self.feature(100.0, dist_to_us_gw_m=2.0),
                self.feature(100.1, dist_to_us_gw_m=2.3),
            ),
            (
                self.feature(100.0, clock_position="12:00"),
                self.feature(100.1, clock_position="01:00"),
            ),
            (
                self.feature(100.0, length_mm=10.0),
                self.feature(100.1, length_mm=61.0),
            ),
        ]

        for old, new in invalid_pairs:
            with self.subTest(old=old, new=new):
                matrix = self.engine.build_cost_matrix([old], [new], [], [])
                edges = self.engine.build_sparse_cost_edges([old], [new], [], [])
                self.assertEqual(matrix[0][0], self.engine.INF_COST)
                self.assertEqual(edges, [])

    def test_scalar_pair_cost_is_the_single_source_of_truth(self):
        # The sparse edge loop used to score each candidate by calling
        # build_cost_matrix([old], [new], ...)[0][0]: a fresh 1x1 numpy array
        # and a full re-resolve of every weight and tolerance per edge. Both
        # paths now share pair_cost, so they must agree cell for cell.
        old_features = [
            self.feature(100.0),
            self.feature(100.0, dist_to_us_gw_m=2.0),
            self.feature(100.0, clock_position="12:00", length_mm=10.0, width_mm=8.0),
            self.feature(100.0, length_mm=10.0),
        ]
        new_features = [
            self.feature(99.7),
            self.feature(99.9),
            self.feature(100.1, dist_to_us_gw_m=2.05),
            self.feature(100.2, clock_position="12:10", length_mm=18.0, width_mm=40.0),
            self.feature(100.3, length_mm=61.0),
        ]

        matrix = self.engine.build_cost_matrix(old_features, new_features, [], [])
        settings = self.engine.resolve_cost_settings(None)
        for i, old in enumerate(old_features):
            corrected = old["abs_distance_m"] + self.engine._interpolate_offset(
                old["abs_distance_m"], [], []
            )
            for j, new in enumerate(new_features):
                self.assertEqual(
                    matrix[i][j],
                    self.engine.pair_cost(old, new, corrected, settings),
                    f"cell ({i}, {j})",
                )

        edges = self.engine.build_sparse_cost_edges(old_features, new_features, [], [])
        for old_index, new_index, cost in edges:
            self.assertEqual(cost, matrix[old_index][new_index])
        dense_edges = {
            (i, j)
            for i in range(len(old_features))
            for j in range(len(new_features))
            if matrix[i][j] < self.engine.INF_COST
        }
        self.assertEqual({(i, j) for i, j, _cost in edges}, dense_edges)

    def test_pair_cost_honours_per_section_tolerance_overrides(self):
        old = self.feature(100.0, length_mm=10.0)
        new = self.feature(100.3, length_mm=61.0)
        overrides = {"ds_gw_distance_tolerance": 0.5, "length_tolerance": 100.0}

        settings = self.engine.resolve_cost_settings(overrides)
        scalar = self.engine.pair_cost(old, new, 100.0, settings)
        dense = self.engine.build_cost_matrix([old], [new], [], [], overrides)[0][0]

        self.assertEqual(scalar, dense)
        self.assertLess(scalar, self.engine.INF_COST)
        # Without the override the same pair is rejected on both counts.
        self.assertEqual(
            self.engine.build_cost_matrix([old], [new], [], [])[0][0],
            self.engine.INF_COST,
        )

    def test_reads_common_upstream_gw_distance_column_alias(self):
        value = self.engine._read_us_gw_distance({"Dist. to U/S GW (m)": "2.35"})

        self.assertEqual(value, 2.35)

    def test_upstream_gw_distance_uses_physical_magnitude_across_vendor_signs(self):
        value = self.engine._read_us_gw_distance({"dist_to_us_gw_m": "-8.64"})
        old = self.feature(100.0, dist_to_us_gw_m=-8.64)
        new = self.feature(100.1, dist_to_us_gw_m=8.64)

        self.assertEqual(value, 8.64)
        self.assertLess(
            self.engine.build_cost_matrix([old], [new], [], [])[0][0],
            self.engine.INF_COST,
        )

    def test_onedirection_strategy_requires_upstream_gw_distance_on_both_runs(self):
        self.engine.require_us_gw_distance = True
        old = self.feature(100.0, dist_to_us_gw_m=2.0)
        new_without_us_distance = self.feature(100.1)

        cost = self.engine.build_cost_matrix([old], [new_without_us_distance], [], [])[0][0]

        self.assertEqual(cost, self.engine.INF_COST)

    def test_phase_partition_uses_type_not_non_unique_locked_identifier(self):
        anomaly = {
            "id": "duplicate-vendor-id",
            "originalType": "metal loss",
            "raw": {"type": "anomaly"},
        }
        weld = {
            "id": "duplicate-vendor-id",
            "originalType": "girth weld anomaly",
            "raw": {"type": "weld"},
        }

        anomalies, bypassed = self.engine._partition_hungarian_features(
            [anomaly, weld],
            {"duplicate-vendor-id"},
        )

        self.assertEqual(anomalies, [anomaly])
        self.assertEqual(bypassed, [])

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


class FeatureQuery:
    def __init__(self, rows):
        self.rows = rows

    def filter(self, *_args, **_kwargs):
        return self

    def order_by(self, *_args, **_kwargs):
        return self

    def yield_per(self, _size):
        return iter(self.rows)


class SessionWithPersistedFeatures:
    def __init__(self, session_record, features):
        self.session_record = session_record
        self.features = features
        self.query_count = 0

    def query(self, *_args, **_kwargs):
        self.query_count += 1
        if self.query_count == 1:
            return FakeQuery(self.session_record)
        return FeatureQuery(self.features)


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

    def test_piecewise_tie_in_maps_historical_run_to_master_axis(self):
        params = {
            "summaryData": {
                "oldRun": {
                    "year": "2024",
                    "rawFeatures": [
                        {"id": "outside", "dist": 0.0},
                        {"id": "inside", "dist": 10.0},
                    ],
                },
                "newRun": {"year": "2026", "rawFeatures": [{"id": "master", "dist": 110.0}]},
            },
            "tieInDecision": {"status": "AUTO_ACCEPTED"},
            "tieInTransform": {
                "direction": "OLD_TO_NEW",
                "model": "MONOTONIC_PIECEWISE_LINEAR",
                "allowExtrapolation": False,
                "domain": {"oldStartM": 5.0, "oldEndM": 15.0},
                "knots": [
                    {"oldDistanceM": 5.0, "newDistanceM": 105.0},
                    {"oldDistanceM": 15.0, "newDistanceM": 115.0},
                ],
            },
        }
        engine = self.engine_with_params(params)

        historical = engine.fetch_data(is_old_run=True)
        master = engine.fetch_data(is_old_run=False)

        self.assertEqual([feature["id"] for feature in historical], ["outside", "inside"])
        self.assertTrue(historical[0]["tiein_outside_domain"])
        self.assertEqual(historical[1]["abs_distance_m"], 110.0)
        self.assertEqual(master[0]["abs_distance_m"], 110.0)

    def test_result_distance_fields_keep_mapped_and_original_values_separate(self):
        fields = HungarianAnomalyAlignmentEngine._result_distance_fields(
            {"abs_distance_m": 3905.57, "source_abs_distance_m": 42.243},
            {"abs_distance_m": 3905.57, "source_abs_distance_m": 3905.57},
        )

        self.assertEqual(fields["Log Dist OLD (m)"], 3905.57)
        self.assertEqual(fields["Log Dist NEW (m)"], 3905.57)
        self.assertEqual(fields["Original Log Dist OLD (m)"], 42.243)
        self.assertEqual(fields["Original Log Dist NEW (m)"], 3905.57)

    def test_legacy_inverted_field_names_are_resolved_by_survey_year(self):
        params = {
            "summaryData": {
                "oldRun": {"year": "2026", "rawFeatures": [{"id": "latest", "dist": 20}]},
                "newRun": {"year": "2021", "rawFeatures": [{"id": "historical", "dist": 10}]},
            }
        }
        engine = self.engine_with_params(params)

        historical = engine.fetch_data(is_old_run=True)
        master = engine.fetch_data(is_old_run=False)

        self.assertEqual(historical[0]["id"], "historical")
        self.assertEqual(master[0]["id"], "latest")
        self.assertTrue(engine.swap_persisted_runs)

    def test_master_binding_uses_latest_available_historical_run(self):
        params = {
            "summaryData": {
                "masterRun": {"year": "2026", "rawFeatures": [{"id": "master", "dist": 20}]},
                "historicalRuns": [
                    {"year": "2012", "rawFeatures": [{"id": "oldest", "dist": 8}]},
                    {"year": "2024", "rawFeatures": [{"id": "latest-old", "dist": 10}]},
                    {"year": "2020", "rawFeatures": [{"id": "middle", "dist": 9}]},
                ],
            }
        }
        engine = self.engine_with_params(params)

        historical = engine.fetch_data(is_old_run=True)
        master = engine.fetch_data(is_old_run=False)

        self.assertEqual(historical[0]["id"], "latest-old")
        self.assertEqual(master[0]["id"], "master")
        self.assertFalse(engine.swap_persisted_runs)

    def test_persisted_run_id_loads_canonical_features_instead_of_session_raw_rows(self):
        params = {
            "summaryData": {
                "masterRun": {"year": "2026", "runId": 9},
                "historicalRuns": [{"year": "2024", "runId": 8}],
            }
        }
        feature = SimpleNamespace(
            id=701,
            feature_id="vendor-weld-7",
            log_distance_m=120.5,
            feature_type="Girth Weld",
            feature_identification="GW-7",
            dist_to_us_gw_m=0.0,
            joint_length_m=12.0,
            clock_position="12:00",
            wall_thickness_mm=10.0,
            length_mm=None,
            width_mm=None,
            depth_pct=None,
            surface_location=None,
            erf_asme=None,
            psafe_bar=None,
            comment=None,
        )
        engine = HungarianAnomalyAlignmentEngine.__new__(HungarianAnomalyAlignmentEngine)
        engine.session_id = 42
        engine.session = SessionWithPersistedFeatures(
            SimpleNamespace(params_json=params),
            [feature],
        )

        persisted = engine.fetch_data(is_old_run=False)

        self.assertEqual(persisted[0]["id"], "701")
        self.assertEqual(persisted[0]["abs_distance_m"], 120.5)
        self.assertEqual(persisted[0]["raw"]["sourceFeatureId"], "vendor-weld-7")


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

    def test_legacy_inverted_gw_pair_is_swapped_to_historical_then_master(self):
        params_json = {
            "gwMatchesFinal": [{
                "old_id": "master-gw",
                "new_id": "historical-gw",
                "old_odometer": 12.0,
                "new_odometer": 10.0,
                "status": "MATCHED",
            }],
        }
        engine = HungarianAnomalyAlignmentEngine.__new__(HungarianAnomalyAlignmentEngine)
        engine.session_id = 42
        engine.session = FakeSession(SimpleNamespace(params_json=params_json))
        engine.swap_persisted_runs = True

        locked_pairs = engine.get_gw_matches()

        self.assertEqual(locked_pairs, [{"oldVal": 10.0, "newVal": 12.0, "offset": 2.0, "status": "Match"}])

    def test_only_anomaly_or_metal_loss_is_eligible_for_hungarian(self):
        self.assertTrue(HungarianAnomalyAlignmentEngine._is_matchable_anomaly({"originalType": "Metal loss"}))
        self.assertTrue(HungarianAnomalyAlignmentEngine._is_matchable_anomaly({"raw": {"type": "anomaly"}}))
        self.assertFalse(HungarianAnomalyAlignmentEngine._is_matchable_anomaly({"originalType": "weld"}))
        self.assertFalse(HungarianAnomalyAlignmentEngine._is_matchable_anomaly({"originalType": "marker"}))

    def test_phase_one_gws_are_not_duplicated_as_hungarian_bypasses(self):
        features = [
            {"id": "gw-matched", "originalType": "weld"},
            {"id": "gw-unmatched", "originalType": "tee"},
            {"id": "offtake-unmatched", "originalType": "offtake"},
            {"id": "bend-unmatched", "originalType": "bend"},
            {"id": "launcher-unmatched", "originalType": "launcher"},
            {"id": "receiver-unmatched", "originalType": "receiver"},
            {"id": "branch-unmatched", "originalType": "tee / branch connection"},
            {"id": "defect", "originalType": "metal loss"},
            {"id": "support", "originalType": "support"},
        ]

        anomalies, bypassed = HungarianAnomalyAlignmentEngine._partition_hungarian_features(
            features,
            locked_ids={"gw-matched"},
        )

        self.assertEqual([feature["id"] for feature in anomalies], ["defect"])
        self.assertEqual([feature["id"] for feature in bypassed], ["support"])

    def test_scenario_depth_does_not_filter_matching_candidates(self):
        engine = HungarianAnomalyAlignmentEngine.__new__(HungarianAnomalyAlignmentEngine)
        engine.depth_thresh = 10
        features = [
            {"id": "shallow", "depth_pct": 5},
            {"id": "eligible", "depth_pct": 20},
        ]

        eligible, filtered = engine._partition_scenario_features(features)

        self.assertEqual([feature["id"] for feature in eligible], ["shallow", "eligible"])
        self.assertEqual(filtered, [])

    def test_outside_tiein_domain_is_conserved_as_filtered_evidence(self):
        engine = HungarianAnomalyAlignmentEngine.__new__(HungarianAnomalyAlignmentEngine)
        features = [
            {"id": "outside", "tiein_outside_domain": True},
            {"id": "inside", "tiein_outside_domain": False},
        ]

        eligible, filtered = engine._partition_scenario_features(features)

        self.assertEqual([feature["id"] for feature in eligible], ["inside"])
        self.assertEqual([feature["id"] for feature in filtered], ["outside"])

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
    def test_sparse_assignment_preserves_order_and_maximizes_cardinality(self):
        edges = [
            (0, 0, 5.0),
            (0, 1, 0.0),
            (1, 0, 0.0),
            (1, 1, 5.0),
            (2, 2, 1.0),
        ]
        pairs = HungarianAnomalyAlignmentEngine.solve_sparse_monotonic_assignment(3, 3, edges)
        self.assertEqual(pairs, [(0, 0), (1, 1), (2, 2)])

    def test_sparse_assignment_ignores_crossing_only_edges(self):
        pairs = HungarianAnomalyAlignmentEngine.solve_sparse_monotonic_assignment(
            2, 2, [(0, 1, 0.0), (1, 0, 0.0)],
        )
        self.assertEqual(len(pairs), 1)

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

    def test_gw_pair_key_tolerates_a_missing_odometer(self):
        # Orphan pairs legitimately miss one odometer; float(None) used to raise.
        key = HungarianAnomalyAlignmentEngine._gw_pair_key(
            {"old_id": "o1", "new_id": "n1", "old_odometer": None, "new_odometer": 12.0}
        )
        self.assertEqual(key, "o1::n1::None::12.000000")

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

    def test_partial_sections_are_valid_and_leave_other_segments_on_global_match(self):
        locked = [
            {"old_id": "o1", "new_id": "n1", "old_odometer": 0.0, "new_odometer": 1.0},
            {"old_id": "o2", "new_id": "n2", "old_odometer": 10.0, "new_odometer": 11.0},
            {"old_id": "o3", "new_id": "n3", "old_odometer": 20.0, "new_odometer": 21.0},
        ]
        key = HungarianAnomalyAlignmentEngine._gw_pair_key

        result = HungarianAnomalyAlignmentEngine.compile_sections([{
            "id": "optional-area",
            "name": "Optional area",
            "startGwKey": key(locked[1]),
            "endGwKey": key(locked[2]),
            "policy": "MATCH",
        }], locked)

        self.assertTrue(result.is_valid)

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


class GwAnchorPartitionTests(unittest.TestCase):
    """Only DTW-eligible anchors may be reported as missing GW evidence.

    dtw_engine restricts anchors to {'weld','valve','tee'} on purpose ("strict
    Tier-1/Tier-2 anchors only"), so bends, elbows, flanges, launchers and
    receivers can never be consumed by Phase 1.  Sweeping them into
    gw_unmatched turned every one of them into permanent phantom missing
    evidence on every run.
    """

    @staticmethod
    def feature(feature_type, identification=""):
        return {
            "originalType": feature_type,
            "raw": {"feature_identification": identification},
        }

    def test_tier_one_and_two_labels_are_dtw_anchors(self):
        for label in ["weld", "girth weld", "seam", "valve", "tee",
                      "offtake", "branch connection"]:
            with self.subTest(label=label):
                item = self.feature(label)
                self.assertTrue(HungarianAnomalyAlignmentEngine._is_dtw_anchor_feature(item))
                self.assertFalse(HungarianAnomalyAlignmentEngine._is_structural_feature(item))

    def test_structural_fittings_are_not_dtw_anchors(self):
        for label in ["bend", "elbow", "launcher", "receiver", "flange"]:
            with self.subTest(label=label):
                item = self.feature(label)
                self.assertFalse(
                    HungarianAnomalyAlignmentEngine._is_dtw_anchor_feature(item),
                    f"{label} is not a DTW anchor and must not be reported as a missing GW",
                )
                self.assertTrue(HungarianAnomalyAlignmentEngine._is_structural_feature(item))

    def test_flange_is_detected_from_the_identification_column(self):
        item = self.feature("other", identification="joint flange")
        self.assertTrue(HungarianAnomalyAlignmentEngine._is_structural_feature(item))
        self.assertFalse(HungarianAnomalyAlignmentEngine._is_dtw_anchor_feature(item))

    def test_both_sets_stay_out_of_the_anomaly_matrix(self):
        # _is_gw_feature is the union, so partitioning behaviour is unchanged.
        for label in ["weld", "valve", "bend", "flange", "launcher"]:
            with self.subTest(label=label):
                self.assertTrue(
                    HungarianAnomalyAlignmentEngine._is_gw_feature(self.feature(label))
                )
        self.assertFalse(
            HungarianAnomalyAlignmentEngine._is_gw_feature(self.feature("metal loss"))
        )


class SectionIndexSpaceTests(unittest.TestCase):
    """Section boundaries and segment ids must index the same list.

    seg_id comes from get_gw_matches (filtered to MATCH/MATCHED, sorted by OLD
    odometer).  locked_gw_pairs used to be gw_matches_final sorted by NEW
    odometer and unfiltered -- a different length and a different order, so a
    BYPASS/REVIEW policy landed on the wrong stretch of pipe.
    """

    def engine(self):
        engine = HungarianAnomalyAlignmentEngine.__new__(HungarianAnomalyAlignmentEngine)
        engine.swap_persisted_runs = False
        return engine

    def test_non_matched_pairs_are_excluded(self):
        pairs = [
            {"old_id": "a", "new_id": "a2", "old_odometer": 10.0, "new_odometer": 110.0, "status": "MATCHED"},
            {"old_id": "b", "new_id": None, "old_odometer": 20.0, "new_odometer": None, "status": "ONLY_OLD"},
            {"old_id": "c", "new_id": "c2", "old_odometer": 30.0, "new_odometer": 130.0, "status": "MATCH"},
        ]
        canonical = self.engine()._canonical_locked_pairs(pairs)
        self.assertEqual([p["old_id"] for p in canonical], ["a", "c"])

    def test_ordering_follows_old_odometer_not_new(self):
        # A pair whose NEW order disagrees with its OLD order: sorting by NEW
        # would swap positions 1 and 2 and shift every section boundary.
        pairs = [
            {"old_id": "a", "new_id": "a2", "old_odometer": 10.0, "new_odometer": 300.0, "status": "MATCHED"},
            {"old_id": "b", "new_id": "b2", "old_odometer": 20.0, "new_odometer": 100.0, "status": "MATCHED"},
        ]
        canonical = self.engine()._canonical_locked_pairs(pairs)
        self.assertEqual([p["old_id"] for p in canonical], ["a", "b"])

    def test_unparseable_odometers_are_dropped(self):
        pairs = [
            {"old_id": "a", "new_id": "a2", "old_odometer": 10.0, "new_odometer": 110.0, "status": "MATCHED"},
            {"old_id": "bad", "new_id": "b2", "old_odometer": "N/A", "new_odometer": 120.0, "status": "MATCHED"},
        ]
        canonical = self.engine()._canonical_locked_pairs(pairs)
        self.assertEqual([p["old_id"] for p in canonical], ["a"])


class GwMonotonicityTests(unittest.TestCase):
    """A crossed GW lock must fail the run, not scramble the segments."""

    @staticmethod
    def pairs(*values):
        return [{"oldVal": old, "newVal": new} for old, new in values]

    def test_strictly_increasing_pairs_are_accepted(self):
        HungarianAnomalyAlignmentEngine._assert_monotonic_gw_pairs(
            self.pairs((10.0, 110.0), (20.0, 125.0), (30.0, 140.0))
        )

    def test_crossed_lock_is_rejected(self):
        # Sorted by OLD, but NEW goes backwards -- run2_boundaries would be
        # non-monotonic and bisect_right would return a meaningless index.
        with self.assertRaises(ValueError) as ctx:
            HungarianAnomalyAlignmentEngine._assert_monotonic_gw_pairs(
                self.pairs((10.0, 110.0), (20.0, 105.0), (30.0, 140.0))
            )
        self.assertIn("strictly", str(ctx.exception))

    def test_duplicate_boundary_is_rejected(self):
        with self.assertRaises(ValueError):
            HungarianAnomalyAlignmentEngine._assert_monotonic_gw_pairs(
                self.pairs((10.0, 110.0), (10.0, 120.0))
            )

    def test_empty_and_single_pair_are_trivially_monotonic(self):
        HungarianAnomalyAlignmentEngine._assert_monotonic_gw_pairs([])
        HungarianAnomalyAlignmentEngine._assert_monotonic_gw_pairs(self.pairs((10.0, 110.0)))


class FieldFallbackTests(unittest.TestCase):
    """A legitimate 0.0 reading must never fall through to another key."""

    def test_first_present_prefers_zero_over_fallback_keys(self):
        record = {"depth_pct": 0.0, "depth": 55.0}
        self.assertEqual(
            hungarian_engine._first_present(record, "depth_pct", "depth"), 0.0
        )

    def test_first_present_skips_none_and_blank_strings(self):
        self.assertEqual(
            hungarian_engine._first_present({"depth_pct": None, "depth": 7.5}, "depth_pct", "depth"),
            7.5,
        )
        self.assertEqual(
            hungarian_engine._first_present({"length_mm": "   ", "length": 3.0}, "length_mm", "length"),
            3.0,
        )
        self.assertIsNone(hungarian_engine._first_present({}, "depth_pct", "depth"))

    def test_fetch_data_preserves_zero_valued_readings_and_id(self):
        params = {
            "summaryData": {
                "newRun": {
                    "rawFeatures": [{
                        "id": 0,
                        "feature_id": "vendor-1",
                        "type": "metal loss",
                        "dist": 100.0,
                        "depth_pct": 0.0,
                        "depth": 55.0,
                        "length_mm": 0.0,
                        "length": 44.0,
                        "width_mm": 0.0,
                        "width": 33.0,
                    }]
                }
            },
        }
        engine = HungarianTieInOffsetTests.engine_with_params(params)

        feature = engine.fetch_data(is_old_run=False)[0]

        self.assertEqual(feature["depth_pct"], 0.0)
        self.assertEqual(feature["length_mm"], 0.0)
        self.assertEqual(feature["width_mm"], 0.0)
        # A vendor row id of 0 must not fall through to feature_id.
        self.assertEqual(feature["id"], "0")


class MissingSurveyYearTests(unittest.TestCase):
    """Missing survey years disable growth output instead of fabricating a span."""

    @staticmethod
    def engine_with_years(old_year, new_year):
        engine = HungarianAnomalyAlignmentEngine.__new__(HungarianAnomalyAlignmentEngine)
        engine.run_1_year = old_year
        engine.run_2_year = new_year
        return engine

    def test_year_span_requires_both_survey_years(self):
        self.assertEqual(self.engine_with_years(2021, 2026)._growth_year_span(), 5)
        self.assertIsNone(self.engine_with_years(None, 2026)._growth_year_span())
        self.assertIsNone(self.engine_with_years(2021, None)._growth_year_span())

    def test_missing_year_produces_a_review_warning_entry(self):
        warnings = self.engine_with_years(None, 2026)._missing_survey_year_warnings()
        self.assertEqual(len(warnings), 1)
        self.assertEqual(warnings[0]["code"], "MISSING_SURVEY_YEAR")
        self.assertEqual(warnings[0]["severity"], "REVIEW")
        self.assertIn("OLD", warnings[0]["message"])
        self.assertEqual(
            self.engine_with_years(2021, 2026)._missing_survey_year_warnings(), []
        )

    def test_run_year_is_never_fabricated_from_the_current_date(self):
        self.assertIsNone(HungarianAnomalyAlignmentEngine._run_year({}))
        self.assertEqual(HungarianAnomalyAlignmentEngine._run_year({"year": "2024"}), 2024)
        self.assertEqual(HungarianAnomalyAlignmentEngine._run_year({"surveyYear": 2019}), 2019)

    def test_payload_reports_missing_year_and_skips_growth(self):
        engine = HungarianAnomalyAlignmentEngine.__new__(HungarianAnomalyAlignmentEngine)
        engine.session_id = 7
        engine.session = FakeSession(SimpleNamespace(params_json={
            "gwMatchesFinal": [],
            "gwOrphans": [],
        }))
        engine.run_1_year = None
        engine.run_2_year = 2026
        engine.clock_tolerance = 15.0
        engine.us_gw_distance_tolerance = 1.0
        engine.ds_gw_distance_tolerance = 1.0
        engine.length_tolerance = 400.0
        engine.fetch_data = lambda is_old_run: (
            [{"id": "old-ml", "abs_distance_m": 10.0, "depth_pct": 10.0, "length_mm": None,
              "width_mm": None, "dist_to_us_gw_m": None, "clock_position": None,
              "originalType": "metal loss"}]
            if is_old_run else
            [{"id": "new-ml", "abs_distance_m": 10.1, "depth_pct": 20.0, "length_mm": None,
              "width_mm": None, "dist_to_us_gw_m": None, "clock_position": None,
              "originalType": "metal loss"}]
        )
        engine.get_gw_matches = lambda: []

        output = io.StringIO()
        with redirect_stdout(output):
            engine.perform_alignment()
        payload = output.getvalue().split("___RESULT_JSON_BEGIN___\n", 1)[1].split("\n___RESULT_JSON_END___", 1)[0]
        result = json.loads(payload)

        matched = result["anomaly_matched"][0]
        self.assertEqual(matched["Depth Growth (%WT/yr)"], "-")
        self.assertEqual(matched["Length Growth (mm/yr)"], "-")
        self.assertIsNone(matched["Run Year OLD"])
        self.assertEqual(matched["Run Year NEW"], 2026)
        self.assertEqual(result["audit"]["warnings"][0]["code"], "MISSING_SURVEY_YEAR")


class DistanceCoercionTests(unittest.TestCase):
    """An unreadable odometer must never become chainage 0.0."""

    def test_real_values_parse(self):
        self.assertEqual(hungarian_engine._coerce_distance(1234.5), 1234.5)
        self.assertEqual(hungarian_engine._coerce_distance("1234.5"), 1234.5)
        self.assertEqual(hungarian_engine._coerce_distance("  88.2 "), 88.2)
        # A genuine zero is a valid chainage and must survive.
        self.assertEqual(hungarian_engine._coerce_distance("0"), 0.0)

    def test_thousands_separator_is_not_a_decimal_comma(self):
        self.assertEqual(hungarian_engine._coerce_distance("12,345.6"), 12345.6)

    def test_unreadable_values_return_none_rather_than_zero(self):
        for value in ["N/A", "#N/A", "", "   ", None, "-", "abc",
                      float("nan"), float("inf"), True]:
            with self.subTest(value=value):
                self.assertIsNone(hungarian_engine._coerce_distance(value))


if __name__ == "__main__":
    unittest.main()
