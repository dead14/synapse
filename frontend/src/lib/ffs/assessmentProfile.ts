import type {
  FfsConfig,
  FfsGrowthAnalysisBasis,
  FfsGrowthObservation,
  FfsScreenedResult,
} from './types.ts';

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
    default: return 'not calculable';
  }
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
      status: n.wall > 0 && n.od > 0 && n.length > 0 && n.width > 0 ? 'pass' : 'fail',
      detail: 'Positive wall, diameter, length, and width are required by the calculation contract.',
    },
    {
      id: 'depth-domain',
      label: 'B31G depth domain below 80% WT',
      status: n.maxDepthPct < 80 ? 'pass' : 'fail',
      detail: `${n.maxDepthPct.toFixed(1)}% WT as reported.`,
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
