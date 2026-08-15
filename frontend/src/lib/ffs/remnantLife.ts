/**
 * Remnant life — the single place the number is computed.
 *
 * "Expected life" used to mean three different things in this codebase: the
 * nominal engine grew depth *and* length and reported the earlier of the 80 %WT
 * and ERF 1.0 limits; the screening layer grew depth only, on tolerance-adjusted
 * dimensions, and called its answer `lifeToErf1`; and neither honoured the
 * original design life. Two of those numbers sat in the same table under
 * different headings. This module replaces all of it.
 *
 * The result is deliberately a record rather than a bare number: an engineer
 * signing a fitness-for-service report has to be able to say which limit
 * governed, what rates were consumed, whether the axial length was projected or
 * held constant, and whether the design-life rule capped the answer.
 *
 * Two limits come from the remaining-strength code itself:
 *   • depth reaches 80 % of nominal wall — the applicability limit of B31G
 *   • ERF reaches 1.0 — the safe pressure falls to the required pressure
 * The third is a project rule, not a code rule: the residual life assessment is
 * not reported above the original design life of the line.
 */

import {
  B31G_DEPTH_LIMIT_RATIO,
  evaluateB31g,
  type B31gGeometry,
  type B31gMethod,
  type FlowStressMode,
} from './b31g.ts';
import type { FfsLifeStatus } from './types.ts';

/** Which set of dimensions the projection started from. */
export type FfsRemnantLifeBasis = 'as-reported' | 'tolerance-adjusted';

/**
 * Which condition produced the reported figure.
 *
 * `'Depth = 80%'` is a stable identifier, not a label: the depth line it refers
 * to is configurable, and `FfsRemnantLife.depthLimitPct` carries the value that
 * was actually used. Display code must read that field rather than the token.
 */
export type FfsRemnantLimit = 'Depth = 80%' | 'ERF = 1' | 'Original design life';

/** Design-dossier figures. Both are optional; neither is inferred. */
export interface FfsServiceLifeInputs {
  /** Original design life of the line, in years. */
  designLifeYears: number | null;
  /** Commissioning year, used to report consumed design life. */
  commissioningYear: number | null;
}

export const EMPTY_SERVICE_LIFE: FfsServiceLifeInputs = {
  designLifeYears: null,
  commissioningYear: null,
};

export interface FfsRemnantLife {
  basis: FfsRemnantLifeBasis;
  /** Years after the ILI date. Null when no limit is established. */
  years: number | null;
  status: FfsLifeStatus;
  /** The limit that produced `years`. Null when none was reached. */
  governingLimit: FfsRemnantLimit | null;
  /** Calendar date the governing limit is reached, or null. */
  dueDateIso: string | null;
  /** Years to the depth rejection line; null when depth growth never reaches it. */
  depthLimitYears: number | null;
  /** The depth rejection line this projection measured to, as % of wall. */
  depthLimitPct: number;
  /** Years to ERF 1.0; null when the ratio never reaches it inside the horizon. */
  erfLimitYears: number | null;
  /** Depth this basis started from, as % of wall. */
  startDepthPct: number;
  /** Axial length this basis started from, in mm. */
  startLengthMm: number;
  depthRateMmPerYear: number;
  lengthRateMmPerYear: number;
  /**
   * True when no length growth rate was established and the axial length was
   * carried forward unchanged. The ERF limit is then non-conservative in the
   * length direction and the report has to say so.
   */
  lengthHeldConstant: boolean;
  /** True when the original-design-life rule reduced the reported figure. */
  designLifeCapApplied: boolean;
  designLifeYears: number | null;
  analysisHorizonYears: number;
}

export interface FfsRemnantLifeRequest {
  geometry: B31gGeometry;
  method: B31gMethod;
  flowStressMode: FlowStressMode;
  basis: FfsRemnantLifeBasis;
  /** Depth to project from, as % of wall. Tolerance is applied by the caller. */
  startDepthPct: number;
  /** Axial length to project from, in mm. Tolerance is applied by the caller. */
  startLengthMm: number;
  depthRateMmPerYear: number;
  lengthRateMmPerYear: number;
  /** False when the source gave no usable length rate. */
  lengthRateAvailable: boolean;
  horizonYears: number;
  iliDate: Date;
  service: FfsServiceLifeInputs;
  /**
   * The depth, as a fraction of wall, this project rejects at.
   *
   * Defaults to the 80 %WT line. It is configurable because
   * `FfsScreeningConfig.depthRejectionPct` is: an operator who screens at 70 %WT
   * was still getting a remnant life measured to 80 %WT, so the governing limit
   * on the report contradicted the acceptance column beside it.
   */
  depthLimitRatio?: number;
}

/**
 * Bisection steps for the ERF search.
 *
 * Each step halves the bracket, which starts at the analysis horizon. Thirty
 * steps take a 100-year horizon to about 10⁻⁷ years — four decimal places past
 * the second the answer is quoted to, and well past anything the growth rates
 * feeding it could justify. This used to be 60, which bought no accuracy the
 * `round2` below does not immediately discard and doubled the cost of the one
 * calculation the screening layer runs per feature per pass.
 */
const BISECTION_STEPS = 30;

/** Rounds to two decimals, the precision remnant life is quoted at. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Adds a fractional number of years to a date and returns an ISO calendar date. */
export function addYearsIso(date: Date, years: number): string {
  const shifted = new Date(date);
  const whole = Math.floor(years);
  shifted.setFullYear(shifted.getFullYear() + whole);
  shifted.setDate(shifted.getDate() + Math.round((years - whole) * 365.25));
  const year = String(shifted.getFullYear()).padStart(4, '0');
  const month = String(shifted.getMonth() + 1).padStart(2, '0');
  const day = String(shifted.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Years until metal loss reaches 80 % of the nominal wall.
 *
 * Infinity when there is no positive depth growth, because a feature that is
 * not deepening never reaches the limit — that is a real answer, not a missing
 * one, and it is reported separately from "no growth basis".
 */
function yearsToDepthLimit(
  startDepthPct: number,
  wallThickness: number,
  depthRateMmPerYear: number,
  depthLimitRatio: number = B31G_DEPTH_LIMIT_RATIO,
): number {
  const startDepthMm = (startDepthPct / 100) * wallThickness;
  const limitMm = depthLimitRatio * wallThickness;
  if (startDepthMm >= limitMm) return 0;
  if (!(depthRateMmPerYear > 0)) return Number.POSITIVE_INFINITY;
  return (limitMm - startDepthMm) / depthRateMmPerYear;
}

/**
 * Years until ERF reaches 1.0, found by bisection on the projected geometry.
 *
 * Both dimensions are grown: a defect that lengthens loses capacity through the
 * Folias term even at constant depth, which is exactly the case the previous
 * depth-only search under-reported. ERF is monotonic in both, so the bracket is
 * sound.
 */
function yearsToErf1(request: FfsRemnantLifeRequest): number {
  const { geometry, method, flowStressMode, horizonYears } = request;
  const wall = geometry.wallThickness;
  const startDepthMm = (request.startDepthPct / 100) * wall;

  const erfAt = (years: number) =>
    evaluateB31g(
      startDepthMm + request.depthRateMmPerYear * years,
      Math.max(0.001, request.startLengthMm + request.lengthRateMmPerYear * years),
      geometry,
      method,
      flowStressMode,
    ).erf;

  if (erfAt(0) >= 1) return 0;
  if (!(request.depthRateMmPerYear > 0) && !(request.lengthRateMmPerYear > 0)) {
    return Number.POSITIVE_INFINITY;
  }
  if (erfAt(horizonYears) < 1) return Number.POSITIVE_INFINITY;

  let low = 0;
  let high = horizonYears;
  for (let step = 0; step < BISECTION_STEPS; step++) {
    const mid = (low + high) / 2;
    if (erfAt(mid) >= 1) high = mid;
    else low = mid;
  }
  return high;
}

/**
 * The full remnant-life record for one feature on one basis.
 *
 * A limit beyond the analysis horizon is reported as not reached rather than
 * extrapolated: the horizon is a numerical boundary on the search, and quoting
 * a date from outside it would dress a bisection failure up as a service-life
 * claim.
 */
export function computeRemnantLife(request: FfsRemnantLifeRequest): FfsRemnantLife {
  const {
    geometry, basis, horizonYears, iliDate, service,
    startDepthPct, startLengthMm, depthRateMmPerYear, lengthRateMmPerYear,
  } = request;

  const depthLimitRatio = Number.isFinite(request.depthLimitRatio)
    && (request.depthLimitRatio as number) > 0
    && (request.depthLimitRatio as number) <= 1
    ? (request.depthLimitRatio as number)
    : B31G_DEPTH_LIMIT_RATIO;
  const rawDepthLimit = yearsToDepthLimit(
    startDepthPct, geometry.wallThickness, depthRateMmPerYear, depthLimitRatio,
  );
  const rawErfLimit = yearsToErf1(request);

  const depthLimitYears = rawDepthLimit <= horizonYears ? round2(rawDepthLimit) : null;
  const erfLimitYears = rawErfLimit <= horizonYears ? round2(rawErfLimit) : null;

  const hasGrowthBasis = depthRateMmPerYear > 0 || lengthRateMmPerYear > 0;
  const designLifeYears =
    service.designLifeYears !== null && Number.isFinite(service.designLifeYears) && service.designLifeYears > 0
      ? service.designLifeYears
      : null;
  // The cap is on life *remaining* from the inspection, so the comparable
  // figure is the design life still unconsumed at the ILI date — not the total
  // design life the line was built for. Comparing against the total meant a
  // 40-year line inspected in its 36th year was capped at 40 more years, which
  // is no cap at all; and where it did bind it quoted more life than the design
  // dossier allows. Without a commissioning year the consumed share is unknown,
  // so the total is retained as the only defensible bound.
  const usage = designLifeUsage(service, iliDate);
  const designLifeCapYears = designLifeYears === null
    ? null
    : (usage === null ? designLifeYears : Math.max(0, usage.designLifeRemainingYears));

  let years: number | null = null;
  let governingLimit: FfsRemnantLimit | null = null;
  let status: FfsLifeStatus;

  if (depthLimitYears !== null || erfLimitYears !== null) {
    status = 'calculated';
    // A tie goes to the depth limit: it is the applicability boundary of the
    // method, so reporting an ERF date past it would quote a number the code
    // does not stand behind.
    const depthGoverns = depthLimitYears !== null &&
      (erfLimitYears === null || depthLimitYears <= erfLimitYears);
    years = depthGoverns ? depthLimitYears : erfLimitYears;
    governingLimit = depthGoverns ? 'Depth = 80%' : 'ERF = 1';
  } else {
    status = hasGrowthBasis ? 'not-reached-within-horizon' : 'insufficient-growth-basis';
  }

  // The residual life assessment is not reported above the original design life
  // of the line. This caps a calculated figure; it never manufactures one where
  // no limit was reached, because that would turn "we did not find a limit"
  // into a dated service-life claim.
  let designLifeCapApplied = false;
  if (designLifeCapYears !== null && years !== null && years > designLifeCapYears) {
    years = round2(designLifeCapYears);
    governingLimit = 'Original design life';
    designLifeCapApplied = true;
  }

  return {
    basis,
    years,
    status,
    governingLimit,
    dueDateIso: years === null ? null : addYearsIso(iliDate, years),
    depthLimitYears,
    depthLimitPct: depthLimitRatio * 100,
    erfLimitYears,
    startDepthPct,
    startLengthMm,
    depthRateMmPerYear,
    lengthRateMmPerYear,
    lengthHeldConstant: !request.lengthRateAvailable || !(lengthRateMmPerYear > 0),
    designLifeCapApplied,
    designLifeYears,
    analysisHorizonYears: horizonYears,
  };
}

/** Design life consumed at the ILI date, for context beside the remnant figure. */
export interface FfsDesignLifeUsage {
  commissioningYear: number;
  designLifeYears: number;
  /** Decimal years between commissioning and the inspection. */
  ageAtInspectionYears: number;
  /** Design life left at the inspection; negative once the line is past it. */
  designLifeRemainingYears: number;
}

export function designLifeUsage(
  service: FfsServiceLifeInputs,
  iliDate: Date,
): FfsDesignLifeUsage | null {
  const { commissioningYear, designLifeYears } = service;
  if (commissioningYear === null || designLifeYears === null) return null;
  if (!Number.isFinite(commissioningYear) || !Number.isFinite(designLifeYears)) return null;
  if (designLifeYears <= 0) return null;

  const commissioned = new Date(Date.UTC(commissioningYear, 0, 1));
  const ageAtInspectionYears =
    (iliDate.getTime() - commissioned.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  return {
    commissioningYear,
    designLifeYears,
    ageAtInspectionYears: round2(ageAtInspectionYears),
    designLifeRemainingYears: round2(designLifeYears - ageAtInspectionYears),
  };
}
