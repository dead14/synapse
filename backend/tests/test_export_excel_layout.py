import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import openpyxl


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "python_engines"))

import export_excel


class ExportExcelLayoutTests(unittest.TestCase):
    def test_export_uses_new_status_old_layout_and_escapes_formula_text(self):
        engine = Path(__file__).parents[1] / "src" / "python_engines" / "export_excel.py"
        data = [{
            "Log Dist NEW (m)": 10.5,
            "Feature Type NEW": "Metal loss",
            "Identif. NEW": "=HYPERLINK(\"https://example.invalid\")",
            "Depth NEW (%WT)": 20,
            "Log Dist OLD (m)": 9.75,
            "Feature Type OLD": "Metal loss",
            "Identif. OLD": "Corrosion",
            "Depth OLD (%WT)": 15,
            "Match/Unmatch": "Matched",
        }]
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "data.json"
            output_path = Path(directory) / "report.xlsx"
            input_path.write_text(json.dumps(data), encoding="utf-8")
            subprocess.run([sys.executable, str(engine), str(input_path), str(output_path)], check=True)
            sheet = openpyxl.load_workbook(output_path, data_only=False).active
            self.assertTrue(str(sheet["A1"].value).startswith("<  DATA NEW"))
            self.assertTrue(str(sheet["P1"].value).startswith("KOMPARASI"))
            self.assertTrue(str(sheet["Z1"].value).startswith("DATA OLD"))
            self.assertEqual(sheet["A3"].value, 10.5)
            self.assertEqual(sheet["C3"].value, "'=HYPERLINK(\"https://example.invalid\")")
            self.assertEqual(sheet["P3"].value, 0.75)
            self.assertEqual(sheet["X3"].value, "Matched")
            self.assertEqual(sheet["Z3"].value, 9.75)


class ClockHandlingTests(unittest.TestCase):
    def test_excel_time_serial_is_mapped_onto_the_12_hour_dial(self):
        # An unconverted Excel serial is a fraction of a 24 h day:
        # 0.5 = 12:00 -> 0 deg on the 12-hour dial, not 0.5 * 30 = 15 deg.
        self.assertAlmostEqual(export_excel.clock_degrees(0.5), 0.0)
        self.assertAlmostEqual(export_excel.clock_degrees(0.25), 180.0)   # 06:00
        self.assertAlmostEqual(export_excel.clock_degrees(0.125), 90.0)   # 03:00
        self.assertAlmostEqual(export_excel.clock_degrees(0.53125), 22.5)  # 12:45

    def test_clock_hours_and_text_forms_are_unchanged(self):
        self.assertAlmostEqual(export_excel.clock_degrees(6), 180.0)
        self.assertAlmostEqual(export_excel.clock_degrees(4.5), 135.0)
        self.assertAlmostEqual(export_excel.clock_degrees("3:00"), 90.0)
        self.assertAlmostEqual(export_excel.clock_degrees("12:30"), 15.0)
        self.assertIsNone(export_excel.clock_degrees("N/A"))
        self.assertIsNone(export_excel.clock_degrees(None))

    def test_verdict_uses_the_wrapped_delta(self):
        # 11:59 vs 12:01 is a 1 degree change across the 12 o'clock wrap;
        # the unwrapped delta (359 deg) used to force a "YES" verdict.
        changed, delta = export_excel.clock_difference("12:01", "11:59")
        self.assertEqual(changed, "no")
        self.assertAlmostEqual(delta, 1.0)

        changed, delta = export_excel.clock_difference("3:00", "9:00")
        self.assertEqual(changed, "YES")
        self.assertAlmostEqual(delta, 180.0)

        changed, delta = export_excel.clock_difference("6:00", "6:00")
        self.assertEqual(changed, "no")
        self.assertAlmostEqual(delta, 0.0)

    def test_serial_and_text_forms_of_the_same_time_agree(self):
        changed, delta = export_excel.clock_difference(0.5, "12:00")
        self.assertEqual(changed, "no")
        self.assertAlmostEqual(delta, 0.0)
