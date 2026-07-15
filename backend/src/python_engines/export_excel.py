import sys
import json
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

def main():
    if len(sys.argv) < 3:
        print("Usage: python export_excel.py <input_json_path> <output_xlsx_path>")
        sys.exit(1)
        
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    
    with open(input_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Comparison Report"
    
    # Ensure grid lines are visible
    ws.views.sheetView[0].showGridLines = True
    
    # Define styles
    font_title = Font(name="Calibri", size=16, bold=True, color="FFFFFF")
    font_subtitle = Font(name="Calibri", size=10, italic=True, color="A6A6A6")
    font_header = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    font_data = Font(name="Calibri", size=10)
    font_legend = Font(name="Calibri", size=10, bold=True)
    
    fill_title = PatternFill(start_color="1B2E4F", end_color="1B2E4F", fill_type="solid") # Dark Blue
    fill_header = PatternFill(start_color="2F5597", end_color="2F5597", fill_type="solid") # Steel Blue
    
    # Colors matching the user's template
    fill_structural = PatternFill(start_color="DCE6F1", end_color="DCE6F1", fill_type="solid") # Cyan/Light Blue
    fill_component = PatternFill(start_color="E2EFDA", end_color="E2EFDA", fill_type="solid") # Light Green
    fill_reference = PatternFill(start_color="F2F2F2", end_color="F2F2F2", fill_type="solid") # Light Gray
    fill_anomaly = PatternFill(start_color="FCE4D6", end_color="FCE4D6", fill_type="solid") # Light Pink/Orange
    
    border_thin = Border(
        left=Side(style='thin', color='D9D9D9'),
        right=Side(style='thin', color='D9D9D9'),
        top=Side(style='thin', color='D9D9D9'),
        bottom=Side(style='thin', color='D9D9D9')
    )
    
    align_center = Alignment(horizontal='center', vertical='center', wrap_text=True)
    align_left = Alignment(horizontal='left', vertical='center')
    align_right = Alignment(horizontal='right', vertical='center')
    
    # Determine columns
    if not data:
        wb.save(output_path)
        return
        
    headers = list(data[0].keys())
    # Filter out columns that are helper columns if any, but all standard comparison keys are good
    num_cols = len(headers)
    
    # Row 1: Merged Title Banner
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=num_cols)
    title_cell = ws.cell(row=1, column=1, value="SYNAPSE ILI ALIGNMENT COMPARISON REPORT — Master Column Structure")
    title_cell.font = font_title
    title_cell.fill = fill_title
    title_cell.alignment = align_center
    ws.row_dimensions[1].height = 40
    
    # Row 2: Merged Subtitle Banner
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=num_cols)
    subtitle_cell = ws.cell(row=2, column=1, value="This report represents the matching results between ILI Run 1 (OLD) and ILI Run 2 (NEW)")
    subtitle_cell.font = font_subtitle
    subtitle_cell.alignment = align_center
    ws.row_dimensions[2].height = 20
    
    # Row 4: Header
    for col_idx, header in enumerate(headers, start=1):
        cell = ws.cell(row=4, column=col_idx, value=header)
        cell.font = font_header
        cell.fill = fill_header
        cell.alignment = align_center
        cell.border = border_thin
    ws.row_dimensions[4].height = 28
    
    # Row 5+: Data
    current_row = 5
    for item in data:
        row_fill = None
        status = str(item.get("Match/Unmatch", "") or "")
        feat_type_old = str(item.get("Feature Type OLD", "") or "").lower()
        feat_type_new = str(item.get("Feature Type NEW", "") or "").lower()
        
        # Categorize features to apply background coloring
        is_structural = any(x in feat_type_old or x in feat_type_new for x in ["weld", "bend", "chwt", "gw"]) or "gw" in status.lower()
        is_component = any(x in feat_type_old or x in feat_type_new for x in ["valve", "valv", "tee", "flg", "flange", "plug", "offtake"])
        is_anomaly = any(x in feat_type_old or x in feat_type_new for x in ["metal loss", "anom", "corrosion", "defect", "dent", "girth weld anomaly"])
        is_reference = any(x in feat_type_old or x in feat_type_new for x in ["begin", "end", "marker", "support", "agm"])
        
        if is_structural:
            row_fill = fill_structural
        elif is_component:
            row_fill = fill_component
        elif is_anomaly:
            row_fill = fill_anomaly
        elif is_reference:
            row_fill = fill_reference
            
        for col_idx, header in enumerate(headers, start=1):
            val = item.get(header)
            cell = ws.cell(row=current_row, column=col_idx)
            
            # Format data values
            if isinstance(val, (int, float)):
                cell.value = val
                if "dist" in header.lower() or "odo" in header.lower() or "diff" in header.lower() or "length" in header.lower() or "width" in header.lower() or "wt" in header.lower():
                    cell.number_format = '0.000'
                elif "depth" in header.lower() or "%" in header.lower():
                    cell.number_format = '0.0'
            else:
                # Convert null or '-' values to empty strings or raw strings
                cell.value = "" if val is None or val == "-" else val
                
            cell.font = font_data
            if row_fill:
                cell.fill = row_fill
            cell.border = border_thin
            
            # Cell alignments
            if isinstance(val, (int, float)):
                cell.alignment = align_right
            elif header == "Match/Unmatch" or "Identif." in header or "O'Clock" in header:
                cell.alignment = align_center
            else:
                cell.alignment = align_left
                
        ws.row_dimensions[current_row].height = 20
        current_row += 1
        
    # Write Color Legend
    legend_start = current_row + 2
    ws.cell(row=legend_start, column=1, value="COLOR LEGEND:").font = font_legend
    
    legends = [
        ("Structural (Weld, Bend, CHWT)", fill_structural),
        ("Component / Fitting", fill_component),
        ("Reference / Special", fill_reference),
        ("Anomaly / Metal Loss", fill_anomaly)
    ]
    
    for idx, (label, fill) in enumerate(legends):
        row_num = legend_start + 1 + idx
        color_cell = ws.cell(row=row_num, column=1)
        color_cell.fill = fill
        color_cell.border = border_thin
        
        label_cell = ws.cell(row=row_num, column=2, value=label)
        label_cell.font = font_data
        
    # Auto-adjust column widths
    for col in ws.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        
        # Read from row 4 onwards for max length check
        for cell in col[3:current_row]:
            if cell.value is not None:
                max_len = max(max_len, len(str(cell.value)))
                
        # Header length check
        header_val = ws.cell(row=4, column=col[0].column).value
        if header_val:
            max_len = max(max_len, len(str(header_val)))
            
        ws.column_dimensions[col_letter].width = max(max_len + 3, 12)
        
    wb.save(output_path)

if __name__ == "__main__":
    main()
