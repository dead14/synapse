import type { FfsConfig, FfsLifeStatus } from './types.ts';
import type { FfsRemnantLife } from './remnantLife.ts';

export const DEFAULT_FFS_ANALYSIS_HORIZON_YEARS = 30;
export const MAX_FFS_ANALYSIS_HORIZON_YEARS = 100;

export function analysisHorizonYears(config: FfsConfig): number {
  return config.analysisHorizonYears ?? DEFAULT_FFS_ANALYSIS_HORIZON_YEARS;
}

/**
 * Sort key for a remnant life. A feature with no established limit sorts last,
 * so "not calculated" never leads a shortest-life ranking.
 */
export function lifeSortValue(years: number | null): number {
  return years === null ? Number.POSITIVE_INFINITY : years;
}

export function remnantSortValue(remnant: FfsRemnantLife | undefined): number {
  return lifeSortValue(remnant?.years ?? null);
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
  return `${years.toFixed(2)} y`;
}

/** The remnant life as it appears in a table cell. */
export function formatRemnantLife(remnant: FfsRemnantLife): string {
  return formatLifeProjection(remnant.years, remnant.status, remnant.analysisHorizonYears);
}

export function lifeProjectionStatusLabel(
  status: FfsLifeStatus,
  criterion: string | null,
  horizonYears: number,
): string {
  if (criterion) return criterion;
  if (status === 'insufficient-growth-basis') return 'No positive growth basis';
  return `Limit not reached in ${horizonYears} y`;
}

/**
 * Which limit governed, phrased for a report column.
 *
 * `'Depth = 80%'` is the stable identifier the filters and the stored case match
 * on, not a label — the depth line it names is configurable and the projection
 * carries the value that was actually used. Printing the token verbatim put
 * "Depth = 80%" in the governing-limit column and in the exported workbook for
 * an assessment screened at, say, 70 %WT, contradicting the years quoted beside
 * it. The number is substituted here, at the display boundary, so the token
 * itself stays untouched for everything that compares against it.
 */
export function remnantLimitLabel(remnant: FfsRemnantLife): string {
  if (remnant.governingLimit === 'Depth = 80%') {
    const limitPct = Number.isFinite(remnant.depthLimitPct) ? remnant.depthLimitPct : 80;
    return `Depth = ${Number(limitPct.toFixed(2))}%`;
  }
  return lifeProjectionStatusLabel(
    remnant.status,
    remnant.governingLimit,
    remnant.analysisHorizonYears,
  );
}

/**
 * The caveats that must travel with a remnant-life figure, in the order an
 * engineer would want to read them. Empty when the figure carries none.
 */
export function remnantLifeCaveats(remnant: FfsRemnantLife): string[] {
  const caveats: string[] = [];
  if (remnant.lengthHeldConstant && remnant.status === 'calculated') {
    caveats.push('Axial length held constant — no length growth rate was established.');
  }
  if (remnant.designLifeCapApplied) {
    caveats.push(
      `Capped at the ${remnant.designLifeYears} y original design life; the calculated limit is later.`,
    );
  }
  if (remnant.basis === 'tolerance-adjusted') {
    caveats.push('Projected from tolerance-adjusted dimensions, not the as-reported ones.');
  }
  return caveats;
}
