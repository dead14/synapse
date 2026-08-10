import math
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "python_engines"))

from bayesian_matcher import (  # noqa: E402
    MatcherConfig,
    Observation,
    estimate_drift,
    match_observations,
    posterior_probabilities,
    score_pair,
    solve_max_score_monotonic,
    build_null_model,
)


def observations(positions, **attributes):
    """Defects at the given positions, in pipe order, with shared attributes."""
    return [
        Observation(
            index=index,
            position=position,
            weld_distance=attributes.get("weld_distances", [None] * len(positions))[index],
            clock_deg=attributes.get("clocks", [None] * len(positions))[index],
            length_mm=attributes.get("lengths", [None] * len(positions))[index],
            width_mm=attributes.get("widths", [None] * len(positions))[index],
        )
        for index, position in enumerate(positions)
    ]


class DriftDiscoveryTests(unittest.TestCase):
    def test_finds_a_shift_far_outside_any_reasonable_tolerance(self):
        old_positions = [100.0, 112.4, 118.9, 131.2, 145.6, 152.0]
        # Four metres is two hundred times the 0.2 m odometer window the
        # tolerance-gated matcher would be run with.
        shifted = [position + 4.0 for position in old_positions]

        drift = estimate_drift(old_positions, shifted, MatcherConfig())

        self.assertAlmostEqual(drift.shift_m, 4.0, places=6)
        self.assertEqual(drift.support, len(old_positions))

    def test_survives_defects_that_appeared_and_disappeared_between_runs(self):
        old_positions = [10.0, 22.0, 35.0, 47.0, 58.0, 71.0]
        # Two of the six are gone; three the old run never saw are present.
        new_positions = sorted(
            [position + 2.5 for position in (10.0, 22.0, 47.0, 58.0)] + [15.0, 40.0, 66.0]
        )

        drift = estimate_drift(old_positions, new_positions, MatcherConfig())

        self.assertAlmostEqual(drift.shift_m, 2.5, places=6)

    def test_reports_no_support_when_the_two_runs_share_no_displacement(self):
        generator = random.Random(7)
        old_positions = sorted(generator.uniform(0, 400) for _ in range(8))
        new_positions = sorted(generator.uniform(0, 400) for _ in range(8))

        drift = estimate_drift(
            old_positions, new_positions, MatcherConfig(drift_bandwidth_m=0.2),
        )

        # A handful of coincidental agreements is possible; a shared displacement
        # supported by most of the section is not.
        self.assertLess(drift.support, len(old_positions))

    def test_a_section_that_did_not_stretch_reports_no_scale_correction(self):
        positions = [100.0 + 8.0 * index for index in range(12)]

        drift = estimate_drift(positions, [p + 3.0 for p in positions], MatcherConfig())

        self.assertEqual(drift.scale, 1.0)
        # A slope of exactly 1 is the null result, not a correction — reporting
        # it as applied made the drawer describe a "x1.00000 scale" it had not.
        self.assertFalse(drift.scale_applied)

    def test_a_stretched_odometer_is_corrected_and_reported(self):
        positions = [100.0 + 8.0 * index for index in range(16)]
        stretched = [100.0 + (position - 100.0) * 1.01 + 2.0 for position in positions]

        drift = estimate_drift(positions, stretched, MatcherConfig())

        self.assertTrue(drift.scale_applied)
        self.assertAlmostEqual(drift.scale, 1.01, places=4)

    def test_measures_its_own_noise_rather_than_taking_it_from_a_setting(self):
        generator = random.Random(11)
        old_positions = [50.0 + 7.0 * index for index in range(20)]
        noisy = [
            position + 1.5 + generator.gauss(0.0, 0.30) for position in old_positions
        ]

        drift = estimate_drift(old_positions, noisy, MatcherConfig())

        self.assertGreater(drift.sigma_m, 0.12)
        self.assertLess(drift.sigma_m, 0.60)


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.config = MatcherConfig()

    def test_agreement_on_every_channel_beats_coincidence(self):
        old = Observation(0, 100.0, weld_distance=1.20, clock_deg=90.0, length_mm=40.0, width_mm=25.0)
        new = Observation(0, 103.0, weld_distance=1.24, clock_deg=93.0, length_mm=46.0, width_mm=27.0)
        drift = estimate_drift([100.0], [103.0], self.config)
        null_model = build_null_model([old], [new], self.config, span_m=300.0)

        candidate = score_pair(old, new, drift, null_model, self.config)

        self.assertGreater(candidate.log_bayes_factor, 0.0)
        self.assertEqual(
            {channel.name for channel in candidate.channels},
            {"Position", "U/S weld distance", "Clock", "Length", "Width"},
        )

    def test_a_defect_on_the_other_side_of_the_pipe_is_evidence_against(self):
        old = Observation(0, 100.0, clock_deg=0.0)
        opposite = Observation(0, 100.0, clock_deg=180.0)
        drift = estimate_drift([100.0], [100.0], self.config)
        null_model = build_null_model([old], [opposite], self.config, span_m=300.0)

        clock_channel = next(
            channel
            for channel in score_pair(old, opposite, drift, null_model, self.config).channels
            if channel.name == "Clock"
        )

        self.assertLess(clock_channel.log_lr, 0.0)

    def test_shrinkage_counts_against_a_pair_more_than_the_same_growth(self):
        drift = estimate_drift([100.0], [100.0], self.config)
        grown = Observation(0, 100.0, length_mm=90.0)
        shrunk = Observation(0, 100.0, length_mm=10.0)
        old = Observation(0, 100.0, length_mm=50.0)
        null_model = build_null_model([old], [grown, shrunk], self.config, span_m=300.0)

        def length_log_lr(new_observation):
            return next(
                channel.log_lr
                for channel in score_pair(old, new_observation, drift, null_model, self.config).channels
                if channel.name == "Length"
            )

        self.assertGreater(length_log_lr(grown), length_log_lr(shrunk))

    def test_a_channel_the_section_cannot_discriminate_on_contributes_exactly_nothing(self):
        """Every defect 40 mm long: length agreement is not evidence of anything.

        And crucially it must not be evidence *against*. A tool that sizes width
        to +/-75 mm, used on a section whose widths all fall within 10 mm, has a
        same-defect density at zero difference *below* the coincidence density —
        so the raw arithmetic scores a perfect agreement as a penalty. Right
        maths, absurd conclusion, and it silently drags real pairs down.
        """
        drift = estimate_drift([100.0], [100.0], self.config)
        uniform = [
            Observation(index, 100.0 + index, length_mm=40.0, width_mm=25.0)
            for index in range(6)
        ]
        old = Observation(0, 100.0, length_mm=40.0, width_mm=25.0)
        null_model = build_null_model([old], uniform, self.config, span_m=300.0)

        channels = {
            channel.name: channel
            for channel in score_pair(old, uniform[0], drift, null_model, self.config).channels
        }

        for name in ("Length", "Width"):
            with self.subTest(channel=name):
                self.assertFalse(channels[name].informative)
                self.assertEqual(channels[name].log_lr, 0.0)

    def test_a_channel_that_can_discriminate_still_counts(self):
        drift = estimate_drift([100.0], [100.0], self.config)
        varied = [
            Observation(index, 100.0 + index, length_mm=20.0 + 60.0 * index)
            for index in range(6)
        ]
        old = Observation(0, 100.0, length_mm=20.0)
        null_model = build_null_model([old], varied, self.config, span_m=300.0)

        channel = next(
            item
            for item in score_pair(old, varied[0], drift, null_model, self.config).channels
            if item.name == "Length"
        )

        self.assertTrue(channel.informative)
        self.assertGreater(channel.log_lr, 0.0)


class AssignmentTests(unittest.TestCase):
    def test_matches_a_whole_section_that_a_distance_window_would_have_emptied(self):
        old_positions = [100.0, 106.5, 113.2, 121.8, 130.4, 138.9, 147.3, 155.1]
        clocks = [30.0, 120.0, 200.0, 300.0, 15.0, 95.0, 175.0, 260.0]
        lengths = [40.0, 55.0, 22.0, 78.0, 31.0, 64.0, 47.0, 90.0]
        old = observations(old_positions, clocks=clocks, lengths=lengths)
        # Every defect displaced by 4.2 m, plus a little sizing noise.
        new = observations(
            [position + 4.2 for position in old_positions],
            clocks=[clock + 2.0 for clock in clocks],
            lengths=[length + 5.0 for length in lengths],
        )

        outcome = match_observations(old, new, MatcherConfig(), span_m=100.0)

        self.assertEqual(len(outcome.pairs), len(old_positions))
        self.assertTrue(all(
            pair["old_index"] == pair["new_index"] for pair in outcome.pairs
        ))
        self.assertTrue(all(pair["posterior"] > 0.9 for pair in outcome.pairs))

    def test_pairs_never_cross(self):
        old = observations([10.0, 20.0, 30.0, 40.0])
        new = observations([11.0, 21.0, 31.0, 41.0])

        outcome = match_observations(old, new, MatcherConfig(), span_m=50.0)

        old_indexes = [pair["old_index"] for pair in outcome.pairs]
        new_indexes = [pair["new_index"] for pair in outcome.pairs]
        self.assertEqual(old_indexes, sorted(old_indexes))
        self.assertEqual(new_indexes, sorted(new_indexes))

    def test_two_unrelated_populations_are_mostly_left_unmatched(self):
        generator = random.Random(3)
        old = observations(
            sorted(generator.uniform(0, 2000) for _ in range(25)),
            clocks=[generator.uniform(0, 360) for _ in range(25)],
            lengths=[generator.uniform(10, 200) for _ in range(25)],
        )
        new = observations(
            sorted(generator.uniform(0, 2000) for _ in range(25)),
            clocks=[generator.uniform(0, 360) for _ in range(25)],
            lengths=[generator.uniform(10, 200) for _ in range(25)],
        )

        outcome = match_observations(old, new, MatcherConfig(), span_m=2000.0)

        # No window rejected these; the evidence did.
        self.assertLess(len(outcome.pairs), 6)

    def test_confidence_drops_when_two_candidates_look_equally_good(self):
        old = observations([100.0], clocks=[90.0], lengths=[50.0])
        # Two NEW defects, indistinguishable on every channel.
        ambiguous = observations([102.0, 102.05], clocks=[90.0, 90.0], lengths=[50.0, 50.0])
        unambiguous = observations([102.0], clocks=[90.0], lengths=[50.0])

        config = MatcherConfig(drift_bandwidth_m=0.5)
        ambiguous_outcome = match_observations(old, ambiguous, config, span_m=200.0)
        clear_outcome = match_observations(old, unambiguous, config, span_m=200.0)

        self.assertEqual(len(ambiguous_outcome.pairs), 1)
        self.assertEqual(len(clear_outcome.pairs), 1)
        self.assertLess(
            ambiguous_outcome.pairs[0]["posterior"],
            clear_outcome.pairs[0]["posterior"],
        )

    def test_the_no_match_hypothesis_never_disappears_from_the_posterior(self):
        """Even an unrivalled pair cannot reach certainty on weak evidence."""
        old = Observation(0, 100.0)
        new = Observation(0, 100.4)
        drift = estimate_drift([100.0], [100.4], MatcherConfig())
        null_model = build_null_model([old], [new], MatcherConfig(), span_m=3.0)
        candidate = score_pair(old, new, drift, null_model, MatcherConfig())

        statistics = posterior_probabilities([candidate])[(0, 0)]

        self.assertLess(statistics["posterior"], 1.0)
        self.assertEqual(statistics["oldSideRivals"], 0)

    def test_a_pair_worth_less_than_coincidence_is_not_selected(self):
        # Three defects that did not move establish a zero drift and a tight
        # sigma; a fourth candidate half a metre off is then many sigmas away.
        config = MatcherConfig()
        aligned = [100.0, 110.0, 120.0]
        drift = estimate_drift(aligned, aligned, config)
        old = Observation(0, 100.0)
        displaced = Observation(0, 100.5)
        null_model = build_null_model([old], [displaced], config, span_m=20.0)

        weak = score_pair(old, displaced, drift, null_model, config)

        self.assertLess(weak.log_bayes_factor, 0.0)
        self.assertEqual(solve_max_score_monotonic(1, 1, [weak], 0.0), [])


class ScaleGuardTests(unittest.TestCase):
    def test_the_displacement_vote_stays_bounded_on_a_huge_section(self):
        # 1,500 x 1,500 is 2.25 million proposals unthinned. The budget below
        # forces a stride, and the displacement must still come out right.
        old_positions = [float(index) * 3.0 for index in range(1500)]
        new_positions = [position + 5.5 for position in old_positions]

        drift = estimate_drift(
            old_positions, new_positions, MatcherConfig(max_vote_pairs=20_000),
        )

        self.assertLessEqual(drift.candidates, 20_000)
        self.assertAlmostEqual(drift.shift_m, 5.5, places=6)
        # Support and sigma are still measured against every defect, not just
        # the sampled ones — thinning applies to the search, not the evidence.
        self.assertEqual(drift.support, len(old_positions))

    def test_thinning_is_deterministic(self):
        old_positions = [float(index) for index in range(400)]
        new_positions = [position + 1.25 for position in old_positions]
        config = MatcherConfig(max_vote_pairs=5_000)

        first = estimate_drift(old_positions, new_positions, config)
        second = estimate_drift(old_positions, new_positions, config)

        self.assertEqual(first.shift_m, second.shift_m)
        self.assertEqual(first.candidates, second.candidates)


class MonteCarloTests(unittest.TestCase):
    def test_real_agreement_is_not_reproduced_by_random_sections(self):
        old_positions = [100.0 + 9.0 * index for index in range(12)]
        clocks = [(37 * index) % 360 for index in range(12)]
        old = observations(old_positions, clocks=clocks)
        new = observations([position + 3.6 for position in old_positions], clocks=clocks)

        outcome = match_observations(
            old, new, MatcherConfig(permutation_trials=60), span_m=120.0,
        )

        self.assertEqual(outcome.permutation_trials, 60)
        self.assertIsNotNone(outcome.permutation_p_value)
        self.assertLess(outcome.permutation_p_value, 0.05)

    def test_the_calibration_is_reproducible(self):
        old = observations([100.0 + 9.0 * index for index in range(10)])
        new = observations([100.0 + 9.0 * index + 2.2 for index in range(10)])
        config = MatcherConfig(permutation_trials=40)

        first = match_observations(old, new, config, span_m=100.0)
        second = match_observations(old, new, config, span_m=100.0)

        self.assertEqual(first.permutation_p_value, second.permutation_p_value)

    def test_calibration_is_skipped_rather_than_guessed_when_too_expensive(self):
        old = observations([float(index) for index in range(300)])
        new = observations([float(index) + 0.5 for index in range(300)])

        outcome = match_observations(
            old, new,
            MatcherConfig(permutation_trials=200, max_permutation_cells=1000),
            span_m=300.0,
        )

        self.assertIsNone(outcome.permutation_p_value)
        self.assertEqual(outcome.permutation_trials, 0)
        self.assertTrue(any("budget" in note for note in outcome.notes))


class DensityTests(unittest.TestCase):
    """The probability model has to be a probability model."""

    def test_the_two_piece_length_density_integrates_to_one(self):
        from bayesian_matcher import _log_two_piece_normal_density

        step = 0.05
        total = sum(
            math.exp(_log_two_piece_normal_density(-400.0 + step * index, 20.0, 60.0)) * step
            for index in range(int(800 / step))
        )
        self.assertAlmostEqual(total, 1.0, places=3)

    def test_the_coincidence_density_for_a_difference_integrates_to_one(self):
        from bayesian_matcher import _log_triangular_difference_density

        step = 0.01
        total = sum(
            math.exp(_log_triangular_difference_density(-5.0 + step * index, 5.0)) * step
            for index in range(int(10 / step))
        )
        self.assertAlmostEqual(total, 1.0, places=3)


if __name__ == "__main__":
    unittest.main()
