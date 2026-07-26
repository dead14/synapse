import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import openpyxl


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
