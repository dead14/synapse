import type { FfsScreenedResult } from './types.ts';

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

export const DEFAULT_DEPTH_BUCKETS: DepthBucket[] = [
  { id: 'b1', name: '0-20%', from: 0, to: 20, color: '#3b82f6' },
  { id: 'b2', name: '20-30%', from: 20, to: 30, color: '#eab308' },
  { id: 'b3', name: '30-40%', from: 30, to: 40, color: '#f97316' },
  { id: 'b4', name: '40%+', from: 40, to: Number.POSITIVE_INFINITY, color: '#ef4444' },
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
 * Builds evenly spaced log-distance bins spanning the dataset. Bins are keyed by
 * index so a feature can be assigned in constant time.
 */
export function buildLdBins(items: FfsScreenedResult[], binSizeM: number): LdBin[] {
  if (!items.length || binSizeM <= 0) return [];
  const distances = items.map(numericLd);
  const min = Math.min(...distances);
  const max = Math.max(...distances);
  const first = Math.floor(min / binSizeM);
  const last = Math.floor(max / binSizeM);

  const bins: LdBin[] = [];
  for (let i = first; i <= last; i++) {
    const start = i * binSizeM;
    const end = start + binSizeM;
    bins.push({
      index: bins.length,
      start,
      end,
      label: `${start.toLocaleString()} - ${end.toLocaleString()}`,
    });
  }
  return bins;
}

export function assignBinIndex(item: FfsScreenedResult, bins: LdBin[], binSizeM: number): number {
  if (!bins.length) return -1;
  const raw = Math.floor(numericLd(item) / binSizeM) * binSizeM;
  const index = bins.findIndex((bin) => bin.start === raw);
  return index >= 0 ? index : -1;
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
    const binIndex = assignBinIndex(item, bins, binSizeM);
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
    const binIndex = assignBinIndex(item, bins, binSizeM);
    if (binIndex >= 0) grouped[binIndex].push(item);
  }

  const rank = (a: FfsScreenedResult, b: FfsScreenedResult) => {
    if (worstBy === 'depth') return b.nominal.maxDepthPct - a.nominal.maxDepthPct;
    if (worstBy === 'erf') return b.nominal.ERF - a.nominal.ERF;
    // Rank on the per-feature measured growth, matching the "Life [y]" column
    // and every other life figure in the workspace.
    return a.nominal.expectedLife - b.nominal.expectedLife;
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
