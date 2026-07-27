import json
import sys

import openpyxl
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter


NEW_HEADERS = [
    "Abs. Dist NEW (m)", "Feature Type NEW", "Identif. NEW", "Joint No. NEW",
    "Joint Len NEW (m)", "Dist GW NEW (m)", "Wall WT NEW (mm)", "O'Clock NEW",
    "Length NEW (mm)", "Width NEW (mm)", "Depth NEW (%WT)", "Surface NEW",
    "ERF ASME NEW", "Psafe NEW (bar)", "Comment NEW",
]
CENTER_HEADERS = [
    "Odo Diff (m)\nNEW-OLD", "Dist GW Δ\nNEW-OLD", "O'Clock\nChanged?",
    "Clock Δ\n(deg)", "Depth Δ (%)\nNEW-OLD", "Length Δ(mm)\nNEW-OLD",
    "Width Δ(mm)\nNEW-OLD", "Surface\nChanged?", "Match\nStatus",
    "Data\nCompleteness",
]
OLD_HEADERS = [
    "Abs. Dist OLD (m)", "Feature Type OLD", "Identif. OLD", "Joint No. OLD",
    "Joint Len OLD (m)", "Dist GW OLD (m)", "Wall WT OLD (mm)", "O'Clock OLD",
    "Length OLD (mm)", "Width OLD (mm)", "Depth OLD (%WT)", "Surface OLD",
    "ERF ASME OLD", "Psafe OLD (bar)", "Comment OLD",
]

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

FIRST_CENTER_COLUMN = 16
FIRST_OLD_COLUMN = 26
STATUS_COLUMN = 24
THREE_DECIMAL_COLUMNS = frozenset(
    {1, 5, 6, 7, 16, 17, 20, 21, 22, 26, 30, 31, 32, 35, 36, 37}
)
ONE_DECIMAL_COLUMNS = frozenset({9, 10, 11, 34})
STATUS_STYLES = (
    ("matched", GREEN_FILL, MATCHED_FONT),
    ("bypassed", YELLOW_FILL, BYPASSED_FONT),
    ("only", ORANGE_FILL, ONLY_FONT),
)


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


def first_value(row, *keys):
    for key in keys:
        value = row.get(key)
        if value not in (None, "", "-"):
            return value
    return None


def as_number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def safe_cell_value(value):
    """Prevent spreadsheet applications from evaluating untrusted text as a formula."""
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def difference(left, right):
    left_number = as_number(left)
    right_number = as_number(right)
    if left_number is None or right_number is None:
        return None
    return left_number - right_number


# Two clock readings within this many degrees count as unchanged (one clock
# minute is 0.5 degrees, so this tolerates vendor rounding of +/- 2 minutes).
CLOCK_UNCHANGED_TOLERANCE_DEG = 1.0


def clock_degrees(value):
    if value in (None, "", "-", "N/A"):
        return None
    try:
        if isinstance(value, (int, float)):
            numeric = float(value)
            if 0 < numeric < 1:
                # An unconverted Excel time serial (fraction of a 24 h day):
                # 0.5 means 12:00, not half past midnight. Convert to hours,
                # then onto the 12-hour pipeline dial at 30 degrees per hour
                # so it agrees with the hour-based conversions below
                # (12:00 -> 0/360 degrees).
                return ((numeric * 24.0) % 12.0) * 30.0
            return numeric * 30
        text = str(value)
        hour, minute = text.split(":", 1)
        return (int(hour) % 12) * 30 + int(minute[:2]) * 0.5
    except (TypeError, ValueError):
        return None


def clock_difference(new_clock, old_clock):
    new_degrees = clock_degrees(new_clock)
    old_degrees = clock_degrees(old_clock)
    if new_degrees is None or old_degrees is None:
        return None, None
    delta = abs(new_degrees - old_degrees)
    wrapped_delta = min(delta, 360 - delta)
    # The verdict must agree with the reported (wrapped) magnitude:
    # 11:59 vs 12:01 is a 1 degree change, not a 359 degree "YES".
    changed = "no" if wrapped_delta <= CLOCK_UNCHANGED_TOLERANCE_DEG else "YES"
    return changed, wrapped_delta


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
        surface_changed,
        first_value(row, "Match/Unmatch", "match_status") or "-",
        completeness(new_values, old_values),
    ]


def set_column_widths(ws):
    widths = [17, 20, 24, 14, 17, 17, 18, 15, 18, 18, 18, 18, 16, 16, 30,
              16, 16, 14, 14, 16, 17, 17, 14, 20, 19,
              17, 20, 24, 14, 17, 17, 18, 15, 18, 18, 18, 18, 16, 16, 30]
    for index, width in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(index)].width = width


def status_style(value):
    """Fill and font for the Match Status cell, or (None, None)."""
    status = str(value or "").lower()
    for keyword, fill, font in STATUS_STYLES:
        if keyword in status:
            return fill, font
    return None, None


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


def build_data_row(worksheet, row, plan):
    """One fully styled sheet row, built and handed straight to the writer."""
    new_values = side_values(row, "NEW")
    old_values = side_values(row, "OLD")
    values = new_values + comparison_values(row, new_values, old_values) + old_values
    status_fill, status_font = status_style(values[STATUS_COLUMN - 1])

    cells = []
    for column, value in enumerate(values, 1):
        fill, text_alignment, number_format = plan[column - 1]
        numeric = isinstance(value, (int, float))
        if column == STATUS_COLUMN and status_fill is not None:
            fill = status_fill
        cells.append(styled_cell(
            worksheet,
            safe_cell_value(value),
            fill=fill,
            font=status_font if column == STATUS_COLUMN else None,
            alignment=RIGHT_ALIGNMENT if numeric else text_alignment,
            border=THIN_BORDER,
            number_format=number_format if numeric else None,
        ))
    return cells


def main():
    if len(sys.argv) < 3:
        print("Usage: python export_excel.py <input_json_path> <output_xlsx_path>")
        sys.exit(1)

    with open(sys.argv[1], "r", encoding="utf-8") as input_file:
        data = json.load(input_file)

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
    worksheet.freeze_panes = "P3"
    worksheet.row_dimensions[1].height = 24
    worksheet.row_dimensions[2].height = 42
    set_column_widths(worksheet)
    worksheet.auto_filter.ref = f"A2:AN{max(2, len(data) + 2)}"
    for span in ("A1:O1", "P1:Y1", "Z1:AN1"):
        worksheet.merged_cells.add(span)

    headers = NEW_HEADERS + CENTER_HEADERS + OLD_HEADERS
    banner = [None] * len(headers)
    for column, value in (
        (1, "<  NEW DATA — ALIGNMENT RESULT"),
        (FIRST_CENTER_COLUMN, "COMPARISON (NEW − OLD)"),
        (FIRST_OLD_COLUMN, "OLD DATA — ALIGNMENT RESULT  >"),
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

    plan = column_style_plan(len(headers))
    for row in data:
        worksheet.append(build_data_row(worksheet, row, plan))

    workbook.save(sys.argv[2])


if __name__ == "__main__":
    main()
