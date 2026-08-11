/**
 * Aggregations behind the two population-level pictures in the integrity panel.
 *
 * Both used to draw one mark per feature. That reads fine for a few hundred
 * anomalies and collapses completely at the scale these reports actually reach:
 * seven thousand markers on a 1,000 px strip is a black smear, and seven
 * thousand dots on a single ring is a solid band in whichever colour happened to
 * be painted last — which is why internal corrosion was invisible even though it
 * was plotted.
 *
 * The fix is to stop pretending each feature can have its own mark and to show
 * the distribution instead: how many features fall in each stretch of line, and
 * how many sit at each hour of the clock, split by surface. Both keep a handle
 * back to a real feature so the picture stays a way into the data.
 */

import { isInternal } from './statistics.ts';
import type { FfsScreenedResult, FfsSeverity } from './types.ts';
import { maxOf, minOf } from '../../utils/numericRange.ts';

const SEVERITY_RANK: Record<FfsSeverity, number> = { pass: 0, review: 1, fail: 2 };

function distanceOf(item: FfsScreenedResult): number {
  const value = Number(item.nominal.ld);
  return Number.isFinite(value) ? value : 0;
}

export interface DistanceBin {
  index: number;
  startM: number;
  endM: number;
  count: number;
  /** Worst conservative severity anywhere in the bin. */
  severity: FfsSeverity;
  /** Conservative ERF of the feature that set the severity. */
  worstErf: number;
  /** The feature a click on this bin should open — the worst one in it. */
  worst: FfsScreenedResult;
}

export interface DistanceProfile {
  bins: DistanceBin[];
  minM: number;
  maxM: number;
  /** Largest bin count, i.e. the value a full-height bar represents. */
  peakCount: number;
  binWidthM: number;
}

/**
 * Buckets features into equal-width stretches of line.
 *
 * The bin carries the worst feature rather than a mean: a stretch holding one
 * unacceptable anomaly among two hundred passes is a stretch that needs
 * attention, and averaging would hide exactly that.
 */
export function buildDistanceProfile(
  items: readonly FfsScreenedResult[],
  binCount: number,
): DistanceProfile {
  const safeBinCount = Math.max(1, Math.floor(binCount));
  if (items.length === 0) {
    return { bins: [], minM: 0, maxM: 0, peakCount: 0, binWidthM: 0 };
  }

  const distances = items.map(distanceOf);
  const minM = minOf(distances);
  const maxM = maxOf(distances);
  const span = maxM - minM || 1;
  const binWidthM = span / safeBinCount;

  const buckets = new Map<number, FfsScreenedResult[]>();
  items.forEach((item, index) => {
    // The feature at the far end belongs to the last bin, not to a bin past it.
    const raw = Math.floor(((distances[index] - minM) / span) * safeBinCount);
    const bin = Math.min(safeBinCount - 1, Math.max(0, raw));
    const existing = buckets.get(bin);
    if (existing) existing.push(item);
    else buckets.set(bin, [item]);
  });

  const bins: DistanceBin[] = [];
  let peakCount = 0;
  for (const [index, members] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    let worst = members[0];
    for (const candidate of members) {
      const better = SEVERITY_RANK[candidate.conservative.severity] - SEVERITY_RANK[worst.conservative.severity];
      if (better > 0 || (better === 0 && candidate.conservative.ERF > worst.conservative.ERF)) {
        worst = candidate;
      }
    }
    peakCount = Math.max(peakCount, members.length);
    bins.push({
      index,
      startM: minM + index * binWidthM,
      endM: minM + (index + 1) * binWidthM,
      count: members.length,
      severity: worst.conservative.severity,
      worstErf: worst.conservative.ERF,
      worst,
    });
  }

  return { bins, minM, maxM, peakCount, binWidthM };
}

export interface ErfBand {
  index: number;
  startM: number;
  endM: number;
  midM: number;
  count: number;
  nominalMax: number;
  conservativeMax: number;
  /** Highest finite forecast in the band, and the lowest, for the envelope. */
  forecastMax: number;
  forecastMin: number;
  /** The feature a click on this stretch should open — the worst one in it. */
  worst: FfsScreenedResult;
}

export interface ErfBandProfile {
  bands: ErfBand[];
  minM: number;
  maxM: number;
  /** Highest finite ERF anywhere in the population, across all three tiers. */
  peakErf: number;
  /** Features whose forecast ERF is not finite; they are counted, not plotted. */
  unboundedCount: number;
  /**
   * Features drawn individually on top of the bands, worst first. Everything
   * that is not screened as a pass earns its own mark; the rest is the band.
   */
  notable: FfsScreenedResult[];
  /** How many notable features were left out of `notable` by the cap. */
  notableOmitted: number;
}

/**
 * The ERF profile as bands rather than one mark per feature.
 *
 * A mark per feature is a thousand SVG nodes per tier on a real population —
 * thirty or forty thousand elements on the page, each with its own tooltip and
 * click handler. That does not draw a denser picture, it draws the same solid
 * smear the schematic used to, and it does it at a frame rate that makes the
 * whole tab feel broken.
 *
 * Binning along the line keeps what the profile is for: the highest ERF in each
 * stretch, tier by tier, and the spread the forecast opens up. Individual marks
 * are reserved for the features that are not screened as passes, which are the
 * only ones a reader clicks anyway.
 */
export function buildErfBands(
  items: readonly FfsScreenedResult[],
  binCount: number,
  notableLimit = 400,
): ErfBandProfile {
  const safeBinCount = Math.max(1, Math.floor(binCount));
  if (items.length === 0) {
    return {
      bands: [], minM: 0, maxM: 0, peakErf: 0, unboundedCount: 0, notable: [], notableOmitted: 0,
    };
  }

  const distances = items.map(distanceOf);
  const minM = minOf(distances);
  const maxM = maxOf(distances);
  const span = maxM - minM || 1;
  const binWidthM = span / safeBinCount;

  const buckets = new Map<number, FfsScreenedResult[]>();
  items.forEach((item, index) => {
    const raw = Math.floor(((distances[index] - minM) / span) * safeBinCount);
    const bin = Math.min(safeBinCount - 1, Math.max(0, raw));
    const existing = buckets.get(bin);
    if (existing) existing.push(item);
    else buckets.set(bin, [item]);
  });

  let peakErf = 0;
  let unboundedCount = 0;
  const bands: ErfBand[] = [];

  for (const [index, members] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    let nominalMax = 0;
    let conservativeMax = 0;
    let forecastMax = 0;
    let forecastMin = Infinity;
    let worst = members[0];

    for (const item of members) {
      const nominal = finiteErf(item.nominal.ERF);
      const conservative = finiteErf(item.conservative.ERF);
      const forecast = finiteErf(item.forecast.ERF);
      if (!Number.isFinite(item.forecast.ERF)) unboundedCount += 1;
      nominalMax = Math.max(nominalMax, nominal);
      conservativeMax = Math.max(conservativeMax, conservative);
      forecastMax = Math.max(forecastMax, forecast);
      forecastMin = Math.min(forecastMin, forecast);
      const better = SEVERITY_RANK[item.conservative.severity] - SEVERITY_RANK[worst.conservative.severity];
      if (better > 0 || (better === 0 && item.conservative.ERF > worst.conservative.ERF)) worst = item;
    }

    peakErf = Math.max(peakErf, nominalMax, conservativeMax, forecastMax);
    bands.push({
      index,
      startM: minM + index * binWidthM,
      endM: minM + (index + 1) * binWidthM,
      midM: minM + (index + 0.5) * binWidthM,
      count: members.length,
      nominalMax,
      conservativeMax,
      forecastMax,
      forecastMin: Number.isFinite(forecastMin) ? forecastMin : 0,
      worst,
    });
  }

  const escalated = items
    .filter((item) => item.conservative.severity !== 'pass' || item.forecast.severity !== 'pass')
    .sort((a, b) => finiteErf(b.forecast.ERF) - finiteErf(a.forecast.ERF)
      || b.conservative.ERF - a.conservative.ERF);

  return {
    bands,
    minM,
    maxM,
    peakErf,
    unboundedCount,
    notable: escalated.slice(0, notableLimit),
    notableOmitted: Math.max(0, escalated.length - notableLimit),
  };
}

/**
 * A collapsed feature carries an infinite ERF. It is counted and reported, but
 * it cannot set an axis, so the plotted value falls back to zero and the caller
 * states the count separately.
 */
function finiteErf(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export interface ClockSector {
  /** 0 is 12 o'clock, increasing clockwise. */
  hour: number;
  label: string;
  internal: number;
  external: number;
  total: number;
  /** The deepest feature in this sector, or null when the sector is empty. */
  deepest: FfsScreenedResult | null;
}

export interface ClockRose {
  sectors: ClockSector[];
  internalTotal: number;
  externalTotal: number;
  plotted: number;
  /** Features with no readable clock value; they are counted, never invented. */
  withoutOrientation: number;
  peakCount: number;
  /** Share of plotted features in the 4–8 o'clock invert arc, 0–1. */
  bottomShare: number;
}

/**
 * Counts features per clock hour, split by surface.
 *
 * Internal and external are separate counts rather than two colours on one ring:
 * on a real population the external count dominates by an order of magnitude, so
 * overplotting hid internal corrosion entirely. A reader needs to see both, and
 * a count is the only honest way to compare them.
 */
export function buildClockRose(items: readonly FfsScreenedResult[]): ClockRose {
  const sectors: ClockSector[] = Array.from({ length: 12 }, (_, hour) => ({
    hour,
    label: String(hour === 0 ? 12 : hour),
    internal: 0,
    external: 0,
    total: 0,
    deepest: null,
  }));

  let withoutOrientation = 0;
  let bottomCount = 0;

  for (const item of items) {
    const clock = item.clockHour;
    if (clock === null || !Number.isFinite(clock)) {
      withoutOrientation += 1;
      continue;
    }
    // 12:30 belongs to the 12 o'clock sector; 12:00 exactly is the sector edge.
    const hour = ((Math.floor(clock) % 12) + 12) % 12;
    const sector = sectors[hour];
    if (isInternal(item)) sector.internal += 1;
    else sector.external += 1;
    sector.total += 1;
    if (!sector.deepest || item.nominal.maxDepthPct > sector.deepest.nominal.maxDepthPct) {
      sector.deepest = item;
    }
    if (clock >= 4 && clock <= 8) bottomCount += 1;
  }

  const plotted = items.length - withoutOrientation;
  return {
    sectors,
    internalTotal: sectors.reduce((sum, sector) => sum + sector.internal, 0),
    externalTotal: sectors.reduce((sum, sector) => sum + sector.external, 0),
    plotted,
    withoutOrientation,
    peakCount: Math.max(0, ...sectors.map((sector) => sector.total)),
    bottomShare: plotted > 0 ? bottomCount / plotted : 0,
  };
}
