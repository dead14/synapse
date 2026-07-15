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


if __name__ == "__main__":
    unittest.main()
