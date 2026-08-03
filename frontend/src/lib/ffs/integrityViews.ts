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
  const minM = Math.min(...distances);
  const maxM = Math.max(...distances);
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
