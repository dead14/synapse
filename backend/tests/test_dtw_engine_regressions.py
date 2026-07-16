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


if __name__ == "__main__":
    unittest.main()
