import pandas as pd
import numpy as np
from datetime import datetime
from openpyxl import Workbook
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from .constants import *
from .math_utils import _sf, _sstr, _clock_diff
#  BAGIAN 12 — BUILD OUTPUT EXCEL
# ══════════════════════════════════════════════════════════════════════════════════

OUT_COLS_NEW = [
    ("Log Dist NEW (m)",  "log_distance_m",         14, "right"),
    ("Feature Type NEW",  "feature_type",            18, "left"),
    ("Identif. NEW",      "feature_identification",  20, "left"),
    ("Joint No. NEW",     "joint_number",             9, "right"),
    ("Joint Len NEW (m)", "joint_length_m",          12, "right"),
    ("Dist GW NEW (m)",   "dist_to_us_gw_m",         13, "right"),
    ("Wall WT NEW (mm)",  "wall_thickness_mm",        11, "right"),
    ("O'Clock NEW",       "clock_position",           10, "center"),
    ("Length NEW (mm)",   "length_mm",                11, "right"),
    ("Width NEW (mm)",    "width_mm",                 11, "right"),
    ("Depth NEW (%WT)",   "depth_pct",                12, "right"),
    ("Surface NEW",       "surface_location",         12, "left"),
    ("ERF ASME NEW",      "erf_asme",                 11, "right"),
    ("Psafe NEW (bar)",   "psafe_bar",                12, "right"),
    ("Comment NEW",       "comment",                  22, "left"),
]
OUT_COLS_COMP = [
    ("Odo Diff (m)\nNEW-OLD",   "odo_diff",          13, "right"),
    ("Dist GW Δ\nNEW-OLD",      "gw_diff",           12, "right"),
    ("O'Clock\nBerubah?",       "clock_changed",     11, "center"),
    ("Clock Δ\n(deg)",          "clock_diff_deg",    10, "right"),
    ("Depth Δ (%)\nNEW-OLD",    "depth_diff",        12, "right"),
    ("Length Δ(mm)\nNEW-OLD",   "length_diff",       12, "right"),
    ("Width Δ(mm)\nNEW-OLD",    "width_diff",        12, "right"),
    ("Surface\nBerubah?",       "surf_changed",      12, "center"),
    ("Match\nStatus",           "match_status",      14, "center"),
    ("Growth Rate\nFlag",       "growth_flag",       16, "center"),
    ("Clock Shift\nIntegrity",  "clock_integrity",   16, "center"),
    ("Data\nKelengkapan",       "data_coverage",     15, "center"),
]
OUT_COLS_OLD = [
    ("Log Dist OLD (m)",  "log_distance_m",         14, "right"),
    ("Feature Type OLD",  "feature_type",            18, "left"),
    ("Identif. OLD",      "feature_identification",  20, "left"),
    ("Joint No. OLD",     "joint_number",             9, "right"),
    ("Joint Len OLD (m)", "joint_length_m",          12, "right"),
    ("Dist GW OLD (m)",   "dist_to_us_gw_m",         13, "right"),
    ("Wall WT OLD (mm)",  "wall_thickness_mm",        11, "right"),
    ("O'Clock OLD",       "clock_position",           10, "center"),
    ("Length OLD (mm)",   "length_mm",                11, "right"),
    ("Width OLD (mm)",    "width_mm",                 11, "right"),
    ("Depth OLD (%WT)",   "depth_pct",                12, "right"),
    ("Surface OLD",       "surface_location",         12, "left"),
    ("ERF ASME OLD",      "erf_asme",                 11, "right"),
    ("Psafe OLD (bar)",   "psafe_bar",                12, "right"),
    ("Comment OLD",       "comment",                  22, "left"),
]

NN = len(OUT_COLS_NEW)
NC = len(OUT_COLS_COMP)
NO = len(OUT_COLS_OLD)
TOTAL_COLS = NN + NC + NO

NUM_F = {"log_distance_m", "joint_number", "dist_to_us_gw_m", "joint_length_m",
         "wall_thickness_mm", "length_mm", "width_mm", "depth_pct",
         "erf_asme", "psafe_bar"}

def _safe(v):
    if v is None: return None
    try:
        if pd.isna(v): return None
    except: pass
    return v

def _diff(a, b):
    sa, sb = _safe(a), _safe(b)
    if sa is None or sb is None: return None
    try: return round(float(sa) - float(sb), 4)
    except: return None

def _cov(rn, ro):
    AC = ["depth_pct", "length_mm", "width_mm", "erf_asme"]
    if rn is None and ro is None: return "-"
    if rn is None: return "Hanya OLD"
    if ro is None: return "Hanya NEW"
    nh = sum(1 for c in AC if _safe(rn.get(c)) is not None)
    oh = sum(1 for c in AC if _safe(ro.get(c)) is not None)
    if nh == 0 and oh == 0: return "Keduanya terbatas"
    if nh == 0: return "NEW terbatas"
    if oh == 0: return "OLD terbatas"
    return "Lengkap"

def _build_interp(matched_new, df_new, df_old):
    p = [
        (float(df_new.at[in_, "log_distance_m"]),
         float(df_old.at[io,  "log_distance_m"]))
        for in_, io in matched_new.items()
        if (_safe(df_new.at[in_, "log_distance_m"]) is not None and
            _safe(df_old.at[io,  "log_distance_m"]) is not None)
    ]
    return sorted(p)

def _interp_old(val, pairs):
    if not pairs: return float(val)
    v   = float(val)
    tbl = sorted([(b, a) for a, b in pairs])
    L   = [(a, b) for a, b in tbl if a <= v]
    R   = [(a, b) for a, b in tbl if a > v]
    if L and R:
        al, bl = L[-1]; ar, br = R[0]; s = ar - al
        return (bl + ((v - al) / s) * (br - bl)) if s > 0 else bl
    elif L:
        if len(L) >= 2:
            al, bl = L[-2]; ar, br = L[-1]; s = ar - al
            if s > 0: return br + ((br - bl) / s) * (v - ar)
        return L[-1][1]
    else:
        if len(R) >= 2:
            al, bl = R[0]; ar, br = R[1]; s = ar - al
            if s > 0: return bl + ((br - bl) / s) * (v - al)
        return R[0][1]


def build_comparison_rows(df_new, df_old, matched_new, matched_old,
                          suspect_growth, suspect_clock):
    interp = _build_interp(matched_new, df_new, df_old)
    rows   = []

    for idx_n in df_new.index:
        rn    = df_new.loc[idx_n]
        idx_o = matched_new.get(idx_n)
        ro    = df_old.loc[idx_o] if idx_o is not None else None

        d_new = _safe(rn.get("log_distance_m"))
        d_old = _safe(ro.get("log_distance_m")) if ro is not None else None
        status = "MATCHED" if ro is not None else "ONLY IN NEW"

        sn = _sstr(rn.get("surface_location"))
        so = _sstr(ro.get("surface_location")) if ro is not None else None
        surf_chg = ("YES" if sn and so and sn != so
                    else ("no" if sn and so else None))

        cn_ = rn.get("clock_position")
        co_ = ro.get("clock_position") if ro is not None else None
        clk_chg = ("YES" if cn_ and co_ and str(cn_) != str(co_)
                   else ("no" if cn_ and co_ else None))
        clk_deg = _clock_diff(cn_, co_)

        # [FIX-6]: Physics validation flags — cek dengan is not None
        growth_flag    = None
        clock_integrity = None
        if idx_n in suspect_growth:
            _, dc, reason = suspect_growth[idx_n]
            if "IMPOSSIBLE" in reason:
                growth_flag = f"❌ IMPOSSIBLE ({dc:.1f}%WT)"
            else:
                growth_flag = f"⚠ SUSPECT ({dc:.1f}%WT)"
        if idx_n in suspect_clock:
            _, shift, median, reason = suspect_clock[idx_n]
            clock_integrity = f"⚠ OUTLIER shift={shift:.0f}° med={median:.0f}°"

        rows.append({
            "sort_d":        float(d_new) if d_new is not None else 0.0,
            "status":        status,
            "feat_new":      _safe(rn.get("feature_type")),
            "rn":            rn,
            "ro":            ro,
            "odo_diff":      _diff(d_new, d_old),
            "gw_diff":       _diff(
                _safe(rn.get("dist_to_us_gw_m")),
                _safe(ro.get("dist_to_us_gw_m")) if ro is not None else None),
            "depth_diff":    _diff(
                _safe(rn.get("depth_pct")),
                _safe(ro.get("depth_pct")) if ro is not None else None),
            "len_diff":      _diff(
                _safe(rn.get("length_mm")),
                _safe(ro.get("length_mm")) if ro is not None else None),
            "wid_diff":      _diff(
                _safe(rn.get("width_mm")),
                _safe(ro.get("width_mm")) if ro is not None else None),
            "clk_chg":       clk_chg,
            "clk_deg":       round(clk_deg, 1) if clk_deg is not None else None,
            "surf_chg":      surf_chg,
            "coverage":      _cov(rn, ro),
            "growth_flag":   growth_flag,
            "clock_integrity": clock_integrity,
        })

    mo_set = set(matched_old.keys())
    for idx_o in df_old.index:
        if idx_o in mo_set: continue
        ro    = df_old.loc[idx_o]
        d_old = _safe(ro.get("log_distance_m"))
        sort_d = (
            _interp_old(d_old, interp)
            if d_old is not None and interp
            else (float(d_old) if d_old is not None else 0.0)
        )
        rows.append({
            "sort_d":         sort_d, "status": "ONLY IN OLD",
            "feat_new":       None,   "rn": None, "ro": ro,
            "odo_diff":       None,   "gw_diff": None,
            "depth_diff":     None,   "len_diff": None,
            "wid_diff":       None,   "clk_chg": None,
            "clk_deg":        None,   "surf_chg": None,
            "coverage":       "Hanya OLD",
            "growth_flag":    None,   "clock_integrity": None,
        })

    rows.sort(key=lambda x: x["sort_d"])
    return rows


def build_output_excel(df_new, df_old, matched_new, matched_old,
                       year_new, year_old, vendor_new, vendor_old,
                       output_path, pipeline_length=None,
                       suspect_growth=None, suspect_clock=None,
                       residuals=None):
    if suspect_growth is None: suspect_growth = {}
    if suspect_clock  is None: suspect_clock  = {}
    if residuals      is None: residuals      = []

    wb = Workbook()

    def mkf(bold=False, color="000000", size=9, italic=False):
        return Font(name="Arial", bold=bold, color=color, size=size, italic=italic)

    def mkfill(h):
        return PatternFill("solid", start_color=h, end_color=h)

    thin = Side(style="thin", color="CCCCCC")
    BRD  = Border(left=thin, right=thin, top=thin, bottom=thin)

    def wcell(ws, row, col, val, fh, bold=False, align="left",
              size=9, fc="000000"):
        c = ws.cell(row, col)
        v = _safe(val)
        if v is not None:
            c.value = v
        c.fill      = mkfill(fh)
        c.font      = mkf(bold=bold, size=size, color=fc)
        c.alignment = Alignment(horizontal=align, vertical="center")
        c.border    = BRD
        return c

    FILLS = {
        "Valve":     "D6E4F7", "Tee":      "E6D6F7", "Bend":    "FFF2CC",
        "Weld":      "F0F0F0", "Anode":    "E2EFDA",
        "Metal Loss":"FDEBD0", "Dent":     "FDE8E2",
        "default":   "EDFAED", "only_new": "E8F5E9", "only_old":"FFF3E0",
        "empty":     "FAFAFA", "no_data":  "EEEEEE",
        "worse":     "FFD7D7", "better":   "D7FFD7", "neutral": "F5F5F5",
        "limited":   "E8E8FF", "surf_diff":"FFE0B2", "clk_diff":"FFF0E0",
        "landmark":  "EEE8FF",
        "suspect":   "FFCCCC", "impossible":"FF8080",
        "clk_outlier":"FFD8B0",
    }

    def rfill(feat, status):
        if status == "ONLY IN NEW": return FILLS["only_new"]
        if status == "ONLY IN OLD": return FILLS["only_old"]
        return FILLS.get(str(feat) if feat else "", FILLS["default"])

    comp_rows = build_comparison_rows(df_new, df_old, matched_new, matched_old,
                                      suspect_growth, suspect_clock)

    # ── Helper: tulis sheet data mentah ────────────────────────────────────────
    def write_data_sheet(ws, df, year, vendor, chex):
        ws.row_dimensions[1].height = 24
        ws.merge_cells(f"A1:{get_column_letter(17)}1")
        c = ws.cell(1, 1,
            f"ILI DATA {year}  |  Vendor: {vendor}  |  {len(df):,} fitur  "
            f"[v8.1 — sorted ascending]")
        c.fill = mkfill(chex)
        c.font = mkf(bold=True, color="FFFFFF", size=11)
        c.alignment = Alignment(horizontal="center", vertical="center")

        ws.merge_cells(f"A2:{get_column_letter(17)}2")
        core_d = ["feature_id","joint_number","dist_to_us_gw_m","joint_length_m",
                  "feature_type","feature_identification","dim_classification",
                  "clock_position","wall_thickness_mm","length_mm","width_mm",
                  "depth_pct","surface_location","erf_asme","psafe_bar","comment"]
        emp   = [c for c in core_d if df[c].notna().sum() == 0]
        gw_ok = df["dist_to_us_gw_m"].notna().sum()
        sv    = dict(df["surface_location"].value_counts())
        txt   = (f"Kosong: {', '.join(emp)} | dist_gw:{gw_ok:,}/{len(df):,} | "
                 f"surface:{sv}" if emp
                 else f"Semua terisi | dist_gw:{gw_ok:,}/{len(df):,} | surface:{sv}")
        c2 = ws.cell(2, 1, txt)
        c2.fill = mkfill("FFF9C4" if emp else "E2EFDA")
        c2.font = mkf(size=8, italic=True,
                      color="833C00" if emp else "375623")
        c2.alignment = Alignment(horizontal="left", vertical="center")
        ws.row_dimensions[2].height = 14
        ws.row_dimensions[3].height = 36

        disp = [
            ("feature_id",12),       ("log_distance_m",15),  ("joint_number",10),
            ("dist_to_us_gw_m",14),  ("joint_length_m",13),  ("feature_type",18),
            ("feature_identification",22), ("dim_classification",16),
            ("clock_position",12),   ("wall_thickness_mm",13),
            ("length_mm",12),        ("width_mm",12),         ("depth_pct",12),
            ("surface_location",13), ("erf_asme",12),         ("psafe_bar",14),
            ("comment",22),
        ]
        for ci, (field, w) in enumerate(disp, 1):
            has = df[field].notna().sum() > 0
            hf  = chex if has else "BBBBBB"
            c   = ws.cell(3, ci, field)
            c.fill = mkfill(hf)
            c.font = mkf(bold=True, color="FFFFFF" if has else "666666", size=8)
            c.alignment = Alignment(horizontal="center", vertical="center",
                                    wrap_text=True)
            c.border = BRD
            ws.column_dimensions[get_column_letter(ci)].width = w

        for ri, (_, row) in enumerate(df.iterrows(), start=4):
            ws.row_dimensions[ri].height = 15
            ft = _safe(row.get("feature_type"))
            fh = FILLS.get(str(ft) if ft else "", FILLS["default"])
            for ci, (field, _) in enumerate(disp, 1):
                v  = _safe(row.get(field))
                cf = fh if v is not None else FILLS["no_data"]
                wcell(ws, ri, ci, v, cf,
                      align="right" if field in NUM_F else "left")

        ws.freeze_panes = "A4"
        ws.auto_filter.ref = f"A3:{get_column_letter(len(disp))}3"

    ws_new = wb.active
    ws_new.title = f"NEW Data ({year_new})"
    write_data_sheet(ws_new, df_new, year_new, vendor_new, "1F4E79")

    # ── COMPARISON SHEET ─────────────────────────────────────────────────────────
    ws_comp = wb.create_sheet("Comparison")
    ws_comp.merge_cells(f"A1:{get_column_letter(TOTAL_COLS)}1")
    pl_txt = f"  |  Pipeline: {pipeline_length:.0f}m" if pipeline_length else ""
    c = ws_comp.cell(1, 1,
        f"PIPE ALIGNMENT v8.1  <  NEW {year_new} ({vendor_new})  vs  "
        f"OLD {year_old} ({vendor_old})  >  {len(comp_rows):,} baris{pl_txt}"
        f"  |  Joint-Centric + DTW + Physics Validation"
        f"  |  5-Tier Hierarchy  |  Sorted ascending")
    c.fill = mkfill("212121"); c.font = mkf(bold=True, color="FFFFFF", size=10)
    c.alignment = Alignment(horizontal="center", vertical="center")
    ws_comp.row_dimensions[1].height = 26

    ws_comp.row_dimensions[2].height = 18
    for start, end, label, color in [
        (1,       NN,         f"<  DATA BARU {year_new} ({vendor_new})",  "1F4E79"),
        (NN+1,    NN+NC,      "KOMPARASI (NEW − OLD) + VALIDASI FISIKA",  "375623"),
        (NN+NC+1, TOTAL_COLS, f"DATA LAMA {year_old} ({vendor_old})  >", "833C00"),
    ]:
        ws_comp.merge_cells(start_row=2, start_column=start,
                            end_row=2,   end_column=end)
        c = ws_comp.cell(2, start, label)
        c.fill = mkfill(color); c.font = mkf(bold=True, color="FFFFFF", size=10)
        c.alignment = Alignment(horizontal="center", vertical="center")

    ws_comp.row_dimensions[3].height = 40
    all_defs = (
        [(l, f, w, a, "2E74B5") for l, f, w, a in OUT_COLS_NEW] +
        [(l, f, w, a, "538135") for l, f, w, a in OUT_COLS_COMP] +
        [(l, f, w, a, "C45911") for l, f, w, a in OUT_COLS_OLD]
    )
    for ci, (l, f, w, a, hc) in enumerate(all_defs, 1):
        c = ws_comp.cell(3, ci, l)
        c.fill = mkfill(hc); c.font = mkf(bold=True, color="FFFFFF", size=8)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BRD
        ws_comp.column_dimensions[get_column_letter(ci)].width = w

    for ri, row in enumerate(comp_rows, start=4):
        ws_comp.row_dimensions[ri].height = 15
        status = row["status"]
        ft = row["feat_new"] or (
            _safe(row["ro"].get("feature_type")) if row["ro"] is not None else None)
        fh     = rfill(ft, status)
        is_key = str(ft) in LANDMARK_TYPES if ft else False
        rn = row["rn"]; ro = row["ro"]

        # Kolom NEW
        for ci, (l, field, w, a) in enumerate(OUT_COLS_NEW, 1):
            v  = _safe(rn.get(field)) if rn is not None else None
            cf = FILLS["empty"] if rn is None else (FILLS["no_data"] if v is None else fh)
            wcell(ws_comp, ri, ci, v, cf, bold=is_key, align=a)

        # Kolom COMP
        cv = {
            "odo_diff":        row["odo_diff"],
            "gw_diff":         row["gw_diff"],
            "clock_changed":   row["clk_chg"],
            "clock_diff_deg":  row["clk_deg"],
            "depth_diff":      row["depth_diff"],
            "length_diff":     row["len_diff"],
            "width_diff":      row["wid_diff"],
            "surf_changed":    row["surf_chg"],
            "match_status":    status,
            "growth_flag":     row["growth_flag"],
            "clock_integrity": row["clock_integrity"],
            "data_coverage":   row["coverage"],
        }
        for ci, (l, field, w, a) in enumerate(OUT_COLS_COMP, NN+1):
            v  = cv.get(field)
            cf = fh  # default fill

            if field == "depth_diff" and isinstance(v, float):
                cf = (FILLS["worse"]   if v > 0
                      else FILLS["better"] if v < 0
                      else fh)
            elif field == "odo_diff" and isinstance(v, float):
                cf = FILLS["neutral"]
            elif field == "clock_changed":
                cf = (FILLS["clk_diff"] if v == "YES"
                      else FILLS["better"] if v == "no"
                      else fh)
            elif field == "clock_diff_deg" and isinstance(v, float):
                cf = (FILLS["worse"]    if v > 45
                      else FILLS["clk_diff"] if v > 20
                      else FILLS["better"])
            elif field == "surf_changed":
                cf = (FILLS["surf_diff"] if v == "YES"
                      else FILLS["better"] if v == "no"
                      else fh)
            elif field == "match_status":
                cf = (FILLS["only_new"] if v == "ONLY IN NEW"
                      else FILLS["only_old"] if v == "ONLY IN OLD"
                      else FILLS["neutral"])
            elif field == "growth_flag":
                if v is not None and "IMPOSSIBLE" in str(v):
                    cf = FILLS["impossible"]
                elif v is not None and "SUSPECT" in str(v):
                    cf = FILLS["suspect"]
                else:
                    cf = FILLS["better"] if (status == "MATCHED" and v is None) else fh
            elif field == "clock_integrity":
                if v is not None:
                    cf = FILLS["clk_outlier"]
                else:
                    cf = FILLS["better"] if status == "MATCHED" else fh
            elif field == "data_coverage":
                cf = (FILLS["limited"]
                      if ("terbatas" in str(v) or "Keduanya" in str(v))
                      else FILLS["better"] if v == "Lengkap"
                      else fh)
            elif field == "gw_diff" and isinstance(v, float):
                cf = (FILLS["worse"]    if abs(v) > 2.0
                      else FILLS["clk_diff"] if abs(v) > 0.1
                      else FILLS["better"])

            fc_ = (
                "C00000" if cf in (FILLS["worse"], FILLS["impossible"]) else
                "006400" if cf == FILLS["better"]   else
                "CC5500" if cf in (FILLS["surf_diff"], FILLS["clk_diff"],
                                   FILLS["clk_outlier"], FILLS["suspect"]) else
                "00008B" if cf == FILLS["limited"]  else "000000"
            )
            wcell(ws_comp, ri, ci, v, cf,
                  bold=(field == "match_status"), align=a, fc=fc_)

        # Kolom OLD
        for ci, (l, field, w, a) in enumerate(OUT_COLS_OLD, NN+NC+1):
            v  = _safe(ro.get(field)) if ro is not None else None
            cf = FILLS["empty"] if ro is None else (FILLS["no_data"] if v is None else fh)
            wcell(ws_comp, ri, ci, v, cf, bold=is_key, align=a)

    ws_comp.freeze_panes = "A4"
    ws_comp.auto_filter.ref = f"A3:{get_column_letter(TOTAL_COLS)}3"

    # ── OLD Data sheet ────────────────────────────────────────────────────────────
    write_data_sheet(
        wb.create_sheet(f"OLD Data ({year_old})"),
        df_old, year_old, vendor_old, "833C00")

    # ── Only in NEW ───────────────────────────────────────────────────────────────
    ws_on = wb.create_sheet("Only in NEW")
    only_new = [r for r in comp_rows if r["status"] == "ONLY IN NEW"]
    c = ws_on.cell(1, 1,
        f"FITUR HANYA DI DATA BARU {year_new}  —  {len(only_new):,} fitur")
    c.fill = mkfill("1F4E79"); c.font = mkf(bold=True, color="FFFFFF", size=11)
    ws_on.merge_cells(f"A1:{get_column_letter(NN)}1")
    c.alignment = Alignment(horizontal="center")
    ws_on.row_dimensions[2].height = 36
    for ci, (l, f, w, a) in enumerate(OUT_COLS_NEW, 1):
        c = ws_on.cell(2, ci, l)
        c.fill = mkfill("2E74B5"); c.font = mkf(bold=True, color="FFFFFF", size=8)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BRD
        ws_on.column_dimensions[get_column_letter(ci)].width = w
    for ri, row in enumerate(only_new, start=3):
        ws_on.row_dimensions[ri].height = 15
        ft = row["feat_new"]
        fh = FILLS.get(str(ft) if ft else "", FILLS["only_new"])
        for ci, (l, field, w, a) in enumerate(OUT_COLS_NEW, 1):
            v = _safe(row["rn"].get(field)) if row["rn"] is not None else None
            wcell(ws_on, ri, ci, v, FILLS["no_data"] if v is None else fh, align=a)
    ws_on.freeze_panes = "A3"

    # ── Only in OLD ───────────────────────────────────────────────────────────────
    ws_oo = wb.create_sheet("Only in OLD")
    only_old = [r for r in comp_rows if r["status"] == "ONLY IN OLD"]
    c = ws_oo.cell(1, 1,
        f"FITUR HANYA DI DATA LAMA {year_old}  —  {len(only_old):,} fitur")
    c.fill = mkfill("833C00"); c.font = mkf(bold=True, color="FFFFFF", size=11)
    ws_oo.merge_cells(f"A1:{get_column_letter(NO)}1")
    c.alignment = Alignment(horizontal="center")
    ws_oo.row_dimensions[2].height = 36
    for ci, (l, f, w, a) in enumerate(OUT_COLS_OLD, 1):
        c = ws_oo.cell(2, ci, l)
        c.fill = mkfill("C45911"); c.font = mkf(bold=True, color="FFFFFF", size=8)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BRD
        ws_oo.column_dimensions[get_column_letter(ci)].width = w
    for ri, row in enumerate(only_old, start=3):
        ws_oo.row_dimensions[ri].height = 15
        ro_ = row["ro"]
        ft  = _safe(ro_.get("feature_type")) if ro_ is not None else None
        fh  = FILLS.get(str(ft) if ft else "", FILLS["only_old"])
        for ci, (l, field, w, a) in enumerate(OUT_COLS_OLD, 1):
            v = _safe(ro_.get(field)) if ro_ is not None else None
            wcell(ws_oo, ri, ci, v, FILLS["no_data"] if v is None else fh, align=a)
    ws_oo.freeze_panes = "A3"

    # ── Physics Validation Sheet ──────────────────────────────────────────────────
    ws_val = wb.create_sheet("Physics_Validation")
    c = ws_val.cell(1, 1,
        f"VALIDASI FISIKA v8.1  |  "
        f"Growth Rate: {len(suspect_growth)} flag  |  "
        f"Clock Integrity: {len(suspect_clock)} flag")
    c.fill = mkfill("4A0080"); c.font = mkf(bold=True, color="FFFFFF", size=11)
    ws_val.merge_cells("A1:H1"); c.alignment = Alignment(horizontal="center")

    headers_val = [
        "Log Dist NEW (m)", "Feature Type", "Depth NEW (%WT)", "Depth OLD (%WT)",
        "Depth Δ (%WT)", "Flag Type", "Detail / Reason", "Action"
    ]
    widths_val = [15, 16, 14, 14, 14, 22, 55, 35]
    for ci, (h, w) in enumerate(zip(headers_val, widths_val), 1):
        c = ws_val.cell(2, ci, h)
        c.fill = mkfill("6B2FA0"); c.font = mkf(bold=True, color="FFFFFF", size=9)
        c.border = BRD
        ws_val.column_dimensions[get_column_letter(ci)].width = w

    ri_val = 3
    for idx_n, (idx_o, dc, reason) in sorted(
            suspect_growth.items(),
            key=lambda x: float(df_new.at[x[0], "log_distance_m"] or 0)):
        is_imp = "IMPOSSIBLE" in reason
        fh = FILLS["impossible"] if is_imp else FILLS["suspect"]
        d_n   = _sf(df_new.at[idx_n, "log_distance_m"])
        ft    = _safe(df_new.at[idx_n, "feature_type"])
        dep_n = _sf(df_new.at[idx_n, "depth_pct"])
        dep_o = _sf(df_old.at[idx_o, "depth_pct"])
        flag  = "❌ IMPOSSIBLE_DECREASE" if is_imp else "⚠ SUSPECT_DECREASE"
        action = ("PERLU VERIFIKASI MANUAL — Kemungkinan false match"
                  if is_imp else "Cek apakah ada repair/sleeve tidak tercatat")
        for ci, v in enumerate([d_n, ft, dep_n, dep_o, round(dc, 2),
                                 flag, reason, action], 1):
            wcell(ws_val, ri_val, ci, v, fh,
                  bold=(ci == 6),
                  align="center" if ci in (1, 3, 4, 5, 6) else "left")
        ws_val.row_dimensions[ri_val].height = 15
        ri_val += 1

    if suspect_clock:
        ri_val += 1
        c = ws_val.cell(ri_val, 1, "── CLOCK SHIFT INTEGRITY FLAGS ──")
        c.fill = mkfill("CC7000")
        c.font = mkf(bold=True, color="FFFFFF", size=10)
        ws_val.merge_cells(f"A{ri_val}:H{ri_val}")
        ri_val += 1
        for idx_n, (idx_o, shift, median, reason) in sorted(
                suspect_clock.items(),
                key=lambda x: float(df_new.at[x[0], "log_distance_m"] or 0)):
            fh = FILLS["clk_outlier"]
            d_n   = _sf(df_new.at[idx_n, "log_distance_m"])
            ft    = _safe(df_new.at[idx_n, "feature_type"])
            dep_n = _sf(df_new.at[idx_n, "depth_pct"])
            dep_o = _sf(df_old.at[idx_o, "depth_pct"])
            flag   = "⚠ CLOCK OUTLIER"
            action = (f"Cek manual: shift={shift:.0f}° "
                      f"tapi tetangga median={median:.0f}°")
            for ci, v in enumerate([d_n, ft, dep_n, dep_o, None,
                                     flag, reason, action], 1):
                wcell(ws_val, ri_val, ci, v, fh,
                      bold=(ci == 6),
                      align="center" if ci in (1, 3, 4, 5, 6) else "left")
            ws_val.row_dimensions[ri_val].height = 15
            ri_val += 1

    ws_val.freeze_panes = "A3"

    # ── Residual Error Sheet ──────────────────────────────────────────────────────
    ws_res = wb.create_sheet("Residual_Plot")
    c = ws_res.cell(1, 1,
        "RESIDUAL ERROR ANALYSIS v8.1  |  "
        "Delta Odometer (NEW − OLD) vs Log Distance  |  "
        "Garis lurus miring = Linear Drift (OK)  |  "
        "Zigzag tajam = Misalignment lokal (PERLU FIX)")
    c.fill = mkfill("1C3A5E"); c.font = mkf(bold=True, color="FFFFFF", size=10)
    ws_res.merge_cells("A1:E1"); c.alignment = Alignment(horizontal="center")
    ws_res.row_dimensions[1].height = 24

    c2 = ws_res.cell(2, 1,
        "Interpretasi: Tren linier miring → normal. "
        "Fluktuasi <0.5m → noise sensor (OK). "
        "Lonjakan >2m → kemungkinan misalignment lokal di area tersebut.")
    c2.fill = mkfill("E8F0F8")
    c2.font = mkf(size=8, italic=True, color="1C3A5E")
    ws_res.merge_cells("A2:E2")
    c2.alignment = Alignment(horizontal="left")
    ws_res.row_dimensions[2].height = 20

    headers_res = ["Log Dist NEW (m)", "Delta Odo (m)\nNEW−OLD",
                   "Feature Type", "Δ Trend", "Interpretasi"]
    widths_res  = [16, 16, 18, 14, 35]
    for ci, (h, w) in enumerate(zip(headers_res, widths_res), 1):
        c = ws_res.cell(3, ci, h)
        c.fill = mkfill("2E74B5"); c.font = mkf(bold=True, color="FFFFFF", size=9)
        c.border = BRD
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws_res.column_dimensions[get_column_letter(ci)].width = w
    ws_res.row_dimensions[3].height = 32

    prev_delta = None
    for ri_r, res in enumerate(residuals, start=4):
        d     = res["log_dist_new"]
        delta = res["delta_odo"]
        ft    = res["feature_type"]

        # [FIX-3 & FIX-8]: Selalu inisialisasi fh_res sebelum dipakai
        fh_res     = FILLS.get(ft, "EDFAED")   # default
        trend_str  = "—"
        interp_str = "Titik awal"

        if prev_delta is not None:
            dtrend = delta - prev_delta
            if abs(dtrend) < 0.1:
                trend_str  = "→ stabil"
                interp_str = "Normal — drift konsisten"
                fh_res     = "EDFAED"
            elif abs(dtrend) < 0.5:
                trend_str  = f"{'↑' if dtrend > 0 else '↓'} {abs(dtrend):.3f}m"
                interp_str = "Normal — sedikit variasi"
                fh_res     = "FFFDE7"
            elif abs(dtrend) < 2.0:
                trend_str  = f"{'↑↑' if dtrend > 0 else '↓↓'} {abs(dtrend):.3f}m"
                interp_str = "⚠ Perlu perhatian — fluktuasi signifikan"
                fh_res     = "FFE0B2"
            else:
                trend_str  = f"{'⬆' if dtrend > 0 else '⬇'} {abs(dtrend):.3f}m"
                interp_str = "❌ ANOMALI LOKAL — kemungkinan misalignment"
                fh_res     = "FFD7D7"

        prev_delta = delta

        for ci, v in enumerate([d, delta, ft, trend_str, interp_str], 1):
            c = ws_res.cell(ri_r, ci, v)
            c.fill = mkfill(fh_res)
            c.font = mkf(size=8)
            c.alignment = Alignment(
                horizontal="right" if ci in (1, 2) else "left",
                vertical="center")
            c.border = BRD
        ws_res.row_dimensions[ri_r].height = 13

    ws_res.freeze_panes = "A4"

    # ── Summary Sheet ──────────────────────────────────────────────────────────────
    ws_s = wb.create_sheet("Summary")
    ws_s.column_dimensions["A"].width = 46
    for col in "BCDEFG":
        ws_s.column_dimensions[col].width = 18

    c = ws_s.cell(1, 1,
        "ILI PIPELINE COMPARISON SUMMARY  v8.1  —  "
        "Joint-Centric Matching | DTW Pre-Alignment | 5-Tier Hierarchy | "
        "Valve+Tee Ground Truth | Growth Rate + Clock Integrity | "
        "Strict Monotonic LIS | Residual Error Plot")
    c.fill = mkfill("212121"); c.font = mkf(bold=True, color="FFFFFF", size=12)
    ws_s.merge_cells("A1:G1"); c.alignment = Alignment(horizontal="center")
    ws_s.row_dimensions[1].height = 30

    pl_str = f"{pipeline_length:.0f} m" if pipeline_length else "N/A"

    info = [
        ("Vendor NEW",         vendor_new),
        ("Survey Year NEW",    year_new),
        ("Vendor OLD",         vendor_old),
        ("Survey Year OLD",    year_old),
        ("Run Date",           datetime.now().strftime("%Y-%m-%d %H:%M")),
        ("Algorithm",          "Multi-Pass Hungarian v8.1 — Joint-Centric + DTW + "
                               "Physics Validation"),
        ("Pipeline Length",    pl_str),
        ("Tier-1 Anchor",      f"Valve (±{ODO_TOLERANCE_FIXED['Valve'][0]:.0f}–"
                               f"{ODO_TOLERANCE_FIXED['Valve'][3]:.0f}m) + "
                               f"Tee (±{ODO_TOLERANCE_FIXED['Tee'][0]:.0f}–"
                               f"{ODO_TOLERANCE_FIXED['Tee'][3]:.0f}m) "
                               "— kebal dari LIS"),
        ("Tier-2 Skeleton",    "Weld — membentuk pola sidik jari pipeline"),
        ("Tier-3 Topology",    "Bend — sinkronisasi orientasi"),
        ("Tier-4 Secondary",   "Anode, Offtake, Flange, Fitting, Marker, Support"),
        ("Tier-5 Assessment",  "Metal Loss + Dent — JOINT-CENTRIC matching dalam "
                               "ruang joint yang terkunci GW"),
        ("DTW Pre-Alignment",  "Koreksi non-linear odometer drift sebelum Hungarian "
                               "(window=10% joints)"),
        ("Joint-Centric Radius",
         f"Dalam joint: ±{JOINT_CENTRIC_ODO_SCALE*100:.0f}% joint length "
         f"(min 0.3m, max 3.0m)"),
        ("Growth Rate Validation",
         f"SUSPECT jika depth turun >{GROWTH_DEPTH_SUSPECT_DECREASE}%WT, "
         f"IMPOSSIBLE jika >{GROWTH_DEPTH_IMPOSSIBLE}%WT"),
        ("Clock Integrity Check",
         f"OUTLIER jika clock shift deviate "
         f">{CLOCK_SHIFT_OUTLIER_THRESHOLD}° dari median "
         f"{CLOCK_SHIFT_NEIGHBOR_WINDOW} tetangga"),
        ("Residual Error Plot",
         "Sheet 'Residual_Plot' — debugging misalignment lokal per pasang"),
        ("Physics Flags",
         f"Growth Rate: {len(suspect_growth)} pair  |  "
         f"Clock Integrity: {len(suspect_clock)} pair"),
        ("v8.1 Bug Fixes",
         "FIX1: total_joints counting | FIX2: DTW traceback | "
         "FIX3/8: fh_res undefined | FIX4: LIS patience sorting | "
         "FIX5: joint early-exit | FIX6: physics flag check | "
         "FIX7: landmark used-set isolation"),
    ]
    for ri, (k, v) in enumerate(info, 3):
        ws_s.cell(ri, 1, k).font = mkf(bold=True, size=9, color="1F4E79")
        c = ws_s.cell(ri, 2, str(v)); c.font = mkf(size=9)
        ws_s.merge_cells(f"B{ri}:G{ri}")

    # Statistik coverage
    r0 = len(info) + 4
    gw_n  = df_new["dist_to_us_gw_m"].notna().sum()
    gw_o  = df_old["dist_to_us_gw_m"].notna().sum()
    sv_n  = dict(df_new["surface_location"].value_counts())
    sv_o  = dict(df_old["surface_location"].value_counts())
    ck_n  = df_new["clock_position"].notna().sum()
    ck_o  = df_old["clock_position"].notna().sum()
    dep_n = df_new["depth_pct"].notna().sum()
    dep_o = df_old["depth_pct"].notna().sum()
    for ri, (k, v) in enumerate([
        ("dist_to_us_gw NEW",  f"{gw_n:,}/{len(df_new):,} "
                               f"({100*gw_n/max(len(df_new),1):.0f}%)"),
        ("dist_to_us_gw OLD",  f"{gw_o:,}/{len(df_old):,} "
                               f"({100*gw_o/max(len(df_old),1):.0f}%)"),
        ("clock_position NEW", f"{ck_n:,}/{len(df_new):,} "
                               f"({100*ck_n/max(len(df_new),1):.0f}%)"),
        ("clock_position OLD", f"{ck_o:,}/{len(df_old):,} "
                               f"({100*ck_o/max(len(df_old),1):.0f}%)"),
        ("depth_pct NEW",      f"{dep_n:,}/{len(df_new):,} "
                               f"({100*dep_n/max(len(df_new),1):.0f}%)"),
        ("depth_pct OLD",      f"{dep_o:,}/{len(df_old):,} "
                               f"({100*dep_o/max(len(df_old),1):.0f}%)"),
        ("Surface NEW",        str(sv_n)),
        ("Surface OLD",        str(sv_o)),
    ], start=r0):
        ws_s.cell(ri, 1, k).font = mkf(bold=True, size=9, color="375623")
        c = ws_s.cell(ri, 2, str(v)); c.font = mkf(size=9)
        ws_s.merge_cells(f"B{ri}:G{ri}")

    # Tabel ringkasan per feature type
    tbl_r = r0 + 9
    for ci, h in enumerate(["Feature Type", "Tier", "NEW", "OLD", "Matched",
                             "Only NEW", "Only OLD", "Match%"], 1):
        c = ws_s.cell(tbl_r, ci, h)
        c.fill = mkfill("1F4E79"); c.font = mkf(bold=True, color="FFFFFF", size=10)
        c.alignment = Alignment(horizontal="center"); c.border = BRD

    all_types_s = sorted(set(
        list(df_new["feature_type"].dropna().unique()) +
        list(df_old["feature_type"].dropna().unique())
    ))
    mn_set = set(matched_new.keys()); mo_set = set(matched_old.keys())
    g = [0] * 5
    for ri2, ft in enumerate(all_types_s, start=tbl_r+1):
        cn  = int((df_new["feature_type"] == ft).sum())
        co  = int((df_old["feature_type"] == ft).sum())
        nm  = sum(1 for i in df_new[df_new["feature_type"] == ft].index
                  if i in mn_set)
        on_ = cn - nm
        oo  = co - sum(1 for i in df_old[df_old["feature_type"] == ft].index
                       if i in mo_set)
        pct = f"{100*nm/max(min(cn,co),1):.0f}%"
        alt = "F2F7FF" if ri2 % 2 == 0 else "FFFFFF"
        lm_mark = "★" if ft in LANDMARK_TYPES else ""
        tier = TIER_LABEL.get(ft, 6)
        for ci, v in enumerate([f"{lm_mark}{ft}", f"T{tier}", cn, co, nm,
                                  on_, oo, pct], 1):
            c = ws_s.cell(ri2, ci, v)
            c.fill = mkfill(FILLS["landmark"] if ft in LANDMARK_TYPES else alt)
            c.font = mkf(size=10, bold=(ci == 1))
            c.alignment = Alignment(
                horizontal="left" if ci == 1 else "center")
            c.border = BRD
        g[0] += cn; g[1] += co; g[2] += nm; g[3] += on_; g[4] += oo

    tot_r2 = tbl_r + len(all_types_s) + 1
    for ci, v in enumerate(["TOTAL", "—"] + g +
                            [f"{100*g[2]/max(min(g[0],g[1]),1):.1f}%"], 1):
        c = ws_s.cell(tot_r2, ci, v)
        c.fill = mkfill("D9E1F2"); c.font = mkf(bold=True, size=10)
        c.border = BRD
        c.alignment = Alignment(horizontal="left" if ci == 1 else "center")

    # Legenda
    nr = tot_r2 + 3
    ws_s.cell(nr, 1,
              "LEGENDA WARNA  |  v8.1 — Joint-Centric + DTW + Physics Validation"
              ).font = mkf(bold=True, size=11)
    ws_s.merge_cells(f"A{nr}:E{nr}")
    for i, (h, l) in enumerate([
        ("EEE8FF", "★ LANDMARK (Valve / Weld / Tee) — Tier-1/2 anchor"),
        ("D6E4F7", "Valve — Absolute Ground Truth (T1, kebal LIS)"),
        ("E6D6F7", "Tee — Ground Truth T1 (kebal LIS)"),
        ("FFF2CC", "Bend — Tier-3 Topology"),
        ("F0F0F0", "Weld — Tier-2 Skeleton"),
        ("E2EFDA", "Anode / Offtake / Flange — Tier-4 Secondary"),
        ("FDEBD0", "Metal Loss — Tier-5 Assessment (Joint-Centric)"),
        ("FDE8E2", "Dent — Tier-5 Assessment (Joint-Centric)"),
        ("E8F5E9", "ONLY IN NEW — fitur baru"),
        ("FFF3E0", "ONLY IN OLD — fitur hilang"),
        ("FFD7D7", "Anomali MEMBURUK — depth naik di NEW"),
        ("D7FFD7", "Anomali MEMBAIK — depth turun di NEW"),
        ("FFF0E0", "Clock BERUBAH — perbedaan 20°–45°"),
        ("FFE0B2", "GW Diff >2m — dist to upstream GW berubah signifikan"),
        ("FF8080", "❌ IMPOSSIBLE_DECREASE — depth turun drastis, cek false match"),
        ("FFCCCC", "⚠ SUSPECT_DECREASE — depth turun mencurigakan"),
        ("FFD8B0", "⚠ CLOCK_OUTLIER — shift tidak konsisten dengan tetangga"),
        ("EEEEEE", "Sel ABU — kolom kosong di vendor tersebut"),
        ("E8E8FF", "Data TERBATAS — kolom anomali tidak lengkap"),
        ("F5F5F5", "NEUTRAL — odo diff normal"),
    ]):
        c = ws_s.cell(nr + 1 + i, 1, l)
        c.fill = mkfill(h); c.font = mkf(size=9); c.border = BRD
        ws_s.merge_cells(f"A{nr+1+i}:E{nr+1+i}")

    wb.save(output_path)

    nm_  = len(matched_new)
    non  = len([r for r in comp_rows if r["status"] == "ONLY IN NEW"])
    noo  = len([r for r in comp_rows if r["status"] == "ONLY IN OLD"])
    return nm_, non, noo


# ══════════════════════════════════════════════════════════════════════════════════
