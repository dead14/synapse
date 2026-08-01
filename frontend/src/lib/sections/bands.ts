/**
 * Section bands — where each named stretch of the line actually sits along the
 * distance axis.
 *
 * Every chart in the application plots against log distance, and until now an
 * engineer reading one had to remember which metre range "RC#86" covers. A band
 * is that mapping, derived from the features themselves so it works on any
 * dataset that carries a section name, without a second API call and without
 * assuming the alignment session is still loaded.
 *
 * The extents are the observed extents: a band runs from the first to the last
 * feature reported inside it. A gap between two bands is a real gap in the
 * reported population, not a rendering artefact, and it is left visible.
 */

import { SECTION_TYPE_COLORS } from '../../sectioning/sectionColors.ts';

/** Names the engine writes when the line has not been sectioned. */
const UNSECTIONED = new Set(['-', '', 'unclassified', 'n/a', 'none']);

/**
 * Fallback palette for section names that carry no recognised type prefix.
 * Chosen to stay distinguishable against both the light and dark chart grids.
 */
const BAND_PALETTE = [
  '#6366f1', '#0ea5e9', '#14b8a6', '#f59e0b', '#ec4899',
  '#8b5cf6', '#22c55e', '#f97316', '#06b6d4', '#e11d48',
];

export interface SectionBandPoint {
  distanceM: number | null;
  section: string;
}

export interface SectionBand {
  /** Stable across renders for the same population. */
  id: string;
  name: string;
  /** Distance of the first feature in this stretch, in metres. */
  startM: number;
  /** Distance of the last feature in this stretch, in metres. */
  endM: number;
  count: number;
  color: string;
  /** Position along the line, left to right, starting at 0. */
  order: number;
}

export function isSectioned(name: string): boolean {
  return !UNSECTIONED.has(String(name ?? '').trim().toLowerCase());
}

/** True once at least one feature carries a real section name. */
export function hasSectionNames(points: SectionBandPoint[]): boolean {
  return points.some((point) => isSectioned(point.section));
}

function hashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Colour for a section name. A recognised sectioning type prefix — RL, AL, RIS,
 * ROC, BUR, CAS, BND — keeps the colour it has in the sectioning workbench, so
 * a river crossing reads the same everywhere. Anything else gets a stable
 * palette entry derived from the name.
 */
export function sectionBandColor(name: string): string {
  const upper = name.trim().toUpperCase();
  const prefix = upper.match(/^[A-Z]+/)?.[0] ?? '';
  for (const type of Object.keys(SECTION_TYPE_COLORS)) {
    if (prefix === type) return SECTION_TYPE_COLORS[type];
  }
  return BAND_PALETTE[hashCode(upper) % BAND_PALETTE.length];
}

/**
 * Groups features into contiguous runs of the same section name along the line.
 *
 * A run ends when a *different* named section appears, so unsectioned features
 * scattered through a stretch do not chop it into pieces. The same name can
 * legitimately produce two bands when another section sits between them — a
 * pipeline can cross the same river twice.
 */
export function buildSectionBands(points: SectionBandPoint[]): SectionBand[] {
  const named = points
    .filter((point) => point.distanceM !== null
      && Number.isFinite(point.distanceM)
      && isSectioned(point.section))
    .map((point) => ({ distanceM: point.distanceM as number, name: point.section.trim() }))
    .sort((left, right) => left.distanceM - right.distanceM);

  const bands: SectionBand[] = [];
  for (const point of named) {
    const current = bands[bands.length - 1];
    if (current && current.name === point.name) {
      current.endM = point.distanceM;
      current.count += 1;
      continue;
    }
    bands.push({
      id: `${point.name}#${bands.length}`,
      name: point.name,
      startM: point.distanceM,
      endM: point.distanceM,
      count: 1,
      color: sectionBandColor(point.name),
      order: bands.length,
    });
  }
  return bands;
}

/** The band a distance falls in, or null when it sits in a gap. */
export function bandForDistance(bands: SectionBand[], distanceM: number): SectionBand | null {
  for (const band of bands) {
    if (distanceM >= band.startM && distanceM <= band.endM) return band;
  }
  return null;
}

/** Formats a band's extent the way the KP axis reads it. */
export function formatBandRange(band: SectionBand): string {
  const start = band.startM / 1000;
  const end = band.endM / 1000;
  if (Math.abs(end - start) < 0.005) return `KP ${start.toFixed(2)}`;
  return `KP ${start.toFixed(2)}–${end.toFixed(2)}`;
}

/** Length of a band's reported extent, in metres. */
export function bandLengthM(band: SectionBand): number {
  return band.endM - band.startM;
}
