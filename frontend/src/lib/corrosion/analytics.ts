/**
 * Corrosion analytics — what can actually be read out of an aligned run pair.
 *
 * Everything here is derived from fields the alignment engine already produces
 * (see `analysis.ts` / `hungarian_engine.format_row`). Nothing is invented: where
 * a quantity needs pipe geometry the engine does not carry (an acceptance
 * envelope needs OD and SMYS), the function takes it as an explicit argument and
 * returns null when it is missing, rather than assuming a diameter.
 *
 * All functions are pure so they can be unit-tested without a DOM.
 */

import type { CorrosionFeature } from './analysis.ts';
import { isMetalLoss } from './analysis.ts';

/* ── Severity ─────────────────────────────────────────────────────────────── */

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export const SEVERITY_ORDER: Severity[] = ['low', 'medium', 'high', 'critical'];

export interface SeverityThresholds {
  /** Depth at or above this is critical, regardless of ERF. */
  criticalDepthPct: number;
  highDepthPct: number;
  mediumDepthPct: number;
  /** ERF at or above this is critical — failure pressure at or below MAOP. */
  criticalErf: number;
  highErf: number;
}

export const DEFAULT_SEVERITY_THRESHOLDS: SeverityThresholds = {
  criticalDepthPct: 60,
  highDepthPct: 40,
  mediumDepthPct: 20,
  criticalErf: 1,
  highErf: 0.9,
};

/**
 * Severity of a single feature. ERF and depth are both checked because either
 * can be the binding constraint: a shallow but very long defect can carry a high
 * ERF, and a short deep one can sit below ERF 0.9 while still being near-wall.
 */
export function severityOf(
  feature: CorrosionFeature,
  thresholds: SeverityThresholds = DEFAULT_SEVERITY_THRESHOLDS,
): Severity {
  const depth = feature.depthPct;
  const erf = feature.erf;
  if ((erf !== null && erf >= thresholds.criticalErf)
    || (depth !== null && depth >= thresholds.criticalDepthPct)) return 'critical';
  if ((erf !== null && erf >= thresholds.highErf)
    || (depth !== null && depth >= thresholds.highDepthPct)) return 'high';
  if (depth !== null && depth >= thresholds.mediumDepthPct) return 'medium';
  return 'low';
}

export type SeverityCounts = Record<Severity, number>;

export function emptySeverityCounts(): SeverityCounts {
  return { low: 0, medium: 0, high: 0, critical: 0 };
}

export function countBySeverity(
  features: CorrosionFeature[],
  thresholds: SeverityThresholds = DEFAULT_SEVERITY_THRESHOLDS,
): SeverityCounts {
  const counts = emptySeverityCounts();
  for (const feature of features) counts[severityOf(feature, thresholds)] += 1;
  return counts;
}

/* ── Depth distribution ───────────────────────────────────────────────────── */

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
  label: string;
}

/**
 * Depth population in %WT bands. Bands are the shape of the wall-loss
 * population — the single most-read corrosion figure.
 */
export function depthHistogram(features: CorrosionFeature[], binPct = 10): HistogramBin[] {
  if (!(binPct > 0)) return [];
  const bins: HistogramBin[] = [];
  for (let from = 0; from < 100; from += binPct) {
    const to = Math.min(100, from + binPct);
    bins.push({ from, to, count: 0, label: `${from}–${to}` });
  }
  for (const feature of features) {
    const depth = feature.depthPct;
    if (depth === null || depth < 0) continue;
    const index = Math.min(bins.length - 1, Math.floor(depth / binPct));
    bins[index].count += 1;
  }
  return bins;
}

/* ── Growth / corrosion rate ──────────────────────────────────────────────── */

export interface GrowthBin extends HistogramBin {
  /** Below zero means the reported depth shrank between runs. */
  sign: -1 | 0 | 1;
}

/**
 * Depth-growth population, signed. Negative bins are not noise to be hidden:
 * a shrinking reported depth usually means a tool-tolerance or re-sizing
 * difference between vendors, and the size of that left tail is how an engineer
 * judges whether the growth numbers can be trusted at all.
 */
export function growthHistogram(
  features: CorrosionFeature[],
  binPctPerYear = 0.25,
  clamp = 3,
): GrowthBin[] {
  if (!(binPctPerYear > 0) || !(clamp > 0)) return [];
  const bins: GrowthBin[] = [];
  for (let from = -clamp; from < clamp - 1e-9; from += binPctPerYear) {
    const to = from + binPctPerYear;
    const mid = (from + to) / 2;
    bins.push({
      from,
      to,
      count: 0,
      sign: mid > 1e-9 ? 1 : mid < -1e-9 ? -1 : 0,
      label: `${from.toFixed(2)}–${to.toFixed(2)}`,
    });
  }
  if (bins.length === 0) return [];
  for (const feature of features) {
    const growth = feature.depthGrowthPctWtPerYear;
    if (growth === null) continue;
    const bounded = Math.min(clamp - 1e-9, Math.max(-clamp, growth));
    const index = Math.min(bins.length - 1, Math.max(0, Math.floor((bounded + clamp) / binPctPerYear)));
    bins[index].count += 1;
  }
  return bins;
}

/* ── Orientation ──────────────────────────────────────────────────────────── */

/** Reads "5:30", "5.5", "05:30:00" or "6" into an hour in [0, 12). */
export function parseClockHour(clock: string): number | null {
  const raw = String(clock ?? '').trim();
  if (!raw || raw === '-') return null;
  const colon = raw.match(/^(\d{1,2})\s*[:.]\s*(\d{1,2})/);
  if (colon) {
    const hour = Number(colon[1]);
    const minute = Number(colon[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    // "5.5" is half past five, but "5.30" from a decimal-comma locale is too;
    // minutes never exceed 59, so a 1-digit fraction is read as tenths.
    const asMinutes = colon[2].length === 1 ? (minute / 10) * 60 : minute;
    return ((hour % 12) + asMinutes / 60 + 12) % 12;
  }
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  return ((numeric % 12) + 12) % 12;
}

export interface ClockSector {
  /** Whole hour 0–11; 0 is the 12 o'clock position (top of pipe). */
  hour: number;
  internal: number;
  external: number;
  unknown: number;
  total: number;
}

function surfaceOf(feature: CorrosionFeature): 'internal' | 'external' | 'unknown' {
  const value = feature.surface.toLowerCase();
  if (value.startsWith('int') || value === 'i') return 'internal';
  if (value.startsWith('ext') || value === 'e') return 'external';
  return 'unknown';
}

/**
 * Metal loss binned by clock position and surface.
 *
 * This is a diagnostic, not just a picture. Internal loss concentrated at
 * 5–7 o'clock is the signature of water dropout along the invert; external loss
 * concentrated at 10–2 points at coating disbondment or CP shielding on the
 * crown. A flat rose means neither mechanism dominates.
 */
export function clockRose(features: CorrosionFeature[]): ClockSector[] {
  const sectors: ClockSector[] = Array.from({ length: 12 }, (_, hour) => ({
    hour,
    internal: 0,
    external: 0,
    unknown: 0,
    total: 0,
  }));
  for (const feature of features) {
    const hour = parseClockHour(feature.clock);
    if (hour === null) continue;
    const sector = sectors[Math.floor(hour) % 12];
    sector[surfaceOf(feature)] += 1;
    sector.total += 1;
  }
  return sectors;
}

export interface OrientationVerdict {
  dominant: 'internal-invert' | 'external-crown' | 'mixed' | 'insufficient';
  internalShare: number;
  externalShare: number;
  /** Share of internal loss sitting between 4 and 8 o'clock. */
  invertShare: number;
  /** Share of external loss sitting between 10 and 2 o'clock. */
  crownShare: number;
}

/** Turns the rose into the sentence an engineer would write under it. */
export function orientationVerdict(features: CorrosionFeature[]): OrientationVerdict {
  let internal = 0;
  let external = 0;
  let internalInvert = 0;
  let externalCrown = 0;

  for (const feature of features) {
    const hour = parseClockHour(feature.clock);
    if (hour === null) continue;
    const surface = surfaceOf(feature);
    if (surface === 'internal') {
      internal += 1;
      if (hour >= 4 && hour <= 8) internalInvert += 1;
    } else if (surface === 'external') {
      external += 1;
      if (hour >= 10 || hour <= 2) externalCrown += 1;
    }
  }

  const total = internal + external;
  const invertShare = internal > 0 ? internalInvert / internal : 0;
  const crownShare = external > 0 ? externalCrown / external : 0;

  if (total < 20) {
    return { dominant: 'insufficient', internalShare: 0, externalShare: 0, invertShare, crownShare };
  }

  const internalShare = internal / total;
  const externalShare = external / total;

  let dominant: OrientationVerdict['dominant'] = 'mixed';
  if (internalShare >= 0.6 && invertShare >= 0.5) dominant = 'internal-invert';
  else if (externalShare >= 0.6 && crownShare >= 0.5) dominant = 'external-crown';

  return { dominant, internalShare, externalShare, invertShare, crownShare };
}

/* ── Remaining life ───────────────────────────────────────────────────────── */

/**
 * Years until the feature reaches `limitPct` of wall at its measured growth
 * rate. Null when the feature is not measurably growing — extrapolating a flat
 * or negative rate would invent a date.
 */
export function remainingLifeYears(feature: CorrosionFeature, limitPct = 80): number | null {
  const depth = feature.depthPct;
  const growth = feature.depthGrowthPctWtPerYear;
  if (depth === null || growth === null || growth <= 0) return null;
  if (depth >= limitPct) return 0;
  return (limitPct - depth) / growth;
}

export interface RemainingLifeEntry {
  feature: CorrosionFeature;
  years: number;
  severity: Severity;
}

/** Growing features ranked by how soon they reach the wall-loss limit. */
export function remainingLifeRanking(
  features: CorrosionFeature[],
  limitPct = 80,
  thresholds: SeverityThresholds = DEFAULT_SEVERITY_THRESHOLDS,
): RemainingLifeEntry[] {
  const entries: RemainingLifeEntry[] = [];
  for (const feature of features) {
    const years = remainingLifeYears(feature, limitPct);
    if (years === null) continue;
    entries.push({ feature, years, severity: severityOf(feature, thresholds) });
  }
  return entries.sort((left, right) => left.years - right.years);
}

/* ── Density along the line ───────────────────────────────────────────────── */

export interface DensityWindow {
  startM: number;
  endM: number;
  count: number;
  /** Features per kilometre in this window. */
  perKm: number;
}

export interface DensityProfile {
  windows: DensityWindow[];
  peak: DensityWindow | null;
  /** Contiguous run of windows at or above the hotspot threshold. */
  hotspot: { startM: number; endM: number; count: number } | null;
  meanPerKm: number;
}

/**
 * Anomaly concentration along the line, plus the worst contiguous stretch.
 *
 * A hotspot is where a coating failure, a CP shadow, or a low point shows up as
 * a cluster — it is the thing that turns a list of defects into a location to go
 * and dig.
 */
export function densityByKp(
  features: CorrosionFeature[],
  windowM = 500,
  hotspotFactor = 1.5,
): DensityProfile {
  const distances = features
    .map((feature) => feature.distanceM)
    .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0);

  if (distances.length === 0 || !(windowM > 0)) {
    return { windows: [], peak: null, hotspot: null, meanPerKm: 0 };
  }

  const maxDistance = Math.max(...distances);
  const windowCount = Math.max(1, Math.ceil((maxDistance + 1e-6) / windowM));
  const windows: DensityWindow[] = Array.from({ length: windowCount }, (_, index) => ({
    startM: index * windowM,
    endM: (index + 1) * windowM,
    count: 0,
    perKm: 0,
  }));

  for (const distance of distances) {
    const index = Math.min(windowCount - 1, Math.floor(distance / windowM));
    windows[index].count += 1;
  }
  for (const window of windows) window.perKm = (window.count * 1000) / windowM;

  const meanPerKm = windows.reduce((sum, window) => sum + window.perKm, 0) / windows.length;
  const threshold = meanPerKm * hotspotFactor;

  let peak = windows[0];
  for (const window of windows) if (window.count > peak.count) peak = window;

  // Widest contiguous stretch above the threshold, anchored on the peak so the
  // reported hotspot always contains the worst window.
  let hotspot: DensityProfile['hotspot'] = null;
  if (peak.perKm >= threshold && threshold > 0) {
    const peakIndex = windows.indexOf(peak);
    let start = peakIndex;
    let end = peakIndex;
    while (start > 0 && windows[start - 1].perKm >= threshold) start -= 1;
    while (end < windows.length - 1 && windows[end + 1].perKm >= threshold) end += 1;
    let count = 0;
    for (let index = start; index <= end; index += 1) count += windows[index].count;
    hotspot = { startM: windows[start].startM, endM: windows[end].endM, count };
  }

  return { windows, peak, hotspot, meanPerKm };
}

/* ── Sections ─────────────────────────────────────────────────────────────── */

export interface SectionSeverity {
  section: string;
  counts: SeverityCounts;
  total: number;
  /** Share of this section's features that are high or critical. */
  criticalDensity: number;
}

const UNSECTIONED = new Set(['-', '', 'unclassified']);

/** True once the engineer has actually sectioned the line in stage 4. */
export function hasSections(features: CorrosionFeature[]): boolean {
  return features.some((feature) => !UNSECTIONED.has(feature.section.trim().toLowerCase()));
}

/**
 * Severity profile per section. Only meaningful when the engineer defined
 * sections during alignment — otherwise every feature lands in one bucket and
 * the chart says nothing.
 */
export function severityBySection(
  features: CorrosionFeature[],
  thresholds: SeverityThresholds = DEFAULT_SEVERITY_THRESHOLDS,
): SectionSeverity[] {
  const bySection = new Map<string, SeverityCounts>();
  for (const feature of features) {
    const name = feature.section.trim();
    if (UNSECTIONED.has(name.toLowerCase())) continue;
    let counts = bySection.get(name);
    if (!counts) {
      counts = emptySeverityCounts();
      bySection.set(name, counts);
    }
    counts[severityOf(feature, thresholds)] += 1;
  }

  return Array.from(bySection.entries())
    .map(([section, counts]) => {
      const total = SEVERITY_ORDER.reduce((sum, key) => sum + counts[key], 0);
      return {
        section,
        counts,
        total,
        criticalDensity: total > 0 ? (counts.high + counts.critical) / total : 0,
      };
    })
    .sort((left, right) => right.total - left.total);
}

/* ── Review queue ─────────────────────────────────────────────────────────── */

export interface RiskEntry {
  feature: CorrosionFeature;
  severity: Severity;
  score: number;
  remainingLife: number | null;
  drivers: string[];
}

/**
 * Composite ranking for the review queue.
 *
 * The score exists to order the queue, not to be quoted as a number — so each
 * entry also carries the plain-language drivers that pushed it up, and the queue
 * is presented with those drivers rather than the score alone.
 */
export function riskRanking(
  features: CorrosionFeature[],
  thresholds: SeverityThresholds = DEFAULT_SEVERITY_THRESHOLDS,
): RiskEntry[] {
  const entries: RiskEntry[] = [];

  for (const feature of features) {
    if (!isMetalLoss(feature)) continue;

    const depth = feature.depthPct ?? 0;
    const erf = feature.erf;
    const growth = feature.depthGrowthPctWtPerYear;
    const life = remainingLifeYears(feature);

    const drivers: string[] = [];
    // Depth carries the most weight: it is the measurement every other number
    // here is derived from, and the one least sensitive to run pairing.
    let score = depth;
    if (erf !== null && erf >= thresholds.highErf) {
      score += (erf - thresholds.highErf) * 200;
      drivers.push(erf >= thresholds.criticalErf ? 'ERF at or above 1' : 'High ERF');
    }
    if (growth !== null && growth > 0) {
      score += growth * 20;
      if (feature.growthClass === 'active') drivers.push('Active growth');
    }
    if (life !== null && life <= 10) {
      score += (10 - life) * 4;
      drivers.push(life <= 5 ? 'Under 5 years remaining' : 'Under 10 years remaining');
    }
    if (depth >= thresholds.criticalDepthPct) drivers.push('Deep wall loss');
    if (feature.physicsWarning !== '-') drivers.push('Physics warning');
    if (!feature.ffsReady) drivers.push('Incomplete dimensions');

    entries.push({
      feature,
      severity: severityOf(feature, thresholds),
      score,
      remainingLife: life,
      drivers,
    });
  }

  return entries.sort((left, right) => right.score - left.score);
}

/* ── Population splits ────────────────────────────────────────────────────── */

export interface SurfaceSplit {
  internal: number;
  external: number;
  unknown: number;
}

export function surfaceSplit(features: CorrosionFeature[]): SurfaceSplit {
  const split: SurfaceSplit = { internal: 0, external: 0, unknown: 0 };
  for (const feature of features) split[surfaceOf(feature)] += 1;
  return split;
}

export interface PopulationChange {
  /** Present in both runs. */
  matched: number;
  /** Only in the NEW run — corrosion that appeared since the last inspection. */
  newlyReported: number;
  /** Matched and measurably growing. */
  growing: number;
  /** Matched and not growing. */
  dormant: number;
}

/**
 * How the population changed between runs. "New since last inspection" and
 * "already there and growing" call for different responses, and the split is
 * usually the first question after an alignment finishes.
 */
export function populationChange(features: CorrosionFeature[]): PopulationChange {
  const change: PopulationChange = { matched: 0, newlyReported: 0, growing: 0, dormant: 0 };
  for (const feature of features) {
    const matched = /match/i.test(feature.matchStatus) && !/unmatch/i.test(feature.matchStatus);
    if (!matched) {
      change.newlyReported += 1;
      continue;
    }
    change.matched += 1;
    const growth = feature.depthGrowthPctWtPerYear;
    if (growth !== null && growth > 0) change.growing += 1;
    else change.dormant += 1;
  }
  return change;
}

/* ── Headline metrics ─────────────────────────────────────────────────────── */

export interface CorrosionVitals {
  metalLoss: number;
  assessable: number;
  incomplete: number;
  maxDepthPct: number | null;
  maxErf: number | null;
  activeGrowth: number;
  worstRemainingLife: number | null;
  severity: SeverityCounts;
}

export function corrosionVitals(
  features: CorrosionFeature[],
  thresholds: SeverityThresholds = DEFAULT_SEVERITY_THRESHOLDS,
): CorrosionVitals {
  const metalLoss = features.filter(isMetalLoss);
  let maxDepthPct: number | null = null;
  let maxErf: number | null = null;
  let activeGrowth = 0;
  let incomplete = 0;

  for (const feature of metalLoss) {
    if (feature.depthPct !== null && (maxDepthPct === null || feature.depthPct > maxDepthPct)) {
      maxDepthPct = feature.depthPct;
    }
    if (feature.erf !== null && (maxErf === null || feature.erf > maxErf)) maxErf = feature.erf;
    if (feature.growthClass === 'active') activeGrowth += 1;
    if (!feature.ffsReady) incomplete += 1;
  }

  const ranking = remainingLifeRanking(metalLoss);

  return {
    metalLoss: metalLoss.length,
    assessable: metalLoss.length - incomplete,
    incomplete,
    maxDepthPct,
    maxErf,
    activeGrowth,
    worstRemainingLife: ranking.length > 0 ? ranking[0].years : null,
    severity: countBySeverity(metalLoss, thresholds),
  };
}
