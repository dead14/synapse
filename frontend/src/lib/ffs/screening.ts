import { evaluateB31g, type B31gGeometry } from './b31g.ts';
import type {
  FfsAction,
  FfsConfig,
  FfsGrowthAnalysisBasis,
  FfsGrowthObservation,
  FfsInteractionPair,
  FfsLifeStatus,
  FfsLocationZone,
  FfsPriority,
  FfsResult,
  FfsScreenedResult,
  FfsScreeningConfig,
  FfsSeverity,
  FfsTier,
} from './types.ts';
import { buildFfsReportCase, type FfsReportContext } from './reportCase.ts';
import { analysisHorizonYears, formatLifeProjection, lifeSortValue } from './lifeProjection.ts';
import { computeRemnantLife, EMPTY_SERVICE_LIFE, type FfsRemnantLife } from './remnantLife.ts';
import { maxBy } from '../../utils/numericRange.ts';

/** Features closer together than this along the pipeline form one location zone. */
const ZONE_GAP_M = 10;
/** Depth at or above which a feature is treated as severe regardless of ERF. */
const SEVERE_DEPTH_PCT = 70;
/**
 * How far downstream the pairwise interaction screen will look, in metres.
 *
 * B31G para. 1.12 interaction spacing is a few wall thicknesses; this bound is
 * two orders of magnitude above that and exists only so a single mis-reported
 * feature length cannot turn the scan into an all-pairs comparison.
 */
const INTERACTION_SCAN_REACH_CAP_M = 5;
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function geometryOf(nominal: FfsResult): B31gGeometry {
  return {
    wallThickness: nominal.wall,
    outerDiameter: nominal.od,
    smysMpa: nominal.smys,
    safetyFactor: nominal.safetyFactor,
    operatingPressureMpa: nominal.p0,
  };
}

/**
 * The growth rate a tier should be projected with.
 *
 * Under the historical `measured` setting this is the feature's source-evidenced
 * depth rate. A reported zero stays zero; the configured rate is only an
 * explicit fallback when the evidence says the source rate is unavailable.
 */
export function growthRateFor(nominal: FfsResult, screening: FfsScreeningConfig): number {
  return growthApplicationFor(nominal, screening).rateMmPerYear;
}

export interface FfsGrowthApplication {
  rateMmPerYear: number;
  observation: FfsGrowthObservation;
  analysisBasis: FfsGrowthAnalysisBasis | 'uniform-assumption';
}

/**
 * Resolves the rate and its provenance together. A zero reported rate remains
 * a reported zero; only an unavailable analysis basis may consume the explicit
 * screening fallback.
 */
export function growthApplicationFor(
  nominal: FfsResult,
  screening: FfsScreeningConfig,
): FfsGrowthApplication {
  const depthEvidence = nominal.growthEvidence?.depth;
  if (screening.growthBasis === 'uniform') {
    return {
      rateMmPerYear: screening.growthRateMmPerYear,
      observation: depthEvidence?.observation ?? 'unavailable',
      analysisBasis: 'uniform-assumption',
    };
  }
  if (depthEvidence?.analysisRateMmPerYear !== null && depthEvidence?.analysisRateMmPerYear !== undefined) {
    return {
      rateMmPerYear: depthEvidence.analysisRateMmPerYear,
      observation: depthEvidence.observation,
      analysisBasis: depthEvidence.analysisBasis,
    };
  }
  if (!depthEvidence && nominal.crDepth > 0) {
    return {
      rateMmPerYear: nominal.crDepth,
      observation: 'manual-reported',
      analysisBasis: 'reported',
    };
  }
  if (screening.growthRateMmPerYear > 0) {
    return {
      rateMmPerYear: screening.growthRateMmPerYear,
      observation: depthEvidence?.observation ?? 'unavailable',
      analysisBasis: 'explicit-fallback',
    };
  }
  return {
    rateMmPerYear: 0,
    observation: depthEvidence?.observation ?? 'unavailable',
    analysisBasis: 'none',
  };
}

/**
 * The axial length growth rate a tier should be projected with.
 *
 * This is the counterpart the depth resolver never had, and its absence is what
 * made the length column untrustworthy in two separate ways. The forecast tier
 * read `nominal.crLength` directly, so switching the growth basis to a uniform
 * assumed rate overrode depth and silently left length on the measured value;
 * and the remaining-life search ignored length entirely, so a defect that was
 * lengthening rather than deepening projected as if it were static.
 *
 * `available` is false when the source established no usable rate. The caller
 * must not read that as a measured zero — it is the difference between "this
 * defect is not getting longer" and "nobody knows whether it is".
 */
export interface FfsLengthApplication {
  rateMmPerYear: number;
  available: boolean;
  observation: FfsGrowthObservation;
  analysisBasis: FfsGrowthAnalysisBasis | 'uniform-assumption';
}

export function lengthApplicationFor(
  nominal: FfsResult,
  screening: FfsScreeningConfig,
): FfsLengthApplication {
  const evidence = nominal.growthEvidence?.length;

  // The uniform basis exists for when the run pair's growth numbers are not
  // trusted. Keeping the measured axial rate while overriding the depth rate
  // would honour that decision in one dimension and quietly ignore it in the
  // other — the exact leak that made the forecast tier inconsistent. The
  // uniform rate is radial and cannot be turned into an axial rate, so length
  // is held constant and the result says so rather than implying a measurement.
  if (screening.growthBasis === 'uniform') {
    return {
      rateMmPerYear: 0,
      available: false,
      observation: evidence?.observation ?? 'unavailable',
      analysisBasis: 'uniform-assumption',
    };
  }

  if (evidence && evidence.analysisRateMmPerYear !== null) {
    return {
      rateMmPerYear: evidence.analysisRateMmPerYear,
      available: true,
      observation: evidence.observation,
      analysisBasis: evidence.analysisBasis,
    };
  }
  // The manual workbook has no evidence record; its column is the engineer's
  // own entry, so a positive value there is a supplied rate.
  if (!evidence && nominal.crLength > 0) {
    return {
      rateMmPerYear: nominal.crLength,
      available: true,
      observation: 'manual-reported',
      analysisBasis: 'reported',
    };
  }
  return {
    rateMmPerYear: 0,
    available: false,
    observation: evidence?.observation ?? 'unavailable',
    analysisBasis: 'none',
  };
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
  growthApplication?: FfsGrowthApplication,
): FfsTier {
  // The kernel has no remaining strength to report past full wall, so the tier
  // is evaluated at 99.5 %WT. A projected depth beyond the wall is a real
  // result, though, and the numbers below then describe a shallower defect than
  // the one requested — so the tier records that it was clamped and what it was
  // asked for, instead of presenting a substituted geometry as the answer.
  const safeDepthPct = clamp(depthPct, 0, 99.5);
  const depthClamped = depthPct > 99.5;
  const dMm = (safeDepthPct / 100) * nominal.wall;
  const safeLength = Math.max(0.001, lengthMm);
  const result = evaluateB31g(dMm, safeLength, geometryOf(nominal), config.method, config.modifiedSa);

  return {
    depthPct: safeDepthPct,
    requestedDepthPct: depthPct,
    depthClamped,
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
    growthObservation: growthApplication?.observation,
    growthAnalysisBasis: growthApplication?.analysisBasis,
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
 * Remnant life recomputed from the tolerance-adjusted dimensions.
 *
 * Same kernel as the as-reported figure — only the starting geometry differs —
 * so the pair reads as one calculation under two assumptions rather than as two
 * unrelated numbers.
 */
function conservativeRemnantLife(
  nominal: FfsResult,
  config: FfsConfig,
  screening: FfsScreeningConfig,
  depthRateMmPerYear: number,
  length: FfsLengthApplication,
): FfsRemnantLife {
  return computeRemnantLife({
    geometry: geometryOf(nominal),
    method: config.method,
    flowStressMode: config.modifiedSa,
    basis: 'tolerance-adjusted',
    startDepthPct: nominal.maxDepthPct + screening.depthTolerancePct,
    startLengthMm: nominal.length + 2 * screening.lengthToleranceMm,
    depthRateMmPerYear,
    lengthRateMmPerYear: length.rateMmPerYear,
    lengthRateAvailable: length.available,
    horizonYears: analysisHorizonYears(config),
    iliDate: config.iliDate,
    service: config.serviceLife ?? EMPTY_SERVICE_LIFE,
    // The same line `severityOf` rejects at. Leaving this on the hard-coded
    // 80 %WT meant a project screening at 70 %WT read "fail" in the acceptance
    // column while the governing limit beside it was still measured to 80.
    depthLimitRatio: screening.depthRejectionPct / 100,
  });
}

function derivePriority(
  nominal: FfsResult,
  conservative: FfsTier,
  forecast: FfsTier,
  remnantYears: number | null,
  screening: FfsScreeningConfig,
): FfsPriority {
  if (conservative.ERF >= 1 || forecast.ERF >= 1) return 'High';
  if (nominal.maxDepthPct >= SEVERE_DEPTH_PCT) return 'High';
  if (conservative.ERF >= screening.reviewBandErf) return 'High';
  if (nominal.maxDepthPct >= 50 || (remnantYears !== null && remnantYears < 10)) return 'Medium';
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
    const growthApplication = growthApplicationFor(nominal, screening);
    const growth = growthApplication.rateMmPerYear;
    const lengthApplication = lengthApplicationFor(nominal, screening);
    const conservativeDepth = nominal.maxDepthPct + screening.depthTolerancePct;
    const conservativeLength = nominal.length + 2 * screening.lengthToleranceMm;
    const conservative = evaluateTier(
      conservativeDepth,
      conservativeLength,
      nominal,
      config,
      screening,
      growth,
      growthApplication,
    );

    const grownDepth = conservativeDepth + ((growth * screening.forecastYears) / nominal.wall) * 100;
    // Resolved through the same layer as depth, so the growth basis governs
    // both dimensions instead of overriding one and leaking the other.
    const grownLength = conservativeLength + lengthApplication.rateMmPerYear * screening.forecastYears;
    const forecast = evaluateTier(
      grownDepth,
      grownLength,
      nominal,
      config,
      screening,
      growth,
      growthApplication,
    );

    const remnantLifeConservative = conservativeRemnantLife(
      nominal,
      config,
      screening,
      growth,
      lengthApplication,
    );
    const clockHour = parseClockHour(nominal.orient);

    return {
      key: nominal.featureId ?? `${nominal.section}|${nominal.ld}|${index}`,
      index,
      nominal,
      conservative,
      forecast,
      remnantLifeConservative,
      priority: derivePriority(
        nominal,
        conservative,
        forecast,
        remnantLifeConservative.years,
        screening,
      ),
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
 * Groups features whose adjacent log-distance gaps are within ZONE_GAP_M.
 *
 * A spatial grouping for inspection planning, not a defect-interaction
 * calculation — and deliberately not called clustering, which in this workspace
 * means a single vendor-merged ILI record. See `FfsInput.isClusteredMetalLoss`.
 */
export function buildLocationZones(items: FfsScreenedResult[]): FfsLocationZone[] {
  const sorted = [...items].sort((a, b) => numericLd(a) - numericLd(b));
  const zones: FfsLocationZone[] = [];
  let current: FfsScreenedResult[] = [];

  const flush = () => {
    if (current.length > 1) {
      zones.push({
        id: `zone-${zones.length + 1}`,
        members: current,
        startLd: numericLd(current[0]),
        endLd: numericLd(current[current.length - 1]),
        worstErf: maxBy(current, (item) => item.conservative.ERF),
      });
    }
    current = [];
  };

  for (const item of sorted) {
    if (!current.length || numericLd(item) - numericLd(current[current.length - 1]) <= ZONE_GAP_M) {
      current.push(item);
    } else {
      flush();
      current = [item];
    }
  }
  flush();
  return zones;
}

/**
 * Circumferential centre-to-centre separation, the short way round the pipe.
 *
 * A clock face is 12 h to the circumference, so one hour is πD/12 of arc. The
 * short way matters: 11:00 and 1:00 are two hours apart, not ten.
 */
export function circumferentialCentreGapMm(
  clockHourA: number,
  clockHourB: number,
  outerDiameterMm: number,
): number {
  const hourGap = Math.abs(clockHourA - clockHourB) % 12;
  const shortest = Math.min(hourGap, 12 - hourGap);
  return (shortest / 12) * Math.PI * outerDiameterMm;
}

/**
 * Pairwise interaction screen against the configured t-multiple.
 *
 * B31G para. 1.12(a) measures the separation of two metal-loss areas both
 * longitudinally and circumferentially; the previous screen only ever looked at
 * the axial gap, so two pits at the same log distance on opposite sides of the
 * pipe were reported as interacting. Both gaps are computed and reported now,
 * and the pair says which of the two brought it into the list.
 *
 * The scan window is still axial, because the ILI record is ordered by distance
 * and two features metres apart are not a colony whatever their clock positions.
 * This remains a screen, not a colony assessment.
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
  //
  // One very long record — a vendor-merged cluster reported at tens of metres —
  // widens that window for every anchor and turns the scan quadratic, so the
  // reach is capped. Anything past the cap is a colony assessment, not a
  // pairwise interaction screen, and the cap is reported rather than silently
  // applied.
  const longestMm = maxBy(sorted, (item) => item.nominal.length);
  const scanReachCapMm = INTERACTION_SCAN_REACH_CAP_M * 1000;
  let truncatedScans = 0;

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const thresholdMm = screening.interactionSpacingFactor * a.nominal.wall;
    const unboundedScanLimitMm = thresholdMm + (a.nominal.length + longestMm) / 2;
    const scanLimitMm = Math.min(unboundedScanLimitMm, scanReachCapMm);
    if (unboundedScanLimitMm > scanReachCapMm) truncatedScans += 1;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const centerGapMm = (numericLd(b) - numericLd(a)) * 1000;
      if (centerGapMm > scanLimitMm) break;
      const edgeGapMm = centerGapMm - (a.nominal.length + b.nominal.length) / 2;
      if (edgeGapMm > thresholdMm) continue;

      // Width is the circumferential extent of the box; clock is its centre.
      // Either can be missing from an ILI tally, and a guessed clock position
      // would silently turn a screened pair into an unscreened one.
      const canMeasureCircumference =
        a.clockHour !== null && b.clockHour !== null &&
        a.nominal.width > 0 && b.nominal.width > 0 && a.nominal.od > 0;

      let circumferentialGapMm: number | null = null;
      let orientationAngleDeg: number | null = null;
      if (canMeasureCircumference) {
        const centreArcMm = circumferentialCentreGapMm(a.clockHour!, b.clockHour!, a.nominal.od);
        circumferentialGapMm = centreArcMm - (a.nominal.width + b.nominal.width) / 2;
        // Angle of the line joining the two centres, measured from the axis.
        orientationAngleDeg = (Math.atan2(centreArcMm, Math.abs(centerGapMm)) * 180) / Math.PI;
      }

      pairs.push({
        a,
        b,
        edgeGapMm,
        circumferentialGapMm,
        thresholdMm,
        axialInteracting: edgeGapMm <= thresholdMm,
        circumferentialInteracting:
          circumferentialGapMm !== null && circumferentialGapMm <= thresholdMm,
        orientationAngleDeg,
        // Para. 1.13: below 45° the overall length of the pattern governs; at or
        // above it the most severe longitudinal section is sufficient, so
        // merging the pair into one long flaw would over-state the extent.
        combineRule: orientationAngleDeg === null
          ? 'undetermined'
          : orientationAngleDeg < 45
            ? 'overall-length'
            : 'worst-longitudinal-section',
      });
    }
  }
  if (truncatedScans > 0) {
    // Never a silent truncation: a screen that stopped short must say so, or a
    // shortened list reads as "no further interactions found".
    console.warn(
      `[ffs] Interaction screen reach capped at ${INTERACTION_SCAN_REACH_CAP_M} m for `
      + `${truncatedScans} feature(s); a reported feature length exceeds the screen's scope. `
      + 'Review those features as a colony instead.',
    );
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
  reportContext: FfsReportContext,
  limit = 12,
): FfsAction[] {
  const reportCase = buildFfsReportCase(items, reportContext);
  // Copied before sorting: `asManagedItems` belongs to the report case, and
  // reordering it in place changed what every other consumer of that case saw.
  const ranked = [...reportCase.asManagedItems].sort(
    (a, b) =>
      PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
      b.conservative.ERF - a.conservative.ERF,
  );

  return ranked.slice(0, limit).map((target, i) => {
    let recommendation: string;
    let due: string;

    if (target.conservative.ERF >= 1) {
      recommendation =
        'Apply operating-pressure control and raise an approved repair or detailed FFS assessment.';
      due = 'Immediate';
    } else if (target.remnantLifeConservative.years === 0) {
      recommendation =
        'Treat the projected capacity limit as reached now; confirm operating-pressure control and escalate the engineering disposition.';
      due = 'Immediate';
    } else if (target.nominal.maxDepthPct >= SEVERE_DEPTH_PCT) {
      recommendation =
        'Validate depth and morphology by excavation or NDE; confirm coating, CP, and local environment.';
      due = '0-3 months';
    } else if (
      target.remnantLifeConservative.years !== null &&
      target.remnantLifeConservative.years < 10
    ) {
      recommendation =
        'Confirm the corrosion growth rate and set a reassessment date before the capacity limit is reached.';
      due = 'Under 6 months';
    } else if (target.conservative.ERF >= screening.reviewBandErf) {
      recommendation =
        'Independent review of ILI tolerances and feature association; confirm the pressure margin.';
      due = 'Engineering review';
    } else if (target.nominal.repairStatus === 'temporary-repair') {
      recommendation =
        'Review the temporary-repair evidence, operating limitations, and permanent-repair plan.';
      due = 'Engineering review';
    } else {
      recommendation = 'Retain in the monitoring plan and correlate with CP, coating, and the next ILI.';
      due = 'Planned';
    }

    const supplementalNotes = [
      target.nominal.repairStatus === 'temporary-repair'
        ? 'Temporary repair remains active and receives no capacity credit.'
        : '',
      target.nominal.isClusteredMetalLoss
        ? 'Reported as clustered metal loss: the B31G result covers a merged group, not a single defect, and no run-pair growth rate exists for it.'
        : '',
      target.nominal.recommendation?.trim()
        ? `Recorded disposition: ${target.nominal.recommendation.trim()}`
        : '',
    ].filter(Boolean);

    return {
      code: `ACT-${String(i + 1).padStart(2, '0')}`,
      target,
      priority: target.priority,
      recommendation: [recommendation, ...supplementalNotes].join(' '),
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
    .filter((item) => item.remnantLifeConservative.status === 'calculated')
    .sort((a, b) =>
      lifeSortValue(a.remnantLifeConservative.years) - lifeSortValue(b.remnantLifeConservative.years));

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
  status: FfsLifeStatus,
  horizonYears: number,
): string {
  return formatLifeProjection(years, status, horizonYears);
}
