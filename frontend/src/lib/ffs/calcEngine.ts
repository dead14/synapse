import type {
  FfsConfig,
  FfsDesignFactorSource,
  FfsGrowthComponentEvidence,
  FfsRepairStatus,
  FfsResult,
} from './types';
import { assertValidFfsRow } from './inputValidation.ts';
import {
  B31G_DEPTH_LIMIT_RATIO,
  evaluateB31g,
  type B31gBranch,
  type B31gGeometry,
  type B31gKernelResult,
} from './b31g.ts';
import { analysisHorizonYears } from './lifeProjection.ts';
import { computeRemnantLife, EMPTY_SERVICE_LIFE } from './remnantLife.ts';

export {
  B31G_DEPTH_LIMIT_RATIO,
  MODIFIED_B31G_Z_CUTOFF,
  ORIGINAL_B31G_Z_CUTOFF,
  evaluateModifiedB31g,
  evaluateOriginalB31g,
} from './remainingStrength.ts';

/** Short branch labels kept for the results table, the export, and the share snapshot. */
const BRANCH_LABEL: Record<B31gBranch, string> = {
  ORIGINAL_SHORT_PARABOLIC: 'z≤20',
  ORIGINAL_LONG_RECTANGULAR: 'z>20',
  MODIFIED_SHORT_POLYNOMIAL: 'z≤50',
  MODIFIED_LONG_LINEAR: 'z>50',
};

/**
 * Evaluates the feature at `years` into the future, growing depth and length at
 * their reported rates. All B31G maths lives in the shared kernel.
 */
function calcAtYear(
  config: FfsConfig,
  geometry: B31gGeometry,
  dInit: number,
  lInit: number,
  crDepth: number,
  crLength: number,
  years: number,
): B31gKernelResult {
  return evaluateB31g(
    dInit + crDepth * years,
    lInit + crLength * years,
    geometry,
    config.method,
    config.modifiedSa,
  );
}

function optionalText(value: string | undefined): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

/** Reads a workbook truthiness flag without treating a stray label as true. */
function parseBooleanFlag(value: string | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['yes', 'y', 'true', '1', 'cluster', 'clustered'].includes(normalized);
}

function designFactorSourceOf(value: string | undefined): FfsDesignFactorSource {
  const normalized = String(value ?? '').trim();
  if (normalized === 'section-override' || normalized === 'line-default') return normalized;
  return 'row-supplied';
}

function repairStatusOf(value: string | undefined): FfsRepairStatus {
  if (value === 'Temporary repair') return 'temporary-repair';
  if (value === 'Permanent repair verified') return 'permanent-repair-verified';
  return 'unrepaired';
}

function manualGrowthComponent(rate: number, label: string): FfsGrowthComponentEvidence {
  return {
    observation: 'manual-reported',
    analysisBasis: 'reported',
    rawRateMmPerYear: rate,
    analysisRateMmPerYear: rate,
    formula: null,
    note: `${label} was supplied by the controlled manual FFS workbook.`,
  };
}

// Process a single row
export function processRow(row: Record<string, string>, config: FfsConfig): FfsResult {
  assertValidFfsRow(row, config);
  const featureId = optionalText(row['Feature ID']);
  const ld = row['LD [m]'];
  const section = row['Section'];
  const surface = row['Surface'];
  const maxDepthPct = parseFloat(row['Max Depth [%]']);
  const length = parseFloat(row['Length [mm]']);
  const width = parseFloat(row['Width [mm]']);
  const orient = row['Orient. (hrs:mins)'];
  const wall = parseFloat(row['Nominal Wall Thickness [mm]']);
  const crDepth = parseFloat(row['CR Depth [mm/y]']);
  const crLength = parseFloat(row['CR Length [mm/y]']);
  const df = parseFloat(row['Design Factor']);
  const od = parseFloat(row['Outer Diameter Ds']);
  const smys = parseFloat(row['SMYS [MPa]']);
  const p0 = parseFloat(row['Operating Pressure P₀ [MPa]']);
  const repairStatus = repairStatusOf(row['Repair Status']);
  const repairMethod = optionalText(row['Repair Method']);
  const repairDate = optionalText(row['Repair Date']);
  const repairReference = optionalText(row['Repair Reference']);
  const recommendation = optionalText(row.Recommendation);
  const actionOwner = optionalText(row['Action Owner']);
  const isClusteredMetalLoss = parseBooleanFlag(row['Clustered Metal Loss']);
  const designFactorSource = designFactorSourceOf(row['Design Factor Source']);

  const dInit = (maxDepthPct / 100) * wall;
  const geometry: B31gGeometry = {
    wallThickness: wall,
    outerDiameter: od,
    smysMpa: smys,
    designFactor: df,
    operatingPressureMpa: p0,
  };
  const so = (p0 * od) / (2 * wall);
  const SF = 1 / df;

  const init = calcAtYear(config, geometry, dInit, length, crDepth, crLength, 0);
  const safePressure = init.safePressureMpa;
  const depthLimitPct = B31G_DEPTH_LIMIT_RATIO * 100;
  // ERF 1.0 is the safe-pressure limit itself, so it is not acceptable. The
  // depth gate is the code's own applicability limit, not a project setting.
  const acceptance = (init.erf < 1 && maxDepthPct < depthLimitPct) ? 'Acceptable' : 'Un-Acceptable';
  const horizonYears = analysisHorizonYears(config);

  // One remnant-life kernel, on the as-reported dimensions. The tolerance
  // sensitivity is computed by the screening layer from the same function, so
  // the two figures can no longer drift apart the way the old depth-only ERF
  // search drifted from this one.
  const remnantLife = computeRemnantLife({
    geometry,
    method: config.method,
    flowStressMode: config.modifiedSa,
    basis: 'as-reported',
    startDepthPct: maxDepthPct,
    startLengthMm: length,
    depthRateMmPerYear: crDepth,
    lengthRateMmPerYear: crLength,
    lengthRateAvailable: crLength > 0,
    horizonYears,
    iliDate: config.iliDate,
    service: config.serviceLife ?? EMPTY_SERVICE_LIFE,
  });

  const atFailure = remnantLife.years === null
    ? null
    : calcAtYear(config, geometry, dInit, length, crDepth, crLength, remnantLife.years);

  // A feature with no remaining capacity carries an infinite ERF. Rounding it
  // would turn it into a finite-looking number that charts and sorts would then
  // treat as a real value, which is how a collapsed feature used to flatten the
  // whole ERF axis at 1e9.
  const round4 = (value: number) => (Number.isFinite(value) ? +value.toFixed(4) : value);

  return {
    featureId, ld: parseFloat(ld as string) || ld as any, section, surface, maxDepthPct, length, width, orient, wall,
    crDepth, crLength, df, od, smys, p0, repairStatus, repairMethod, repairDate, repairReference,
    recommendation, actionOwner, isClusteredMetalLoss, designFactorSource,
    growthEvidence: {
      oldSurveyYear: null,
      newSurveyYear: null,
      intervalYears: null,
      depth: manualGrowthComponent(crDepth, 'Depth growth'),
      length: manualGrowthComponent(crLength, 'Length growth'),
    },
    SF: +SF.toFixed(4), d: +dInit.toFixed(4), dt: +init.depthRatio.toFixed(4),
    z: +(init.z || 0).toFixed(4), M: init.foliasFactor !== null ? +init.foliasFactor.toFixed(4) : null,
    sflow: +(init.flowStressMpa || 0).toFixed(4),
    Sf: +(init.failureStressMpa || 0).toFixed(4), Pf: +(init.failurePressureMpa || 0).toFixed(4),
    So: +so.toFixed(4), safePressure: +safePressure.toFixed(4),
    ERF: round4(init.erf), acceptance,
    branch: BRANCH_LABEL[init.branch],
    remnantLife,
    atFailure_ERF: atFailure ? round4(atFailure.erf) : null,
    atFailure_depth: atFailure ? +atFailure.depthPct.toFixed(2) : null,
    atFailure_Sf: atFailure ? +atFailure.failureStressMpa.toFixed(4) : null,
    method: config.method,
    saMode: config.modifiedSa,
  };
}

export function processAllRows(rows: Record<string, string>[], config: FfsConfig, onProgress?: (pct: number) => void): Promise<FfsResult[]> {
  return new Promise((resolve, reject) => {
    const results: FfsResult[] = [];
    const total = rows.length;
    if (total === 0) {
      onProgress?.(100);
      resolve(results);
      return;
    }
    const BATCH = 200;
    let i = 0;
    function tick() {
      try {
        const end = Math.min(i + BATCH, total);
        for (; i < end; i++) {
          results.push(processRow(rows[i], config));
        }
        onProgress?.(Math.round((i / total) * 100));
        if (i < total) setTimeout(tick, 0);
        else resolve(results);
      } catch (error) {
        reject(error);
      }
    }
    setTimeout(tick, 0);
  });
}
