"""ASME B31G (Original + Modified) remaining-strength math.

A port of the production frontend kernel in `frontend/src/lib/ffs/b31g.ts` and
its remnant-life layer in `frontend/src/lib/ffs/remnantLife.ts`. The corrosion
assessment report is generated here, in Python; the FFS module calculates in
TypeScript. Two implementations of one standard is a liability unless they are
pinned together, so both halves are asserted against the same golden vectors
(`backend/tests/test_b31g_parity.py` and `frontend/tests/ffsB31gParity.test.ts`)
and those vectors are generated from the TypeScript engine rather than typed by
hand. Change one implementation only together with the other.

Four things in the earlier draft of this file no longer match the TypeScript
side, and each was a real difference in the numbers rather than a style choice:

  * `ERF = S₀ / (S_F · F)` and `P_safe = P_F · F` assume the safety factor is
    always the reciprocal of the design factor. It is not: para. 1.9 asks for
    the ratio of the minimum hydrostatic test pressure to the MAOP, which the
    assessment can supply directly. The kernel divides by that factor.
  * The Modified flow-stress uplift is 10 ksi, which is 68.9476 MPa. Writing 69
    moved the failure stress by about 0.05 MPa on every feature.
  * A feature with no remaining strength carried `ERF = 1e9`. A sentinel that
    large is a real number to every chart and sort that touches it.
  * Remnant life was capped at 200 years and reported as the string
    "N/A (≥200yr)", which reads as a service-life claim. The limit is either
    reached inside the analysis horizon and reported exactly, or it is not
    reached and reported as such.
"""

import math

# The Modified B31G flow-stress uplift is defined as SMYS + 10 ksi. Carried at
# the converted precision, not rounded to 69 MPa.
KSI_TO_MPA = 6.894757293168689
MODIFIED_FLOW_STRESS_UPLIFT_MPA = 10 * KSI_TO_MPA

# ASME B31G-2023 para. 2.2(a) states the Original branch as z ≤ 20 and z > 20.
ORIGINAL_Z_CUTOFF = 20
# Modified B31G switches from the polynomial to the linear Folias factor here.
MODIFIED_Z_CUTOFF = 50

# The 80 %WT line. A project rejection threshold, not an applicability limit of
# B31G: para. 1.2(f) admits metal loss of any depth, asking only that the sizing
# accuracy and the effective corrosion rate be justified above it.
DEPTH_LIMIT_RATIO = 0.80

# Bounded projection window. This is a numerical boundary on the search, not a
# statement about pipeline service life, and a limit beyond it is reported as
# not reached rather than extrapolated.
DEFAULT_HORIZON_YEARS = 30
BISECTION_STEPS = 60


def _round2(value):
    """Round half away from zero, matching the TypeScript `Math.round(x*100)/100`."""
    return math.floor(value * 100 + 0.5) / 100


def flow_stress(smys_mpa, method, sa_mode):
    """Flow stress for the method and, for Modified B31G, its stress basis."""
    if method == "original":
        return 1.1 * smys_mpa
    if sa_mode == "smys11":
        return 1.1 * smys_mpa
    return smys_mpa + MODIFIED_FLOW_STRESS_UPLIFT_MPA


def normalized_length(length_mm, od_mm, wall_mm):
    """z = L² / (D·t)."""
    return (length_mm * length_mm) / (od_mm * wall_mm)


def folias_factor(z, method):
    """Bulging factor for the branch z falls in. None where the branch drops it."""
    if method == "original":
        return math.sqrt(1 + 0.8 * z) if z <= ORIGINAL_Z_CUTOFF else None
    if z <= MODIFIED_Z_CUTOFF:
        return math.sqrt(max(1.0, 1 + 0.6275 * z - 0.003375 * z * z))
    return 0.032 * z + 3.3


def area_shape_factor(method, z):
    """2/3 parabolic for Original short, 1 for Original long, 0.85 for Modified."""
    if method == "original":
        return 2 / 3 if z <= ORIGINAL_Z_CUTOFF else 1
    return 0.85


def branch_label(method, z):
    if method == "original":
        return "z≤20" if z <= ORIGINAL_Z_CUTOFF else "z>20"
    return "z≤50" if z <= MODIFIED_Z_CUTOFF else "z>50"


def _collapsed(branch, depth_ratio, z, folias, flow, hoop, reason):
    return {
        "branch": branch,
        "dt": depth_ratio,
        "depthPct": depth_ratio * 100,
        "z": z,
        "M": folias,
        "sflow": flow,
        "Sf": 0.0,
        "Pf": 0.0,
        "safePressure": 0.0,
        "so": hoop,
        "ERF": math.inf,
        "valid": False,
        "invalidReason": reason,
        "beyondDepthLimit": depth_ratio > DEPTH_LIMIT_RATIO,
    }


def evaluate(depth_mm, length_mm, wall_mm, od_mm, smys_mpa, safety_factor,
             pressure_mpa, method, sa_mode="smys69"):
    """Evaluate B31G for one depth/length pair. Never raises.

    `pressure_mpa` is the pressure the ERF is referenced to — MAOP for the
    corrosion assessment report, the required assessment pressure in the FFS
    module. `safety_factor` is the divisor between failure and safe pressure.
    """
    flow = flow_stress(smys_mpa, method, sa_mode)
    hoop = (pressure_mpa * od_mm) / (2 * wall_mm) if wall_mm else math.inf
    depth_ratio = depth_mm / wall_mm if wall_mm else math.inf

    finite = all(
        isinstance(v, (int, float)) and math.isfinite(v)
        for v in (wall_mm, od_mm, smys_mpa, safety_factor, pressure_mpa, depth_mm, length_mm)
    )
    if not finite or wall_mm <= 0 or od_mm <= 0 or length_mm <= 0 or safety_factor <= 0:
        return _collapsed("z≤50", depth_ratio, 0.0, None, flow, hoop,
                          "Geometry is missing or not usable")

    z = normalized_length(length_mm, od_mm, wall_mm)
    branch = branch_label(method, z)
    folias = folias_factor(z, method)

    if depth_ratio >= 1:
        return _collapsed(branch, depth_ratio, z, folias, flow, hoop,
                          "Metal loss reaches the full wall thickness")

    shape = area_shape_factor(method, z)
    area_ratio = shape * depth_ratio
    # The rectangular Original branch has no Folias term; the others divide by it.
    denominator = 1.0 if folias is None else 1 - area_ratio / folias
    numerator = 1 - area_ratio

    if denominator <= 0 or numerator <= 0:
        return _collapsed(branch, depth_ratio, z, folias, flow, hoop,
                          "No remaining strength at this depth and length")

    failure_stress = (flow * numerator) / denominator
    failure_pressure = (2 * failure_stress * wall_mm) / od_mm
    safe_pressure = failure_pressure / safety_factor
    erf = pressure_mpa / safe_pressure if safe_pressure > 0 else math.inf

    return {
        "branch": branch,
        "dt": depth_ratio,
        "depthPct": depth_ratio * 100,
        "z": z,
        "M": folias,
        "sflow": flow,
        "Sf": failure_stress,
        "Pf": failure_pressure,
        "safePressure": safe_pressure,
        "so": hoop,
        "ERF": erf,
        "valid": True,
        "invalidReason": None,
        "beyondDepthLimit": depth_ratio > DEPTH_LIMIT_RATIO,
    }


def safety_factor_from_design_factor(design_factor):
    """Historic B31G practice and the basis of the Level 0 tables: SF = 1/F.

    Only correct while the line actually operates at its design hoop stress.
    """
    return 1 / design_factor if design_factor > 0 else math.inf


def _years_to_depth_limit(start_depth_pct, wall_mm, depth_rate_mm_yr):
    """Years until metal loss reaches 80 % of the nominal wall."""
    start_mm = (start_depth_pct / 100) * wall_mm
    limit_mm = DEPTH_LIMIT_RATIO * wall_mm
    if start_mm >= limit_mm:
        return 0.0
    if not depth_rate_mm_yr > 0:
        return math.inf
    return (limit_mm - start_mm) / depth_rate_mm_yr


def _years_to_erf_1(start_depth_pct, start_length_mm, wall_mm, od_mm, smys_mpa,
                    safety_factor, pressure_mpa, method, sa_mode,
                    depth_rate_mm_yr, length_rate_mm_yr, horizon_years):
    """Years until ERF reaches 1.0, by bisection on the projected geometry.

    Both dimensions are grown: a flaw that lengthens loses capacity through the
    bulging term even at constant depth. ERF is monotonic in both, so the
    bracket is sound.
    """
    start_mm = (start_depth_pct / 100) * wall_mm

    def erf_at(years):
        return evaluate(
            start_mm + depth_rate_mm_yr * years,
            max(0.001, start_length_mm + length_rate_mm_yr * years),
            wall_mm, od_mm, smys_mpa, safety_factor, pressure_mpa, method, sa_mode,
        )["ERF"]

    if erf_at(0) >= 1:
        return 0.0
    if not depth_rate_mm_yr > 0 and not length_rate_mm_yr > 0:
        return math.inf
    if erf_at(horizon_years) < 1:
        return math.inf

    low, high = 0.0, float(horizon_years)
    for _ in range(BISECTION_STEPS):
        mid = (low + high) / 2
        if erf_at(mid) >= 1:
            high = mid
        else:
            low = mid
    return high


def remnant_life(start_depth_pct, start_length_mm, wall_mm, od_mm, smys_mpa,
                 safety_factor, pressure_mpa, method, sa_mode="smys69",
                 depth_rate_mm_yr=0.0, length_rate_mm_yr=0.0,
                 horizon_years=DEFAULT_HORIZON_YEARS, design_life_years=None,
                 design_life_remaining_years=None):
    """The remnant-life record, mirroring `remnantLife.ts`.

    A limit beyond the analysis horizon is reported as not reached rather than
    extrapolated, and never as a capped number: quoting a figure from outside
    the search window would dress a bisection failure up as a service-life claim.
    """
    raw_depth = _years_to_depth_limit(start_depth_pct, wall_mm, depth_rate_mm_yr)
    raw_erf = _years_to_erf_1(
        start_depth_pct, start_length_mm, wall_mm, od_mm, smys_mpa, safety_factor,
        pressure_mpa, method, sa_mode, depth_rate_mm_yr, length_rate_mm_yr, horizon_years,
    )

    depth_limit_years = _round2(raw_depth) if raw_depth <= horizon_years else None
    erf_limit_years = _round2(raw_erf) if raw_erf <= horizon_years else None
    has_growth_basis = depth_rate_mm_yr > 0 or length_rate_mm_yr > 0

    years = None
    governing_limit = None
    if depth_limit_years is not None or erf_limit_years is not None:
        status = "calculated"
        # A tie goes to the depth limit: it is the project rejection line, so
        # reporting an ERF date past it would quote a number the assessment
        # does not stand behind.
        depth_governs = depth_limit_years is not None and (
            erf_limit_years is None or depth_limit_years <= erf_limit_years
        )
        years = depth_limit_years if depth_governs else erf_limit_years
        governing_limit = "Depth = 80%" if depth_governs else "ERF = 1"
    else:
        status = "not-reached-within-horizon" if has_growth_basis else "insufficient-growth-basis"

    # The residual life assessment is not reported above the design life the
    # line has left at the inspection date. This caps a calculated figure; it
    # never manufactures one.  Mirrors `computeRemnantLife` in remnantLife.ts:
    # comparing against the *total* design life instead of the unconsumed
    # remainder made the rule practically inert on any line more than a few
    # years old, and quoted more life than the design dossier allows wherever it
    # did bind.  Without a commissioning date the caller cannot supply the
    # remainder, and the total stays the only defensible bound.
    cap_years = design_life_remaining_years
    if cap_years is None:
        cap_years = design_life_years
    elif cap_years < 0:
        cap_years = 0.0
    design_life_cap_applied = False
    if cap_years is not None and years is not None and years > cap_years:
        years = _round2(cap_years)
        governing_limit = "Original design life"
        design_life_cap_applied = True

    return {
        "years": years,
        "status": status,
        "governingLimit": governing_limit,
        "depthLimitYears": depth_limit_years,
        "erfLimitYears": erf_limit_years,
        "depthRateMmPerYear": depth_rate_mm_yr,
        "lengthRateMmPerYear": length_rate_mm_yr,
        "lengthHeldConstant": not length_rate_mm_yr > 0,
        "designLifeCapApplied": design_life_cap_applied,
        "analysisHorizonYears": horizon_years,
    }


def assess_feature(method, sa_mode, depth_pct, length_mm, wall_mm, od_mm, smys_mpa,
                   design_factor, pressure_mpa, cr_depth_mm_yr=0.0, cr_length_mm_yr=0.0,
                   safety_factor=None, horizon_years=DEFAULT_HORIZON_YEARS,
                   design_life_years=None, design_life_remaining_years=None):
    """Full screening evaluation for one metal-loss feature.

    `safety_factor` is the para. 1.9 hydrotest-to-MAOP ratio where the
    assessment supplies one. Left None it falls back to the historic 1/F, and
    the return says which of the two was used.
    """
    explicit = safety_factor is not None and safety_factor > 0
    resolved_sf = safety_factor if explicit else safety_factor_from_design_factor(design_factor)

    depth_mm = (depth_pct / 100.0) * wall_mm
    result = evaluate(depth_mm, length_mm, wall_mm, od_mm, smys_mpa, resolved_sf,
                      pressure_mpa, method, sa_mode)
    life = remnant_life(depth_pct, length_mm, wall_mm, od_mm, smys_mpa, resolved_sf,
                        pressure_mpa, method, sa_mode, cr_depth_mm_yr, cr_length_mm_yr,
                        horizon_years, design_life_years, design_life_remaining_years)

    return {
        "depthMm": depth_mm,
        "so": result["so"],
        "z": result["z"],
        "M": result["M"],
        "sflow": result["sflow"],
        "Sf": result["Sf"],
        "Pf": result["Pf"],
        "safePressure": result["safePressure"],
        "ERF": result["ERF"],
        "branch": result["branch"],
        "safetyFactor": resolved_sf,
        "safetyFactorSource": "explicit" if explicit else "derived-from-design-factor",
        "beyondDepthLimit": result["beyondDepthLimit"],
        "valid": result["valid"],
        "invalidReason": result["invalidReason"],
        "remnantLife": life,
    }
