import json
import sys

import openpyxl
import xlsxwriter
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# The stateless value helpers are shared with the corrosion assessment report,
# which reads the same alignment rows. Only the pure functions move: the style
# objects below are deliberately module-level singletons (see the note on them),
# and a shared factory returning fresh Font/Fill/Border objects per call would
# undo that.
from excel_common import (
    as_number,
    clock_difference,
    difference,
    first_value,
    safe_cell_value,
)


# Column titles follow POF 100 (Nov 2021) Appendix 2 "Report structure,
# terminology and abbreviations" and Appendix 8 "Run comparison example", so a
# client can read this workbook next to the contractor's own report without
# translating. Only the titles are POF; the row values are still pulled by the
# engine's own keys in `side_values()` below, which are unchanged.
#
# Two headers have no POF equivalent and say so plainly rather than borrowing a
# standard word: "Feature number" (the vendor's own record number, which POF
# leaves to the contractor) and "Data completeness" (an audit of this alignment,
# not a property of the pipe).
def _sided(side):
    return [
        f"Log distance {side} [m]",
        f"Feature type {side}",
        f"Feature number {side}",
        f"Girth weld number {side}",
        f"Joint length {side} [m]",
        f"Feature to upstream weld {side} [m]",
        f"Wall thickness {side} [mm]",
        f"Clock position {side}",
        f"Length {side} [mm]",
        f"Width {side} [mm]",
        f"Depth {side} [%t]",
        f"Surface location {side}",
        f"ERF {side}",
        f"Psafe {side} [bar]",
        f"Comments {side}",
    ]


NEW_HEADERS = _sided("NEW")
# POF Appendix 8 bands these as "Difference"; depth is %t and the clock is a
# position, per POF §2.7.
CENTER_HEADERS = [
    "Δ Log distance\n[m] NEW-OLD", "Δ Feature to\nupstream weld [m]",
    "Clock position\nchanged?", "Δ Clock position\n[°]",
    "Δ Depth [%t]\nNEW-OLD", "Δ Length [mm]\nNEW-OLD", "Δ Width [mm]\nNEW-OLD",
    "Depth growth\n[%t/yr]", "Length growth\n[mm/yr]",
    "Surface location\nchanged?", "Run\ncomparison", "Data\ncompleteness",
]
OLD_HEADERS = _sided("OLD")

# Every style object is built exactly once at import time.  openpyxl keeps one
# Cell object per populated cell, and the report is 40 columns wide, so a
# 100k-row comparison is four million cells: constructing a Font/Fill/Border
# per cell (or even per row, as the status column used to) is what turned this
# export into a multi-gigabyte job.  Write-only mode would drop the Cell
# objects too, but it supports neither merged cells nor auto-filter nor
# column/row dimensions, all of which this layout depends on.
DARK_BLUE_FILL = PatternFill("solid", fgColor="1F4E79")
BLUE_FILL = PatternFill("solid", fgColor="2E74B5")
GOLD_FILL = PatternFill("solid", fgColor="BF9000")
NEW_FILL = PatternFill("solid", fgColor="F0F6FC")
CENTER_FILL = PatternFill("solid", fgColor="FFF8E7")
OLD_FILL = PatternFill("solid", fgColor="F7F7F7")
GREEN_FILL = PatternFill("solid", fgColor="C6EFCE")
ORANGE_FILL = PatternFill("solid", fgColor="FCE4D6")
YELLOW_FILL = PatternFill("solid", fgColor="FFF2CC")

WHITE_BOLD_FONT = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
TITLE_FONT = Font(name="Calibri", size=12, bold=True, color="FFFFFF")
MATCHED_FONT = Font(name="Calibri", size=10, bold=True, color="006100")
BYPASSED_FONT = Font(name="Calibri", size=10, bold=True, color="7F6000")
ONLY_FONT = Font(name="Calibri", size=10, bold=True, color="9C0006")

CENTER_ALIGNMENT = Alignment(horizontal="center", vertical="center", wrap_text=True)
LEFT_ALIGNMENT = Alignment(horizontal="left", vertical="center")
RIGHT_ALIGNMENT = Alignment(horizontal="right", vertical="center")
THIN_BORDER = Border(bottom=Side(style="thin", color="D9E2F3"))

# Derived from the header lists rather than written out. These were literals —
# 16, 26, 24 — which silently encoded "there are exactly ten comparison
# columns"; adding one shifted the OLD block and the status styling onto the
# wrong cells with nothing to catch it.
FIRST_CENTER_COLUMN = len(NEW_HEADERS) + 1
FIRST_OLD_COLUMN = FIRST_CENTER_COLUMN + len(CENTER_HEADERS)
STATUS_COLUMN = FIRST_CENTER_COLUMN + CENTER_HEADERS.index("Run\ncomparison")
LAST_COLUMN = len(NEW_HEADERS) + len(CENTER_HEADERS) + len(OLD_HEADERS)


def _new(*offsets):
    """Absolute column numbers from 1-based offsets inside the NEW block."""
    return {offset for offset in offsets}


def _center(*offsets):
    return {FIRST_CENTER_COLUMN + offset - 1 for offset in offsets}


def _old(*offsets):
    return {FIRST_OLD_COLUMN + offset - 1 for offset in offsets}


# Number formats are addressed by block offset, not by absolute column. Written
# out as absolute indices they had to be renumbered by hand whenever the layout
# grew, and a missed entry formats a neighbouring column instead of failing.
#
# The OLD block's offsets deliberately mirror what the export already produced
# rather than what symmetry would suggest — OLD Width/Depth carry three
# decimals where their NEW counterparts carry one. That asymmetry predates this
# change and is left alone here so the refactor does not quietly restyle a
# report that people already reconcile against.
THREE_DECIMAL_COLUMNS = frozenset(
    _new(1, 5, 6, 7)
    | _center(1, 2, 5, 6, 7, 8, 9)
    | _old(1, 5, 6, 7, 10, 11, 12)
)
ONE_DECIMAL_COLUMNS = frozenset(_new(9, 10, 11) | _old(9))
# POF 100 run comparison wording for the engine's own match statuses. Keep in
# step with `POF_MATCH_STATUS` in `frontend/src/domain/pof100.ts`: the workbook
# and the screen are read side by side, and the header of this column already
# says "Run comparison".
#
# The engine names a row after the side it was built from — "Only OLD" is a row
# with an OLD feature and no NEW partner. That is a statement about the join,
# not about the pipe. A feature the OLD run reported and the NEW run did not is
# missing; one only the NEW run reported is new.
#
# "Not compared" is deliberately not "missing": a bypassed row was never offered
# to the matcher (a vendor-merged cluster above all), so the NEW run saying
# nothing about it says nothing about the pipe.
POF_MATCH_STATUS = {
    "match": ("Matched", "matched"),
    "matched": ("Matched", "matched"),
    "only old": ("Missing", "missing"),
    "only new": ("New", "new"),
    "bypassed old": ("Not compared (OLD)", "not-compared"),
    "bypassed new": ("Not compared (NEW)", "not-compared"),
    # The girth-weld bucket's own underscored statuses stay out of the
    # missing/new pair: a weld with no counterpart is a weld the comparison
    # could not match, not a weld that has gone.
    "only_old": ("Not match (OLD)", "unmatched"),
    "only_new": ("Not match (NEW)", "unmatched"),
    "unmatch": ("Not match", "unmatched"),
    "unmatched": ("Not match", "unmatched"),
}

STATUS_STYLES = {
    "matched": (GREEN_FILL, MATCHED_FONT),
    "not-compared": (YELLOW_FILL, BYPASSED_FONT),
    "missing": (ORANGE_FILL, ONLY_FONT),
    "new": (ORANGE_FILL, ONLY_FONT),
    "unmatched": (ORANGE_FILL, ONLY_FONT),
}

# The same three colours for the streaming writer, which builds its formats
# through xlsxwriter instead of openpyxl.
STATUS_FORMAT_NAMES = {
    "matched": "status_matched",
    "not-compared": "status_bypassed",
    "missing": "status_only",
    "new": "status_only",
    "unmatched": "status_only",
}

# Both vocabularies resolve to the same outcome, so the cell can be styled from
# the word already written into it.
STATUS_OUTCOMES = {
    **{engine_value: outcome for engine_value, (_, outcome) in POF_MATCH_STATUS.items()},
    **{label.lower(): outcome for label, outcome in POF_MATCH_STATUS.values()},
}


def pof_match_status(value):
    """The POF 100 wording for an engine match status, or the value as written.

    An unrecognised status is carried through rather than blanked: a status this
    table has never seen is still evidence of how the row was produced.
    """
    entry = POF_MATCH_STATUS.get(str(value or "").strip().lower())
    return entry[0] if entry else value

XLSX_FILL_COLORS = {
    "dark_blue": "#1F4E79",
    "blue": "#2E74B5",
    "gold": "#BF9000",
    "new": "#F0F6FC",
    "center": "#FFF8E7",
    "old": "#F7F7F7",
    "green": "#C6EFCE",
    "orange": "#FCE4D6",
    "yellow": "#FFF2CC",
}


def column_style_plan(column_count):
    """Resolve each column's fill, alignments and number format once.

    The per-cell decisions are a pure function of the column index and whether
    the value is numeric, so they are hoisted out of the row loop entirely.
    """
    plan = []
    for column in range(1, column_count + 1):
        if column < FIRST_CENTER_COLUMN:
            fill = NEW_FILL
        elif column < FIRST_OLD_COLUMN:
            fill = CENTER_FILL
        else:
            fill = OLD_FILL
        text_alignment = (
            CENTER_ALIGNMENT
            if FIRST_CENTER_COLUMN <= column < FIRST_OLD_COLUMN
            else LEFT_ALIGNMENT
        )
        if column in THREE_DECIMAL_COLUMNS:
            number_format = "0.000"
        elif column in ONE_DECIMAL_COLUMNS:
            number_format = "0.0"
        else:
            number_format = None
        plan.append((fill, text_alignment, number_format))
    return plan


def side_values(row, side):
    return [
        first_value(row, f"Log Dist {side} (m)", f"Abs. Dist {side} (m)"),
        first_value(row, f"Feature Type {side}"),
        first_value(row, f"Identif. {side}", f"feature_{side.lower()}_id"),
        first_value(row, f"Joint No. {side}", f"Joint Number {side}"),
        first_value(row, f"Joint Len {side} (m)", f"Joint Length {side} (m)"),
        first_value(row, f"Dist GW {side} (m)", f"Dist to US GW {side} (m)"),
        first_value(row, f"Wall WT {side} (mm)", f"Wall Thickness {side} (mm)"),
        first_value(row, f"O'Clock {side}"),
        first_value(row, f"Length {side} (mm)"),
        first_value(row, f"Width {side} (mm)"),
        first_value(row, f"Depth {side} (%WT)"),
        first_value(row, f"Surface {side}"),
        first_value(row, f"ERF ASME {side}"),
        first_value(row, f"Psafe {side} (bar)"),
        first_value(row, f"Comment {side}"),
    ]


def completeness(new_values, old_values):
    if new_values[0] is None:
        return "OLD only"
    if old_values[0] is None:
        return "NEW only"
    dimensional_values = [new_values[8], new_values[9], new_values[10], old_values[8], old_values[9], old_values[10]]
    return "Complete" if sum(value is not None for value in dimensional_values) >= 4 else "Both limited"


def comparison_values(row, new_values, old_values):
    clock_changed, clock_delta = clock_difference(new_values[7], old_values[7])
    new_surface, old_surface = new_values[11], old_values[11]
    surface_changed = None
    if new_surface is not None and old_surface is not None:
        surface_changed = "no" if str(new_surface).lower() == str(old_surface).lower() else "YES"
    return [
        difference(new_values[0], old_values[0]),
        difference(new_values[5], old_values[5]),
        clock_changed,
        clock_delta,
        difference(new_values[10], old_values[10]),
        difference(new_values[8], old_values[8]),
        difference(new_values[9], old_values[9]),
        # The run-pair growth rates the alignment engine already derived. They
        # are carried rather than recomputed here: the engine knows the survey
        # interval and whether the pair was matched at all, and a rate divided
        # out of two raw depths in this file would disagree with the one the
        # FFS assessment projects from.
        as_number(first_value(row, "Depth Growth (%WT/yr)")),
        as_number(first_value(row, "Length Growth (mm/yr)")),
        surface_changed,
        pof_match_status(first_value(row, "Match/Unmatch", "match_status")) or "-",
        completeness(new_values, old_values),
    ]


def set_column_widths(ws):
    widths = [17, 20, 24, 14, 17, 17, 18, 15, 18, 18, 18, 18, 16, 16, 30,
              16, 16, 14, 14, 16, 17, 17, 17, 17, 14, 20, 19,
              17, 20, 24, 14, 17, 17, 18, 15, 18, 18, 18, 18, 16, 16, 30]
    # One width per column, or the fills and formats land on the wrong ones.
    assert len(widths) == LAST_COLUMN, f"{len(widths)} widths for {LAST_COLUMN} columns"
    plan = column_style_plan(len(widths))
    for index, (width, (fill, alignment, number_format)) in enumerate(zip(widths, plan), 1):
        dimension = ws.column_dimensions[get_column_letter(index)]
        dimension.width = width
        dimension.fill = fill
        dimension.border = THIN_BORDER
        if FIRST_CENTER_COLUMN <= index < FIRST_OLD_COLUMN:
            dimension.alignment = alignment
        if number_format is not None:
            dimension.number_format = number_format


def status_style(value):
    """Fill and font for the Run comparison cell, or (None, None)."""
    outcome = STATUS_OUTCOMES.get(str(value or "").strip().lower())
    return STATUS_STYLES.get(outcome, (None, None))


def styled_cell(worksheet, value, *, fill=None, font=None, alignment=None,
                border=None, number_format=None):
    cell = WriteOnlyCell(worksheet, value=value)
    if fill is not None:
        cell.fill = fill
    if font is not None:
        cell.font = font
    if alignment is not None:
        cell.alignment = alignment
    if border is not None:
        cell.border = border
    if number_format is not None:
        cell.number_format = number_format
    return cell


def build_data_row(worksheet, row):
    """Build one row while leaving shared presentation styles on the columns."""
    new_values = side_values(row, "NEW")
    old_values = side_values(row, "OLD")
    values = new_values + comparison_values(row, new_values, old_values) + old_values
    status_fill, status_font = status_style(values[STATUS_COLUMN - 1])

    cells = [safe_cell_value(value) for value in values]
    if status_fill is not None:
        cells[STATUS_COLUMN - 1] = styled_cell(
            worksheet,
            cells[STATUS_COLUMN - 1],
            fill=status_fill,
            font=status_font,
            alignment=CENTER_ALIGNMENT,
            border=THIN_BORDER,
        )
    return cells


PIPELINE_FIELDS = [
    ("Pipeline Name", "pipelineName"),
    ("Segment Route", "segmentRoute"),
    ("Environment", "environment"),
    ("Length (km)", "lengthKm"),
    ("Product Medium", "productMedium"),
    ("MAOP (psi)", "maopPsi"),
    ("Outer Diameter", "outerDiameter"),
    ("Nominal WT (mm)", "nominalWtMm"),
    ("Material Grade", "materialGrade"),
    ("Seam Type", "seamType"),
    ("External Coating", "externalCoating"),
    ("Installation Year", "installationYear"),
    ("Location Class", "locationClass"),
]


def append_header_row(worksheet, headers, fill=DARK_BLUE_FILL):
    worksheet.append([
        styled_cell(
            worksheet,
            header,
            fill=fill,
            font=WHITE_BOLD_FONT,
            alignment=CENTER_ALIGNMENT,
        )
        for header in headers
    ])


def build_pipeline_sheet(workbook, pipeline_data):
    worksheet = workbook.create_sheet("Data Pipeline")
    worksheet.sheet_view.showGridLines = False
    worksheet.freeze_panes = "A3"
    worksheet.column_dimensions["A"].width = 28
    worksheet.column_dimensions["B"].width = 42
    worksheet.merged_cells.add("A1:B1")
    worksheet.append([
        styled_cell(
            worksheet,
            "PIPELINE DATA",
            fill=DARK_BLUE_FILL,
            font=TITLE_FONT,
            alignment=CENTER_ALIGNMENT,
        ),
        None,
    ])
    append_header_row(worksheet, ["Field", "Value"], BLUE_FILL)
    for label, key in PIPELINE_FIELDS:
        worksheet.append([
            styled_cell(worksheet, label, fill=NEW_FILL, font=MATCHED_FONT, border=THIN_BORDER),
            styled_cell(
                worksheet,
                safe_cell_value(pipeline_data.get(key)),
                fill=OLD_FILL,
                border=THIN_BORDER,
            ),
        ])

    worksheet.append([])
    worksheet.append([
        styled_cell(
            worksheet,
            "INSPECTION RUNS",
            fill=GOLD_FILL,
            font=TITLE_FONT,
            alignment=CENTER_ALIGNMENT,
        ),
    ])
    run_headers = ["Role", "Survey Year", "Vendor", "File Name", "Run ID", "Records"]
    append_header_row(worksheet, run_headers, GOLD_FILL)
    for run in pipeline_data.get("inspectionRuns", []) or []:
        worksheet.append([
            styled_cell(worksheet, safe_cell_value(run.get(key)), border=THIN_BORDER)
            for key in ("role", "year", "vendor", "fileName", "runId", "total")
        ])
    for column, width in enumerate((18, 14, 24, 38, 14, 14), 1):
        worksheet.column_dimensions[get_column_letter(column)].width = width
    return worksheet


def report_headers(rows):
    headers = []
    seen = set()
    for row in rows:
        for key in row:
            if str(key).startswith("__") or key in seen:
                continue
            seen.add(key)
            headers.append(key)
    return headers


def initialize_report_sheet(workbook, headers, row_count):
    worksheet = workbook.create_sheet("Runcomp Report")
    worksheet.sheet_view.showGridLines = False
    worksheet.freeze_panes = "A2"
    worksheet.auto_filter.ref = (
        f"A1:{get_column_letter(len(headers))}{max(1, row_count + 1)}"
    )
    append_header_row(worksheet, headers)
    for index, header in enumerate(headers, 1):
        worksheet.column_dimensions[get_column_letter(index)].width = min(
            34, max(12, len(str(header)) + 2)
        )
    return worksheet


def build_report_sheet(workbook, rows):
    headers = report_headers(rows)
    if not headers:
        headers = ["Status"]
        rows = [{"Status": "No runcomp report data"}]
    worksheet = initialize_report_sheet(workbook, headers, len(rows))
    for row in rows:
        # This is the complete audit data sheet, not the presentation sheet.
        # Plain write-only values avoid allocating and serialising a style
        # object for every cell in large result sets.
        worksheet.append([safe_cell_value(row.get(header)) for header in headers])
    return worksheet


def initialize_comparison_sheet(workbook, title, row_count):
    worksheet = workbook.create_sheet(title)
    worksheet.sheet_view.showGridLines = False
    worksheet.freeze_panes = f"{get_column_letter(FIRST_CENTER_COLUMN)}3"
    worksheet.row_dimensions[1].height = 24
    worksheet.row_dimensions[2].height = 42
    set_column_widths(worksheet)
    last_letter = get_column_letter(LAST_COLUMN)
    worksheet.auto_filter.ref = f"A2:{last_letter}{max(2, row_count + 2)}"
    for span in (
        f"A1:{get_column_letter(FIRST_CENTER_COLUMN - 1)}1",
        f"{get_column_letter(FIRST_CENTER_COLUMN)}1:{get_column_letter(FIRST_OLD_COLUMN - 1)}1",
        f"{get_column_letter(FIRST_OLD_COLUMN)}1:{last_letter}1",
    ):
        worksheet.merged_cells.add(span)

    headers = NEW_HEADERS + CENTER_HEADERS + OLD_HEADERS
    banner = [None] * len(headers)
    for column, value in (
        (1, "<  DATA RUN NEW — ALIGNMENT RESULT"),
        (FIRST_CENTER_COLUMN, "DIFFERENCE (NEW − OLD)"),
        (FIRST_OLD_COLUMN, "DATA RUN OLD — ALIGNMENT RESULT  >"),
    ):
        banner[column - 1] = styled_cell(
            worksheet,
            value,
            fill=GOLD_FILL if column == FIRST_CENTER_COLUMN else DARK_BLUE_FILL,
            font=TITLE_FONT,
            alignment=CENTER_ALIGNMENT,
        )
    worksheet.append(banner)
    worksheet.append([
        styled_cell(
            worksheet,
            header,
            fill=(
                BLUE_FILL
                if column < FIRST_CENTER_COLUMN or column >= FIRST_OLD_COLUMN
                else GOLD_FILL
            ),
            font=WHITE_BOLD_FONT,
            alignment=CENTER_ALIGNMENT,
        )
        for column, header in enumerate(headers, 1)
    ])
    return worksheet


def build_comparison_sheet(workbook, data, title):
    worksheet = initialize_comparison_sheet(workbook, title, len(data))
    for row in data:
        worksheet.append(build_data_row(worksheet, row))
    return worksheet


def read_ndjson_rows(path):
    with open(path, "r", encoding="utf-8") as rows_file:
        for line in rows_file:
            if not line.strip():
                continue
            row = json.loads(line)
            if isinstance(row, dict):
                yield row


def xlsxwriter_formats(workbook):
    title = {
        "font_name": "Calibri",
        "font_size": 12,
        "bold": True,
        "font_color": "#FFFFFF",
        "align": "center",
        "valign": "vcenter",
    }
    header = {
        "font_name": "Calibri",
        "font_size": 11,
        "bold": True,
        "font_color": "#FFFFFF",
        "align": "center",
        "valign": "vcenter",
        "text_wrap": True,
    }
    return {
        "title_blue": workbook.add_format({**title, "bg_color": XLSX_FILL_COLORS["dark_blue"]}),
        "title_gold": workbook.add_format({**title, "bg_color": XLSX_FILL_COLORS["gold"]}),
        "header_blue": workbook.add_format({**header, "bg_color": XLSX_FILL_COLORS["blue"]}),
        "header_gold": workbook.add_format({**header, "bg_color": XLSX_FILL_COLORS["gold"]}),
        "pipeline_label": workbook.add_format({
            "bg_color": XLSX_FILL_COLORS["new"],
            "bold": True,
            "font_color": "#006100",
            "bottom": 1,
            "bottom_color": "#D9E2F3",
        }),
        "pipeline_value": workbook.add_format({
            "bg_color": XLSX_FILL_COLORS["old"],
            "bottom": 1,
            "bottom_color": "#D9E2F3",
        }),
        "run_value": workbook.add_format({
            "bottom": 1,
            "bottom_color": "#D9E2F3",
        }),
        "status_matched": workbook.add_format({
            "bg_color": XLSX_FILL_COLORS["green"],
            "bold": True,
            "font_color": "#006100",
            "align": "center",
            "valign": "vcenter",
            "bottom": 1,
            "bottom_color": "#D9E2F3",
        }),
        "status_bypassed": workbook.add_format({
            "bg_color": XLSX_FILL_COLORS["yellow"],
            "bold": True,
            "font_color": "#7F6000",
            "align": "center",
            "valign": "vcenter",
            "bottom": 1,
            "bottom_color": "#D9E2F3",
        }),
        "status_only": workbook.add_format({
            "bg_color": XLSX_FILL_COLORS["orange"],
            "bold": True,
            "font_color": "#9C0006",
            "align": "center",
            "valign": "vcenter",
            "bottom": 1,
            "bottom_color": "#D9E2F3",
        }),
    }


def xlsxwriter_column_formats(workbook):
    formats = []
    for column, (_fill, _alignment, number_format) in enumerate(
        column_style_plan(LAST_COLUMN), 1
    ):
        if column < FIRST_CENTER_COLUMN:
            fill_color = XLSX_FILL_COLORS["new"]
        elif column < FIRST_OLD_COLUMN:
            fill_color = XLSX_FILL_COLORS["center"]
        else:
            fill_color = XLSX_FILL_COLORS["old"]
        properties = {
            "bg_color": fill_color,
            "valign": "vcenter",
            "bottom": 1,
            "bottom_color": "#D9E2F3",
            "align": (
                "center"
                if FIRST_CENTER_COLUMN <= column < FIRST_OLD_COLUMN
                else "left"
            ),
        }
        if number_format is not None:
            properties["num_format"] = number_format
        formats.append(workbook.add_format(properties))
    return formats


def build_xlsxwriter_pipeline_sheet(workbook, pipeline_data, formats):
    worksheet = workbook.add_worksheet("Data Pipeline")
    worksheet.hide_gridlines(2)
    worksheet.freeze_panes(2, 0)
    worksheet.set_column("A:A", 28)
    worksheet.set_column("B:B", 42)
    worksheet.merge_range("A1:B1", "PIPELINE DATA", formats["title_blue"])
    worksheet.write_row("A2", ["Field", "Value"], formats["header_blue"])
    for row_index, (label, key) in enumerate(PIPELINE_FIELDS, 2):
        worksheet.write(row_index, 0, label, formats["pipeline_label"])
        worksheet.write(
            row_index,
            1,
            safe_cell_value(pipeline_data.get(key)),
            formats["pipeline_value"],
        )

    section_row = 2 + len(PIPELINE_FIELDS) + 1
    worksheet.write(section_row, 0, "INSPECTION RUNS", formats["title_gold"])
    run_headers = ["Role", "Survey Year", "Vendor", "File Name", "Run ID", "Records"]
    worksheet.write_row(section_row + 1, 0, run_headers, formats["header_gold"])
    for offset, run in enumerate(pipeline_data.get("inspectionRuns", []) or [], 1):
        worksheet.write_row(
            section_row + 1 + offset,
            0,
            [safe_cell_value(run.get(key)) for key in (
                "role", "year", "vendor", "fileName", "runId", "total"
            )],
            formats["run_value"],
        )
    for index, width in enumerate((18, 14, 24, 38, 14, 14)):
        worksheet.set_column(index, index, width)
    return worksheet


def initialize_xlsxwriter_report_sheet(workbook, headers, row_count, formats):
    worksheet = workbook.add_worksheet("Runcomp Report")
    worksheet.hide_gridlines(2)
    worksheet.freeze_panes(1, 0)
    worksheet.autofilter(0, 0, max(0, row_count), len(headers) - 1)
    worksheet.write_row(0, 0, headers, formats["header_blue"])
    for index, header in enumerate(headers):
        worksheet.set_column(index, index, min(34, max(12, len(str(header)) + 2)))
    return worksheet


def initialize_xlsxwriter_comparison_sheet(workbook, row_count, formats):
    worksheet = workbook.add_worksheet("Runcomp Comparison")
    worksheet.hide_gridlines(2)
    worksheet.freeze_panes(2, FIRST_CENTER_COLUMN - 1)
    worksheet.set_row(0, 24)
    worksheet.set_row(1, 42)
    worksheet.autofilter(1, 0, max(1, row_count + 1), LAST_COLUMN - 1)
    widths = [17, 20, 24, 14, 17, 17, 18, 15, 18, 18, 18, 18, 16, 16, 30,
              16, 16, 14, 14, 16, 17, 17, 17, 17, 14, 20, 19,
              17, 20, 24, 14, 17, 17, 18, 15, 18, 18, 18, 18, 16, 16, 30]
    assert len(widths) == LAST_COLUMN, f"{len(widths)} widths for {LAST_COLUMN} columns"
    column_formats = xlsxwriter_column_formats(workbook)
    for index, (width, column_format) in enumerate(zip(widths, column_formats)):
        worksheet.set_column(index, index, width, column_format)

    # xlsxwriter is 0-based, so each bound is one less than its column number.
    # These were literal 14/15/24/25/39 and did not move with the header lists,
    # which left the OLD title merged across the wrong span — and unwritten.
    worksheet.merge_range(
        0, 0, 0, FIRST_CENTER_COLUMN - 2,
        "<  DATA RUN NEW — ALIGNMENT RESULT", formats["title_blue"],
    )
    worksheet.merge_range(
        0, FIRST_CENTER_COLUMN - 1, 0, FIRST_OLD_COLUMN - 2,
        "DIFFERENCE (NEW − OLD)", formats["title_gold"],
    )
    worksheet.merge_range(
        0, FIRST_OLD_COLUMN - 1, 0, LAST_COLUMN - 1,
        "DATA RUN OLD — ALIGNMENT RESULT  >", formats["title_blue"],
    )
    headers = NEW_HEADERS + CENTER_HEADERS + OLD_HEADERS
    for column, header in enumerate(headers):
        header_format = (
            formats["header_gold"]
            if FIRST_CENTER_COLUMN - 1 <= column < FIRST_OLD_COLUMN - 1
            else formats["header_blue"]
        )
        worksheet.write(1, column, header, header_format)
    return worksheet


def xlsxwriter_status_format(value, formats):
    """`status_style` for the streaming writer, resolved the same way.

    Keyword matching is what this used to do, and it cannot survive the POF
    wording: "Not matched" contains "matched" and would have been filled green.
    """
    name = STATUS_FORMAT_NAMES.get(STATUS_OUTCOMES.get(str(value or "").strip().lower()))
    return formats[name] if name else None


def export_ndjson_with_xlsxwriter(metadata, rows_path, output_path):
    workbook = xlsxwriter.Workbook(output_path, {
        "constant_memory": True,
        "strings_to_formulas": False,
        "strings_to_urls": False,
        "nan_inf_to_errors": True,
    })
    try:
        formats = xlsxwriter_formats(workbook)
        pipeline_data = metadata.get("pipelineData", {})
        build_xlsxwriter_pipeline_sheet(
            workbook,
            pipeline_data if isinstance(pipeline_data, dict) else {},
            formats,
        )
        headers = [
            str(header)
            for header in metadata.get("headers", [])
            if str(header) and not str(header).startswith("__")
        ] or ["Status"]
        row_count = int(metadata.get("rowCount", 0) or 0)
        report_sheet = initialize_xlsxwriter_report_sheet(
            workbook, headers, row_count, formats
        )
        comparison_sheet = initialize_xlsxwriter_comparison_sheet(
            workbook, row_count, formats
        )

        written = 0
        for row in read_ndjson_rows(rows_path):
            report_sheet.write_row(
                written + 1,
                0,
                [safe_cell_value(row.get(header)) for header in headers],
            )
            new_values = side_values(row, "NEW")
            old_values = side_values(row, "OLD")
            values = new_values + comparison_values(row, new_values, old_values) + old_values
            comparison_sheet.write_row(
                written + 2,
                0,
                [safe_cell_value(value) for value in values],
            )
            status_format = xlsxwriter_status_format(
                values[STATUS_COLUMN - 1], formats
            )
            if status_format is not None:
                comparison_sheet.write(
                    written + 2,
                    STATUS_COLUMN - 1,
                    safe_cell_value(values[STATUS_COLUMN - 1]),
                    status_format,
                )
            written += 1
            if written % 10_000 == 0:
                print(f"PROGRESS {written}", flush=True)

        if written == 0:
            report_sheet.write(1, 0, "No runcomp report data")
        elif written % 10_000 != 0:
            print(f"PROGRESS {written}", flush=True)
    finally:
        workbook.close()


def main():
    if len(sys.argv) < 3:
        print("Usage: python export_excel.py <input_json_path> <output_xlsx_path>")
        sys.exit(1)

    if sys.argv[1] == "--ndjson":
        if len(sys.argv) != 5:
            print(
                "Usage: python export_excel.py --ndjson "
                "<metadata_json_path> <rows_ndjson_path> <output_xlsx_path>"
            )
            sys.exit(1)
        with open(sys.argv[2], "r", encoding="utf-8") as metadata_file:
            metadata = json.load(metadata_file)
        export_ndjson_with_xlsxwriter(metadata, sys.argv[3], sys.argv[4])
        return

    with open(sys.argv[1], "r", encoding="utf-8") as input_file:
        data = json.load(input_file)

    if isinstance(data, dict):
        comparison = data.get("comparison")
        report = data.get("report")
        if report is None:
            report = comparison if isinstance(comparison, list) else []
        if comparison is None:
            comparison = report
        pipeline_data = data.get("pipelineData", {})
        workbook = openpyxl.Workbook(write_only=True)
        build_pipeline_sheet(
            workbook,
            pipeline_data if isinstance(pipeline_data, dict) else {},
        )
        build_report_sheet(workbook, report if isinstance(report, list) else [])
        build_comparison_sheet(
            workbook,
            comparison if isinstance(comparison, list) else [],
            "Runcomp Comparison",
        )
        workbook.save(sys.argv[2])
        return

    # Write-only mode streams each row to disk and drops it, so peak memory no
    # longer scales with row count: a 100k-row comparison is four million cells
    # that normal mode would keep alive as Cell objects until save().
    # WriteOnlyWorksheet has no merge_cells() helper, but the merged-range
    # collection it inherits is serialised normally, so the banner merges below
    # survive; freeze panes, auto-filter and row/column dimensions are likewise
    # supported as long as they are set before the rows are appended.
    workbook = openpyxl.Workbook(write_only=True)
    worksheet = workbook.create_sheet("Comparison Report")
    worksheet.sheet_view.showGridLines = False
    worksheet.freeze_panes = f"{get_column_letter(FIRST_CENTER_COLUMN)}3"
    worksheet.row_dimensions[1].height = 24
    worksheet.row_dimensions[2].height = 42
    set_column_widths(worksheet)
    last_letter = get_column_letter(LAST_COLUMN)
    worksheet.auto_filter.ref = f"A2:{last_letter}{max(2, len(data) + 2)}"
    # Spelled as letters these were "A1:O1", "P1:Y1", "Z1:AN1" — a banner that
    # silently stopped tracking the header lists. A merge whose top-left lands
    # one column short of the title swallows it, so the OLD banner disappeared
    # rather than moved.
    for span in (
        f"A1:{get_column_letter(FIRST_CENTER_COLUMN - 1)}1",
        f"{get_column_letter(FIRST_CENTER_COLUMN)}1:{get_column_letter(FIRST_OLD_COLUMN - 1)}1",
        f"{get_column_letter(FIRST_OLD_COLUMN)}1:{last_letter}1",
    ):
        worksheet.merged_cells.add(span)

    headers = NEW_HEADERS + CENTER_HEADERS + OLD_HEADERS
    banner = [None] * len(headers)
    for column, value in (
        (1, "<  DATA RUN NEW — ALIGNMENT RESULT"),
        (FIRST_CENTER_COLUMN, "DIFFERENCE (NEW − OLD)"),
        (FIRST_OLD_COLUMN, "DATA RUN OLD — ALIGNMENT RESULT  >"),
    ):
        banner[column - 1] = styled_cell(
            worksheet,
            value,
            fill=GOLD_FILL if column == FIRST_CENTER_COLUMN else DARK_BLUE_FILL,
            font=TITLE_FONT,
            alignment=CENTER_ALIGNMENT,
        )
    worksheet.append(banner)

    worksheet.append([
        styled_cell(
            worksheet,
            header,
            fill=(
                BLUE_FILL
                if column < FIRST_CENTER_COLUMN or column >= FIRST_OLD_COLUMN
                else GOLD_FILL
            ),
            font=WHITE_BOLD_FONT,
            alignment=CENTER_ALIGNMENT,
        )
        for column, header in enumerate(headers, 1)
    ])

    for row in data:
        worksheet.append(build_data_row(worksheet, row))

    workbook.save(sys.argv[2])


if __name__ == "__main__":
    main()
