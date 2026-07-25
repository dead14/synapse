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

/** Features closer together than this along the pipeline form one location zone. */
const CLUSTER_GAP_M = 10;
/** Depth at or above which a feature is treated as severe regardless of ERF. */
const SEVERE_DEPTH_PCT = 70;
/** Upper bound for the life-to-ERF-1 search, in years. */
const LIFE_SEARCH_MAX_YEARS = 200;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Evaluates B31G at an arbitrary depth and length. Mirrors calcEngine but is
 * parameterised on dimensions so the same maths drives every screening tier.
 */
function evaluateTier(
  depthPct: number,
  lengthMm: number,
  nominal: FfsResult,
  config: FfsConfig,
  screening: FfsScreeningConfig,
): FfsTier {
  const { wall, od, smys, df, So } = nominal;
  const safeDepthPct = clamp(depthPct, 0, 99.5);
  const dMm = (safeDepthPct / 100) * wall;
  const safeLength = Math.max(0.001, lengthMm);
  const dt = dMm / wall;
  const z = (safeLength * safeLength) / (od * wall);

  let M: number | null;
  let sflow: number;
  let Sf: number;

  if (config.method === 'original') {
    sflow = 1.1 * smys;
    if (z <= 20) {
      M = Math.sqrt(1 + 0.8 * z);
      const num = 1 - (2 / 3) * dt;
      const den = 1 - (2 / 3) * (dt / M);
      Sf = den > 0 && num > 0 ? (sflow * num) / den : 0;
    } else {
      M = null;
      Sf = sflow * (1 - dt);
    }
  } else {
    sflow = config.modifiedSa === 'smys11' ? 1.1 * smys : smys + 69;
    if (z <= 50) {
      M = Math.sqrt(Math.max(1, 1 + 0.6275 * z - 0.003375 * z * z));
    } else {
      M = 0.032 * z + 3.3;
    }
    const num = 1 - 0.85 * dt;
    const den = 1 - (0.85 * dt) / M;
    Sf = den > 0 && num > 0 ? (sflow * num) / den : 0;
  }

  const Pf = (2 * Sf * wall) / od;
  const safePressure = Pf * df;
  // A collapsed remaining-strength term means the feature has no capacity left.
  const ERF = Sf > 0 ? So / (Sf * df) : Number.POSITIVE_INFINITY;

  return {
    depthPct: safeDepthPct,
    lengthMm: safeLength,
    dMm,
    z,
    M,
    sflow,
    Sf,
    Pf,
    safePressure,
    ERF,
    severity: severityOf(ERF, safeDepthPct, screening),
  };
}

export function severityOf(
  erf: number,
  depthPct: number,
  screening: FfsScreeningConfig,
): FfsSeverity {
  if (!Number.isFinite(erf) || erf > 1 || depthPct >= screening.depthRejectionPct) return 'fail';
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
 * bisection on the forecast depth. Infinity when it never gets there.
 */
function findLifeToErf1(
  nominal: FfsResult,
  config: FfsConfig,
  screening: FfsScreeningConfig,
): number {
  const growth = screening.growthRateMmPerYear;
  const baseDepth = nominal.maxDepthPct + screening.depthTolerancePct;
  const length = nominal.length + 2 * screening.lengthToleranceMm;

  const erfAtYear = (years: number) => {
    const depthPct = baseDepth + ((growth * years) / nominal.wall) * 100;
    return evaluateTier(depthPct, length, nominal, config, screening).ERF;
  };

  if (erfAtYear(0) >= 1) return 0;
  if (growth <= 0) return Number.POSITIVE_INFINITY;
  if (erfAtYear(LIFE_SEARCH_MAX_YEARS) < 1) return Number.POSITIVE_INFINITY;

  let lo = 0;
  let hi = LIFE_SEARCH_MAX_YEARS;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (erfAtYear(mid) >= 1) hi = mid;
    else lo = mid;
  }
  return Math.round(hi * 100) / 100;
}

function derivePriority(
  nominal: FfsResult,
  conservative: FfsTier,
  forecast: FfsTier,
  lifeToErf1: number,
  screening: FfsScreeningConfig,
): FfsPriority {
  if (conservative.ERF > 1 || forecast.ERF > 1) return 'High';
  if (nominal.maxDepthPct >= SEVERE_DEPTH_PCT) return 'High';
  if (conservative.ERF >= screening.reviewBandErf) return 'High';
  if (nominal.maxDepthPct >= 50 || lifeToErf1 < 10) return 'Medium';
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
    const conservativeDepth = nominal.maxDepthPct + screening.depthTolerancePct;
    const conservativeLength = nominal.length + 2 * screening.lengthToleranceMm;
    const conservative = evaluateTier(conservativeDepth, conservativeLength, nominal, config, screening);

    const grownDepth =
      conservativeDepth + ((screening.growthRateMmPerYear * screening.forecastYears) / nominal.wall) * 100;
    const grownLength = conservativeLength + nominal.crLength * screening.forecastYears;
    const forecast = evaluateTier(grownDepth, grownLength, nominal, config, screening);

    const lifeToErf1 = findLifeToErf1(nominal, config, screening);
    const clockHour = parseClockHour(nominal.orient);

    return {
      key: `${nominal.section}|${nominal.ld}|${index}`,
      index,
      nominal,
      conservative,
      forecast,
      lifeToErf1,
      priority: derivePriority(nominal, conservative, forecast, lifeToErf1, screening),
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

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const thresholdMm = screening.interactionSpacingFactor * a.nominal.wall;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const centerGapMm = (numericLd(b) - numericLd(a)) * 1000;
      const halfLengths = (a.nominal.length + b.nominal.length) / 2;
      // Once the centre gap clears the widest possible interacting span, every
      // later feature is further still — stop scanning this anchor.
      if (centerGapMm - halfLengths > thresholdMm) break;
      const edgeGapMm = centerGapMm - halfLengths;
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
    } else if (target.lifeToErf1 < 10) {
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
  const byLife = [...items].sort((a, b) => a.lifeToErf1 - b.lifeToErf1);

  return {
    maxNominalErf: byNominal[0],
    maxConservativeErf: byConservative[0],
    maxForecastErf: byForecast[0],
    minLife: byLife[0],
    escalatedCount: items.filter((item) => item.conservative.severity !== 'pass').length,
    bottomQuadrantCount: items.filter((item) => item.bottomQuadrant).length,
    totalCount: items.length,
  };
}

export function formatLife(years: number): string {
  if (!Number.isFinite(years)) return '>200 y';
  if (years >= 200) return '>200 y';
  if (years < 0.1) return 'Now';
  return `${years.toFixed(1)} y`;
}
