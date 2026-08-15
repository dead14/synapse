import type { FfsScreenedResult } from './types.ts';
import { lifeSortValue } from './lifeProjection.ts';
import { maxOf, minOf } from '../../utils/numericRange.ts';

/** A user-editable depth band used by the distribution table and charts. */
export interface DepthBucket {
  id: string;
  name: string;
  /** Inclusive lower bound as % of wall. */
  from: number;
  /** Exclusive upper bound as % of wall. Infinity for the open top band. */
  to: number;
  color: string;
}

/**
 * Names a band the way ILI reports name it.
 *
 * Bands are lower-inclusive and upper-exclusive, so [20, 30) is written
 * "20-29%" — the convention every vendor report uses, and the one the reader is
 * expecting. When the bounds are not whole numbers the exact interval is shown
 * instead, because rounding a 22.5% boundary into a tidy label would misstate
 * where the band actually cuts.
 */
export function depthBandLabel(from: number, to: number): string {
  if (!Number.isFinite(to)) return `${from}%+`;
  if (Number.isInteger(from) && Number.isInteger(to)) return `${from}-${to - 1}%`;
  return `${from}-${to}%`;
}

export const DEFAULT_DEPTH_BUCKETS: DepthBucket[] = [
  { id: 'b1', name: depthBandLabel(0, 20), from: 0, to: 20, color: '#3b82f6' },
  { id: 'b2', name: depthBandLabel(20, 30), from: 20, to: 30, color: '#eab308' },
  { id: 'b3', name: depthBandLabel(30, 40), from: 30, to: 40, color: '#f97316' },
  { id: 'b4', name: depthBandLabel(40, Number.POSITIVE_INFINITY), from: 40, to: Number.POSITIVE_INFINITY, color: '#ef4444' },
];

export interface LdBin {
  index: number;
  start: number;
  end: number;
  label: string;
}

function numericLd(item: FfsScreenedResult): number {
  const value = Number(item.nominal.ld);
  return Number.isFinite(value) ? value : 0;
}

/** True when a feature's reported surface reads as internal corrosion. */
export function isInternal(item: FfsScreenedResult): boolean {
  return /int/i.test(item.nominal.surface ?? '');
}

/**
 * The most bins any distribution table or chart will build.
 *
 * The bin count is the pipeline's length divided by the bin size, and the bin
 * size is typed in by the engineer. The `min` attribute on those inputs is a
 * spinner hint the browser does not enforce on typed text, so a stray "0.01" on
 * a 120 km line asked for twelve million bins — one array allocated per bin in
 * `buildWorstTable` — and took the tab down with it. Past a few thousand rows a
 * distribution table has stopped being readable anyway, so the bin size is
 * widened to fit rather than the table being truncated: every feature stays
 * counted, in fewer and coarser bands.
 */
export const MAX_LD_BINS = 5_000;
/** The finest bin the inputs accept, in metres. */
export const MIN_LD_BIN_SIZE_M = 1;

/**
 * The bin size that will actually be used for this population.
 *
 * Exported so the panels can show the engineer the number their table was drawn
 * with instead of the one they typed — a silently widened bin is a mislabelled
 * axis.
 */
export function resolveLdBinSize(items: FfsScreenedResult[], binSizeM: number): number {
  if (!items.length) return MIN_LD_BIN_SIZE_M;
  const requested = Number.isFinite(binSizeM) && binSizeM > 0
    ? Math.max(binSizeM, MIN_LD_BIN_SIZE_M)
    : MIN_LD_BIN_SIZE_M;
  const distances = items.map(numericLd);
  const span = maxOf(distances) - minOf(distances);
  if (!(span > 0)) return requested;
  const needed = span / MAX_LD_BINS;
  return requested >= needed ? requested : needed;
}

/**
 * Builds evenly spaced log-distance bins spanning the dataset. Bins are keyed by
 * index so a feature can be assigned in constant time.
 *
 * `assignBinIndex` reads the width back off the bins rather than being told it
 * again, so a size this function widened can never disagree with the arithmetic
 * that places a feature into it.
 */
export function buildLdBins(items: FfsScreenedResult[], binSizeM: number): LdBin[] {
  if (!items.length) return [];
  const size = resolveLdBinSize(items, binSizeM);
  const distances = items.map(numericLd);
  const min = minOf(distances);
  const max = maxOf(distances);
  const first = Math.floor(min / size);
  const last = Math.floor(max / size);

  const bins: LdBin[] = [];
  for (let i = first; i <= last; i++) {
    const start = i * size;
    const end = start + size;
    bins.push({
      index: bins.length,
      start,
      end,
      label: `${start.toLocaleString()} - ${end.toLocaleString()}`,
    });
  }
  return bins;
}

/**
 * Bins are evenly spaced from `bins[0].start`, so the index is arithmetic. The
 * previous linear search made every distribution table and stacked chart cost
 * features × bins, which is what made a large run pair stall on a small bin size.
 *
 * The width comes off the bins themselves. Passing it separately meant a size
 * `buildLdBins` had widened to stay inside `MAX_LD_BINS` no longer matched the
 * one used to place features, which would drop every feature past the first bin.
 */
export function assignBinIndex(item: FfsScreenedResult, bins: LdBin[]): number {
  if (!bins.length) return -1;
  const width = bins[0].end - bins[0].start;
  if (!(width > 0)) return -1;
  const index = Math.floor((numericLd(item) - bins[0].start) / width);
  return index >= 0 && index < bins.length ? index : -1;
}

export function bucketIndexFor(depthPct: number, buckets: DepthBucket[]): number {
  return buckets.findIndex((bucket) => depthPct >= bucket.from && depthPct < bucket.to);
}

export interface DistributionCell {
  internal: number;
  external: number;
  total: number;
}

export interface DistributionRow {
  bin: LdBin;
  /** One cell per depth bucket, in bucket order. */
  cells: DistributionCell[];
  total: number;
}

export interface DistributionTable {
  buckets: DepthBucket[];
  rows: DistributionRow[];
  totals: DistributionRow;
}

/**
 * Cross-tabulates feature counts by log-distance bin, depth bucket, and
 * internal/external surface.
 */
export function buildDistributionTable(
  items: FfsScreenedResult[],
  binSizeM: number,
  buckets: DepthBucket[],
): DistributionTable {
  const bins = buildLdBins(items, binSizeM);
  const emptyCells = (): DistributionCell[] =>
    buckets.map(() => ({ internal: 0, external: 0, total: 0 }));

  const rows: DistributionRow[] = bins.map((bin) => ({ bin, cells: emptyCells(), total: 0 }));
  const totals: DistributionRow = {
    bin: { index: -1, start: 0, end: 0, label: 'Total' },
    cells: emptyCells(),
    total: 0,
  };

  for (const item of items) {
    const binIndex = assignBinIndex(item, bins);
    const bucketIndex = bucketIndexFor(item.nominal.maxDepthPct, buckets);
    if (binIndex < 0 || bucketIndex < 0) continue;

    const internal = isInternal(item);
    const row = rows[binIndex];
    const cell = row.cells[bucketIndex];
    const totalCell = totals.cells[bucketIndex];

    if (internal) {
      cell.internal += 1;
      totalCell.internal += 1;
    } else {
      cell.external += 1;
      totalCell.external += 1;
    }
    cell.total += 1;
    totalCell.total += 1;
    row.total += 1;
    totals.total += 1;
  }

  return { buckets, rows, totals };
}

export type WorstBy = 'depth' | 'erf' | 'life';

export interface WorstRow {
  bin: LdBin;
  worst: FfsScreenedResult | null;
  count: number;
}

/**
 * Picks the single governing feature per log-distance bin under the selected
 * ranking criterion.
 */
export function buildWorstTable(
  items: FfsScreenedResult[],
  binSizeM: number,
  worstBy: WorstBy,
): WorstRow[] {
  const bins = buildLdBins(items, binSizeM);
  const grouped: FfsScreenedResult[][] = bins.map(() => []);

  for (const item of items) {
    const binIndex = assignBinIndex(item, bins);
    if (binIndex >= 0) grouped[binIndex].push(item);
  }

  const rank = (a: FfsScreenedResult, b: FfsScreenedResult) => {
    if (worstBy === 'depth') return b.nominal.maxDepthPct - a.nominal.maxDepthPct;
    if (worstBy === 'erf') return b.nominal.ERF - a.nominal.ERF;
    // Rank on the per-feature source-evidenced growth, matching the remnant-life
    // column and every other life figure in the workspace.
    return lifeSortValue(a.nominal.remnantLife.years) - lifeSortValue(b.nominal.remnantLife.years);
  };

  return bins.map((bin, i) => {
    const members = grouped[i];
    return {
      bin,
      worst: members.length ? [...members].sort(rank)[0] : null,
      count: members.length,
    };
  });
}
