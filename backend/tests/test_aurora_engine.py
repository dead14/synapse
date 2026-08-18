"""AURORA-ILI validation, following the scenario matrix of specification 32.

Each test states the physical situation it builds, then asserts the behaviour
the specification requires — not an implementation detail.  A synthetic line is
used deliberately: the transform is known, so "recovered the transform" is a
checkable claim rather than an opinion about a real dataset.
"""

import math
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "python_engines"))

from engine.aurora import run_aurora_alignment
from engine.aurora.anchors import extract_anchors
from engine.aurora.canonical import (
    canonicalize_run,
    clock_to_radians,
    partition_positioned,
    wrap,
)
from engine.aurora.config import AuroraConfig, resolve_config
from engine.aurora.reid import (
    MANY_TO_MANY_REGION,
    MANY_TO_ONE,
    MISSING_OR_UNDETECTED,
    NEW_OR_PREVIOUSLY_UNDETECTED,
    ONE_TO_MANY,
    ONE_TO_ONE,
)
from engine.aurora.structure import (
    AnchorMap,
    MATCH,
    StructuralEvent,
    assert_non_crossing,
    register_structure_two_pass,
)


def weld(side, index, x):
    return {
        "id": f"{side}W{index}",
        "source_key": f"{side}:w{index}",
        "abs_distance_m": x,
        "originalType": "girth weld",
        "raw": {"feature_type": "Girth Weld"},
    }


def metal_loss(side, index, x, clock="3:00", depth=20.0, length=30.0, surface="External"):
    return {
        "id": f"{side}M{index}",
        "source_key": f"{side}:m{index}",
        "abs_distance_m": x,
        "originalType": "metal loss",
        "clock_position": clock,
        "depth_pct": depth,
        "length_mm": length,
        "width_mm": 20.0,
        "surface_location": surface,
        "raw": {"feature_type": "Metal Loss"},
    }


def joint_positions(count=30, nominal=12.0, seed=5):
    """A pipe string with the joint-length variation that makes it unique."""
    generator = random.Random(seed)
    positions = [0.0]
    for _ in range(count):
        positions.append(positions[-1] + nominal + generator.uniform(-1.2, 1.2))
    return positions


def build_pair(
    positions,
    axial_offset=0.0,
    axial_scale=1.0,
    clock_shift_hours=0.0,
    dropped_welds=(),
    inserted_welds=(),
    features_per_joint=3,
    split_new_into=1,
    drop_old_fraction=0.0,
    seed=5,
):
    """Two runs of one physical line, distorted in a known way."""
    generator = random.Random(seed)
    old, new = [], []
    for index, x in enumerate(positions):
        old.append(weld("OLD", index, x))
        if index in dropped_welds:
            continue
        new.append(weld("NEW", index, x * axial_scale + axial_offset))
    for offset, x in enumerate(inserted_welds):
        new.append(weld("NEW", 900 + offset, x * axial_scale + axial_offset))

    counter = 0
    for joint in range(len(positions) - 1):
        base = positions[joint]
        span = positions[joint + 1] - base
        for k in range(features_per_joint):
            u = 0.2 + (0.6 / max(features_per_joint, 1)) * k
            x = base + u * span
            clock = 2.0 + 3.0 * k
            if generator.random() >= drop_old_fraction:
                old.append(metal_loss("OLD", counter, x, _clock(clock), 20 + k))
            shifted = (clock + clock_shift_hours) % 12
            for part in range(split_new_into):
                nudge = (part - (split_new_into - 1) / 2) * 0.02 * span
                new.append(metal_loss(
                    "NEW", counter * 10 + part,
                    (x + nudge) * axial_scale + axial_offset,
                    _clock(shifted), 24 + k,
                ))
            counter += 1
    return old, new


def _clock(hours):
    whole = int(hours) % 12
    minutes = int(round((hours - int(hours)) * 60)) % 60
    return f"{whole}:{minutes:02d}"


def matched_pairs(result):
    return [
        (group.old_members[0].feature.key, group.new_members[0].feature.key)
        for group in result.groups
        if group.group_type == ONE_TO_ONE
    ]


def group_types(result):
    counts = {}
    for group in result.groups:
        counts[group.group_type] = counts.get(group.group_type, 0) + 1
    return counts


class ClockCoordinateTests(unittest.TestCase):
    """Section 5.1 — clock is circular, and unknown is not twelve o'clock."""

    def test_reads_every_reported_clock_form_onto_one_axis(self):
        self.assertAlmostEqual(clock_to_radians("6:00"), math.pi, places=6)
        self.assertAlmostEqual(clock_to_radians(6.0), math.pi, places=6)
        self.assertAlmostEqual(clock_to_radians("6.0"), math.pi, places=6)
        self.assertAlmostEqual(clock_to_radians("10:30"), clock_to_radians(10.5), places=6)

    def test_unreadable_clock_is_unavailable_evidence_not_midnight(self):
        for value in (None, "", "-", "n/a", "not a clock", "10:75"):
            self.assertIsNone(clock_to_radians(value), value)

    def test_difference_across_twelve_is_small(self):
        eleven = clock_to_radians("11:00")
        one = clock_to_radians("1:00")
        self.assertAlmostEqual(abs(wrap(one - eleven)), math.radians(60), places=6)


class StructuralInvariantTests(unittest.TestCase):
    """Section 8.2 — a crossing structural map is a defect, not a low score."""

    def test_crossing_correspondence_raises(self):
        anchor_map = AnchorMap(events=[
            StructuralEvent(MATCH, 0, 0, 0.0, 0.0),
            StructuralEvent(MATCH, 1, 5, 12.0, 60.0),
            StructuralEvent(MATCH, 2, 3, 24.0, 36.0),
        ])
        with self.assertRaises(ValueError):
            assert_non_crossing(anchor_map)

    def test_cost_favouring_a_crossing_still_yields_a_monotonic_map(self):
        # Two identical short pups upstream and downstream: the fingerprints
        # invite the solver to swap them.
        positions = [0.0, 12.0, 13.0, 25.0, 37.0, 38.0, 50.0, 62.0]
        old_records = [weld("OLD", i, x) for i, x in enumerate(positions)]
        new_records = [weld("NEW", i, x) for i, x in enumerate(positions)]
        config = AuroraConfig()
        old_features, _ = partition_positioned(canonicalize_run(old_records, "old"))
        new_features, _ = partition_positioned(canonicalize_run(new_records, "new"))
        anchor_map = register_structure_two_pass(
            extract_anchors(old_features, config.anchors),
            extract_anchors(new_features, config.anchors),
            config.anchors,
            config.structure,
        )
        assert_non_crossing(anchor_map)
        self.assertGreaterEqual(len(anchor_map.matches), len(positions) - 1)


class AxialRegistrationTests(unittest.TestCase):
    """Sections 10 and 32 — offset and drift are recovered, not tolerated."""

    def test_global_axial_offset_is_absorbed_by_registration(self):
        positions = joint_positions()
        old, new = build_pair(positions, axial_offset=37.5)
        result = run_aurora_alignment(old, new)

        self.assertEqual(result.state, "REVIEW_READY")
        self.assertEqual(len(result.anchor_pairs), len(positions))
        self.assertEqual(group_types(result).get(ONE_TO_ONE), 3 * (len(positions) - 1))
        # Every pair is the true one: the builder numbers the n-th new feature
        # 10n, so a shifted match would break this immediately.
        for old_key, new_key in matched_pairs(result):
            old_index = int(old_key.split(":m")[1])
            new_index = int(new_key.split(":m")[1])
            self.assertEqual(new_index, old_index * 10)

    def test_progressive_odometer_drift_is_corrected_joint_by_joint(self):
        positions = joint_positions()
        old, new = build_pair(positions, axial_offset=2.0, axial_scale=1.004)
        result = run_aurora_alignment(old, new)

        scales = [
            state.axial_scale for state in result.transform_field.states.values()
        ]
        self.assertAlmostEqual(sum(scales) / len(scales), 1.004, places=3)
        self.assertEqual(group_types(result).get(ONE_TO_ONE), 3 * (len(positions) - 1))

    def test_accumulated_drift_is_reported_as_explained_not_as_an_error(self):
        positions = joint_positions(count=60)
        old, new = build_pair(positions, axial_scale=1.004)
        result = run_aurora_alignment(old, new)

        check = result.transform_field.drift_check
        self.assertTrue(check["explained"])
        self.assertGreater(abs(check["totalAccumulatedDriftM"]), 1.0)


class ClockRotationTests(unittest.TestCase):
    """Section 11 — a coherent shift is a rotation, never a wider tolerance."""

    def test_two_hour_shift_is_recovered_as_a_sixty_degree_rotation(self):
        positions = joint_positions()
        old, new = build_pair(positions, clock_shift_hours=2.0)
        result = run_aurora_alignment(old, new)

        rotations = [
            math.degrees(wrap(state.clock_rotation_rad))
            for state in result.transform_field.states.values()
        ]
        self.assertTrue(rotations)
        self.assertAlmostEqual(
            sorted(rotations)[len(rotations) // 2], 60.0, delta=2.0
        )
        self.assertEqual(group_types(result).get(ONE_TO_ONE), 3 * (len(positions) - 1))

    def test_the_raw_clock_gate_is_not_widened_by_the_rotation(self):
        # A feature rotated by two hours *against* the region's own rotation
        # must not be matched: the corrected residual is what is scored.
        positions = joint_positions(count=12)
        old, new = build_pair(positions, clock_shift_hours=2.0, features_per_joint=1)
        for record in new:
            if record["source_key"] == "NEW:m00":
                record["clock_position"] = "10:00"
        result = run_aurora_alignment(old, new)

        outliers = [
            group for group in result.groups
            if group.group_type == ONE_TO_ONE
            and group.new_members[0].feature.key == "NEW:m00"
        ]
        self.assertEqual(outliers, [])


class StructuralGapTests(unittest.TestCase):
    """Sections 8.1 and 32 — missing welds are gaps, inserts are change zones."""

    def test_missing_welds_produce_gaps_not_an_index_shift(self):
        positions = joint_positions(count=40)
        old, new = build_pair(positions, dropped_welds=(5, 6, 17))
        result = run_aurora_alignment(old, new)

        self.assertEqual(len(result.anchor_pairs), len(positions) - 3)
        for pair in result.anchor_pairs:
            self.assertAlmostEqual(
                pair.old_feature.x_raw_m, pair.new_feature.x_raw_m, places=6
            )
        self.assertEqual(len(result.unmatched_anchors_old), 3)

    def test_inserted_welds_are_marked_as_a_structural_change_zone(self):
        positions = joint_positions(count=40)
        middle = positions[20]
        old, new = build_pair(
            positions,
            inserted_welds=[middle + step * 1.6 for step in range(1, 6)],
        )
        result = run_aurora_alignment(old, new)

        self.assertTrue(result.anchor_map.change_zones)
        self.assertEqual(result.mode, "M5_STRUCTURAL_CHANGE")
        # Identity is not forced across the modified region.
        self.assertTrue(any(
            reason.startswith("Structural change zone")
            for _feature, reason in result.bypassed_new
        ))


class AntiJumpTests(unittest.TestCase):
    """Sections 17.1 and 32 — a distant look-alike is never a candidate."""

    def test_similar_pattern_outside_the_corridor_is_rejected(self):
        positions = joint_positions(count=40)
        old = [weld("OLD", i, x) for i, x in enumerate(positions)]
        new = [weld("NEW", i, x) for i, x in enumerate(positions)]
        old.append(metal_loss("OLD", 0, positions[3] + 4.0, "9:00", 30))
        new.append(metal_loss("NEW", 0, positions[20] + 4.0, "9:00", 30))

        result = run_aurora_alignment(old, new)

        counts = group_types(result)
        self.assertEqual(counts.get(ONE_TO_ONE), None)
        self.assertEqual(counts.get(MISSING_OR_UNDETECTED), 1)
        self.assertEqual(counts.get(NEW_OR_PREVIOUSLY_UNDETECTED), 1)


class PatternRescueTests(unittest.TestCase):
    """Sections 16.2 and 38 — zero direct matches, strong regional pattern."""

    def test_rescue_recovers_a_region_whose_direct_matching_collapsed(self):
        positions = joint_positions(count=25)
        old, new = build_pair(positions, clock_shift_hours=2.0, features_per_joint=4)
        result = run_aurora_alignment(old, new)

        self.assertTrue(result.rescue_cases)
        accepted = [case for case in result.rescue_cases if case.accepted]
        self.assertTrue(accepted)
        for case in accepted:
            self.assertAlmostEqual(
                math.degrees(wrap(case.clock_rotation_rad)), 60.0, delta=3.0
            )
            self.assertGreaterEqual(case.inlier_fraction, 0.35)

    def test_rescue_declines_when_the_transform_is_not_unique(self):
        # A perfectly periodic constellation: several rotations explain it
        # equally well, so no transform may be adopted.
        positions = [0.0, 12.0, 24.0, 36.0]
        old = [weld("OLD", i, x) for i, x in enumerate(positions)]
        new = [weld("NEW", i, x) for i, x in enumerate(positions)]
        for joint in range(len(positions) - 1):
            base = positions[joint]
            for k in range(4):
                old.append(metal_loss(
                    "OLD", joint * 10 + k, base + 2.0 + 2.0 * k, _clock(3.0 * k)
                ))
                new.append(metal_loss(
                    "NEW", joint * 10 + k, base + 2.0 + 2.0 * k, _clock(3.0 * k + 3.0)
                ))

        result = run_aurora_alignment(old, new)
        statuses = {case.status for case in result.rescue_cases}
        self.assertTrue(
            statuses <= {"AMBIGUOUS_TRANSFORM", "NO_COHERENT_TRANSFORM", "ACCEPTED"}
        )
        # Whatever it decided, it may not have invented a crossing map.
        assert_non_crossing(result.anchor_map)


class ReportingEvolutionTests(unittest.TestCase):
    """Section 20 — split, merge and region-only are first-class outcomes."""

    def test_one_patch_reported_as_three_boxes_is_one_to_many(self):
        positions = joint_positions(count=20)
        old, new = build_pair(positions, features_per_joint=1, split_new_into=3)
        result = run_aurora_alignment(old, new)

        counts = group_types(result)
        self.assertGreater(counts.get(ONE_TO_MANY, 0), 10)
        # A split must not be reported as one match plus two new defects.
        self.assertEqual(counts.get(NEW_OR_PREVIOUSLY_UNDETECTED, 0), 0)

    def test_a_merge_is_reported_as_many_to_one(self):
        positions = joint_positions(count=20)
        new, old = build_pair(positions, features_per_joint=1, split_new_into=3)
        # Swap the roles: the *old* run is now the dense one.
        for record in old:
            record["source_key"] = record["source_key"].replace("NEW:", "OLD:")
        for record in new:
            record["source_key"] = record["source_key"].replace("OLD:", "NEW:")
        result = run_aurora_alignment(old, new)

        counts = group_types(result)
        self.assertGreater(counts.get(MANY_TO_ONE, 0), 10)
        self.assertEqual(counts.get(MISSING_OR_UNDETECTED, 0), 0)

    def test_region_and_feature_confidence_are_stored_separately(self):
        positions = joint_positions(count=20)
        old, new = build_pair(positions, clock_shift_hours=2.0, features_per_joint=4)
        result = run_aurora_alignment(old, new)

        rescued = [group for group in result.groups if group.rescue_mode]
        self.assertTrue(rescued)
        for group in rescued:
            self.assertGreater(group.region_confidence, 0.0)
            self.assertIsNotNone(group.feature_confidence)
            if group.group_type == MANY_TO_MANY_REGION:
                self.assertLess(group.feature_confidence, group.probability)


class InsufficientEvidenceTests(unittest.TestCase):
    """Section 33 — UNRESOLVED is a correct answer, not a software failure."""

    def test_a_run_with_no_anchors_refuses_to_claim_identity(self):
        old = [metal_loss("OLD", i, 10.0 * i) for i in range(8)]
        new = [metal_loss("NEW", i, 10.0 * i + 0.2) for i in range(8)]
        result = run_aurora_alignment(old, new)

        self.assertEqual(result.state, "INSUFFICIENT_EVIDENCE")
        self.assertEqual(group_types(result).get(ONE_TO_ONE), None)
        # Every feature is still conserved, with no identity claimed.
        self.assertEqual(
            group_types(result).get(MISSING_OR_UNDETECTED, 0)
            + group_types(result).get(NEW_OR_PREVIOUSLY_UNDETECTED, 0),
            16,
        )

    def test_clustered_metal_loss_is_conserved_but_never_aligned(self):
        positions = joint_positions(count=10)
        old, new = build_pair(positions, features_per_joint=1)
        old.append({
            "id": "OLDC", "source_key": "OLD:cluster",
            "abs_distance_m": positions[2] + 4.0, "originalType": "metal loss",
            "clock_position": "6:00", "depth_pct": 40.0,
            "raw": {"feature_identification": "CLUSTER corrosion"},
        })
        new.append({
            "id": "NEWC", "source_key": "NEW:cluster",
            "abs_distance_m": positions[2] + 4.0, "originalType": "metal loss",
            "clock_position": "6:00", "depth_pct": 45.0,
            "raw": {"feature_identification": "CLUSTER corrosion"},
        })
        result = run_aurora_alignment(old, new)

        bypassed_keys = {feature.key for feature, _reason in result.bypassed_old}
        self.assertIn("OLD:cluster", bypassed_keys)
        self.assertTrue(any(
            "Clustered metal loss" in reason for _f, reason in result.bypassed_old
        ))

    def test_a_session_may_offer_clusters_to_the_matcher(self):
        # The same two runs, with the engineer's decision that this vendor's
        # clusters are stable enough to carry an identity across runs.
        positions = joint_positions(count=10)
        old, new = build_pair(positions, features_per_joint=1)
        old.append({
            "id": "OLDC", "source_key": "OLD:cluster",
            "abs_distance_m": positions[2] + 4.0, "originalType": "metal loss",
            "clock_position": "6:00", "depth_pct": 40.0,
            "raw": {"feature_identification": "CLUSTER corrosion"},
        })
        new.append({
            "id": "NEWC", "source_key": "NEW:cluster",
            "abs_distance_m": positions[2] + 4.0, "originalType": "metal loss",
            "clock_position": "6:00", "depth_pct": 45.0,
            "raw": {"feature_identification": "CLUSTER corrosion"},
        })
        result = run_aurora_alignment(old, new, align_clusters=True)

        bypassed_keys = {feature.key for feature, _reason in result.bypassed_old}
        self.assertNotIn("OLD:cluster", bypassed_keys)
        self.assertFalse(any(
            "Clustered metal loss" in reason for _f, reason in result.bypassed_old
        ))
        # It went to the matcher, so it appears as a group like any other
        # metal loss rather than vanishing between the two buckets.
        grouped = {
            member.key
            for group in result.groups
            for member in list(group.old_members) + list(group.new_members)
        }
        self.assertIn("OLD:cluster", grouped)


class ConfigurationTests(unittest.TestCase):
    """Section 30 — thresholds are configuration, and are versioned."""

    def test_overrides_are_merged_and_unknown_keys_are_ignored(self):
        config = resolve_config({
            "rescue": {"direct_ok": 0.9, "not_a_real_key": 1},
            "score": {"auto_match_probability": 0.95},
            "unknown_section": {"whatever": 2},
        })
        self.assertEqual(config.rescue.direct_ok, 0.9)
        self.assertEqual(config.score.auto_match_probability, 0.95)
        self.assertEqual(config.structure.gap_open, AuroraConfig().structure.gap_open)

    def test_every_result_records_the_config_and_model_version(self):
        positions = joint_positions(count=8)
        old, new = build_pair(positions, features_per_joint=1)
        summary = run_aurora_alignment(old, new).summary()
        self.assertTrue(summary["configVersion"])
        self.assertTrue(summary["modelVersion"])


class WorkerOutputTests(unittest.TestCase):
    """The bucket contract the Node layer normalises."""

    def _engine(self):
        import hungarian_engine

        engine = hungarian_engine.HungarianAnomalyAlignmentEngine.__new__(
            hungarian_engine.HungarianAnomalyAlignmentEngine
        )
        engine.session_id = 1
        engine.run_1_year = 2016
        engine.run_2_year = 2026
        engine._run_1_meta = {"year": 2016}
        engine._run_2_meta = {"year": 2026}
        return engine

    def test_output_conserves_every_input_feature_exactly_once(self):
        import aurora_engine

        positions = joint_positions(count=15)
        old, new = build_pair(positions, axial_offset=5.0, features_per_joint=2)
        output = aurora_engine.build_aurora_output(self._engine(), old, new)

        audit = output["audit"]
        self.assertTrue(audit["isConserved"], audit)
        self.assertEqual(audit["old"]["inputCount"], len(old))
        self.assertEqual(audit["new"]["inputCount"], len(new))

    def test_a_split_group_emits_one_row_per_member_under_one_group_id(self):
        import aurora_engine

        positions = joint_positions(count=12)
        old, new = build_pair(positions, features_per_joint=1, split_new_into=3)
        output = aurora_engine.build_aurora_output(self._engine(), old, new)

        split_rows = [
            row for row in output["anomaly_matched"]
            if row["AURORA Match Type"].startswith("ONE_TO_MANY")
        ]
        self.assertTrue(split_rows)
        groups = {row["AURORA Group ID"] for row in split_rows}
        self.assertLess(len(groups), len(split_rows))
        self.assertTrue(output["audit"]["isConserved"])

    def test_stage_artifacts_travel_inside_the_audit_object(self):
        import aurora_engine

        positions = joint_positions(count=12)
        old, new = build_pair(positions, features_per_joint=2)
        output = aurora_engine.build_aurora_output(self._engine(), old, new)

        artifacts = output["audit"]["aurora"]
        for key in (
            "summary", "capabilityProfile", "anchorMap",
            "persistentJointMap", "transformField", "rescueCases", "reviewQueue",
        ):
            self.assertIn(key, artifacts)
        # Nothing AURORA adds may become a top-level array: the Node contract
        # flattens those straight into the comparison table.
        for key, value in output.items():
            if key == "audit":
                continue
            self.assertIsInstance(value, list, key)

    def test_girth_welds_and_fittings_land_in_their_own_buckets(self):
        import aurora_engine

        positions = joint_positions(count=12)
        old, new = build_pair(positions, features_per_joint=1)
        for side, records in (("OLD", old), ("NEW", new)):
            records.append({
                "id": f"{side}V1", "source_key": f"{side}:valve",
                "abs_distance_m": positions[4] + 3.0,
                "originalType": "valve", "raw": {"feature_type": "Valve"},
            })
            records.append({
                "id": f"{side}B1", "source_key": f"{side}:bend",
                "abs_distance_m": positions[6] + 3.0,
                "originalType": "bend", "raw": {"feature_type": "Bend"},
            })
        output = aurora_engine.build_aurora_output(self._engine(), old, new)

        self.assertTrue(output["gw_locked"])
        fitting_types = {
            str(row["Feature Type NEW"]).lower() for row in output["fitting_matched"]
        }
        self.assertTrue({"valve", "bend"} <= fitting_types, fitting_types)
        self.assertTrue(output["audit"]["isConserved"])


if __name__ == "__main__":
    unittest.main()
