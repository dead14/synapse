import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "python_engines"))

import manual_alignment_engine


class ManualAlignmentEngineTests(unittest.TestCase):
    def test_manual_output_preserves_every_feature_for_intervention(self):
        old_features = [
            {"id": "old-gw", "source_key": "OLD:gw", "abs_distance_m": 0.0, "originalType": "weld", "depth_pct": None},
            {"id": "old-ml", "source_key": "OLD:ml", "abs_distance_m": 5.0, "originalType": "metal loss", "depth_pct": 10.0},
        ]
        new_features = [
            {"id": "new-gw", "source_key": "NEW:gw", "abs_distance_m": 0.2, "originalType": "weld", "depth_pct": None},
            {"id": "new-ml", "source_key": "NEW:ml", "abs_distance_m": 5.2, "originalType": "metal loss", "depth_pct": 12.0},
        ]

        output = manual_alignment_engine.build_manual_output(old_features, new_features, 2020, 2026)

        rows = [row for value in output.values() if isinstance(value, list) for row in value]
        self.assertEqual(len(rows), 4)
        self.assertEqual(output["audit"]["old"]["missingKeys"], [])
        self.assertEqual(output["audit"]["new"]["missingKeys"], [])
        self.assertTrue(output["audit"]["isConserved"])
        self.assertEqual(len(output["gw_unmatched"]), 2)
        self.assertEqual(len(output["anomaly_only_old"]), 1)
        self.assertEqual(len(output["anomaly_only_new"]), 1)

    def test_clustered_metal_loss_is_conserved_as_a_bypass_row_with_its_reason(self):
        old_features = [
            {
                "id": "old-ml",
                "source_key": "OLD:ml",
                "abs_distance_m": 5.0,
                "originalType": "metal loss",
                "depth_pct": 10.0,
                "raw": {"feature_identification": "Corrosion"},
            },
            {
                "id": "old-cluster",
                "source_key": "OLD:cluster",
                "abs_distance_m": 7.0,
                "originalType": "metal loss",
                "depth_pct": 22.0,
                "raw": {"feature_identification": "CLUSTER corrosion"},
            },
        ]

        output = manual_alignment_engine.build_manual_output(old_features, [], 2020, 2026)

        self.assertEqual([row["Identif. OLD"] for row in output["anomaly_only_old"]], ["old-ml"])
        self.assertEqual([row["Identif. OLD"] for row in output["bypassed_old"]], ["old-cluster"])
        self.assertEqual(
            output["bypassed_old"][0]["Bypass Reason"],
            manual_alignment_engine.CLUSTER_BYPASS_REASON,
        )
        self.assertEqual(output["anomaly_only_old"][0]["Bypass Reason"], "-")
        # The cluster is held back from matching, never dropped from the report.
        self.assertTrue(output["audit"]["isConserved"])


if __name__ == "__main__":
    unittest.main()
