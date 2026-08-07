/**
 * Feature model for the Spool Detail View.
 *
 * `comparisonLanes` folds the pair-shaped result rows into one lane per run so
 * a reviewer can read a feature's life across a chain of inspections. The spool
 * view asks the opposite question — "what is on this piece of pipe right now,
 * and how did it change since the last run" — so it keeps the row's pair shape
 * and exposes it as a CURRENT side, a PREVIOUS side, and the deltas between
 * them. Nothing here is invented: every field is either read straight off the
 * engine row or derived by an arithmetic that is named on the type.
 *
 * Two derivations deserve their own note:
 *
 * - `remainingWtMm` is `wall × (1 − depth%)`. It is only produced when the row
 *   carries a wall thickness; a missing wall gives null rather than a guess.
 * - `arcWidthDeg` is NOT computed here. Turning a width in millimetres into an
 *   angle needs the pipe's outside diameter, which the alignment session never
 *   carries, and the codebase's rule is to leave diameter-dependent geometry
 *   unset rather than draw a picture of a pipe that is not this pipe.
 */

import { classifyFeatureKind, type FeatureKind } from './comparisonLanes.ts';
import { parseClockToDegrees } from '../utils/clock.ts';
import { maxOf, minOf } from '../utils/numericRange.ts';

export type ComparisonRow = Record<string, unknown>;

/** How the current run's feature relates to the run it was compared against. */
export type SpoolMatchStatus =
  | 'matched-no-growth'
  | 'matched-growth'
  | 'new'
  | 'prev-only'
  | 'bypassed';

/** Anomaly families the layer switches turn on and off. */
export type SpoolFeatureClass = 'weld' | 'metal-loss' | 'dent' | 'crack-like' | 'other';

/** One run's view of a feature, as that run reported it. */
export interface SpoolSide {
  present: boolean;
  id: string | null;
  /** Distance on the shared master axis, which is what every view draws on. */
  maM: number | null;
  /** The distance printed in that run's own tally. */
  reportedM: number | null;
  depthPct: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  clockDeg: number | null;
  clockLabel: string;
  wtMm: number | null;
  /** Vendor-reported ERF. Null when the tally did not carry one. */
  erf: number | null;
  /** Vendor-reported safe pressure, in bar. */
  psafeBar: number | null;
  external: boolean | null;
  jointNo: string | null;
  distGwM: number | null;
  featureType: string;
  year: number | null;
  /** wall × (1 − depth%), or null when the wall thickness is missing. */
  remainingWtMm: number | null;
}

export interface SpoolFeature {
  key: string;
  /** Index into the rows array handed to {@link buildSpoolModel}. */
  rowIndex: number;
  id: string;
  kind: FeatureKind;
  featureClass: SpoolFeatureClass;
  status: SpoolMatchStatus;
  /** Master-axis position used by every view: current run first, previous as fallback. */
  maM: number;
  /** Clock used by every view, on the same current-first rule. */
  clockDeg: number;
  clockLabel: string;
  current: SpoolSide;
  previous: SpoolSide;
  /** Deltas are current − previous, and are null unless both sides carry the value. */
  depthDeltaPct: number | null;
  lengthDeltaMm: number | null;
  widthDeltaMm: number | null;
  erfDelta: number | null;
  remainingWtDeltaMm: number | null;
  maShiftM: number | null;
  /** Engine-computed rates, straight off the row. */
  depthGrowthPctPerYear: number | null;
  lengthGrowthMmPerYear: number | null;
  intervalYears: number | null;
  section: string | null;
  bypassReason: string | null;
  physicsWarning: string | null;
  comment: string | null;
}

export interface SpoolRunInfo {
  label: string;
  year: number | null;
}

export interface SpoolModel {
  features: SpoolFeature[];
  /** Girth welds on the master axis, sorted, used as markers in both views. */
  welds: Array<{ id: string; maM: number; rowIndex: number }>;
  currentRun: SpoolRunInfo;
  previousRun: SpoolRunInfo;
  hasComparison: boolean;
  extentM: { startM: number; endM: number } | null;
}

const MISSING = new Set(['', '-', 'nan', 'null', 'undefined', 'n/a']);

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function present(value: unknown): boolean {
  const raw = text(value);
  return raw !== '' && !MISSING.has(raw.toLowerCase());
}

function num(value: unknown): number | null {
  if (!present(value)) return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function str(value: unknown): string | null {
  return present(value) ? text(value) : null;
}

/** Clock label in the HH:MM shape the tallies use, from degrees. */
export function clockLabelFromDegrees(deg: number | null): string {
  if (deg === null) return '—';
  const hours = ((deg / 30) % 12 + 12) % 12;
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  const carried = minutes === 60;
  const hh = carried ? (whole + 1) % 12 : whole;
  const mm = carried ? 0 : minutes;
  return `${hh === 0 ? 12 : hh}:${String(mm).padStart(2, '0')}`;
}

/**
 * Anomaly family for the layer switches. Welds come from the shared kind
 * classifier so the spool view and the lane timeline never disagree on what a
 * girth weld is.
 */
export function classifyFeatureFamily(kind: FeatureKind, featureType: string): SpoolFeatureClass {
  if (kind === 'weld') return 'weld';
  const haystack = featureType.toLowerCase();
  if (/crack|lamination|\bscc\b|inclusion/.test(haystack)) return 'crack-like';
  if (/dent|deform|ovality|buckle|wrinkle/.test(haystack)) return 'dent';
  if (/metal[\s_-]?loss|corros|pitting|gouge|erosion|\bml\b/.test(haystack)) return 'metal-loss';
  return 'other';
}

function isExternal(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (!present(value)) continue;
    const raw = text(value).toUpperCase();
    if (raw.includes('EXT')) return true;
    if (raw.includes('INT')) return false;
  }
  return null;
}

function readSide(row: ComparisonRow, side: 'OLD' | 'NEW'): SpoolSide {
  const id = str(row[`Identif. ${side}`]) ?? str(row[`Feature ID ${side}`]);
  const maM = num(row[`Log Dist ${side} (m)`]);
  const depthPct = num(row[`Depth ${side} (%WT)`]);
  const wtMm = num(row[`Wall WT ${side} (mm)`]);
  const clockRaw = row[`O'Clock ${side}`];
  const clockDeg = present(clockRaw) ? parseClockToDegrees(clockRaw) : null;
  return {
    present: id !== null || maM !== null,
    id,
    maM,
    reportedM: num(row[`Original Log Dist ${side} (m)`]) ?? maM,
    depthPct,
    lengthMm: num(row[`Length ${side} (mm)`]),
    widthMm: num(row[`Width ${side} (mm)`]),
    clockDeg,
    clockLabel: clockDeg === null ? '—' : clockLabelFromDegrees(clockDeg),
    wtMm,
    erf: num(row[`ERF ASME ${side}`]),
    psafeBar: num(row[`Psafe ${side} (bar)`]),
    external: isExternal(row[`Int/Ext ${side}`], row[`Surface ${side}`]),
    jointNo: str(row[`Joint No. ${side}`]),
    distGwM: num(row[`Dist GW ${side} (m)`]),
    featureType: str(row[`Feature Type ${side}`]) ?? '',
    year: num(row[`Run Year ${side}`]),
    remainingWtMm:
      wtMm !== null && depthPct !== null ? wtMm * (1 - depthPct / 100) : null,
  };
}

function delta(current: number | null, previous: number | null): number | null {
  return current !== null && previous !== null ? current - previous : null;
}

/** Depth change small enough that calling it growth would overstate the tools. */
const GROWTH_EPSILON_PCT_WT = 1;

function classifyStatus(
  row: ComparisonRow,
  current: SpoolSide,
  previous: SpoolSide,
  depthDeltaPct: number | null,
  lengthDeltaMm: number | null,
): SpoolMatchStatus {
  const resultGroup = text(row['Result Group']).toLowerCase();
  const matchStatus = text(row.match_status ?? row['Match/Unmatch']).toLowerCase();
  // The engine parks anything it refuses to align — clusters above all — in a
  // bypassed bucket. That is a statement about the alignment, not about the
  // metal, so it gets its own status instead of being read as "new".
  if (resultGroup.includes('bypass') || present(row['Bypass Reason']) || matchStatus.includes('bypass')) {
    return 'bypassed';
  }
  if (current.present && previous.present) {
    const grew =
      (depthDeltaPct !== null && depthDeltaPct >= GROWTH_EPSILON_PCT_WT)
      || (lengthDeltaMm !== null && lengthDeltaMm > 0 && depthDeltaPct === null);
    return grew ? 'matched-growth' : 'matched-no-growth';
  }
  return current.present ? 'new' : 'prev-only';
}

export const STATUS_LABEL: Record<SpoolMatchStatus, string> = {
  'matched-no-growth': 'Matched (No Growth)',
  'matched-growth': 'Matched (Growth)',
  new: 'New (Not in Previous)',
  'prev-only': 'Not Reported (Prev Only)',
  bypassed: 'Bypassed (Not Aligned)',
};

/**
 * Fold the engine's comparison rows into one feature per row, with the current
 * run in front and the previous run kept alongside for the deltas.
 */
export function buildSpoolModel(rows: readonly ComparisonRow[]): SpoolModel {
  const features: SpoolFeature[] = [];
  const welds: Array<{ id: string; maM: number; rowIndex: number }> = [];
  let currentRun: SpoolRunInfo = { label: 'Current run', year: null };
  let previousRun: SpoolRunInfo = { label: 'Previous run', year: null };
  let sawPrevious = false;

  rows.forEach((row, rowIndex) => {
    if (!row || row.__excluded === true) return;

    const current = readSide(row, 'NEW');
    const previous = readSide(row, 'OLD');
    if (!current.present && !previous.present) return;

    if (current.year !== null && currentRun.year === null) {
      currentRun = { label: `ILI ${current.year}`, year: current.year };
    }
    if (previous.year !== null && previousRun.year === null) {
      previousRun = { label: `ILI ${previous.year}`, year: previous.year };
    }
    if (previous.present) sawPrevious = true;

    const maM = current.maM ?? previous.maM;
    if (maM === null) return;

    const featureType = current.featureType || previous.featureType;
    const kind = classifyFeatureKind(featureType, text(row['Result Group']));
    const id = current.id ?? previous.id ?? `row-${rowIndex}`;

    if (kind === 'weld') {
      welds.push({ id, maM, rowIndex });
      return;
    }

    const depthDeltaPct = delta(current.depthPct, previous.depthPct);
    const lengthDeltaMm = delta(current.lengthMm, previous.lengthMm);
    const clockDeg = current.clockDeg ?? previous.clockDeg;
    const intervalYears =
      current.year !== null && previous.year !== null && current.year !== previous.year
        ? current.year - previous.year
        : null;

    features.push({
      key: `${rowIndex}:${id}`,
      rowIndex,
      id,
      kind,
      featureClass: classifyFeatureFamily(kind, featureType),
      status: classifyStatus(row, current, previous, depthDeltaPct, lengthDeltaMm),
      maM,
      clockDeg: clockDeg ?? 0,
      clockLabel: clockDeg === null ? '—' : clockLabelFromDegrees(clockDeg),
      current,
      previous,
      depthDeltaPct,
      lengthDeltaMm,
      widthDeltaMm: delta(current.widthMm, previous.widthMm),
      erfDelta: delta(current.erf, previous.erf),
      remainingWtDeltaMm: delta(current.remainingWtMm, previous.remainingWtMm),
      maShiftM: delta(current.maM, previous.maM),
      depthGrowthPctPerYear: num(row['Depth Growth (%WT/yr)']),
      lengthGrowthMmPerYear: num(row['Length Growth (mm/yr)']),
      intervalYears,
      section: str(row.Section) ?? str(row['Section NEW']) ?? str(row['Section OLD']),
      bypassReason: str(row['Bypass Reason']),
      physicsWarning: str(row['Physics Warning']),
      comment: str(row['Comment NEW']) ?? str(row['Comment OLD']),
    });
  });

  welds.sort((left, right) => left.maM - right.maM);
  features.sort((left, right) => left.maM - right.maM);

  const positions = [...features.map((feature) => feature.maM), ...welds.map((weld) => weld.maM)];
  const extentM = positions.length
    ? { startM: minOf(positions), endM: maxOf(positions) }
    : null;

  return { features, welds, currentRun, previousRun, hasComparison: sawPrevious, extentM };
}

// ─── Filtering ─────────────────────────────────────────────────────────────

export type SurfaceFilter = 'all' | 'internal' | 'external';
export type DepthBand = 'all' | 'lt20' | '20-40' | '40-60' | 'gte60';
export type GrowthFilter = 'all' | 'growing' | 'stable';

export interface SpoolLayers {
  weld: boolean;
  'metal-loss': boolean;
  dent: boolean;
  'crack-like': boolean;
  other: boolean;
  /** Draw the previous run's footprint alongside the current one. */
  previousRun: boolean;
  currentRun: boolean;
}

export interface SpoolFilters {
  featureClass: 'all' | SpoolFeatureClass;
  surface: SurfaceFilter;
  depthBand: DepthBand;
  status: 'all' | SpoolMatchStatus;
  growth: GrowthFilter;
  clockFromDeg: number;
  clockToDeg: number;
  maStartM: number;
  maEndM: number;
}

export const DEFAULT_LAYERS: SpoolLayers = {
  weld: true,
  'metal-loss': true,
  dent: true,
  'crack-like': false,
  other: false,
  previousRun: true,
  currentRun: true,
};

export function defaultFilters(startM: number, endM: number): SpoolFilters {
  return {
    featureClass: 'all',
    surface: 'all',
    depthBand: 'all',
    status: 'all',
    growth: 'all',
    clockFromDeg: 0,
    clockToDeg: 360,
    maStartM: startM,
    maEndM: endM,
  };
}

function inClockWindow(deg: number, fromDeg: number, toDeg: number): boolean {
  if (toDeg - fromDeg >= 360) return true;
  const normalized = ((deg % 360) + 360) % 360;
  const from = ((fromDeg % 360) + 360) % 360;
  const to = ((toDeg % 360) + 360) % 360;
  // A window that runs past 12 o'clock wraps, e.g. 10:00 → 2:00 is 300°→60°.
  return from <= to
    ? normalized >= from && normalized <= to
    : normalized >= from || normalized <= to;
}

function inDepthBand(depthPct: number | null, band: DepthBand): boolean {
  if (band === 'all') return true;
  if (depthPct === null) return false;
  if (band === 'lt20') return depthPct < 20;
  if (band === '20-40') return depthPct >= 20 && depthPct < 40;
  if (band === '40-60') return depthPct >= 40 && depthPct < 60;
  return depthPct >= 60;
}

export function filterSpoolFeatures(
  features: readonly SpoolFeature[],
  filters: SpoolFilters,
  layers: SpoolLayers,
): SpoolFeature[] {
  return features.filter((feature) => {
    if (!layers[feature.featureClass]) return false;
    if (!layers.currentRun && feature.status !== 'prev-only') return false;
    if (!layers.previousRun && feature.status === 'prev-only') return false;
    if (filters.featureClass !== 'all' && feature.featureClass !== filters.featureClass) return false;
    if (filters.status !== 'all' && feature.status !== filters.status) return false;
    if (feature.maM < filters.maStartM || feature.maM > filters.maEndM) return false;
    if (!inClockWindow(feature.clockDeg, filters.clockFromDeg, filters.clockToDeg)) return false;

    const depthPct = feature.current.depthPct ?? feature.previous.depthPct;
    if (!inDepthBand(depthPct, filters.depthBand)) return false;

    if (filters.surface !== 'all') {
      const external = feature.current.external ?? feature.previous.external;
      if (external === null) return false;
      if (filters.surface === 'external' && !external) return false;
      if (filters.surface === 'internal' && external) return false;
    }

    if (filters.growth === 'growing' && feature.status !== 'matched-growth') return false;
    if (filters.growth === 'stable' && feature.status === 'matched-growth') return false;

    return true;
  });
}

/**
 * Circumferential half-angle a defect of `widthMm` covers on a pipe of
 * `odMm` outside diameter. Returns null when the diameter is unknown — the
 * views then fall back to a nominal marker rather than drawing a width that
 * belongs to some other pipe.
 */
export function arcWidthDeg(widthMm: number | null, odMm: number | null): number | null {
  if (widthMm === null || odMm === null || odMm <= 0) return null;
  return (widthMm / (Math.PI * odMm)) * 360;
}
