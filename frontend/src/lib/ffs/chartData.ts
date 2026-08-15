import { acceptableDepthRatio, type B31gGeometry, type ScreeningBasis } from './b31g.ts';
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
    const binIndex = assignBinIndex(item, bins);
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

/**
 * What a single dominant value in one measured column means for a chart drawn
 * against it.
 *
 * A population whose axial lengths are all the same number plots as one
 * vertical stripe, and every acceptance envelope beside it is decoration. That
 * is not a drawing problem to be worked around — it is the tally saying the
 * column was never populated, or that the parser mapped the wrong one — so the
 * chart reports it instead of rendering a stripe and leaving the reader to
 * work out why the screen tells them nothing.
 */
export interface ColumnUniformity {
  /** The value that dominates, when one does. */
  value: number | null;
  /** How many features carry it. */
  count: number;
  total: number;
  /** How many distinct values the column holds at all. */
  distinctCount: number;
  /** True once a single value covers `threshold` of the population. */
  degenerate: boolean;
}

export function measureUniformity(
  values: number[],
  threshold = 0.98,
): ColumnUniformity {
  const total = values.length;
  if (!total) {
    return { value: null, count: 0, total: 0, distinctCount: 0, degenerate: false };
  }
  const tally = new Map<number, number>();
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1);

  let best: [number, number] = [values[0], 0];
  for (const entry of tally) if (entry[1] > best[1]) best = entry;

  return {
    value: best[0],
    count: best[1],
    total,
    distinctCount: tally.size,
    degenerate: best[1] / total >= threshold,
  };
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
  /** Which criterion the curve was solved against. */
  basis: ScreeningBasis;
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
 * The axial length the screening chart has to span for its envelopes to mean
 * anything.
 *
 * Driving the x axis off the reported lengths alone is what made this chart
 * useless: a tally whose boxes are all short keeps the domain short, the
 * envelope never reaches the lengths where it bends down, and every curve is
 * a flat line off the top of the plot — or, once clipped, nothing at all.
 *
 * So the domain is whichever is wider: the population's own lengths, or the
 * length at which the shallowest wall's envelope has fallen to `floorPct`.
 * That guarantees the knee of the curve is on screen whatever the data looks
 * like, which is the whole point of drawing an acceptance boundary.
 */
export function envelopeDomainMm(
  items: FfsScreenedResult[],
  config: FfsConfig,
  basis: ScreeningBasis = 'level-0',
  floorPct = 25,
  hardCapMm = 2000,
): number {
  const dataMax = items.reduce((max, item) => Math.max(max, item.nominal.length), 0);
  if (!items.length) return Math.max(50, dataMax * 1.1);

  // The thinnest wall bends down soonest, so it sets the length at which the
  // interesting part of the family is visible.
  const thinnest = items.reduce((min, item) => (item.nominal.wall < min.nominal.wall ? item : min), items[0]);
  const { wall, od, smys, safetyFactor, p0 } = thinnest.nominal;
  const geometry: B31gGeometry = {
    wallThickness: wall,
    outerDiameter: od,
    smysMpa: smys,
    safetyFactor,
    operatingPressureMpa: p0,
  };

  let needed = 0;
  for (let length = 10; length <= hardCapMm; length += 10) {
    const ratio = acceptableDepthRatio(length, geometry, config.method, config.modifiedSa, basis);
    needed = length;
    if (ratio !== null && ratio * 100 <= floorPct) break;
  }

  return Math.max(50, dataMax * 1.1, needed);
}

/**
 * Builds the acceptance envelope for each distinct wall thickness in the
 * dataset: for a given anomaly length, the greatest depth the criterion allows.
 * Features plotting above their wall's curve fail the screen.
 *
 * `basis` selects the criterion — see `ScreeningBasis`. On the Level 0 basis
 * every curve is the same shape the code's own tables draw: flat along the
 * rejection line while the anomaly is short, then falling away as the Folias
 * term takes hold.
 *
 * Short anomalies solve to an allowable depth above the wall itself — the
 * equations do not stop the metal loss reaching 117 % of a wall that only has
 * 100 % to give. Dropping those points, as this used to, deleted the entire
 * flat top of the curve, and on a lightly loaded line that is the entire curve:
 * the chart rendered a legend with no line beside it. They are clamped to the
 * project rejection line now, which is where the real boundary sits and what
 * the reference reports draw.
 */
export function buildEnvelopeCurves(
  items: FfsScreenedResult[],
  config: FfsConfig,
  maxLengthMm: number,
  /** The %WT line the envelope is flat along before the equations govern. */
  depthLimitPct = 80,
  basis: ScreeningBasis = 'level-0',
  steps = 120,
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
    const members = byWall.get(wall)!;
    // The curve belongs to a line geometry, not to a feature. Pick the geometry
    // the most features on this wall actually share, and say so when the group
    // is mixed rather than silently drawing the first row's pipe.
    const tally = new Map<string, { count: number; geometry: B31gGeometry }>();
    for (const member of members) {
      const { od, smys, safetyFactor, p0 } = member.nominal;
      const key = `${od}|${smys}|${safetyFactor}|${p0}`;
      const entry = tally.get(key);
      if (entry) entry.count += 1;
      else {
        tally.set(key, {
          count: 1,
          geometry: {
            wallThickness: wall,
            outerDiameter: od,
            smysMpa: smys,
            safetyFactor,
            operatingPressureMpa: p0,
          },
        });
      }
    }
    const geometry = [...tally.values()].sort((a, b) => b.count - a.count)[0].geometry;

    const points: { x: number; y: number }[] = [];
    for (let s = 0; s <= steps; s++) {
      const length = (maxLengthMm * s) / steps;
      const ratio = acceptableDepthRatio(length, geometry, config.method, config.modifiedSa, basis);
      if (ratio === null) continue;
      const depthPct = ratio * 100;
      // Below zero there is no acceptable depth at all: the line already
      // exceeds its own flow stress at this length, and the curve ends rather
      // than being drawn along the axis as if any metal loss were tolerable.
      if (depthPct <= 0) break;
      points.push({ x: length, y: Math.min(depthLimitPct, depthPct) });
    }

    return {
      wall,
      color: ENVELOPE_COLORS[i % ENVELOPE_COLORS.length],
      points,
      basis,
      count: members.length,
      mixedGeometry: tally.size > 1,
    };
  });
}

export interface ScreeningVerdict {
  item: FfsScreenedResult;
  /**
   * The deepest metal loss this feature's own length and pipe allow, in %WT,
   * clamped to the project rejection line. Null when the equations resolve no
   * allowable depth at all — the target stress already exceeds sound pipe.
   */
  allowablePct: number | null;
  /** How much of the allowance the reported depth uses, as a ratio. */
  utilisation: number | null;
  exceeds: boolean;
}

export interface ScreeningOutcome {
  basis: ScreeningBasis;
  verdicts: ScreeningVerdict[];
  /** Keyed by `FfsScreenedResult.key`, for tooltips and table joins. */
  byKey: Map<string, ScreeningVerdict>;
  exceeded: number;
  /** Features whose allowable depth could not be resolved at all. */
  indeterminate: number;
  total: number;
  /** Exceedances as a fraction of the assessed population. */
  fraction: number;
}

/**
 * Screens every feature against the envelope, feature by feature.
 *
 * The count is not read off the drawn curve. Each anomaly is solved at its own
 * reported length against its own OD, grade, and wall, so a feature whose pipe
 * differs from the representative geometry its wall group was drawn with is
 * still judged against its own line — and there is no interpolation error
 * between plotted points to argue about. The curve is the picture; this is the
 * number.
 */
export function screenAgainstEnvelope(
  items: FfsScreenedResult[],
  config: FfsConfig,
  depthLimitPct = 80,
  basis: ScreeningBasis = 'level-0',
): ScreeningOutcome {
  const verdicts = items.map<ScreeningVerdict>((item) => {
    const { wall, od, smys, safetyFactor, p0, length, maxDepthPct } = item.nominal;
    const ratio = acceptableDepthRatio(
      length,
      {
        wallThickness: wall,
        outerDiameter: od,
        smysMpa: smys,
        safetyFactor,
        operatingPressureMpa: p0,
      },
      config.method,
      config.modifiedSa,
      basis,
    );
    if (ratio === null || !Number.isFinite(ratio)) {
      return { item, allowablePct: null, utilisation: null, exceeds: false };
    }
    // The rejection line caps the allowance: an anomaly the equations would
    // tolerate at 117 %WT is still rejected by project rule at 80 %. The floor
    // matters too — where the target stress already exceeds sound pipe the
    // equations solve negative, which means no metal loss at all is acceptable,
    // not that a negative depth is.
    const allowablePct = Math.max(0, Math.min(depthLimitPct, ratio * 100));
    return {
      item,
      allowablePct,
      utilisation: allowablePct > 0 ? maxDepthPct / allowablePct : null,
      exceeds: maxDepthPct > allowablePct,
    };
  });

  const exceeded = verdicts.filter((verdict) => verdict.exceeds).length;
  return {
    basis,
    verdicts,
    byKey: new Map(verdicts.map((verdict) => [verdict.item.key, verdict])),
    exceeded,
    indeterminate: verdicts.filter((verdict) => verdict.allowablePct === null).length,
    total: verdicts.length,
    fraction: verdicts.length ? exceeded / verdicts.length : 0,
  };
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
