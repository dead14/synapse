import type { FfsConfig, FfsFailureCriterion, FfsLifeStatus } from './types.ts';

export const DEFAULT_FFS_ANALYSIS_HORIZON_YEARS = 30;
export const MAX_FFS_ANALYSIS_HORIZON_YEARS = 100;

export function analysisHorizonYears(config: FfsConfig): number {
  return config.analysisHorizonYears ?? DEFAULT_FFS_ANALYSIS_HORIZON_YEARS;
}

export function lifeSortValue(years: number | null): number {
  return years === null ? Number.POSITIVE_INFINITY : years;
}

export function formatLifeProjection(
  years: number | null,
  status: FfsLifeStatus,
  horizonYears: number,
): string {
  if (status === 'insufficient-growth-basis') return 'Not calculated';
  if (status === 'not-reached-within-horizon') return `Not reached in ${horizonYears} y`;
  if (years === null) return 'Not calculated';
  if (years < 0.1) return 'Now';
  return `${years.toFixed(1)} y`;
}

export function lifeProjectionStatusLabel(
  status: FfsLifeStatus,
  criterion: FfsFailureCriterion | null,
  horizonYears: number,
): string {
  if (criterion) return criterion;
  if (status === 'insufficient-growth-basis') return 'No positive growth basis';
  return `Limit not reached in ${horizonYears} y`;
}
