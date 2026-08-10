import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "python_engines"))

from bayesian_engine import BayesianDriftAlignmentEngine  # noqa: E402
from hungarian_engine import HungarianAnomalyAlignmentEngine  # noqa: E402


def anomaly(distance, clock, length, width=25.0, gw=None):
    return {
        "id": f"a{distance:.1f}",
        "abs_distance_m": distance,
        "source_abs_distance_m": distance,
        "dist_to_us_gw_m": gw,
        "clock_position": clock,
        "length_mm": length,
        "width_mm": width,
        "depth_pct": 20.0,
        "originalType": "metal loss",
        "raw": {},
    }


# One segment of eight defects with distinct clocks and lengths, as a real
# pipetally section looks.
OLD_SEGMENT = [
    anomaly(1000.0, "12:00", 40.0),
    anomaly(1006.5, "04:00", 55.0),
    anomaly(1013.2, "07:00", 22.0),
    anomaly(1021.8, "10:00", 78.0),
    anomaly(1030.4, "01:00", 31.0),
    anomaly(1038.9, "03:00", 64.0),
    anomaly(1047.3, "06:00", 47.0),
    anomaly(1055.1, "09:00", 90.0),
]

# The same eight defects in the newer run, displaced by 4.2 m — the case that
# started this: the girth welds locked, but every metal-loss pair sits far
# outside any odometer window an engineer would set.
DISPLACEMENT_M = 4.2
NEW_SEGMENT = [
    anomaly(
        feature["abs_distance_m"] + DISPLACEMENT_M,
        feature["clock_position"],
        feature["length_mm"] + 6.0,
    )
    for feature in OLD_SEGMENT
]


def bayesian_engine(**bayesian_settings):
    engine = BayesianDriftAlignmentEngine.__new__(BayesianDriftAlignmentEngine)
    engine._effective_params = {
        "ToleranceConfig": {"anomaly_matcher": "bayesian_drift", "bayesian": bayesian_settings},
    }
    engine._cached_bayesian_config = None
    engine.use_us_gw_distance = True
    engine.median_joint_length_m = 12.0
    return engine


def hungarian_engine(distance_tolerance=0.2):
    engine = HungarianAnomalyAlignmentEngine.__new__(HungarianAnomalyAlignmentEngine)
    engine.distance_tolerance_m = distance_tolerance
    engine.us_gw_distance_tolerance = distance_tolerance
    engine.ds_gw_distance_tolerance = distance_tolerance
    engine.clock_tolerance = 15.0
    engine.length_tolerance = 50.0
    engine.use_us_gw_distance = True
    return engine


class DisplacedSectionTests(unittest.TestCase):
    """The case the Bayesian matcher exists for."""

    def test_the_tolerance_gated_matcher_finds_nothing_here(self):
        pairs, _audit = hungarian_engine().match_segment(1, OLD_SEGMENT, NEW_SEGMENT, [], [])

        self.assertEqual(pairs, [])

    def test_the_bayesian_matcher_recovers_the_whole_section(self):
        pairs, audit = bayesian_engine(permutation_trials=0).match_segment(
            1, OLD_SEGMENT, NEW_SEGMENT, [], [],
        )

        self.assertEqual(len(pairs), len(OLD_SEGMENT))
        self.assertEqual(
            [(old_index, new_index) for old_index, new_index, _evidence in pairs],
            [(index, index) for index in range(len(OLD_SEGMENT))],
        )
        self.assertAlmostEqual(audit["drift"]["shiftM"], DISPLACEMENT_M, places=6)

    def test_it_reports_the_drift_it_discovered(self):
        _pairs, audit = bayesian_engine(permutation_trials=0).match_segment(
            1, OLD_SEGMENT, NEW_SEGMENT, [], [],
        )

        self.assertEqual(audit["method"], "BAYESIAN_DRIFT")
        self.assertEqual(audit["drift"]["support"], len(OLD_SEGMENT))
        self.assertGreater(audit["totalLogBayesFactor"], 0.0)

    def test_a_girth_weld_offset_table_is_applied_before_the_drift_is_measured(self):
        """Whatever the locks explain is not counted twice as residual drift."""
        # The locks already shift OLD by +4.0 m, so only 0.2 m is left over.
        offset_table = [(0.0, 4.0), (2000.0, 4.0)]

        _pairs, audit = bayesian_engine(permutation_trials=0).match_segment(
            1, OLD_SEGMENT, NEW_SEGMENT, offset_table, [0.0, 2000.0],
        )

        self.assertAlmostEqual(audit["drift"]["shiftM"], 0.2, places=6)


class EvidenceOutputTests(unittest.TestCase):
    def setUp(self):
        self.pairs, self.audit = bayesian_engine(permutation_trials=40).match_segment(
            2, OLD_SEGMENT, NEW_SEGMENT, [], [],
        )
        self.evidence = self.pairs[0][2]

    def test_every_pair_carries_a_posterior_and_the_arithmetic_behind_it(self):
        self.assertEqual(self.evidence["method"], "BAYESIAN_DRIFT")
        self.assertGreater(self.evidence["posterior"], 0.9)
        self.assertGreater(self.evidence["logBayesFactor"], 0.0)
        self.assertIn("Position", [channel["name"] for channel in self.evidence["channels"]])

    def test_the_channel_contributions_reconstruct_the_total(self):
        # The drawer shows the channels adding up to the total; if they did not,
        # the explanation would be decorative rather than the actual calculation.
        channel_total = sum(
            channel["logLikelihoodRatio"] for channel in self.evidence["channels"]
        )
        self.assertAlmostEqual(
            channel_total + self.evidence["prior"]["logOdds"],
            self.evidence["logBayesFactor"],
            places=9,
        )

    def test_the_stored_evidence_carries_numbers_rather_than_prose(self):
        # This object is stored once per matched row, so repeated English here
        # is repeated tens of thousands of times in the results table. The
        # drawer supplies the wording from `nullSpread` and the channel name.
        for channel in self.evidence["channels"]:
            self.assertNotIn("detail", channel)
            self.assertIn("nullSpread", channel)
            self.assertIsInstance(channel["nullSpread"], float)

    def test_depth_is_never_one_of_the_channels(self):
        self.assertNotIn(
            "Depth", [channel["name"] for channel in self.evidence["channels"]],
        )

    def test_it_carries_the_monte_carlo_calibration_of_its_own_section(self):
        self.assertEqual(self.evidence["sectionPermutationTrials"], 40)
        self.assertLess(self.evidence["sectionPValue"], 0.1)

    def test_a_bayesian_row_reports_no_cost_and_a_hungarian_row_no_posterior(self):
        """The two matchers' numbers never appear on the same row."""
        bayesian_fields = HungarianAnomalyAlignmentEngine._match_evidence_fields(self.evidence)

        aligned_new = [
            anomaly(feature["abs_distance_m"] + 0.05, feature["clock_position"], feature["length_mm"])
            for feature in OLD_SEGMENT
        ]
        gated_pairs, _audit = hungarian_engine().match_segment(3, OLD_SEGMENT, aligned_new, [], [])
        gated_fields = HungarianAnomalyAlignmentEngine._match_evidence_fields(gated_pairs[0][2])

        self.assertEqual(bayesian_fields["Match Method"], "BAYESIAN_DRIFT")
        self.assertEqual(bayesian_fields["Match Cost"], "-")
        self.assertNotEqual(bayesian_fields["Match Confidence (%)"], "-")

        self.assertEqual(gated_fields["Match Method"], "HUNGARIAN")
        self.assertEqual(gated_fields["Match Confidence (%)"], "-")
        self.assertEqual(gated_fields["Match Log Bayes Factor"], "-")
        self.assertNotEqual(gated_fields["Match Cost"], "-")


class HungarianExplanationTests(unittest.TestCase):
    def test_the_itemised_penalties_reproduce_the_solver_cost(self):
        engine = hungarian_engine(distance_tolerance=0.5)
        new_segment = [
            anomaly(
                feature["abs_distance_m"] + 0.12,
                feature["clock_position"],
                feature["length_mm"] + 8.0,
                width=31.0,
            )
            for feature in OLD_SEGMENT
        ]

        pairs, _audit = engine.match_segment(1, OLD_SEGMENT, new_segment, [], [])

        self.assertTrue(pairs)
        for _old_index, _new_index, evidence in pairs:
            self.assertNotIn("note", evidence)
            self.assertAlmostEqual(
                evidence["breakdownTotal"], evidence["solverCost"], places=9,
            )

    def test_the_sparse_and_dense_solvers_explain_a_pair_the_same_way(self):
        """The optimisation path must not change what a reviewer is shown."""
        dense = hungarian_engine(distance_tolerance=0.5)
        sparse = hungarian_engine(distance_tolerance=0.5)
        sparse.MAX_DENSE_ALIGNMENT_CELLS = 1
        new_segment = [
            anomaly(feature["abs_distance_m"] + 0.1, feature["clock_position"], feature["length_mm"])
            for feature in OLD_SEGMENT
        ]

        dense_pairs, dense_audit = dense.match_segment(1, OLD_SEGMENT, new_segment, [], [])
        sparse_pairs, sparse_audit = sparse.match_segment(1, OLD_SEGMENT, new_segment, [], [])

        self.assertEqual(dense_audit["solver"], "dense")
        self.assertEqual(sparse_audit["solver"], "sparse")
        self.assertEqual(
            [(i, j) for i, j, _ in dense_pairs], [(i, j) for i, j, _ in sparse_pairs],
        )
        for (_i, _j, dense_evidence), (_k, _l, sparse_evidence) in zip(dense_pairs, sparse_pairs):
            self.assertAlmostEqual(
                dense_evidence["solverCost"], sparse_evidence["solverCost"], places=9,
            )


class MatcherAuditTests(unittest.TestCase):
    def test_the_bayesian_audit_advertises_no_gates(self):
        audit = bayesian_engine()._matcher_audit()

        self.assertNotIn("gates", audit)
        self.assertIn("model", audit)
        self.assertIn("priorMatchProbability", audit["decision"])

    def test_the_tolerance_gated_audit_reports_the_gates_that_ran(self):
        audit = hungarian_engine()._matcher_audit()

        self.assertIn("gates", audit)
        self.assertNotIn("model", audit)
        self.assertEqual(audit["gates"]["clock_tolerance"], 15.0)

    def test_the_joint_length_comes_from_the_line_when_it_was_measured(self):
        engine = bayesian_engine()
        engine.median_joint_length_m = 6.05

        self.assertAlmostEqual(engine._bayesian_config().joint_length_m, 6.05)

    def test_a_negative_acceptance_threshold_is_clamped_rather_than_honoured(self):
        # The solver maximises a sum of scores, so a negative-scoring pair
        # always makes its chain worse and is dropped whatever the threshold
        # claims. Clamping says so instead of offering an inert knob.
        engine = bayesian_engine(accept_log_bayes_factor=-8.0)

        self.assertEqual(engine._bayesian_config().accept_log_bayes_factor, 0.0)

    def test_a_raised_acceptance_threshold_is_honoured(self):
        engine = bayesian_engine(accept_log_bayes_factor=25.0)

        self.assertEqual(engine._bayesian_config().accept_log_bayes_factor, 25.0)

    def test_demanding_more_evidence_accepts_fewer_pairs(self):
        lenient, _audit = bayesian_engine(permutation_trials=0).match_segment(
            1, OLD_SEGMENT, NEW_SEGMENT, [], [],
        )
        strict, _audit = bayesian_engine(
            permutation_trials=0, accept_log_bayes_factor=1e6,
        ).match_segment(1, OLD_SEGMENT, NEW_SEGMENT, [], [])

        self.assertEqual(len(lenient), len(OLD_SEGMENT))
        self.assertEqual(strict, [])

    def test_a_session_setting_overrides_the_measured_joint_length(self):
        engine = bayesian_engine(joint_length_m=18.0)
        engine.median_joint_length_m = 6.05

        self.assertAlmostEqual(engine._bayesian_config().joint_length_m, 18.0)


class EmptySegmentTests(unittest.TestCase):
    def test_a_one_sided_segment_produces_no_pairs_and_still_audits(self):
        pairs, audit = bayesian_engine().match_segment(4, OLD_SEGMENT, [], [], [])

        self.assertEqual(pairs, [])
        self.assertEqual(audit["matched"], 0)
        self.assertEqual(audit["newCount"], 0)


if __name__ == "__main__":
    unittest.main()
