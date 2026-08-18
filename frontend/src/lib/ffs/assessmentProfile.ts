import type {
  FfsConfig,
  FfsDesignFactorSource,
  FfsOuterDiameterSource,
  FfsSmysSource,
  FfsSafetyFactorSource,
  FfsGrowthAnalysisBasis,
  FfsGrowthObservation,
  FfsScreenedResult,
} from './types.ts';
import type { B314Disposition } from './b314.ts';
import type { FfsWallThicknessSource } from './alignmentImport.ts';

export function pressureBasisLabel(config: FfsConfig): string {
  switch (config.pressureBasis) {
    case 'maop': return 'MAOP';
    case 'mop': return 'MOP / approved operating limit';
    case 'other-required': return 'Other required assessment pressure';
    default: return 'Current operating pressure';
  }
}

export function methodProfileLabel(config: FfsConfig): string {
  if (config.method === 'original') return 'Original B31G · 2/3 area model · 1.1 × SMYS flow stress';
  return `Modified B31G · 0.85 area model · ${config.modifiedSa === 'smys11' ? '1.1 × SMYS' : 'SMYS + 69 MPa'} flow stress`;
}

export function growthObservationLabel(observation: FfsGrowthObservation | undefined): string {
  switch (observation) {
    case 'matched-measured': return 'Matched run-pair CGR';
    case 'new-only-zero-baseline-estimate': return 'NEW-only zero-baseline estimate';
    case 'apparent-decrease': return 'Apparent decrease';
    case 'manual-reported': return 'Manual workbook rate';
    default: return 'Source growth unavailable';
  }
}

export function growthAnalysisBasisLabel(
  basis: FfsGrowthAnalysisBasis | 'uniform-assumption' | undefined,
): string {
  switch (basis) {
    case 'reported': return 'reported rate';
    case 'estimated': return 'estimated rate';
    case 'explicit-fallback': return 'engineer-entered fallback';
    case 'uniform-assumption': return 'uniform screening assumption';
    // Derivations, not measurements. Named as such in every column they reach —
    // an engineer reading "derived" must never take it for a run-pair result.
    case 'service-age': return 'derived: service-age rate';
    case 'population-percentile': return 'derived: population rate';
    default: return 'not calculable';
  }
}

/**
 * The para. 451.6.2.2 disposition, phrased for a report column.
 *
 * Deliberately worded as the Code words it — "shall be removed or repaired", not
 * "fail" — because this column is the Code requirement, not a screening band.
 */
export function b314DispositionLabel(disposition: B314Disposition): string {
  switch (disposition) {
    case 'remove-or-repair': return 'Remove or repair — over 80 %WT (451.6.2.2(a))';
    case 'no-repair-required': return 'No repair required — 20 % or less of t (451.6.2.2(b))';
    case 'safe-pressure-established': return 'May remain — safe pressure at or above MOP (451.6.2.2(b))';
    case 'repair-replace-or-reduce-mop': return 'Repair, replace, or reduce MOP (451.6.2.2(b))';
    case 'engineering-analysis-required': return 'Engineering analysis required (451.6.2.2(b))';
    default: return 'Not established';
  }
}

export function designFactorSourceLabel(source: FfsDesignFactorSource): string {
  switch (source) {
    case 'section-override': return 'Section override';
    case 'line-default': return 'Line default';
    default: return 'Supplied per row';
  }
}

/**
 * Reads a wall provenance for the report, strongest evidence first.
 *
 * The two measured sources are named apart from the two typed ones. An
 * inherited wall is the joint's own measurement — the pipetally rows — so it is
 * not labelled as an assumption, but it is not labelled as a reading taken at
 * the defect either.
 */
export function wallThicknessSourceLabel(source: FfsWallThicknessSource | undefined): string {
  switch (source) {
    case 'run-reported': return 'Reported at the feature';
    case 'joint-inherited': return 'Read off the joint girth welds';
    case 'section-nominal': return 'Section nominal wall';
    case 'line-nominal': return 'Line nominal wall';
    default: return 'Not recorded';
  }
}

export function outerDiameterSourceLabel(source: FfsOuterDiameterSource): string {
  switch (source) {
    case 'section-override': return 'Section pipe spec';
    case 'line-default': return 'Line default';
    default: return 'Supplied per row';
  }
}

export function smysSourceLabel(source: FfsSmysSource): string {
  switch (source) {
    case 'section-override': return 'Section pipe spec';
    case 'line-default': return 'Line default';
    default: return 'Supplied per row';
  }
}

export function safetyFactorSourceLabel(source: FfsSafetyFactorSource): string {
  return source === 'explicit'
    ? 'Explicit hydrotest / MAOP ratio'
    : 'Derived from design factor (1/F)';
}

export interface FfsApplicabilityCheck {
  id: string;
  label: string;
  status: 'pass' | 'review' | 'fail';
  detail: string;
}

export function applicabilityChecks(item: FfsScreenedResult): FfsApplicabilityCheck[] {
  const n = item.nominal;
  return [
    {
      id: 'geometry',
      label: 'Validated pipe and anomaly geometry',
      // Width is deliberately absent: it is not a B31G input, so a run that
      // reports none does not make the geometry invalid. It is reported as a
      // review note rather than a failure of the calculation contract.
      status: n.wall > 0 && n.od > 0 && n.length > 0
        ? (n.width > 0 ? 'pass' : 'review')
        : 'fail',
      detail: n.wall > 0 && n.od > 0 && n.length > 0 && n.width <= 0
        ? 'Wall, diameter, and axial length are positive. The run reported no circumferential width, which '
          + 'B31G does not use — only the circumferential interaction screen is affected.'
        : 'Positive wall, diameter, and axial length are required by the calculation contract.',
    },
    {
      id: 'depth-domain',
      label: 'Depth below the 80 %WT project rejection line',
      // B31G para. 1.2(f) admits any depth; 80 % is where it asks for extra
      // consideration of sizing accuracy and growth rate, and where the Level 0
      // tables stop. Treating it as an outright method failure overstates what
      // the code says, so it is a review gate, not a rejection.
      status: n.maxDepthPct < 80 ? 'pass' : 'review',
      detail: n.maxDepthPct < 80
        ? `${n.maxDepthPct.toFixed(1)} %WT as reported.`
        : `${n.maxDepthPct.toFixed(1)} %WT as reported. B31G para. 1.2(f) permits evaluation at this depth but requires the sizing accuracy and the effective corrosion rate to be justified; the section 3 tables do not apply above 80 %.`,
    },
    {
      id: 'single-feature',
      label: 'Record describes a single metal-loss feature',
      // Not a failure: the calculation still runs and is usually conservative.
      // It is a limitation the reader has to be told about, because B31G is
      // written for one defect and this row is a vendor-merged group.
      status: n.isClusteredMetalLoss ? 'review' : 'pass',
      detail: n.isClusteredMetalLoss
        ? 'Reported as clustered metal loss. The result treats the merged envelope as one defect, and no run-pair growth rate exists because clusters are never matched across runs.'
        : 'Reported as an individual metal-loss feature.',
    },
    {
      id: 'morphology',
      label: 'Metal-loss morphology excludes crack-like or mechanical damage',
      status: 'review',
      detail: 'Morphology evidence is not part of the current FFS intake and must be confirmed from ILI/NDE records.',
    },
    {
      id: 'material-loading',
      label: 'Carbon-steel material and pressure-dominated loading confirmed',
      status: 'review',
      detail: 'Material grade is represented by SMYS, but material class and non-pressure loading evidence are not captured.',
    },
  ];
}

export function applicabilityStatus(item: FfsScreenedResult): 'applicable' | 'limited' | 'outside-domain' {
  const checks = applicabilityChecks(item);
  if (checks.some((check) => check.status === 'fail')) return 'outside-domain';
  if (checks.some((check) => check.status === 'review')) return 'limited';
  return 'applicable';
}

export function engineeringDisposition(item: FfsScreenedResult): string {
  if (applicabilityStatus(item) === 'outside-domain') return 'Detailed assessment required';
  if (item.nominal.acceptance === 'Un-Acceptable' || item.conservative.severity === 'fail') {
    return 'Pressure control / repair review';
  }
  const evidence = item.nominal.growthEvidence?.depth;
  if (
    item.conservative.severity === 'review' ||
    evidence?.observation === 'new-only-zero-baseline-estimate' ||
    evidence?.observation === 'apparent-decrease' ||
    evidence?.analysisBasis === 'explicit-fallback' ||
    evidence?.analysisBasis === 'none'
  ) {
    return 'Engineering review';
  }
  return 'Screening pass — verify applicability';
}
