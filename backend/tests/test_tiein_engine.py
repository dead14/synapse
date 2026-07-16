import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "python_engines"))

import tiein_engine


class TieInEngineTests(unittest.TestCase):
    @staticmethod
    def feature(feature_id, feature_type, distance):
        return {"id": feature_id, "type": feature_type, "dist": distance}

    def test_partial_run_returns_offset_overlap_and_residual_diagnostics(self):
        old = [
            self.feature("o-valve-a", "valve", 0.0),
            self.feature("o-tee-a", "tee", 100.0),
            self.feature("o-bend", "bend", 250.0),
            self.feature("o-valve-b", "valve", 400.0),
            self.feature("o-tee-b", "tee", 620.0),
        ]
        new_partial = [
            self.feature("n-bend", "bend", 0.0),
            self.feature("n-valve", "valve", 150.0),
            self.feature("n-tee", "tee", 370.0),
        ]

        result = tiein_engine.calculate_tiein_offset(old, new_partial)

        self.assertTrue(result["success"])
        self.assertAlmostEqual(result["offset"], 250.0, places=3)
        self.assertEqual(result["matchedPairCount"], 3)
        self.assertEqual(result["overlap"]["oldStartM"], 250.0)
        self.assertEqual(result["overlap"]["oldEndM"], 620.0)
        self.assertLess(result["residualRmseM"], 0.001)

    def test_welds_are_supported_as_partial_run_anchors(self):
        old = [
            self.feature("o-1", "weld", 1000.0),
            self.feature("o-2", "weld", 1012.0),
            self.feature("o-3", "weld", 1029.0),
        ]
        new = [
            self.feature("n-1", "girth weld", 0.0),
            self.feature("n-2", "girth weld", 12.0),
            self.feature("n-3", "girth weld", 29.0),
        ]

        result = tiein_engine.calculate_tiein_offset(old, new)

        self.assertTrue(result["success"])
        self.assertAlmostEqual(result["offset"], 1000.0, places=3)

    def test_excluded_area_is_ignored_without_deleting_source_data(self):
        old = [
            self.feature("o-noise", "valve", 50.0),
            self.feature("o-1", "weld", 1000.0),
            self.feature("o-2", "weld", 1012.0),
            self.feature("o-3", "weld", 1029.0),
        ]
        new = [
            self.feature("n-noise", "valve", 9000.0),
            self.feature("n-1", "weld", 0.0),
            self.feature("n-2", "weld", 12.0),
            self.feature("n-3", "weld", 29.0),
        ]

        result = tiein_engine.calculate_tiein_offset(
            old,
            new,
            excluded_ranges=[
                {"run": "OLD", "startM": 0.0, "endM": 100.0},
                {"run": "NEW", "startM": 8000.0, "endM": 10000.0},
            ],
        )

        self.assertTrue(result["success"])
        self.assertAlmostEqual(result["offset"], 1000.0, places=3)
        self.assertEqual(result["excludedAnchorCount"], 2)


if __name__ == "__main__":
    unittest.main()
