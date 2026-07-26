import json
import sys

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter


NEW_HEADERS = [
    "Abs. Dist NEW (m)", "Feature Type NEW", "Identif. NEW", "Joint No. NEW",
    "Joint Len NEW (m)", "Dist GW NEW (m)", "Wall WT NEW (mm)", "O'Clock NEW",
    "Length NEW (mm)", "Width NEW (mm)", "Depth NEW (%WT)", "Surface NEW",
    "ERF ASME NEW", "Psafe NEW (bar)", "Comment NEW",
]
CENTER_HEADERS = [
    "Odo Diff (m)\nNEW-OLD", "Dist GW Δ\nNEW-OLD", "O'Clock\nBerubah?",
    "Clock Δ\n(deg)", "Depth Δ (%)\nNEW-OLD", "Length Δ(mm)\nNEW-OLD",
    "Width Δ(mm)\nNEW-OLD", "Surface\nBerubah?", "Match\nStatus",
    "Data\nKelengkapan",
]
OLD_HEADERS = [
    "Abs. Dist OLD (m)", "Feature Type OLD", "Identif. OLD", "Joint No. OLD",
    "Joint Len OLD (m)", "Dist GW OLD (m)", "Wall WT OLD (mm)", "O'Clock OLD",
    "Length OLD (mm)", "Width OLD (mm)", "Depth OLD (%WT)", "Surface OLD",
    "ERF ASME OLD", "Psafe OLD (bar)", "Comment OLD",
]


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


def clock_degrees(value):
    if value in (None, "", "-", "N/A"):
        return None
    try:
        if isinstance(value, (int, float)):
            return float(value) * 30
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
    return ("no" if delta == 0 else "YES"), min(delta, 360 - delta)


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
        return "Hanya OLD"
    if old_values[0] is None:
        return "Hanya NEW"
    dimensional_values = [new_values[8], new_values[9], new_values[10], old_values[8], old_values[9], old_values[10]]
    return "Lengkap" if sum(value is not None for value in dimensional_values) >= 4 else "Keduanya terbatas"


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


def main():
    if len(sys.argv) < 3:
        print("Usage: python export_excel.py <input_json_path> <output_xlsx_path>")
        sys.exit(1)

    with open(sys.argv[1], "r", encoding="utf-8") as input_file:
        data = json.load(input_file)

    workbook = openpyxl.Workbook()
    worksheet = workbook.active
    worksheet.title = "Comparison Report"
    worksheet.sheet_view.showGridLines = False
    worksheet.freeze_panes = "P3"

    dark_blue = PatternFill("solid", fgColor="1F4E79")
    blue = PatternFill("solid", fgColor="2E74B5")
    gold = PatternFill("solid", fgColor="BF9000")
    new_fill = PatternFill("solid", fgColor="F0F6FC")
    center_fill = PatternFill("solid", fgColor="FFF8E7")
    old_fill = PatternFill("solid", fgColor="F7F7F7")
    green_fill = PatternFill("solid", fgColor="C6EFCE")
    orange_fill = PatternFill("solid", fgColor="FCE4D6")
    yellow_fill = PatternFill("solid", fgColor="FFF2CC")
    white_bold = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    title_font = Font(name="Calibri", size=12, bold=True, color="FFFFFF")
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left = Alignment(horizontal="left", vertical="center")
    right = Alignment(horizontal="right", vertical="center")
    thin_border = Border(bottom=Side(style="thin", color="D9E2F3"))

    worksheet.merge_cells("A1:O1")
    worksheet.merge_cells("P1:Y1")
    worksheet.merge_cells("Z1:AN1")
    for cell, value, fill in [
        ("A1", "<  DATA NEW — HASIL ALIGNMENT", dark_blue),
        ("P1", "KOMPARASI (NEW − OLD)", gold),
        ("Z1", "DATA OLD — HASIL ALIGNMENT  >", dark_blue),
    ]:
        worksheet[cell] = value
        worksheet[cell].fill = fill
        worksheet[cell].font = title_font
        worksheet[cell].alignment = center
    worksheet.row_dimensions[1].height = 24

    headers = NEW_HEADERS + CENTER_HEADERS + OLD_HEADERS
    for column, header in enumerate(headers, 1):
        cell = worksheet.cell(row=2, column=column, value=header)
        cell.fill = blue if column <= 15 or column >= 26 else gold
        cell.font = white_bold
        cell.alignment = center
    worksheet.row_dimensions[2].height = 42

    for row_index, row in enumerate(data, 3):
        new_values = side_values(row, "NEW")
        old_values = side_values(row, "OLD")
        values = new_values + comparison_values(row, new_values, old_values) + old_values
        for column, value in enumerate(values, 1):
            cell = worksheet.cell(row=row_index, column=column, value=safe_cell_value(value))
            cell.fill = new_fill if column <= 15 else old_fill if column >= 26 else center_fill
            cell.border = thin_border
            cell.alignment = right if isinstance(value, (int, float)) else center if 16 <= column <= 25 else left
            if column in {1, 5, 6, 7, 16, 17, 20, 21, 22, 26, 30, 31, 32, 35, 36, 37} and isinstance(value, (int, float)):
                cell.number_format = "0.000"
            elif column in {9, 10, 11, 34} and isinstance(value, (int, float)):
                cell.number_format = "0.0"
        status_cell = worksheet.cell(row=row_index, column=24)
        status = str(status_cell.value or "").lower()
        if "matched" in status:
            status_cell.fill = green_fill
            status_cell.font = Font(name="Calibri", size=10, bold=True, color="006100")
        elif "bypassed" in status:
            status_cell.fill = yellow_fill
            status_cell.font = Font(name="Calibri", size=10, bold=True, color="7F6000")
        elif "only" in status:
            status_cell.fill = orange_fill
            status_cell.font = Font(name="Calibri", size=10, bold=True, color="9C0006")

    worksheet.auto_filter.ref = f"A2:AN{max(2, len(data) + 2)}"
    set_column_widths(worksheet)
    workbook.save(sys.argv[2])


if __name__ == "__main__":
    main()
