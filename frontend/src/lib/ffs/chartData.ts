import { acceptableDepthRatio, type B31gGeometry } from './b31g.ts';
import {
  assignBinIndex,
  bucketIndexFor,
  buildLdBins,
  isInternal,
  type DepthBucket,
  type LdBin,
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
  /** Bin bounds in metres, so a caller can relate a bar back to the line. */
  bins: LdBin[];
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

  return { labels: bins.map((bin) => bin.label), series, bins };
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
  basis: 'level0' | 'level1';
  label: string;
  borderDash: number[];
  /** How many features share this wall thickness. */
  count: number;
  /**
   * True when the features on this wall do not all share one OD / SMYS /
   * pressure. The curve is drawn for the most common combination, so a mixed
   * group means some markers are being read against a curve that is not theirs.
   */
  mixedGeometry: boolean;
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

  return walls.flatMap((wall, i) => {
    const members = byWall.get(wall)!;
    // The curve belongs to a line geometry, not to a feature. Pick the geometry
    // the most features on this wall actually share, and say so when the group
    // is mixed rather than silently drawing the first row's pipe.
    const tally = new Map<string, { count: number; geometry: B31gGeometry }>();
    for (const member of members) {
      const { od, smys, df, p0 } = member.nominal;
      const key = `${od}|${smys}|${df}|${p0}`;
      const entry = tally.get(key);
      if (entry) entry.count += 1;
      else {
        tally.set(key, {
          count: 1,
          geometry: {
            wallThickness: wall,
            outerDiameter: od,
            smysMpa: smys,
            designFactor: df,
            operatingPressureMpa: p0,
          },
        });
      }
    }
    const geometry = [...tally.values()].sort((a, b) => b.count - a.count)[0].geometry;

    const pointsFor = (
      curveGeometry: B31gGeometry,
      method: FfsConfig['method'],
      flowStressMode: FfsConfig['modifiedSa'],
      maximumDepthPct: number,
    ) => {
      const points: { x: number; y: number }[] = [];
      // Quadratic sampling keeps the short-defect knee visible even when one
      // long anomaly stretches the axis into the metre range.
      for (let s = 0; s <= steps; s++) {
        const fraction = s / steps;
        const length = maxLengthMm * fraction * fraction;
        const ratio = acceptableDepthRatio(length, curveGeometry, method, flowStressMode);
        if (ratio === null) continue;
        const depthPct = ratio * 100;
        if (depthPct <= 0) continue;
        points.push({ x: length, y: Math.min(maximumDepthPct, depthPct) });
      }
      return points;
    };

    // Level 0 is the conservative ASME tabular basis: Original B31G, line at
    // 72% SMYS and minimum SF ~= 1/0.72, capped at the Level 0 80% table limit.
    const level0Geometry: B31gGeometry = {
      ...geometry,
      designFactor: 0.72,
      operatingPressureMpa: (2 * 0.72 * geometry.smysMpa * wall) / geometry.outerDiameter,
    };
    const level0: EnvelopeCurve = {
      wall,
      color: '#f97316',
      points: pointsFor(level0Geometry, 'original', 'smys11', 80),
      basis: 'level0',
      label: `ASME B31G Level 0 · t=${wall.toFixed(2)} mm`,
      borderDash: [],
      count: members.length,
      mixedGeometry: tally.size > 1,
    };
    const methodLabel = config.method === 'original'
      ? 'Original B31G'
      : `Modified B31G (${config.modifiedSa === 'smys69' ? 'SMYS + 69 MPa' : '1.1 × SMYS'})`;
    const level1: EnvelopeCurve = {
      wall,
      color: ENVELOPE_COLORS[i % ENVELOPE_COLORS.length],
      points: pointsFor(geometry, config.method, config.modifiedSa, 100),
      basis: 'level1',
      label: `Configured Level 1 · ${methodLabel} · t=${wall.toFixed(2)} mm`,
      borderDash: [6, 4],
      count: members.length,
      mixedGeometry: tally.size > 1,
    };
    return [level0, level1];
  });
}

export interface ErfProfilePoint {
  ld: number;
  nominal: number;
  conservative: number;
  forecast: number;
  item: FfsScreenedResult;
}

/**
 * Spatial ERF profile carrying all three screening tiers per feature.
 *
 * A feature with no remaining capacity keeps its infinite ERF here. Zeroing it,
 * as this used to, drew the worst feature on the line at the bottom of the axis
 * where it reads as the safest one; the consumer clamps it to the top instead.
 */
export function buildErfProfile(items: FfsScreenedResult[]): ErfProfilePoint[] {
  return [...items]
    .sort((a, b) => numericLd(a) - numericLd(b))
    .map((item) => ({
      ld: numericLd(item),
      nominal: item.nominal.ERF,
      conservative: item.conservative.ERF,
      forecast: item.forecast.ERF,
      item,
    }));
}
