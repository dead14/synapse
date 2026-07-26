import pandas as pd
import numpy as np
#  BAGIAN 1 — SKEMA & KONSTANTA
# ══════════════════════════════════════════════════════════════════════════════════

ABS_DIST_COL = "log_distance_m"

UNIVERSAL_SCHEMA = [
    ("feature_id",             "str",   "ID / Nomor fitur unik dari vendor",            False),
    (ABS_DIST_COL,              "float", "Jarak odometer absolut dari launcher (meter)", True),
    ("joint_number",           "int",   "Nomor joint pipa",                             False),
    ("dist_to_us_gw_m",        "float", "Jarak ke upstream girth weld (meter)",         False),
    ("joint_length_m",         "float", "Panjang joint (meter)",                        False),
    ("feature_type",           "str",   "Tipe fitur",                                   False),
    ("feature_identification", "str",   "Sub-tipe / identifikasi fitur",                False),
    ("dim_classification",     "str",   "Klasifikasi dimensi anomali",                  False),
    ("clock_position",         "str",   "Orientasi posisi jam (HH:MM)",                 False),
    ("wall_thickness_mm",      "float", "Wall thickness nominal (mm)",                  False),
    ("length_mm",              "float", "Panjang aksial anomali (mm)",                  False),
    ("width_mm",               "float", "Lebar anomali (mm)",                           False),
    ("depth_pct",              "float", "Kedalaman anomali (% WT)",                     False),
    ("surface_location",       "str",   "Lokasi permukaan: Internal / External",        False),
    ("erf_asme",               "float", "ERF ASME B31G",                                False),
    ("psafe_bar",              "float", "Tekanan aman ASME B31G (bar)",                 False),
    ("comment",                "str",   "Komentar / catatan vendor",                    False),
    ("_source_file",           "str",   "[AUTO]",                                       False),
    ("_survey_year",           "int",   "[AUTO]",                                       False),
    ("_vendor",                "str",   "[AUTO]",                                       False),
    ("_import_timestamp",      "str",   "[AUTO]",                                       False),
]
UNIVERSAL_COLS = [f[0] for f in UNIVERSAL_SCHEMA]

FEATURE_TYPE_NORMALIZATION = {
    "valve":"Valve","valv":"Valve","ball valve":"Valve","gate valve":"Valve",
    "block valve":"Valve",
    "weld":"Weld","girth weld":"Weld","seam weld":"Weld",
    "girth weld anomaly":"Weld","longitudinal weld":"Weld","chwt":"Weld",
    "launcher end":"Weld",
    "bend":"Bend","bend begin":"Bend","bend end":"Bend","elbow":"Bend",
    "bend start":"Bend",
    "anomaly":"Metal Loss","metal loss":"Metal Loss","corrosion":"Metal Loss",
    "external metal":"Metal Loss","internal metal loss":"Metal Loss",
    "anom":"Metal Loss","cocl":"Metal Loss","corr":"Metal Loss",
    "metal loss cluster":"Metal Loss","cluster corrosion":"Metal Loss",
    "pipe mill anomaly":"Metal Loss",
    "dent":"Dent","dent part":"Dent","denp":"Dent","mechanical damage":"Dent",
    "anode":"Anode","anod":"Anode","sacrificial anode":"Anode",
    "offtake":"Offtake","offtake tap":"Offtake","offtake tee":"Offtake",
    "offt":"Offtake","off take":"Offtake",
    "comp":"Fitting","full circle fitting":"Fitting","repair shell":"Fitting",
    "fitting":"Fitting","repa":"Fitting","clamp":"Fitting",
    "sleeve begin":"Fitting","sleeve end":"Fitting",
    "tee":"Tee","field tee":"Tee",
    "flange":"Flange","joint flange":"Flange",
    "support":"Support","external support":"Support","attachment":"Support",
    "marker":"Marker","above ground marker":"Marker","agm":"Marker",
    "data recording begin":"Recording","data recording end":"Recording",
    "othe":"Other","other":"Other","pipeline fixture":"Other",
}

SURFACE_NORMALIZATION = {
    "internal":"Internal","int":"Internal","midwall":"Internal",
    "mid-wall":"Internal","mid wall":"Internal","inside":"Internal",
    "external":"External","ext":"External","non-internal":"External",
    "non internal":"External","outer":"External","outside":"External",
}

# ── HIERARCHY OF CERTAINTY (5 Tier) ────────────────────────────────────────────
MATCH_PRIORITY = [
    "Valve", "Tee",           # Tier 1 — Absolute Anchor
    "Weld",                    # Tier 2 — Skeleton
    "Bend",                    # Tier 3 — Topology
    "Anode", "Offtake", "Flange", "Fitting", "Marker", "Support",  # Tier 4
    "Metal Loss", "Dent",      # Tier 5 — Assessment (paling dinamis)
    "Recording", "Other",
]

TIER_LABEL = {
    "Valve": 1, "Tee": 1,
    "Weld": 2,
    "Bend": 3,
    "Anode": 4, "Offtake": 4, "Flange": 4, "Fitting": 4, "Marker": 4, "Support": 4,
    "Metal Loss": 5, "Dent": 5,
    "Recording": 6, "Other": 6,
}

LANDMARK_TYPES = {"Valve", "Weld", "Tee"}
ANOMALY_TYPES  = {"Metal Loss", "Dent"}


# ══════════════════════════════════════════════════════════════════════════════════
#  TOLERANSI & BOBOT
# ══════════════════════════════════════════════════════════════════════════════════

ODO_TOLERANCE_FIXED = {
    "Valve":    ( 50.0, 100.0, 200.0, 300.0),
    "Tee":      (  8.0,  15.0,  25.0,  35.0),
    "Bend":     (  5.0,  12.0,  20.0,  30.0),
    "Weld":     (  2.0,   4.0,   6.0,   8.0),
    "Anode":    (  4.0,   8.0,  12.0,  18.0),
    "Offtake":  (  8.0,  15.0,  25.0,  35.0),
    "Flange":   (  8.0,  15.0,  25.0,  35.0),
    "Fitting":  ( 10.0,  20.0,  35.0,  50.0),
    "Marker":   ( 30.0,  60.0, 100.0, 150.0),
    "Support":  (  8.0,  15.0,  25.0,  35.0),
    "Recording":( 8.0,  15.0,  25.0,  35.0),
    "Other":    ( 10.0,  20.0,  35.0,  50.0),
}

# Valve: radius sangat besar (Absolute Ground Truth, odometer bisa drift jauh)
VALVE_MATCH_TOL = 300.0

ANOMALY_ODO_PCT   = (0.0, 0.01, 0.02, 0.03)
ANOMALY_ODO_ABS   = 0.5
ANOMALY_ODO_MIN   = {1: 1.0, 2: 2.0, 3: 3.0}
ANOMALY_ODO_CAP   = {1: 15.0, 2: 25.0, 3: 35.0}

# Joint-centric: radius anomali = 20% dari panjang joint (min 0.3m, maks 3.0m)
JOINT_CENTRIC_ODO_SCALE = 0.20

CLOCK_HARD_GATE = {
    "tight":  20.0,
    "medium": 30.0,
    "loose":  45.0,
    "super":  60.0,
}

CLOCK_GATE_TYPES   = {"Metal Loss", "Dent"}
SURFACE_GATE_TYPES = {"Metal Loss", "Dent"}

W = {
    "gw_max_penalty_m":          3.0,
    "clock_max_penalty_m":       2.0,
    "depth_max_penalty_m":       1.5,
    "length_max_penalty_m":      1.0,
    "width_max_penalty_m":       0.5,
    "joint_length_match_bonus":  0.5,   # Bonus jika panjang joint sangat mirip
}
PENALTY = 99999.0

# Physics Validation Thresholds
GROWTH_DEPTH_SUSPECT_DECREASE = 30.0
GROWTH_DEPTH_IMPOSSIBLE       = 50.0
CLOCK_SHIFT_NEIGHBOR_WINDOW   = 5
CLOCK_SHIFT_OUTLIER_THRESHOLD = 45.0
OTA_PCT = 1.5

def update_tolerances(clock_tol=None, gw_tol=None, depth_max=None, ota_pct=None):
    global CLOCK_HARD_GATE, W, GROWTH_DEPTH_IMPOSSIBLE, ANOMALY_ODO_PCT, OTA_PCT
    if clock_tol is not None:
        CLOCK_HARD_GATE["tight"] = float(clock_tol) * 0.5
        CLOCK_HARD_GATE["medium"] = float(clock_tol)
        CLOCK_HARD_GATE["loose"] = float(clock_tol) * 1.5
        CLOCK_HARD_GATE["super"] = float(clock_tol) * 2.0
    if gw_tol is not None:
        W["gw_max_penalty_m"] = float(gw_tol)
    if depth_max is not None:
        GROWTH_DEPTH_IMPOSSIBLE = float(depth_max)
    if ota_pct is not None:
        OTA_PCT = float(ota_pct)
        val = OTA_PCT / 100.0
        ANOMALY_ODO_PCT = (0.0, val*0.5, val, val*1.5)
# ══════════════════════════════════════════════════════════════════════════════════
