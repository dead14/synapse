import {
  assignBinIndex,
  bucketIndexFor,
  buildLdBins,
  isInternal,
  type DepthBucket,
} from './statistics.ts';
import type { FfsConfig, FfsScreenedResult } from './types.ts';

/**
 * Point payload carried through Chart.js so tooltips can name the feature.
 * Reference lines (thresholds, envelope curves) share the shape but carry no
 * feature, so consumers must guard on `item` before using it.
 */
export interface FfsPoint {
  x: number;
  y: number;
  item?: FfsScreenedResult;
}

function numericLd(item: FfsScreenedResult): number {
  const value = Number(item.nominal.ld);
  return Number.isFinite(value) ? value : 0;
}

export interface StackedSeries {
  label: string;
  color: string;
  data: number[];
}

export interface StackedBarData {
  labels: string[];
  series: StackedSeries[];
}

/**
 * Counts features per log-distance bin, split by depth bucket. Optionally
 * restricted to internal or external corrosion.
 */
export function buildDepthByLd(
  items: FfsScreenedResult[],
  binSizeM: number,
  buckets: DepthBucket[],
  surface?: 'internal' | 'external',
): StackedBarData {
  const scoped = surface
    ? items.filter((item) => (surface === 'internal' ? isInternal(item) : !isInternal(item)))
    : items;
  const bins = buildLdBins(scoped, binSizeM);
  const series: StackedSeries[] = buckets.map((bucket) => ({
    label: bucket.name,
    color: bucket.color,
    data: new Array(bins.length).fill(0),
  }));

  for (const item of scoped) {
    const binIndex = assignBinIndex(item, bins, binSizeM);
    const bucketIndex = bucketIndexFor(item.nominal.maxDepthPct, buckets);
    if (binIndex >= 0 && bucketIndex >= 0) series[bucketIndex].data[binIndex] += 1;
  }

  return { labels: bins.map((bin) => bin.label), series };
}

export interface SplitScatter {
  internal: FfsPoint[];
  external: FfsPoint[];
}

/** Splits features into internal/external series for a scatter plot. */
function splitScatter(
  items: FfsScreenedResult[],
  yOf: (item: FfsScreenedResult) => number | null,
): SplitScatter {
  const internal: FfsPoint[] = [];
  const external: FfsPoint[] = [];

  for (const item of items) {
    const y = yOf(item);
    if (y === null || !Number.isFinite(y)) continue;
    const point: FfsPoint = { x: numericLd(item), y, item };
    if (isInternal(item)) internal.push(point);
    else external.push(point);
  }
  return { internal, external };
}

/** Clock position (0-12) against log distance. */
export function buildOrientationScatter(items: FfsScreenedResult[]): SplitScatter {
  return splitScatter(items, (item) => item.clockHour);
}

export function buildDepthCrScatter(items: FfsScreenedResult[]): SplitScatter {
  return splitScatter(items, (item) => item.nominal.crDepth);
}

export function buildLengthCrScatter(items: FfsScreenedResult[]): SplitScatter {
  return splitScatter(items, (item) => item.nominal.crLength);
}

export function buildErfScatter(items: FfsScreenedResult[]): SplitScatter {
  return splitScatter(items, (item) => (Number.isFinite(item.nominal.ERF) ? item.nominal.ERF : null));
}

/** Anomaly length against depth — the axes of the B31G Level 0 screen. */
export function buildScreeningScatter(items: FfsScreenedResult[]): SplitScatter {
  const internal: FfsPoint[] = [];
  const external: FfsPoint[] = [];
  for (const item of items) {
    const point: FfsPoint = { x: item.nominal.length, y: item.nominal.maxDepthPct, item };
    if (isInternal(item)) internal.push(point);
    else external.push(point);
  }
  return { internal, external };
}

export interface EnvelopeCurve {
  wall: number;
  color: string;
  points: { x: number; y: number }[];
}

const ENVELOPE_COLORS = [
  '#0ea5e9', '#8b5cf6', '#f43f5e', '#14b8a6', '#f59e0b',
  '#6366f1', '#ec4899', '#22c55e', '#ef4444', '#06b6d4',
];

/**
 * Builds the B31G Level 0 acceptance envelope for each distinct wall thickness
 * in the dataset: for a given anomaly length, the greatest depth that still
 * keeps ERF at 1.0. Features plotting above their wall's curve fail the screen.
 */
export function buildEnvelopeCurves(
  items: FfsScreenedResult[],
  config: FfsConfig,
  maxLengthMm: number,
  steps = 60,
): EnvelopeCurve[] {
  // Group by wall thickness — each distinct wall gets its own curve, using the
  // most common geometry/material for that wall so the curve is representative.
  const byWall = new Map<number, FfsScreenedResult[]>();
  for (const item of items) {
    const wall = Number(item.nominal.wall.toFixed(2));
    const bucket = byWall.get(wall);
    if (bucket) bucket.push(item);
    else byWall.set(wall, [item]);
  }

  const walls = [...byWall.keys()].sort((a, b) => a - b);

  return walls.map((wall, i) => {
    const sample = byWall.get(wall)![0].nominal;
    const { od, smys, df, p0 } = sample;
    const so = (p0 * od) / (2 * wall);
    const sflow =
      config.method === 'original'
        ? 1.1 * smys
        : config.modifiedSa === 'smys11'
          ? 1.1 * smys
          : smys + 69;

    const points: { x: number; y: number }[] = [];
    for (let s = 1; s <= steps; s++) {
      const length = (maxLengthMm * s) / steps;
      const z = (length * length) / (od * wall);

      // Solve Sf(d/t) = So/df for d/t. Both B31G forms rearrange to a closed
      // form once the Folias factor is known.
      const target = so / df;
      let dt: number | null = null;

      if (config.method === 'original' && z > 20) {
        // Sf = sflow * (1 - dt)
        dt = 1 - target / sflow;
      } else {
        const M =
          config.method === 'original'
            ? Math.sqrt(1 + 0.8 * z)
            : z <= 50
              ? Math.sqrt(Math.max(1, 1 + 0.6275 * z - 0.003375 * z * z))
              : 0.032 * z + 3.3;
        const k = config.method === 'original' ? 2 / 3 : 0.85;
        // sflow(1 - k·dt) = target(1 - k·dt/M)  =>  dt = (sflow - target) / (k(sflow - target/M))
        const denominator = k * (sflow - target / M);
        if (denominator !== 0) dt = (sflow - target) / denominator;
      }

      if (dt === null || !Number.isFinite(dt)) continue;
      const depthPct = dt * 100;
      if (depthPct <= 0 || depthPct > 100) continue;
      points.push({ x: length, y: Math.min(100, depthPct) });
    }

    return { wall, color: ENVELOPE_COLORS[i % ENVELOPE_COLORS.length], points };
  });
}

export interface ErfProfilePoint {
  ld: number;
  nominal: number;
  conservative: number;
  forecast: number;
  item: FfsScreenedResult;
}

/** Spatial ERF profile carrying all three screening tiers per feature. */
export function buildErfProfile(items: FfsScreenedResult[]): ErfProfilePoint[] {
  return [...items]
    .sort((a, b) => numericLd(a) - numericLd(b))
    .map((item) => ({
      ld: numericLd(item),
      nominal: Number.isFinite(item.nominal.ERF) ? item.nominal.ERF : 0,
      conservative: Number.isFinite(item.conservative.ERF) ? item.conservative.ERF : 0,
      forecast: Number.isFinite(item.forecast.ERF) ? item.forecast.ERF : 0,
      item,
    }));
}
