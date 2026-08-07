import pandas as pd
import numpy as np
import sys
import re
import os
from difflib import get_close_matches
from datetime import datetime
from .constants import *
#  BAGIAN 2 — FUZZY COLUMN MATCHING
# ══════════════════════════════════════════════════════════════════════════════════
ABBREV_MAP = {
    "dist":"distance","abs":"absolute","us":"upstream","u/s":"upstream",
    "ds":"downstream","d/s":"downstream","gw":"girthweld","wt":"wallthickness",
    "len":"length","ori":"orientation","clk":"clock","loc":"location",
    "id":"identification","feat":"feature","ident":"identification",
    "dim":"dimension","class":"classification","psafe":"pressuresafe",
    "pct":"percent","prcnt":"percent",
}

def _norm_token(s):
    s = s.lower().strip()
    s = re.sub(r'[*\(\)\[\]#\.,/]', '', s).strip()
    return ABBREV_MAP.get(s, s)

def _norm_col(s):
    tokens = re.split(r'[\s_\-]+', str(s))
    return " ".join([_norm_token(t) for t in tokens if t.strip()])

def _col_sim(a, b):
    na, nb = _norm_col(a), _norm_col(b)
    if na == nb: return 1.0
    ta, tb = set(na.split()), set(nb.split())
    if not ta or not tb: return 0.0
    j = len(ta & tb) / len(ta | tb)
    if na in nb or nb in na: j = min(1.0, j + 0.3)
    return j

def find_best_col(vendor_col, df_cols, threshold=0.4):
    if vendor_col in df_cols: return vendor_col, 1.0
    for c in df_cols:
        if str(c).strip() == vendor_col.strip(): return c, 0.99
    vnorm = _norm_col(vendor_col)
    col_norms = {c: _norm_col(str(c)) for c in df_cols}
    for c, cn in col_norms.items():
        if cn == vnorm: return c, 0.95
    best_c, best_s = None, 0.0
    for c, cn in col_norms.items():
        s = _col_sim(vnorm, cn)
        if s > best_s: best_s, best_c = s, c
    return (best_c, best_s) if best_s >= threshold else (None, 0.0)


# ══════════════════════════════════════════════════════════════════════════════════
#  BAGIAN 3 — LOADER
# ══════════════════════════════════════════════════════════════════════════════════

def normalize_clock(val):
    if val is None or (isinstance(val, float) and np.isnan(val)): return None
    s = str(val).strip()
    if ":" in s:
        p = s.split(":")
        try: return f"{int(p[0]):02d}:{int(p[1]):02d}"
        except: pass
    try:
        h = float(s)
        # Excel stores time as a fraction of a 24-hour day (0 < h < 1)
        if 0 < h < 1:
            total_hours = h * 24
            hours = int(total_hours)
            minutes = round((total_hours - hours) * 60)
            if minutes == 60:
                hours += 1
                minutes = 0
            if hours == 0:
                hours = 12
            return f"{hours:02d}:{minutes:02d}"
        return f"{int(h):02d}:00"
    except: pass
    return s

def normalize_surface(val):
    if val is None or (isinstance(val, float) and np.isnan(val)): return None
    s = str(val).strip().lower()
    if s in ("nan", "none", "-", "n/a", ""): return None
    return SURFACE_NORMALIZATION.get(s, val.strip().title())

# Ordered token rules, applied after an exact dictionary hit and before any
# substring or fuzzy fallback.
#
# The order is the whole point.  The previous implementation walked
# FEATURE_TYPE_NORMALIZATION and returned on the first key that appeared
# *anywhere* inside the label, in dictionary insertion order, so "Metal loss at
# girth weld" hit the "weld" entry and was stored as a girth weld — promoting an
# anomaly into a Tier-2 DTW anchor.  That directly contradicted the precedence
# db_ingest.summarize_feature_counts already applied to the wizard's own intake
# summary ("a metal loss near a weld remains an anomaly, never an anchor"), so
# the counts on screen and the rows in the database disagreed.
#
# Metal loss and dents are therefore resolved first and on word boundaries; a
# structural label only wins when no anomaly token is present.
_FEATURE_TYPE_RULES = (
    ("Metal Loss", re.compile(
        r"\b(?:metal\s*loss|corrosion|corroded|corr|anomaly|anom|ml|cocl|"
        r"pitting|pit|cluster|klaster|kluster|erosion|gouge|grooving)\b",
    )),
    ("Dent", re.compile(r"\b(?:dent|denp|dint|mechanical\s+damage|deformation)\b")),
    ("Valve", re.compile(r"\b(?:valve|valv)\b")),
    ("Tee", re.compile(r"\b(?:tee|branch\s+connection)\b")),
    ("Offtake", re.compile(r"\b(?:offtake|off\s*take|offt)\b")),
    ("Flange", re.compile(r"\b(?:flange|flanged|flng)\b")),
    ("Bend", re.compile(r"\b(?:bend|elbow)\b")),
    ("Anode", re.compile(r"\b(?:anode|anod)\b")),
    ("Support", re.compile(r"\b(?:support|attachment)\b")),
    ("Marker", re.compile(r"\b(?:marker|agm|magnet)\b")),
    ("Casing", re.compile(r"\bcasing\b")),
    ("Fitting", re.compile(r"\b(?:fitting|sleeve|clamp|repair|repa|comp|reducer|swage)\b")),
    ("Recording", re.compile(r"\bdata\s+recording\b")),
    # Weld sits last so it can never outrank an anomaly token in the same label.
    ("Weld", re.compile(r"\b(?:weld|girth|chwt)\b")),
)


def _match_feature_type_rules(key):
    for standard_name, pattern in _FEATURE_TYPE_RULES:
        if pattern.search(key):
            return standard_name
    return None


def _dictionary_substring_match(key):
    """Longest dictionary key contained in the label, on word boundaries.

    Length-ordered so "metal loss cluster" beats "ml", and the reversed
    ``key in k`` direction is gone: a two-letter label used to match any
    dictionary entry that happened to contain it.
    """
    for synonym in sorted(FEATURE_TYPE_NORMALIZATION, key=len, reverse=True):
        if len(synonym) < 3:
            continue
        if re.search(rf"\b{re.escape(synonym)}\b", key):
            return FEATURE_TYPE_NORMALIZATION[synonym]
    return None


def _normalize_type_label(value):
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    text = str(value).strip()
    if text.lower() in ("nan", "none", "-", "n/a", ""):
        return None
    return text


def normalize_feature_type(val, fallback_id=None):
    raw = _normalize_type_label(val)
    if raw:
        key = re.sub(r"[\-_/]+", " ", raw.lower().strip())
        key = re.sub(r"\s+", " ", key)
        # The seeded dictionary is authoritative for an exact label: an operator
        # who mapped a vendor code deliberately outranks every heuristic below.
        result = FEATURE_TYPE_NORMALIZATION.get(key)
        if result:
            return result
        result = _match_feature_type_rules(key)
        if result:
            return result
        result = _dictionary_substring_match(key)
        if result:
            return result
        # Handle small vendor spelling variations without changing unrelated labels.
        fuzzy = get_close_matches(key, FEATURE_TYPE_NORMALIZATION.keys(), n=1, cutoff=0.82)
        if fuzzy:
            return FEATURE_TYPE_NORMALIZATION[fuzzy[0]]
        return raw.title()

    fallback = _normalize_type_label(fallback_id)
    if fallback:
        fb = re.sub(r"[\-_/]+", " ", fallback.lower().strip())
        fb = re.sub(r"\s+", " ", fb)
        result = FEATURE_TYPE_NORMALIZATION.get(fb) or _match_feature_type_rules(fb)
        if result:
            return result
        fuzzy = get_close_matches(fb, FEATURE_TYPE_NORMALIZATION.keys(), n=1, cutoff=0.82)
        if fuzzy:
            return FEATURE_TYPE_NORMALIZATION[fuzzy[0]]
    return "Other"

def _autodetect_header(path, sheet, field_map, max_scan=8):
    best_row, best_score = 0, -1
    for hr in range(max_scan):
        try:
            df_p = pd.read_excel(path, sheet_name=sheet, header=hr, nrows=1)
            cols = [str(c) for c in df_p.columns]
            score = sum(find_best_col(mk, cols, 0.3)[1] for mk in field_map.keys())
            if score > best_score: best_score, best_row = score, hr
        except: continue
    return best_row, best_score

def load_field_map_from_file(file_path):
    try:
        xl = pd.ExcelFile(file_path)
        if "FIELD_MAP" not in xl.sheet_names: return {}
        df_map = pd.read_excel(file_path, sheet_name="FIELD_MAP", header=None)
        core_fields = {f[0] for f in UNIVERSAL_SCHEMA if not f[0].startswith("_")}
        mapping = {}
        for _, row in df_map.iterrows():
            try:
                uni = str(row.iloc[1]).strip() if pd.notna(row.iloc[1]) else ""
                vc  = str(row.iloc[4]).strip() if pd.notna(row.iloc[4]) else ""
                if uni in core_fields and vc.lower() not in ("nan","none","","✓ wajib","wajib"):
                    mapping[vc] = uni
            except: continue
        return mapping
    except: return {}

def load_ili_universal(file_path, field_map=None, survey_year=None, vendor=None,
                       sheet_name="ILI_DATA"):
    if not field_map:
        field_map = load_field_map_from_file(file_path)
        if field_map: print(f"   FIELD_MAP: {len(field_map)} kolom")
        else: print("   [WARN] Tidak ada FIELD_MAP — fallback fuzzy matching")

    xl = pd.ExcelFile(file_path)
    if sheet_name not in xl.sheet_names:
        sheet_name = xl.sheet_names[0]

    header_row, score = _autodetect_header(file_path, sheet_name, field_map)
    print(f"   Header row: baris {header_row+1} (score={score:.1f})")

    df_raw = pd.read_excel(file_path, sheet_name=sheet_name, header=header_row)
    df_raw = df_raw.dropna(how="all").reset_index(drop=True)
    df_raw.columns = [str(c).strip() if pd.notna(c) else f"_col{i}"
                      for i, c in enumerate(df_raw.columns)]
    n = len(df_raw)
    df_uni = pd.DataFrame({col: pd.Series([np.nan]*n) for col in UNIVERSAL_COLS})

    for vc, uc in field_map.items():
        if uc not in UNIVERSAL_COLS: continue
        mc, sim = find_best_col(vc, df_raw.columns, 0.4)
        if mc:
            df_uni[uc] = df_raw[mc].values
            if sim < 0.9: print(f"   Fuzzy: '{vc}'→'{mc}' (sim={sim:.2f})→{uc}")

    # Last-resort binder for columns the FIELD_MAP did not cover.  0.5 was low
    # enough to bind loosely related headers to the wrong universal field
    # (e.g. a "(mm)" column onto a percentage field), so the floor is 0.75 and
    # every fallback binding is logged with its similarity score.
    FALLBACK_SIM_FLOOR = 0.75
    for uc in UNIVERSAL_COLS[:17]:
        if df_uni[uc].notna().sum() > 0: continue
        for rc in df_raw.columns:
            _, s = find_best_col(uc, [rc], FALLBACK_SIM_FLOOR)
            if s >= FALLBACK_SIM_FLOOR:
                df_uni[uc] = df_raw[rc].values
                print(f"   Fallback: '{rc}'→{uc} (sim={s:.2f})")
                break

    df_uni["clock_position"]   = df_uni["clock_position"].apply(normalize_clock)
    df_uni["surface_location"] = df_uni["surface_location"].apply(normalize_surface)
    ft = df_uni["feature_type"].values
    fi = df_uni["feature_identification"].values
    df_uni["feature_type"] = [normalize_feature_type(ft[i], fi[i]) for i in range(n)]

    df_uni["_source_file"]      = os.path.basename(file_path)
    df_uni["_survey_year"]      = survey_year
    df_uni["_vendor"]           = vendor
    df_uni["_import_timestamp"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    mask = pd.to_numeric(df_uni["log_distance_m"], errors="coerce").notna()
    dropped = (~mask).sum()
    if dropped > 0: print(f"   {dropped} baris tanpa log_distance_m di-skip")

    df_uni = df_uni[mask].copy()
    df_uni["log_distance_m"] = pd.to_numeric(df_uni["log_distance_m"], errors="coerce")
    df_uni = df_uni.sort_values("log_distance_m", kind="stable").reset_index(drop=True)

    n_total = len(df_uni)
    gw_ok   = df_uni["dist_to_us_gw_m"].notna().sum()
    empty_c = [c for c in UNIVERSAL_COLS[:17]
               if c != "log_distance_m" and df_uni[c].notna().sum() == 0]
    surf_v  = dict(df_uni["surface_location"].value_counts())
    print(f"   {n_total:,} baris | dist_gw={gw_ok:,} ({100*gw_ok/max(n_total,1):.0f}%) "
          f"| surface={surf_v}")
    if empty_c: print(f"   Kolom kosong: {', '.join(empty_c)}")
    return df_uni


# ══════════════════════════════════════════════════════════════════════════════════
# BAGIAN 4 — DATABASE LOADER
# ══════════════════════════════════════════════════════════════════════════════════

def load_ili_from_db(run_id, db_session):
    from backend.models import ILIFeature
    
    features = db_session.query(ILIFeature).filter(ILIFeature.run_id == run_id).order_by(ILIFeature.log_distance_m).all()
    
    if not features:
        print(f"   [WARN] No features found for run_id {run_id}")
        return pd.DataFrame(columns=UNIVERSAL_COLS)
        
    data = []
    for f in features:
        data.append({
            "feature_id": f.feature_id,
            "log_distance_m": f.log_distance_m,
            "joint_number": f.joint_number,
            "dist_to_us_gw_m": f.dist_to_us_gw_m,
            "joint_length_m": f.joint_length_m,
            "feature_type": f.feature_type,
            "feature_identification": f.feature_identification,
            "dim_classification": f.dim_classification,
            "clock_position": f.clock_position,
            "wall_thickness_mm": f.wall_thickness_mm,
            "length_mm": f.length_mm,
            "width_mm": f.width_mm,
            "depth_pct": f.depth_pct,
            "surface_location": f.surface_location,
            "erf_asme": f.erf_asme,
            "psafe_bar": f.psafe_bar,
            "comment": f.comment,
            "_source_file": f"DB_RUN_{run_id}",
            "_survey_year": f.run.survey_year if f.run else None,
            "_vendor": f.run.vendor if f.run else None,
            "_import_timestamp": "DB",
            # We also need the DB ID so we can save alignment results back!
            "_db_id": f.id
        })
        
    df_uni = pd.DataFrame(data)
    
    n_total = len(df_uni)
    gw_ok   = df_uni["dist_to_us_gw_m"].notna().sum()
    surf_v  = dict(df_uni["surface_location"].value_counts())
    print(f"   DB Run {run_id}: {n_total:,} baris | dist_gw={gw_ok:,} ({100*gw_ok/max(n_total,1):.0f}%) "
          f"| surface={surf_v}")
          
    # Ensure log distance is numeric
    df_uni["log_distance_m"] = pd.to_numeric(df_uni["log_distance_m"], errors="coerce")
    return df_uni
