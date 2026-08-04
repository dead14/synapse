import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import openpyxl


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "python_engines"))

import excel_common
import export_excel


class ExportExcelLayoutTests(unittest.TestCase):
    def test_ndjson_export_streams_rows_into_both_data_sheets(self):
        engine = Path(__file__).parents[1] / "src" / "python_engines" / "export_excel.py"
        metadata = {
            "pipelineData": {"pipelineName": "North Line"},
            "headers": ["Log Dist NEW (m)", "Match/Unmatch", "physics_warnings"],
            "rowCount": 2,
        }
        rows = [
            {
                "Log Dist NEW (m)": 10.5,
                "Match/Unmatch": "Matched",
                "physics_warnings": [{"code": "REVIEW"}],
            },
            {
                "Log Dist NEW (m)": 11.5,
                "Match/Unmatch": "Only NEW",
                "physics_warnings": [],
            },
        ]
        with tempfile.TemporaryDirectory() as directory:
            metadata_path = Path(directory) / "metadata.json"
            rows_path = Path(directory) / "rows.ndjson"
            output_path = Path(directory) / "report.xlsx"
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
            rows_path.write_text(
                "".join(json.dumps(row) + "\n" for row in rows),
                encoding="utf-8",
            )

            completed = subprocess.run(
                [
                    sys.executable,
                    str(engine),
                    "--ndjson",
                    str(metadata_path),
                    str(rows_path),
                    str(output_path),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertIn("PROGRESS 2", completed.stdout)
            workbook = openpyxl.load_workbook(output_path, data_only=False)

            self.assertEqual(workbook["Runcomp Report"]["A3"].value, 11.5)
            self.assertEqual(
                workbook["Runcomp Report"]["C2"].value,
                '[{"code":"REVIEW"}]',
            )
            self.assertEqual(workbook["Runcomp Comparison"]["Z4"].value, "Only NEW")
            self.assertEqual(
                workbook["Runcomp Comparison"]["Z4"].fill.fgColor.rgb,
                "FFFCE4D6",
            )
            self.assertEqual(
                sorted(
                    str(cells)
                    for cells in workbook["Runcomp Comparison"].merged_cells.ranges
                ),
                ["A1:O1", "AB1:AP1", "P1:AA1"],
            )

    def test_export_builds_pipeline_report_and_primary_comparison_sheets(self):
        engine = Path(__file__).parents[1] / "src" / "python_engines" / "export_excel.py"
        payload = {
            "pipelineData": {
                "pipelineName": "North Line",
                "segmentRoute": "Station A - Station B",
                "environment": "Onshore",
                "inspectionRuns": [
                    {"year": "2021", "vendor": "Vendor OLD", "fileName": "old.xlsx"},
                    {"year": "2026", "vendor": "Vendor NEW", "fileName": "new.xlsx"},
                ],
            },
            "report": [{
                "Run Pair": "2021 -> 2026",
                "Result Group": "ANOMALY",
                "Depth NEW (%WT)": 20,
            }],
            "comparison": [{
                "Log Dist NEW (m)": 10.5,
                "Log Dist OLD (m)": 9.75,
                "Match/Unmatch": "Matched",
            }],
        }
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "data.json"
            output_path = Path(directory) / "report.xlsx"
            input_path.write_text(json.dumps(payload), encoding="utf-8")
            subprocess.run([sys.executable, str(engine), str(input_path), str(output_path)], check=True)
            workbook = openpyxl.load_workbook(output_path, data_only=False)

            self.assertEqual(
                workbook.sheetnames,
                ["Data Pipeline", "Runcomp Report", "Runcomp Comparison"],
            )
            self.assertEqual(workbook["Data Pipeline"]["A1"].value, "PIPELINE DATA")
            self.assertEqual(workbook["Data Pipeline"]["B3"].value, "North Line")
            self.assertEqual(workbook["Runcomp Report"]["A2"].value, "2021 -> 2026")
            self.assertEqual(workbook["Runcomp Comparison"]["Z3"].value, "Matched")

    def test_report_only_payload_reuses_rows_for_the_comparison_sheet(self):
        engine = Path(__file__).parents[1] / "src" / "python_engines" / "export_excel.py"
        payload = {
            "pipelineData": {"pipelineName": "North Line"},
            "report": [{
                "Log Dist NEW (m)": 10.5,
                "Log Dist OLD (m)": 9.75,
                "Match/Unmatch": "Matched",
            }],
        }
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "data.json"
            output_path = Path(directory) / "report.xlsx"
            input_path.write_text(json.dumps(payload), encoding="utf-8")
            subprocess.run([sys.executable, str(engine), str(input_path), str(output_path)], check=True)
            workbook = openpyxl.load_workbook(output_path, data_only=False)

            self.assertEqual(workbook["Runcomp Report"]["A2"].value, 10.5)
            self.assertEqual(workbook["Runcomp Comparison"]["Z3"].value, "Matched")

    def test_report_body_is_plain_data_for_large_export_throughput(self):
        workbook = openpyxl.Workbook(write_only=True)
        export_excel.build_report_sheet(workbook, [{
            "Identifier": "=1+1",
            "Depth": 23,
        }])
        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "report.xlsx"
            workbook.save(output_path)
            sheet = openpyxl.load_workbook(output_path, data_only=False)["Runcomp Report"]

            self.assertEqual(sheet["A2"].value, "'=1+1")
            self.assertEqual(sheet["B2"].value, 23)
            self.assertEqual(sheet["A2"].style_id, 0)
            self.assertEqual(sheet["B2"].style_id, 0)

    def test_comparison_body_uses_column_defaults_instead_of_per_cell_styles(self):
        workbook = openpyxl.Workbook(write_only=True)
        export_excel.build_comparison_sheet(workbook, [{
            "Log Dist NEW (m)": 10.5,
            "Log Dist OLD (m)": 9.75,
            "Match/Unmatch": "Matched",
        }], "Runcomp Comparison")
        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "report.xlsx"
            workbook.save(output_path)
            sheet = openpyxl.load_workbook(output_path, data_only=False)["Runcomp Comparison"]

            self.assertEqual(sheet["A3"].style_id, 0)
            self.assertNotEqual(sheet.column_dimensions["A"].style_id, 0)
            self.assertEqual(sheet["Z3"].fill.fgColor.rgb, "00C6EFCE")

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
            self.assertTrue(str(sheet["A1"].value).startswith("<  NEW DATA"))
            self.assertTrue(str(sheet["P1"].value).startswith("COMPARISON"))
            self.assertTrue(str(sheet["AB1"].value).startswith("OLD DATA"))
            self.assertEqual(sheet["A3"].value, 10.5)
            self.assertEqual(sheet["C3"].value, "'=HYPERLINK(\"https://example.invalid\")")
            self.assertEqual(sheet["P3"].value, 0.75)
            self.assertEqual(sheet["Z3"].value, "Matched")
            self.assertEqual(sheet["AB3"].value, 9.75)
            # The status colour rule and the completeness verdict are what an
            # operator reads first; both must survive the shared-style rewrite.
            self.assertEqual(sheet["Z3"].fill.fgColor.rgb, "00C6EFCE")
            # Only depth is populated on both sides, so two of the six
            # dimensional readings are present: the verdict is "Both limited".
            self.assertEqual(sheet["AA3"].value, "Both limited")


class StreamedWorkbookTests(unittest.TestCase):
    """The sheet is streamed, and every style object is a module singleton.

    The report is 40 columns wide, so a 100k-row export is four million cells.
    Normal mode keeps all of them alive as Cell objects until save() and used
    to build a fresh Font per row for the status column on top of that. The
    export now runs in write-only mode with shared styles: 50k rows went from
    884 MB of Python heap to 78 MB, with byte-identical formatting.
    """

    def test_workbook_is_created_in_write_only_mode(self):
        engine_source = (
            Path(__file__).parents[1] / "src" / "python_engines" / "export_excel.py"
        ).read_text(encoding="utf-8")
        self.assertIn("write_only=True", engine_source)

    def test_streamed_layout_keeps_the_features_write_only_supports(self):
        # merge_cells() does not exist on a WriteOnlyWorksheet, but the merged
        # range collection it inherits is serialised, and freeze panes,
        # auto-filter and dimensions all survive. This pins that contract.
        engine = Path(__file__).parents[1] / "src" / "python_engines" / "export_excel.py"
        data = [{"Log Dist NEW (m)": 1.0, "Log Dist OLD (m)": 0.5, "Match/Unmatch": "Only NEW"}]
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "data.json"
            output_path = Path(directory) / "report.xlsx"
            input_path.write_text(json.dumps(data), encoding="utf-8")
            subprocess.run(
                [sys.executable, str(engine), str(input_path), str(output_path)], check=True
            )
            sheet = openpyxl.load_workbook(output_path).active
            self.assertEqual(sheet.title, "Comparison Report")
            self.assertEqual(
                sorted(str(cells) for cells in sheet.merged_cells.ranges),
                ["A1:O1", "AB1:AP1", "P1:AA1"],
            )
            self.assertEqual(sheet.freeze_panes, "P3")
            self.assertEqual(sheet.auto_filter.ref, "A2:AP3")
            self.assertEqual(sheet.column_dimensions["A"].width, 17)
            self.assertEqual(sheet.row_dimensions[1].height, 24)
            self.assertEqual(sheet.row_dimensions[2].height, 42)
            self.assertFalse(sheet.sheet_view.showGridLines)
            self.assertEqual(sheet["Z3"].fill.fgColor.rgb, "00FCE4D6")

    def test_status_style_matches_the_legacy_keyword_precedence(self):
        self.assertIs(export_excel.status_style("Matched")[0], export_excel.GREEN_FILL)
        self.assertIs(export_excel.status_style("Bypassed OLD")[0], export_excel.YELLOW_FILL)
        self.assertIs(export_excel.status_style("Only NEW")[0], export_excel.ORANGE_FILL)
        self.assertEqual(export_excel.status_style("-"), (None, None))
        self.assertEqual(export_excel.status_style(None), (None, None))

    def test_style_objects_are_module_level_singletons(self):
        plan = export_excel.column_style_plan(export_excel.LAST_COLUMN)
        self.assertEqual(len(plan), export_excel.LAST_COLUMN)
        fills = {id(fill) for fill, _alignment, _format in plan}
        alignments = {id(alignment) for _fill, alignment, _format in plan}
        self.assertEqual(len(fills), 3)
        self.assertEqual(len(alignments), 2)
        self.assertTrue(
            all(fill in (export_excel.NEW_FILL, export_excel.CENTER_FILL, export_excel.OLD_FILL)
                for fill, _alignment, _format in plan)
        )

    def test_column_plan_reproduces_the_legacy_per_cell_decisions(self):
        for column, (fill, alignment, number_format) in enumerate(
            export_excel.column_style_plan(export_excel.LAST_COLUMN), 1
        ):
            expected_fill = (
                export_excel.NEW_FILL if column < export_excel.FIRST_CENTER_COLUMN
                else export_excel.OLD_FILL if column >= export_excel.FIRST_OLD_COLUMN
                else export_excel.CENTER_FILL
            )
            expected_alignment = (
                export_excel.CENTER_ALIGNMENT
                if export_excel.FIRST_CENTER_COLUMN <= column < export_excel.FIRST_OLD_COLUMN
                else export_excel.LEFT_ALIGNMENT
            )
            expected_format = (
                "0.000" if column in export_excel.THREE_DECIMAL_COLUMNS
                else "0.0" if column in export_excel.ONE_DECIMAL_COLUMNS
                else None
            )
            self.assertIs(fill, expected_fill, f"column {column}")
            self.assertIs(alignment, expected_alignment, f"column {column}")
            self.assertEqual(number_format, expected_format, f"column {column}")


class ClockHandlingTests(unittest.TestCase):
    def test_excel_time_serial_is_mapped_onto_the_12_hour_dial(self):
        # An unconverted Excel serial is a fraction of a 24 h day:
        # 0.5 = 12:00 -> 0 deg on the 12-hour dial, not 0.5 * 30 = 15 deg.
        self.assertAlmostEqual(excel_common.clock_degrees(0.5), 0.0)
        self.assertAlmostEqual(excel_common.clock_degrees(0.25), 180.0)   # 06:00
        self.assertAlmostEqual(excel_common.clock_degrees(0.125), 90.0)   # 03:00
        self.assertAlmostEqual(excel_common.clock_degrees(0.53125), 22.5)  # 12:45

    def test_clock_hours_and_text_forms_are_unchanged(self):
        self.assertAlmostEqual(excel_common.clock_degrees(6), 180.0)
        self.assertAlmostEqual(excel_common.clock_degrees(4.5), 135.0)
        self.assertAlmostEqual(excel_common.clock_degrees("3:00"), 90.0)
        self.assertAlmostEqual(excel_common.clock_degrees("12:30"), 15.0)
        self.assertIsNone(excel_common.clock_degrees("N/A"))
        self.assertIsNone(excel_common.clock_degrees(None))

    def test_verdict_uses_the_wrapped_delta(self):
        # 11:59 vs 12:01 is a 1 degree change across the 12 o'clock wrap;
        # the unwrapped delta (359 deg) used to force a "YES" verdict.
        changed, delta = excel_common.clock_difference("12:01", "11:59")
        self.assertEqual(changed, "no")
        self.assertAlmostEqual(delta, 1.0)

        changed, delta = excel_common.clock_difference("3:00", "9:00")
        self.assertEqual(changed, "YES")
        self.assertAlmostEqual(delta, 180.0)

        changed, delta = excel_common.clock_difference("6:00", "6:00")
        self.assertEqual(changed, "no")
        self.assertAlmostEqual(delta, 0.0)

    def test_serial_and_text_forms_of_the_same_time_agree(self):
        changed, delta = excel_common.clock_difference(0.5, "12:00")
        self.assertEqual(changed, "no")
        self.assertAlmostEqual(delta, 0.0)
