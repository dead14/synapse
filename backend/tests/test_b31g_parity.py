"""The Python half of the B31G cross-implementation pin.

Both halves read the same vector file, `b31g_golden_vectors.json`, which is
generated from the production TypeScript engine. This half asserts the Python
port reproduces it; `frontend/tests/ffsB31gParity.test.ts` asserts the fixture
still describes the engine that produced it. Neither file carries its own
transcribed copy of the numbers, because a hand-copied pin only pins the halves
to whatever was typed — which is how the previous version of this test ended up
asserting a rounded `SMYS + 69` flow stress, a `P_F x F` safe pressure, and an
`S0 / (S_F x F)` ERF against an engine that had moved on from all three.

Regenerate the fixture and both halves together, or neither.
"""

import json
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src" / "python_engines"))

from b31g import (  # noqa: E402
    DEPTH_LIMIT_RATIO,
    MODIFIED_FLOW_STRESS_UPLIFT_MPA,
    assess_feature,
    safety_factor_from_design_factor,
)

FIXTURE = json.loads((Path(__file__).parent / "b31g_golden_vectors.json").read_text(encoding="utf-8"))
TOLERANCE = FIXTURE["tolerance"]

NUMERIC_KEYS = ("so", "z", "sflow", "Sf", "Pf", "safePressure", "ERF", "safetyFactor")
LIFE_KEYS = ("years", "depthLimitYears", "erfLimitYears")


class B31gParityTests(unittest.TestCase):
    def test_fixture_covers_both_safety_factor_provenances(self):
        self.assertGreaterEqual(len(FIXTURE["vectors"]), 8)
        sources = {v["expected"]["safetyFactorSource"] for v in FIXTURE["vectors"]}
        self.assertIn("explicit", sources)
        self.assertIn("derived-from-design-factor", sources)

    def test_golden_vectors(self):
        for vector in FIXTURE["vectors"]:
            with self.subTest(vector["id"]):
                data = vector["input"]
                expected = vector["expected"]
                result = assess_feature(
                    method=data["method"],
                    sa_mode=data["saMode"],
                    depth_pct=data["depthPct"],
                    length_mm=data["lengthMm"],
                    wall_mm=data["wallMm"],
                    od_mm=data["odMm"],
                    smys_mpa=data["smysMpa"],
                    design_factor=data["designFactor"],
                    pressure_mpa=data["pressureMpa"],
                    cr_depth_mm_yr=data["crDepthMmPerYear"],
                    cr_length_mm_yr=data["crLengthMmPerYear"],
                    safety_factor=data["safetyFactor"],
                )

                for key in NUMERIC_KEYS:
                    self.assertAlmostEqual(result[key], expected[key], delta=TOLERANCE, msg=key)

                if expected["M"] is None:
                    self.assertIsNone(result["M"])
                else:
                    self.assertAlmostEqual(result["M"], expected["M"], delta=TOLERANCE, msg="M")

                self.assertEqual(result["branch"], expected["branch"])
                self.assertEqual(result["safetyFactorSource"], expected["safetyFactorSource"])

                life = result["remnantLife"]
                self.assertEqual(life["status"], expected["status"])
                self.assertEqual(life["governingLimit"], expected["governingLimit"])
                for key in LIFE_KEYS:
                    if expected[key] is None:
                        self.assertIsNone(life[key], key)
                    else:
                        self.assertAlmostEqual(life[key], expected[key], delta=TOLERANCE, msg=key)


class B31gContractTests(unittest.TestCase):
    """The behaviours the earlier draft of this port got wrong."""

    def test_flow_stress_uplift_is_the_converted_10_ksi(self):
        # Writing 69 moved the failure stress on every Modified assessment.
        self.assertAlmostEqual(MODIFIED_FLOW_STRESS_UPLIFT_MPA, 68.94757293168689, places=10)

    def test_safe_pressure_divides_by_the_safety_factor(self):
        explicit = assess_feature("modified", "smys69", 45, 120, 9.53, 508, 359, 0.72, 6.0,
                                  safety_factor=1.25)
        self.assertEqual(explicit["safetyFactorSource"], "explicit")
        self.assertAlmostEqual(explicit["safePressure"], explicit["Pf"] / 1.25, places=9)
        self.assertAlmostEqual(explicit["ERF"], 6.0 / explicit["safePressure"], places=9)
        # The design factor must not reach the pressures once SF is explicit.
        self.assertNotAlmostEqual(explicit["safePressure"], explicit["Pf"] * 0.72, places=3)

    def test_derived_safety_factor_is_the_reciprocal_design_factor(self):
        derived = assess_feature("modified", "smys69", 45, 120, 9.53, 508, 359, 0.72, 6.0)
        self.assertEqual(derived["safetyFactorSource"], "derived-from-design-factor")
        self.assertAlmostEqual(derived["safetyFactor"], safety_factor_from_design_factor(0.72), places=9)

    def test_a_stricter_safety_factor_lowers_the_safe_pressure_only(self):
        lenient = assess_feature("modified", "smys69", 45, 120, 9.53, 508, 359, 0.72, 6.0,
                                 safety_factor=1.25)
        strict = assess_feature("modified", "smys69", 45, 120, 9.53, 508, 359, 0.72, 6.0,
                                safety_factor=1.39)
        self.assertAlmostEqual(lenient["Pf"], strict["Pf"], places=9)
        self.assertLess(strict["safePressure"], lenient["safePressure"])
        self.assertGreater(strict["ERF"], lenient["ERF"])

    def test_no_remaining_strength_is_infinite_not_a_sentinel(self):
        # 1e9 is a real number to every chart and sort that touches it.
        result = assess_feature("modified", "smys69", 100, 50, 10, 508, 359, 0.72, 7.2)
        self.assertTrue(math.isinf(result["ERF"]))
        self.assertFalse(result["valid"])
        self.assertEqual(result["Sf"], 0.0)

    def test_no_growth_reports_no_basis_rather_than_a_capped_number(self):
        # The old port answered 200 years and "N/A (>=200yr)", which reads as a
        # service-life claim rather than the absence of one.
        result = assess_feature("modified", "smys69", 20, 60, 12.7, 508, 359, 0.72, 7.2, 0.0, 0.0)
        life = result["remnantLife"]
        self.assertIsNone(life["years"])
        self.assertEqual(life["status"], "insufficient-growth-basis")
        self.assertIsNone(life["governingLimit"])

    def test_a_limit_beyond_the_horizon_is_not_reached_rather_than_extrapolated(self):
        result = assess_feature("modified", "smys69", 20, 60, 12.7, 508, 359, 0.72, 7.2,
                                cr_depth_mm_yr=0.001, horizon_years=5)
        life = result["remnantLife"]
        self.assertIsNone(life["years"])
        self.assertEqual(life["status"], "not-reached-within-horizon")

    def test_metal_loss_past_the_project_rejection_line_is_still_assessed(self):
        # 80 %WT is a project rejection threshold, not an applicability limit:
        # para. 1.2(f) admits any depth given a justified sizing accuracy.
        result = assess_feature("modified", "smys69", 85, 100, 12.7, 508, 359, 0.72, 7.2,
                                cr_depth_mm_yr=0.2)
        self.assertTrue(result["valid"])
        self.assertTrue(result["beyondDepthLimit"])
        self.assertGreater(result["Sf"], 0)
        self.assertEqual(result["remnantLife"]["years"], 0)
        self.assertEqual(result["remnantLife"]["governingLimit"], "Depth = 80%")

    def test_the_original_long_branch_drops_the_bulging_term_at_z_20(self):
        # The cutoff is 20 exactly. The 4.479^2 = 20.0614 form kept the
        # parabolic branch alive where the code has moved to the rectangular one.
        wall, od = 12.7, 508.0
        just_over = math.sqrt(20.0001 * od * wall)
        result = assess_feature("original", "smys11", 40, just_over, wall, od, 359, 0.72, 7.2)
        self.assertIsNone(result["M"])
        self.assertEqual(result["branch"], "z>20")

    def test_depth_limit_ratio_is_the_documented_project_threshold(self):
        self.assertEqual(DEPTH_LIMIT_RATIO, 0.80)


if __name__ == "__main__":
    unittest.main()
