import sys
import unittest
from pathlib import Path
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "python_engines"))

import dtw_engine


class DtwEngineRegressionTests(unittest.TestCase):
    @staticmethod
    def weld(feature_id, distance):
        return {"id": feature_id, "type": "weld", "dist": distance}

    def test_welds_outside_the_physical_window_are_not_force_matched(self):
        result = dtw_engine.process_request(
            {
                "requestId": 1,
                "ota": 1.5,
                "strictPenalty": True,
                "oldRun": [self.weld("old-weld", 0.0)],
                "newRun": [self.weld("new-weld", 1000.0)],
            }
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["stats"]["matchedGws"], 0)
        self.assertFalse(any(match["status"] == "Match" for match in result["gwMatches"]))
        self.assertCountEqual(
            [orphan["status"] for orphan in result["gwOrphans"]],
            ["ONLY_OLD", "ONLY_NEW"],
        )

    def test_welds_inside_the_physical_window_remain_matchable(self):
        result = dtw_engine.process_request(
            {
                "requestId": 2,
                "ota": 1.5,
                "strictPenalty": True,
                "oldRun": [self.weld("old-weld", 100.0)],
                "newRun": [self.weld("new-weld", 105.0)],
            }
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["stats"]["matchedGws"], 1)
        self.assertEqual(result["gwMatchesFinal"][0]["old_id"], "old-weld")
        self.assertEqual(result["gwMatchesFinal"][0]["new_id"], "new-weld")

    def test_partial_run_without_tiein_is_rejected_before_raw_odometer_matching(self):
        result = dtw_engine.process_request(
            {
                "requestId": "missing-tiein",
                "partialRunEnabled": True,
                "oldRun": [self.weld("old-weld", 0.0)],
                "newRun": [self.weld("new-weld", 0.0)],
            }
        )

        self.assertFalse(result["success"])
        self.assertEqual(result["code"], "PARTIAL_RUN_TIEIN_REQUIRED")

    def test_canonical_tiein_maps_old_history_to_new_master_piecewise(self):
        result = dtw_engine.process_request(
            {
                "requestId": "canonical-tiein",
                "ota": 5.0,
                "oldRun": [
                    self.weld("old-launcher", 0.0),
                    self.weld("old-1", 4.0),
                    self.weld("old-2", 16.0),
                    self.weld("old-3", 28.0),
                ],
                "newRun": [
                    self.weld("new-1", 100.0),
                    self.weld("new-2", 112.2),
                    self.weld("new-3", 124.0),
                ],
                "tieInDecision": {"status": "AUTO_ACCEPTED"},
                "tieInTransform": {
                    "direction": "OLD_TO_NEW",
                    "model": "MONOTONIC_PIECEWISE_LINEAR",
                    "allowExtrapolation": False,
                    "domain": {"oldStartM": 4.0, "oldEndM": 28.0},
                    "knots": [
                        {"oldId": "old-1", "newId": "new-1", "oldDistanceM": 4.0, "newDistanceM": 100.0},
                        {"oldId": "old-2", "newId": "new-2", "oldDistanceM": 16.0, "newDistanceM": 112.2},
                        {"oldId": "old-3", "newId": "new-3", "oldDistanceM": 28.0, "newDistanceM": 124.0},
                    ],
                },
            }
        )

        self.assertTrue(result["success"])
        self.assertTrue(result["tieInTransformApplied"])
        self.assertEqual(result["matchingMode"], "TIEIN_LOCKED")
        self.assertEqual(result["stats"]["matchedGws"], 3)
        self.assertEqual(
            [match["old_odometer"] for match in result["gwMatchesFinal"]],
            [100.0, 112.2, 124.0],
        )
        first_match = next(match for match in result["gwMatches"] if match["status"] == "Match")
        self.assertEqual(first_match["oldSourceDist"], 4.0)
        self.assertEqual(first_match["newSourceDist"], 100.0)
        self.assertFalse(any(
            orphan.get("oldId") == "old-launcher" for orphan in result["gwOrphans"]
        ))
        self.assertEqual(result["tieInExcludedOld"], [{
            "id": "old-launcher",
            "sourceDistanceM": 0.0,
            "type": "weld",
            "reason": "OUTSIDE_ACCEPTED_TIEIN_DOMAIN",
        }])

    def test_canonical_tiein_locks_are_not_reassigned_when_ota_changes(self):
        payload = {
            "requestId": "locked-tiein",
            "partialRunEnabled": True,
            "oldRun": [
                self.weld("old-outside", 0.0),
                self.weld("old-1", 10.0),
                self.weld("old-2", 22.0),
                self.weld("old-3", 34.0),
            ],
            "newRun": [
                self.weld("new-outside", 0.0),
                self.weld("new-1", 1010.0),
                self.weld("new-2", 1022.3),
                self.weld("new-3", 1034.7),
            ],
            "tieInDecision": {"status": "AUTO_ACCEPTED"},
            "tieInTransform": {
                "direction": "OLD_TO_NEW",
                "model": "MONOTONIC_PIECEWISE_LINEAR",
                "allowExtrapolation": False,
                "domain": {"oldStartM": 10.0, "oldEndM": 34.0},
                "knots": [
                    {"oldId": "old-1", "newId": "new-1", "oldDistanceM": 10.0, "newDistanceM": 1010.0},
                    {"oldId": "old-2", "newId": "new-2", "oldDistanceM": 22.0, "newDistanceM": 1022.3},
                    {"oldId": "old-3", "newId": "new-3", "oldDistanceM": 34.0, "newDistanceM": 1034.7},
                ],
            },
        }

        strict = dtw_engine.process_request({**payload, "ota": 0.1})
        loose = dtw_engine.process_request({**payload, "ota": 10.0})

        self.assertEqual(strict["matchingMode"], "TIEIN_LOCKED")
        self.assertEqual(loose["matchingMode"], "TIEIN_LOCKED")
        self.assertEqual(
            [(item["old_id"], item["new_id"]) for item in strict["gwMatchesFinal"]],
            [("old-1", "new-1"), ("old-2", "new-2"), ("old-3", "new-3")],
        )
        self.assertEqual(strict["gwMatchesFinal"], loose["gwMatchesFinal"])

    def test_canonical_tiein_fails_closed_when_a_knot_weld_is_missing(self):
        result = dtw_engine.process_request(
            {
                "requestId": "missing-lock",
                "partialRunEnabled": True,
                "oldRun": [
                    self.weld("old-1", 10.0),
                    self.weld("old-2", 22.0),
                ],
                "newRun": [
                    self.weld("new-1", 1010.0),
                    # The accepted transform names this knot, but the source
                    # run no longer contains its physical weld.
                ],
                "tieInDecision": {"status": "AUTO_ACCEPTED"},
                "tieInTransform": {
                    "direction": "OLD_TO_NEW",
                    "model": "MONOTONIC_PIECEWISE_LINEAR",
                    "allowExtrapolation": False,
                    "domain": {
                        "oldStartM": 10.0,
                        "oldEndM": 22.0,
                        "newStartM": 1010.0,
                        "newEndM": 1022.0,
                    },
                    "knots": [
                        {"oldId": "old-1", "newId": "new-1", "oldDistanceM": 10.0, "newDistanceM": 1010.0},
                        {"oldId": "old-2", "newId": "new-2", "oldDistanceM": 22.0, "newDistanceM": 1022.0},
                    ],
                },
            }
        )

        self.assertFalse(result["success"])
        self.assertEqual(result["code"], "TIEIN_LOCK_RESOLUTION_FAILED")
        self.assertEqual(result["unresolvedKnotIndexes"], [1])

    def test_canonical_tiein_can_lock_vendor_rows_without_ids_by_distance(self):
        result = dtw_engine.process_request(
            {
                "requestId": "idless-locks",
                "oldRun": [self.weld(None, 10.0), self.weld(None, 22.0)],
                "newRun": [self.weld(None, 1010.0), self.weld(None, 1022.0)],
                "tieInDecision": {"status": "AUTO_ACCEPTED"},
                "tieInTransform": {
                    "direction": "OLD_TO_NEW",
                    "model": "MONOTONIC_PIECEWISE_LINEAR",
                    "allowExtrapolation": False,
                    "domain": {
                        "oldStartM": 10.0,
                        "oldEndM": 22.0,
                        "newStartM": 1010.0,
                        "newEndM": 1022.0,
                    },
                    "knots": [
                        {"oldDistanceM": 10.0, "newDistanceM": 1010.0},
                        {"oldDistanceM": 22.0, "newDistanceM": 1022.0},
                    ],
                },
            }
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["matchingMode"], "TIEIN_LOCKED")
        self.assertEqual(result["stats"]["matchedGws"], 2)

    def test_canonical_tiein_rejects_a_stale_non_null_vendor_id(self):
        result = dtw_engine.process_request(
            {
                "requestId": "stale-lock-id",
                "oldRun": [
                    self.weld("different-old-1", 10.0),
                    self.weld("old-2", 22.0),
                ],
                "newRun": [
                    self.weld("new-1", 1010.0),
                    self.weld("new-2", 1022.0),
                ],
                "tieInDecision": {"status": "AUTO_ACCEPTED"},
                "tieInTransform": {
                    "direction": "OLD_TO_NEW",
                    "model": "MONOTONIC_PIECEWISE_LINEAR",
                    "allowExtrapolation": False,
                    "domain": {"oldStartM": 10.0, "oldEndM": 22.0},
                    "knots": [
                        {"oldId": "expected-old-1", "newId": "new-1", "oldDistanceM": 10.0, "newDistanceM": 1010.0},
                        {"oldId": "old-2", "newId": "new-2", "oldDistanceM": 22.0, "newDistanceM": 1022.0},
                    ],
                },
            }
        )

        self.assertFalse(result["success"])
        self.assertEqual(result["code"], "TIEIN_LOCK_RESOLUTION_FAILED")
        self.assertEqual(result["unresolvedKnotIndexes"], [0])

    def test_partial_new_domain_metadata_must_be_complete(self):
        result = dtw_engine.process_request(
            {
                "oldRun": [self.weld("old-1", 10.0), self.weld("old-2", 22.0)],
                "newRun": [self.weld("new-1", 1010.0), self.weld("new-2", 1022.0)],
                "tieInDecision": {"status": "AUTO_ACCEPTED"},
                "tieInTransform": {
                    "direction": "OLD_TO_NEW",
                    "model": "MONOTONIC_PIECEWISE_LINEAR",
                    "allowExtrapolation": False,
                    "domain": {"oldStartM": 10.0, "oldEndM": 22.0, "newStartM": 1010.0},
                    "knots": [
                        {"oldDistanceM": 10.0, "newDistanceM": 1010.0},
                        {"oldDistanceM": 22.0, "newDistanceM": 1022.0},
                    ],
                },
            }
        )

        self.assertFalse(result["success"])
        self.assertEqual(result["code"], "INVALID_TIEIN_TRANSFORM")

    def test_piecewise_transform_without_acceptance_decision_is_not_applied(self):
        result = dtw_engine.process_request(
            {
                "oldRun": [self.weld("old", 10.0)],
                "newRun": [self.weld("new", 110.0)],
                "tieInTransform": {
                    "direction": "OLD_TO_NEW",
                    "knots": [
                        {"oldDistanceM": 5.0, "newDistanceM": 105.0},
                        {"oldDistanceM": 15.0, "newDistanceM": 115.0},
                    ],
                },
            }
        )

        self.assertFalse(result["success"])
        self.assertEqual(result["code"], "INVALID_TIEIN_TRANSFORM")

    def test_request_over_the_dtw_cell_limit_returns_a_controlled_error(self):
        with patch.object(dtw_engine, "MAX_DTW_CELLS", 3):
            result = dtw_engine.process_request(
                {
                    "requestId": "oversized",
                    "oldRun": [
                        self.weld("old-1", 0.0),
                        self.weld("old-2", 10.0),
                    ],
                    "newRun": [
                        self.weld("new-1", 0.0),
                        self.weld("new-2", 10.0),
                    ],
                }
            )

        self.assertFalse(result["success"])
        self.assertEqual(result["code"], "DTW_INPUT_TOO_LARGE")
        self.assertEqual(result["requestId"], "oversized")

    def test_ota_uses_the_reference_spool_formula_and_exact_threshold(self):
        matches = [
            {"status": "Match", "oldDist": 0.0, "newDist": 0.0},
            {"status": "Match", "oldDist": 100.0, "newDist": 106.0},
        ]

        dtw_engine._post_process_matches(matches, ota_threshold=5.0)

        # The ILI comparison definition is |L_old / L_new - 1|.  A 5.66%
        # spool deviation must be flagged at a 5% OTA, not accepted by an
        # accidental "5% + OTA" threshold.
        self.assertAlmostEqual(matches[1]["deviation_ratio"], abs(100 / 106 - 1))
        self.assertTrue(matches[1]["flagged"])

    def test_offset_trend_contains_only_ordered_matched_pairs(self):
        result = dtw_engine.process_request(
            {
                "requestId": "extra-weld",
                "ota": 5.0,
                "oldRun": [self.weld("old-0", 0), self.weld("old-12", 12), self.weld("old-24", 24)],
                "newRun": [
                    self.weld("new-0", 0.35),
                    self.weld("new-12", 12.54),
                    self.weld("new-extra", 18.0),
                    self.weld("new-24", 24.60),
                ],
            }
        )

        trend = result["offsetTrend"]
        self.assertEqual([point["oldDistance"] for point in trend], [0, 12, 24])
        self.assertEqual([point["newId"] for point in trend], ["new-0", "new-12", "new-24"])
        self.assertEqual([point["offset"] for point in trend], [0.35, 0.54, 0.6])

    def test_reconciliation_never_emits_the_same_gw_as_match_and_orphan(self):
        old_gws = [
            self.weld("old-1", 0.0),
            self.weld("old-2", 10.0),
        ]
        new_gws = [
            self.weld("new-1", 0.2),
            self.weld("new-2", 10.2),
        ]
        candidates = [
            {"oldId": "old-1", "newId": "new-1", "oldDist": 0.0, "newDist": 0.2, "status": "Match"},
            {"oldId": None, "newId": "new-1", "oldDist": None, "newDist": 0.2, "status": "Skipped"},
            {"oldId": None, "newId": "new-1", "oldDist": None, "newDist": 0.2, "status": "Skipped"},
        ]

        reconciled = dtw_engine.reconcile_gw_matches(candidates, old_gws, new_gws)

        self.assertEqual(len(reconciled), 3)
        self.assertEqual(sum(match.get("newId") == "new-1" for match in reconciled), 1)
        self.assertCountEqual(
            [(match.get("oldId"), match.get("newId")) for match in reconciled],
            [("old-1", "new-1"), ("old-2", None), (None, "new-2")],
        )

    def test_reconciliation_restores_sources_omitted_by_partial_segments(self):
        old_gws = [self.weld("old-outside-overlap", 100.0)]
        new_gws = [self.weld("new-inside-overlap", 0.0)]

        reconciled = dtw_engine.reconcile_gw_matches([], old_gws, new_gws)

        self.assertCountEqual(
            [(match.get("oldId"), match.get("newId")) for match in reconciled],
            [("old-outside-overlap", None), (None, "new-inside-overlap")],
        )

    def test_canonical_tiein_limits_matching_to_the_physical_master_overlap(self):
        result = dtw_engine.process_request(
            {
                "requestId": "partial-overlap",
                "ota": 9.3,
                "useValveAnchor": False,
                "oldRun": [
                    self.weld("old-0", 0.0),
                    self.weld("old-12", 12.0),
                    self.weld("old-24", 24.0),
                ],
                "newRun": [
                    self.weld("new-lookalike-0", 1850.0),
                    self.weld("new-lookalike-12", 1862.0),
                    self.weld("new-lookalike-24", 1874.0),
                    self.weld("new-0", 2000.0),
                    self.weld("new-12", 2012.0),
                    self.weld("new-24", 2024.0),
                ],
                "tieInDecision": {"status": "AUTO_ACCEPTED"},
                "tieInTransform": {
                    "direction": "OLD_TO_NEW",
                    "model": "MONOTONIC_PIECEWISE_LINEAR",
                    "allowExtrapolation": False,
                    "domain": {"oldStartM": 0.0, "oldEndM": 24.0},
                    "knots": [
                        {"oldDistanceM": 0.0, "newDistanceM": 2000.0},
                        {"oldDistanceM": 12.0, "newDistanceM": 2012.0},
                        {"oldDistanceM": 24.0, "newDistanceM": 2024.0},
                    ],
                },
            }
        )

        self.assertTrue(result["success"])
        self.assertEqual(
            [match["new_id"] for match in result["gwMatchesFinal"]],
            ["new-0", "new-12", "new-24"],
        )
        self.assertEqual(
            [row["id"] for row in result["tieInExcludedNew"]],
            ["new-lookalike-0", "new-lookalike-12", "new-lookalike-24"],
        )
        self.assertEqual(result["gwOrphans"], [])

    def test_ota_uses_raw_source_spool_lengths_after_tiein_mapping(self):
        matches = [
            {
                "status": "Match",
                "oldDist": 2000.0,
                "newDist": 2000.0,
                "oldSourceDist": 100.0,
                "newSourceDist": 2000.0,
            },
            {
                "status": "Match",
                "oldDist": 2012.0,
                "newDist": 2012.0,
                "oldSourceDist": 112.0,
                "newSourceDist": 2013.0,
            },
        ]

        dtw_engine._post_process_matches(matches, ota_threshold=5.0)

        self.assertEqual(matches[1]["L_ref"], 12.0)
        self.assertEqual(matches[1]["L_new"], 13.0)
        self.assertAlmostEqual(matches[1]["deviation_ratio"], abs(12.0 / 13.0 - 1.0))
        self.assertTrue(matches[1]["flagged"])

    def test_valve_anchor_matching_preserves_anchor_type_and_order(self):
        old = [
            {"id": "old-valve", "type": "valve", "dist": 100.0},
            {"id": "old-tee", "type": "tee", "dist": 200.0},
        ]
        new = [
            {"id": "new-tee-decoy", "type": "tee", "dist": 100.0},
            {"id": "new-valve", "type": "valve", "dist": 101.0},
            {"id": "new-tee", "type": "tee", "dist": 201.0},
        ]

        pairs = dtw_engine.match_valves(old, new, tolerance=10.0)

        self.assertEqual(
            [(pair["old_id"], pair["new_id"]) for pair in pairs],
            [("old-valve", "new-valve"), ("old-tee", "new-tee")],
        )
        self.assertEqual(
            [pair["new_dist"] for pair in pairs],
            sorted(pair["new_dist"] for pair in pairs),
        )

    def test_anchor_matching_maximizes_cardinality_before_distance_error(self):
        old = [
            {"id": "old-8", "type": "valve", "dist": 8.0},
            {"id": "old-10", "type": "valve", "dist": 10.0},
        ]
        new = [
            {"id": "new-0", "type": "valve", "dist": 0.0},
            {"id": "new-9", "type": "valve", "dist": 9.0},
        ]

        pairs = dtw_engine.match_valves(old, new, tolerance=9.0)

        self.assertEqual(
            [(pair["old_id"], pair["new_id"]) for pair in pairs],
            [("old-8", "new-0"), ("old-10", "new-9")],
        )

    def test_anchor_matching_minimizes_error_at_equal_cardinality(self):
        old = [
            {"id": "old-0", "type": "valve", "dist": 0.0},
            {"id": "old-10", "type": "valve", "dist": 10.0},
        ]
        new = [
            {"id": "new-1", "type": "valve", "dist": 1.0},
            {"id": "new-7", "type": "valve", "dist": 7.0},
            {"id": "new-11", "type": "valve", "dist": 11.0},
        ]

        pairs = dtw_engine.match_valves(old, new, tolerance=5.0)

        self.assertEqual(
            [(pair["old_id"], pair["new_id"]) for pair in pairs],
            [("old-0", "new-1"), ("old-10", "new-11")],
        )

    def test_anchor_tolerance_is_inclusive(self):
        pairs = dtw_engine.match_valves(
            [{"id": "old-valve", "type": "valve", "dist": 100.0}],
            [{"id": "new-valve", "type": "valve", "dist": 110.0}],
            tolerance=10.0,
        )

        self.assertEqual(len(pairs), 1)

    def test_anchor_type_normalization_uses_fallback_without_substring_collisions(self):
        fallback_pairs = dtw_engine.match_valves(
            [{"id": "old-valve", "type": None, "originalType": "Valve", "dist": 0.0}],
            [{"id": "new-valve", "type": "Valve", "dist": 0.0}],
            tolerance=1.0,
        )
        false_tee_pairs = dtw_engine.match_valves(
            [{"id": "old-sleeve", "type": "Steel Sleeve", "dist": 0.0}],
            [{"id": "new-tee", "type": "Tee", "dist": 0.0}],
            tolerance=1.0,
        )

        self.assertEqual(len(fallback_pairs), 1)
        self.assertEqual(false_tee_pairs, [])
        self.assertEqual(
            dtw_engine._alignment_feature_kind({
                "type": "weld",
                "feature_identification": "Flanged",
            }),
            "flange",
        )
        self.assertEqual(
            dtw_engine._alignment_feature_kind({
                "type": "weld",
                "feature_identification": "Valve pipe",
            }),
            "weld",
        )

    def test_dtw_does_not_match_a_weld_to_a_valve(self):
        matches = dtw_engine.calculate_dtw(
            [{"id": "old-weld", "type": "weld", "dist": 100.0}],
            [{"id": "new-valve", "type": "valve", "dist": 100.0}],
            ota_threshold=5.0,
        )

        self.assertFalse(any(match["status"] == "Match" for match in matches))

    def test_valve_segmentation_preserves_ids_at_duplicate_chainages(self):
        result = dtw_engine.process_request(
            {
                "requestId": "duplicate-chainage-ids",
                "ota": 5.0,
                "useValveAnchor": True,
                "oldRun": [
                    {"id": "old-valve-0", "type": "valve", "dist": 0.0},
                    self.weld("old-weld-0", 0.0),
                    {"id": "old-valve-10", "type": "valve", "dist": 10.0},
                ],
                "newRun": [
                    self.weld("new-weld-0", 0.0),
                    {"id": "new-valve-0", "type": "valve", "dist": 0.0},
                    {"id": "new-valve-10", "type": "valve", "dist": 10.0},
                ],
            }
        )

        self.assertTrue(result["success"])
        pairs = {
            (match["old_id"], match["new_id"])
            for match in result["gwMatchesFinal"]
        }
        self.assertIn(("old-valve-0", "new-valve-0"), pairs)
        self.assertIn(("old-valve-10", "new-valve-10"), pairs)
        self.assertNotIn(("old-weld-0", "new-valve-0"), pairs)
        self.assertNotIn(("old-valve-0", "new-weld-0"), pairs)

    def test_valve_segmented_matches_keep_zero_chainage_first(self):
        result = dtw_engine.process_request(
            {
                "requestId": "zero-chainage-order",
                "ota": 5.0,
                "useValveAnchor": True,
                "oldRun": [
                    {"id": "old-valve-0", "type": "valve", "dist": 0.0},
                    self.weld("old-weld-5", 5.0),
                    {"id": "old-valve-10", "type": "valve", "dist": 10.0},
                ],
                "newRun": [
                    {"id": "new-valve-0", "type": "valve", "dist": 0.0},
                    self.weld("new-weld-5", 5.0),
                    {"id": "new-valve-10", "type": "valve", "dist": 10.0},
                ],
            }
        )

        self.assertTrue(result["success"])
        self.assertEqual(
            [match["oldDist"] for match in result["gwMatches"] if match["status"] == "Match"],
            [0.0, 5.0, 10.0],
        )
        self.assertTrue(all(
            match.get("L_ref", 0.0) >= 0.0
            for match in result["gwMatches"]
            if match["status"] == "Match"
        ))

    def test_ota_falls_back_as_a_pair_when_one_source_endpoint_is_missing(self):
        matches = [
            {
                "status": "Match",
                "oldDist": 2000.0,
                "newDist": 2000.0,
                "newSourceDist": 1000.0,
            },
            {
                "status": "Match",
                "oldDist": 2012.0,
                "newDist": 2013.0,
                "oldSourceDist": 112.0,
                "newSourceDist": 1014.0,
            },
        ]

        dtw_engine._post_process_matches(matches, ota_threshold=5.0)

        self.assertEqual(matches[1]["L_ref"], 12.0)
        self.assertEqual(matches[1]["L_new"], 13.0)
        self.assertTrue(matches[1]["flagged"])

    def test_empty_tiein_overlap_returns_exclusion_diagnostics(self):
        result = dtw_engine.process_request(
            {
                "requestId": "empty-target-overlap",
                "oldRun": [self.weld("old-0", 0.0), self.weld("old-10", 10.0)],
                "newRun": [self.weld("new-outside", 1000.0)],
                "tieInDecision": {"status": "AUTO_ACCEPTED"},
                "tieInTransform": {
                    "direction": "OLD_TO_NEW",
                    "model": "MONOTONIC_PIECEWISE_LINEAR",
                    "allowExtrapolation": False,
                    "domain": {"oldStartM": 0.0, "oldEndM": 10.0},
                    "knots": [
                        {"oldDistanceM": 0.0, "newDistanceM": 2000.0},
                        {"oldDistanceM": 10.0, "newDistanceM": 2010.0},
                    ],
                },
            }
        )

        self.assertFalse(result["success"])
        self.assertTrue(result["tieInTransformApplied"])
        self.assertEqual(
            [feature["id"] for feature in result["tieInExcludedNew"]],
            ["new-outside"],
        )


if __name__ == "__main__":
    unittest.main()
