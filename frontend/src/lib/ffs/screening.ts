import { evaluateB31g, type B31gGeometry } from './b31g.ts';
import type {
  FfsAction,
  FfsCluster,
  FfsConfig,
  FfsInteractionPair,
  FfsPriority,
  FfsResult,
  FfsScreenedResult,
  FfsScreeningConfig,
  FfsSeverity,
  FfsTier,
} from './types.ts';
import { analysisHorizonYears, formatLifeProjection, lifeSortValue } from './lifeProjection.ts';

/** Features closer together than this along the pipeline form one location zone. */
const CLUSTER_GAP_M = 10;
/** Depth at or above which a feature is treated as severe regardless of ERF. */
const SEVERE_DEPTH_PCT = 70;
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function geometryOf(nominal: FfsResult): B31gGeometry {
  return {
    wallThickness: nominal.wall,
    outerDiameter: nominal.od,
    smysMpa: nominal.smys,
    designFactor: nominal.df,
    operatingPressureMpa: nominal.p0,
  };
}

/**
 * The growth rate a tier should be projected with.
 *
 * Under the `measured` basis this is the feature's own reported depth rate, so
 * the forecast and the remaining-life search sit on the same footing as the
 * nominal expected life. The configured rate is the fallback for features whose
 * run pair produced no usable growth, and the single rate under `uniform`.
 */
export function growthRateFor(nominal: FfsResult, screening: FfsScreeningConfig): number {
  if (screening.growthBasis === 'uniform') return screening.growthRateMmPerYear;
  return nominal.crDepth > 0 ? nominal.crDepth : screening.growthRateMmPerYear;
}

/**
 * Evaluates B31G at an arbitrary depth and length through the shared kernel, so
 * every screening tier is the same maths as the nominal code result.
 */
function evaluateTier(
  depthPct: number,
  lengthMm: number,
  nominal: FfsResult,
  config: FfsConfig,
  screening: FfsScreeningConfig,
  growthRateMmPerYear: number,
): FfsTier {
  const safeDepthPct = clamp(depthPct, 0, 99.5);
  const dMm = (safeDepthPct / 100) * nominal.wall;
  const safeLength = Math.max(0.001, lengthMm);
  const result = evaluateB31g(dMm, safeLength, geometryOf(nominal), config.method, config.modifiedSa);

  return {
    depthPct: safeDepthPct,
    lengthMm: safeLength,
    dMm,
    z: result.z,
    M: result.foliasFactor,
    sflow: result.flowStressMpa,
    Sf: result.failureStressMpa,
    Pf: result.failurePressureMpa,
    safePressure: result.safePressureMpa,
    ERF: result.erf,
    severity: severityOf(result.erf, safeDepthPct, screening),
    beyondDepthLimit: result.beyondDepthLimit,
    growthRateMmPerYear,
  };
}

export function severityOf(
  erf: number,
  depthPct: number,
  screening: FfsScreeningConfig,
): FfsSeverity {
  // ERF 1.0 is the safe-pressure limit itself, not a margin — it fails, which is
  // also what the nominal acceptance column says.
  if (!Number.isFinite(erf) || erf >= 1 || depthPct >= screening.depthRejectionPct) return 'fail';
  if (erf >= screening.reviewBandErf) return 'review';
  return 'pass';
}

/**
 * Parses an ILI clock string ("5:30", "05:16:00") into a decimal hour.
 * Returns null when the value is absent or unparseable.
 */
export function parseClockHour(orient: string | undefined): number | null {
  if (!orient) return null;
  const parts = String(orient).trim().split(':');
  if (parts.length < 2) return null;
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = parts.length > 2 ? Number(parts[2]) : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  const decimal = (hours % 12) + minutes / 60 + (Number.isFinite(seconds) ? seconds / 3600 : 0);
  return Number.isFinite(decimal) ? decimal : null;
}

/**
 * Years until the tolerance-adjusted feature reaches ERF 1.0, found by
 * bisection on the forecast depth. The numerical search is bounded by the
 * assessment horizon and never becomes a service-life claim.
 */
function findLifeToErf1(
  nominal: FfsResult,
  config: FfsConfig,
  screening: FfsScreeningConfig,
  growth: number,
): Pick<FfsScreenedResult, 'lifeToErf1' | 'lifeToErf1Status'> {
  const horizonYears = analysisHorizonYears(config);
  const baseDepth = nominal.maxDepthPct + screening.depthTolerancePct;
  const length = nominal.length + 2 * screening.lengthToleranceMm;

  const erfAtYear = (years: number) => {
    const depthPct = baseDepth + ((growth * years) / nominal.wall) * 100;
    return evaluateTier(depthPct, length, nominal, config, screening, growth).ERF;
  };

  if (erfAtYear(0) >= 1) return { lifeToErf1: 0, lifeToErf1Status: 'calculated' };
  if (growth <= 0) return { lifeToErf1: null, lifeToErf1Status: 'insufficient-growth-basis' };
  if (erfAtYear(horizonYears) < 1) {
    return { lifeToErf1: null, lifeToErf1Status: 'not-reached-within-horizon' };
  }

  let lo = 0;
  let hi = horizonYears;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (erfAtYear(mid) >= 1) hi = mid;
    else lo = mid;
  }
  return { lifeToErf1: Math.round(hi * 100) / 100, lifeToErf1Status: 'calculated' };
}

function derivePriority(
  nominal: FfsResult,
  conservative: FfsTier,
  forecast: FfsTier,
  lifeToErf1: number | null,
  screening: FfsScreeningConfig,
): FfsPriority {
  if (conservative.ERF > 1 || forecast.ERF > 1) return 'High';
  if (nominal.maxDepthPct >= SEVERE_DEPTH_PCT) return 'High';
  if (conservative.ERF >= screening.reviewBandErf) return 'High';
  if (nominal.maxDepthPct >= 50 || (lifeToErf1 !== null && lifeToErf1 < 10)) return 'Medium';
  return 'Routine';
}

/**
 * Layers the conservative screen, the degradation forecast, and the derived
 * engineering fields onto each nominal B31G result.
 */
export function screenResults(
  results: FfsResult[],
  config: FfsConfig,
  screening: FfsScreeningConfig,
): FfsScreenedResult[] {
  return results.map((nominal, index) => {
    const growth = growthRateFor(nominal, screening);
    const conservativeDepth = nominal.maxDepthPct + screening.depthTolerancePct;
    const conservativeLength = nominal.length + 2 * screening.lengthToleranceMm;
    const conservative = evaluateTier(conservativeDepth, conservativeLength, nominal, config, screening, growth);

    const grownDepth = conservativeDepth + ((growth * screening.forecastYears) / nominal.wall) * 100;
    const grownLength = conservativeLength + nominal.crLength * screening.forecastYears;
    const forecast = evaluateTier(grownDepth, grownLength, nominal, config, screening, growth);

    const lifeProjection = findLifeToErf1(nominal, config, screening, growth);
    const clockHour = parseClockHour(nominal.orient);

    return {
      key: `${nominal.section}|${nominal.ld}|${index}`,
      index,
      nominal,
      conservative,
      forecast,
      ...lifeProjection,
      priority: derivePriority(nominal, conservative, forecast, lifeProjection.lifeToErf1, screening),
      clockHour,
      bottomQuadrant: clockHour !== null && clockHour >= 4 && clockHour <= 8,
    };
  });
}

function numericLd(item: FfsScreenedResult): number {
  const value = Number(item.nominal.ld);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Groups features whose adjacent log-distance gaps are within CLUSTER_GAP_M.
 * This is a spatial grouping for inspection planning, not a defect-interaction
 * calculation.
 */
export function buildClusters(items: FfsScreenedResult[]): FfsCluster[] {
  const sorted = [...items].sort((a, b) => numericLd(a) - numericLd(b));
  const clusters: FfsCluster[] = [];
  let current: FfsScreenedResult[] = [];

  const flush = () => {
    if (current.length > 1) {
      clusters.push({
        id: `zone-${clusters.length + 1}`,
        members: current,
        startLd: numericLd(current[0]),
        endLd: numericLd(current[current.length - 1]),
        worstErf: Math.max(...current.map((item) => item.conservative.ERF)),
      });
    }
    current = [];
  };

  for (const item of sorted) {
    if (!current.length || numericLd(item) - numericLd(current[current.length - 1]) <= CLUSTER_GAP_M) {
      current.push(item);
    } else {
      flush();
      current = [item];
    }
  }
  flush();
  return clusters;
}

/**
 * Pairwise axial edge-to-edge gap screen against the configured t-multiple.
 * A simplified screen — it does not replace a full colony assessment.
 */
export function findInteractions(
  items: FfsScreenedResult[],
  screening: FfsScreeningConfig,
): FfsInteractionPair[] {
  const sorted = [...items].sort((a, b) => numericLd(a) - numericLd(b));
  const pairs: FfsInteractionPair[] = [];
  // The scan can only stop once the centre gap clears the *longest* feature in
  // the population. Cutting off on the current pair's lengths skipped a long
  // downstream anomaly whose near edge still fell inside the threshold.
  const longestMm = sorted.reduce((max, item) => Math.max(max, item.nominal.length), 0);

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const thresholdMm = screening.interactionSpacingFactor * a.nominal.wall;
    const scanLimitMm = thresholdMm + (a.nominal.length + longestMm) / 2;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const centerGapMm = (numericLd(b) - numericLd(a)) * 1000;
      if (centerGapMm > scanLimitMm) break;
      const edgeGapMm = centerGapMm - (a.nominal.length + b.nominal.length) / 2;
      if (edgeGapMm <= thresholdMm) {
        pairs.push({ a, b, edgeGapMm, thresholdMm });
      }
    }
  }
  return pairs;
}

const PRIORITY_RANK: Record<FfsPriority, number> = { High: 3, Medium: 2, Routine: 1 };

/**
 * Turns assessment output into a ranked, dated action register. The wording is
 * screening guidance — the governing company procedure still sets final action.
 */
export function buildActionRegister(
  items: FfsScreenedResult[],
  screening: FfsScreeningConfig,
  limit = 12,
): FfsAction[] {
  const ranked = [...items].sort(
    (a, b) =>
      PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
      b.conservative.ERF - a.conservative.ERF,
  );

  return ranked.slice(0, limit).map((target, i) => {
    let recommendation: string;
    let due: string;

    if (target.conservative.ERF > 1) {
      recommendation =
        'Apply operating-pressure control and raise an approved repair or detailed FFS assessment.';
      due = 'Immediate';
    } else if (target.nominal.maxDepthPct >= SEVERE_DEPTH_PCT) {
      recommendation =
        'Validate depth and morphology by excavation or NDE; confirm coating, CP, and local environment.';
      due = '0-3 months';
    } else if (target.lifeToErf1 !== null && target.lifeToErf1 < 10) {
      recommendation =
        'Confirm the corrosion growth rate and set a reassessment date before the capacity limit is reached.';
      due = 'Under 6 months';
    } else if (target.conservative.ERF >= screening.reviewBandErf) {
      recommendation =
        'Independent review of ILI tolerances and feature association; confirm the pressure margin.';
      due = 'Engineering review';
    } else {
      recommendation = 'Retain in the monitoring plan and correlate with CP, coating, and the next ILI.';
      due = 'Planned';
    }

    return {
      code: `ACT-${String(i + 1).padStart(2, '0')}`,
      target,
      priority: target.priority,
      recommendation,
      due,
    };
  });
}

export interface FfsKpiSet {
  maxNominalErf: FfsScreenedResult | null;
  maxConservativeErf: FfsScreenedResult | null;
  maxForecastErf: FfsScreenedResult | null;
  minLife: FfsScreenedResult | null;
  escalatedCount: number;
  bottomQuadrantCount: number;
  totalCount: number;
}

export function buildKpis(items: FfsScreenedResult[]): FfsKpiSet {
  if (!items.length) {
    return {
      maxNominalErf: null,
      maxConservativeErf: null,
      maxForecastErf: null,
      minLife: null,
      escalatedCount: 0,
      bottomQuadrantCount: 0,
      totalCount: 0,
    };
  }

  const byNominal = [...items].sort((a, b) => b.nominal.ERF - a.nominal.ERF);
  const byConservative = [...items].sort((a, b) => b.conservative.ERF - a.conservative.ERF);
  const byForecast = [...items].sort((a, b) => b.forecast.ERF - a.forecast.ERF);
  const byLife = items
    .filter((item) => item.lifeToErf1Status === 'calculated')
    .sort((a, b) => lifeSortValue(a.lifeToErf1) - lifeSortValue(b.lifeToErf1));

  return {
    maxNominalErf: byNominal[0],
    maxConservativeErf: byConservative[0],
    maxForecastErf: byForecast[0],
    minLife: byLife[0] ?? null,
    escalatedCount: items.filter((item) => item.conservative.severity !== 'pass').length,
    bottomQuadrantCount: items.filter((item) => item.bottomQuadrant).length,
    totalCount: items.length,
  };
}

export function formatLife(
  years: number | null,
  status: FfsScreenedResult['lifeToErf1Status'],
  horizonYears: number,
): string {
  return formatLifeProjection(years, status, horizonYears);
}
