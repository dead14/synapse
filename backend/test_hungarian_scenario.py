import sys
import unittest
import io
import json
from pathlib import Path
from contextlib import redirect_stdout

sys.path.insert(0, str(Path(__file__).parent / "src" / "python_engines"))
from hungarian_engine import HungarianAnomalyAlignmentEngine


class ScenarioFilterTests(unittest.TestCase):
    def test_depth_filter_keeps_the_matrix_source_indexes_aligned(self):
        engine = HungarianAnomalyAlignmentEngine.__new__(HungarianAnomalyAlignmentEngine)
        engine.depth_thresh = 10
        engine.INF_COST = 1e9
        engine.ds_gw_distance_tolerance = 1
        engine.us_gw_distance_tolerance = 1
        engine.clock_tolerance = 15
        engine.depth_tolerance = 50
        engine.length_tolerance = 400

        old = [
            {"id": "below-threshold", "depth_pct": 5, "abs_distance_m": 0},
            {"id": "candidate", "depth_pct": 20, "abs_distance_m": 10},
        ]
        new = [{"id": "new-candidate", "depth_pct": 20, "abs_distance_m": 10.1}]

        filtered_old = engine._apply_scenario_filter(old)
        filtered_new = engine._apply_scenario_filter(new)
        matrix = engine.build_cost_matrix(filtered_old, filtered_new, [], [])

        self.assertEqual([item["id"] for item in filtered_old], ["candidate"])
        self.assertEqual(matrix.shape, (1, 1))
        self.assertLess(matrix[0, 0], engine.INF_COST)

    def test_result_json_keeps_the_matched_duplicate_id_source_row(self):
        """Duplicate spreadsheet IDs must not make the output point to row 0."""
        class Query:
            def __init__(self, session):
                self.session = session

            def filter(self, *args):
                return self

            def first(self):
                return self.session.alignment_session

        class Session:
            alignment_session = type("AlignmentSession", (), {
                "params_json": {
                    "depthThresh": 0,
                    "ToleranceConfig": {
                        "us_gw_distance_tolerance": 1,
                        "ds_gw_distance_tolerance": 1,
                    },
                    "gwMatchesFinal": [],
                    "gwOrphans": [],
                }
            })()

            def query(self, *args):
                return Query(self)

        engine = HungarianAnomalyAlignmentEngine.__new__(HungarianAnomalyAlignmentEngine)
        engine.session_id = 1
        engine.session = Session()
        engine.run_1_year = 2021
        engine.run_2_year = 2026
        engine.INF_COST = 1e9
        engine.clock_tolerance = 15
        engine.depth_tolerance = 50
        engine.length_tolerance = 400
        engine.fetch_data = lambda is_old_run: (
            [
                {"id": "7", "abs_distance_m": 0, "depth_pct": 20, "length_mm": None, "width_mm": None, "dist_to_us_gw_m": None, "clock_position": None, "originalType": "metal loss"},
                {"id": "7", "abs_distance_m": 10, "depth_pct": 20, "length_mm": None, "width_mm": None, "dist_to_us_gw_m": None, "clock_position": None, "originalType": "metal loss"},
            ] if is_old_run else [
                {"id": "8", "abs_distance_m": 10.1, "depth_pct": 20, "length_mm": None, "width_mm": None, "dist_to_us_gw_m": None, "clock_position": None, "originalType": "metal loss"},
            ]
        )
        engine.get_gw_matches = lambda: []

        output = io.StringIO()
        with redirect_stdout(output):
            engine.perform_alignment()
        payload = output.getvalue().split("___RESULT_JSON_BEGIN___\n", 1)[1].split("\n___RESULT_JSON_END___", 1)[0]
        result_json = json.loads(payload)

        self.assertEqual(result_json["anomaly_matched"][0]["Log Dist OLD (m)"], 10)


if __name__ == "__main__":
    unittest.main()
