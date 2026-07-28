export type PublicShareKind =
  | 'GW_ALIGNMENT'
  | 'SECTIONING'
  | 'ILI_ALIGNMENT'
  | 'CORROSION'
  | 'FFS';

export type PublicShareValue =
  | string
  | number
  | boolean
  | null
  | PublicShareValue[]
  | { [key: string]: PublicShareValue };

export interface PublicShareColumn {
  key: string;
  label: string;
}

export interface PublicShareSummaryItem {
  label: string;
  value: string | number | boolean | null;
  tone?: string;
}

export interface PublicShareSnapshot {
  version: 1;
  summary: PublicShareSummaryItem[];
  columns: PublicShareColumn[];
  rows: Array<Record<string, PublicShareValue>>;
  notes: string[];
}

interface BuildSnapshotOptions {
  summary?: PublicShareSummaryItem[];
  notes?: string[];
}

const MAX_ROWS = 10_000;
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const COLUMN_SETS: Record<Exclude<PublicShareKind, 'FFS'>, PublicShareColumn[]> = {
  GW_ALIGNMENT: [
    { key: 'status', label: 'Status' },
    { key: 'oldId', label: 'OLD weld' },
    { key: 'oldVal', label: 'OLD distance (m)' },
    { key: 'oldDesc', label: 'OLD description' },
    { key: 'newId', label: 'NEW weld' },
    { key: 'originalNewVal', label: 'NEW distance (m)' },
    { key: 'newDesc', label: 'NEW description' },
    { key: 'offset', label: 'Offset (m)' },
    { key: 'confidence', label: 'Confidence' },
    { key: 'deviationRatio', label: 'Deviation ratio' },
    { key: 'flagged', label: 'Review flag' },
  ],
  SECTIONING: [
    { key: 'name', label: 'Section' },
    { key: 'type', label: 'Type' },
    { key: 'physicalType', label: 'Physical type' },
    { key: 'startGw', label: 'Start GW' },
    { key: 'endGw', label: 'End GW' },
    { key: 'startM', label: 'Start (m)' },
    { key: 'endM', label: 'End (m)' },
    { key: 'length', label: 'Length (m)' },
    { key: 'notes', label: 'Notes' },
  ],
  ILI_ALIGNMENT: [
    { key: 'Match/Unmatch', label: 'Match status' },
    { key: 'Source Key OLD', label: 'OLD source key' },
    { key: 'Identif. OLD', label: 'OLD feature' },
    { key: 'Feature Type OLD', label: 'OLD type' },
    { key: 'Log Dist OLD (m)', label: 'OLD distance (m)' },
    { key: 'Source Key NEW', label: 'NEW source key' },
    { key: 'Identif. NEW', label: 'NEW feature' },
    { key: 'Feature Type NEW', label: 'NEW type' },
    { key: 'Log Dist NEW (m)', label: 'NEW distance (m)' },
    { key: "O'Clock NEW", label: "NEW o'clock" },
    { key: 'Depth NEW (%WT)', label: 'NEW depth (%WT)' },
    { key: 'Length NEW (mm)', label: 'NEW length (mm)' },
    { key: 'Width NEW (mm)', label: 'NEW width (mm)' },
    { key: 'Depth Growth (%WT/yr)', label: 'Depth growth (%WT/y)' },
    { key: 'Length Growth (mm/yr)', label: 'Length growth (mm/y)' },
    { key: 'ERF ASME NEW', label: 'NEW ERF' },
    { key: 'Psafe NEW (bar)', label: 'NEW safe pressure (bar)' },
    { key: 'Physics Warning', label: 'Physics warning' },
  ],
  CORROSION: [
    { key: 'sourceKey', label: 'Source key' },
    { key: 'featureId', label: 'Feature' },
    { key: 'section', label: 'Section' },
    { key: 'featureType', label: 'Feature type' },
    { key: 'distanceM', label: 'Distance (m)' },
    { key: 'clock', label: "O'clock" },
    { key: 'surface', label: 'Surface' },
    { key: 'depthPct', label: 'Depth (%WT)' },
    { key: 'lengthMm', label: 'Length (mm)' },
    { key: 'widthMm', label: 'Width (mm)' },
    { key: 'wallMm', label: 'Wall (mm)' },
    { key: 'depthGrowthPctWtPerYear', label: 'Depth growth (%WT/y)' },
    { key: 'lengthGrowthMmPerYear', label: 'Length growth (mm/y)' },
    { key: 'growthClass', label: 'Growth class' },
    { key: 'erf', label: 'ERF' },
    { key: 'psafeBar', label: 'Safe pressure (bar)' },
    { key: 'matchStatus', label: 'Match status' },
    { key: 'physicsWarning', label: 'Physics warning' },
    { key: 'ffsReady', label: 'FFS ready' },
    { key: 'selectedForFfs', label: 'Released to FFS' },
    { key: 'selectionReason', label: 'Selection reason' },
    { key: 'blockers', label: 'Assessment blockers' },
  ],
};

const FFS_COLUMNS: PublicShareColumn[] = [
  { key: 'key', label: 'Feature key' },
  { key: 'ld', label: 'Distance (m)' },
  { key: 'section', label: 'Section' },
  { key: 'surface', label: 'Surface' },
  { key: 'maxDepthPct', label: 'Depth (%WT)' },
  { key: 'length', label: 'Length (mm)' },
  { key: 'width', label: 'Width (mm)' },
  { key: 'orient', label: "O'clock" },
  { key: 'nominalErf', label: 'Nominal ERF' },
  { key: 'conservativeErf', label: 'Conservative ERF' },
  { key: 'forecastErf', label: 'Forecast ERF' },
  { key: 'safePressure', label: 'Safe pressure' },
  { key: 'acceptance', label: 'Acceptance' },
  { key: 'lifeToErf1', label: 'Life to ERF 1 (y)' },
  { key: 'priority', label: 'Priority' },
  { key: 'branch', label: 'B31G branch' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function displayValue(value: unknown, depth = 0): PublicShareValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (depth >= 3) return String(value);
  if (Array.isArray(value)) return value.map((item) => displayValue(item, depth + 1));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, item]) => !BLOCKED_KEYS.has(key.toLowerCase()) && typeof item !== 'function')
        .map(([key, item]) => [key, displayValue(item, depth + 1)]),
    );
  }
  return String(value);
}

function ffsProjection(row: Record<string, unknown>): Record<string, PublicShareValue> {
  const nominal = isRecord(row.nominal) ? row.nominal : {};
  const conservative = isRecord(row.conservative) ? row.conservative : {};
  const forecast = isRecord(row.forecast) ? row.forecast : {};
  return {
    key: displayValue(row.key),
    ld: displayValue(nominal.ld),
    section: displayValue(nominal.section),
    surface: displayValue(nominal.surface),
    maxDepthPct: displayValue(nominal.maxDepthPct),
    length: displayValue(nominal.length),
    width: displayValue(nominal.width),
    orient: displayValue(nominal.orient),
    nominalErf: displayValue(nominal.ERF),
    conservativeErf: displayValue(conservative.ERF),
    forecastErf: displayValue(forecast.ERF),
    safePressure: displayValue(nominal.safePressure),
    acceptance: displayValue(nominal.acceptance),
    lifeToErf1: displayValue(row.lifeToErf1),
    priority: displayValue(row.priority),
    branch: displayValue(nominal.branch),
  };
}

function columnsFor(
  kind: PublicShareKind,
  rows: Array<Record<string, unknown>>,
): PublicShareColumn[] {
  const configured = kind === 'FFS' ? FFS_COLUMNS : COLUMN_SETS[kind];
  if (rows.length === 0) return configured;
  const available = configured.filter((column) => rows.some((row) => {
    if (kind === 'FFS') return Object.hasOwn(ffsProjection(row), column.key);
    return Object.hasOwn(row, column.key);
  }));
  return available.length > 0 ? available : [{ key: 'status', label: 'Status' }];
}

function projectRow(
  kind: PublicShareKind,
  row: Record<string, unknown>,
  columns: PublicShareColumn[],
): Record<string, PublicShareValue> {
  const source = kind === 'FFS' ? ffsProjection(row) : row;
  return Object.fromEntries(
    columns.map((column) => [column.key, displayValue(source[column.key])]),
  );
}

export function buildPublicShareSnapshot(
  kind: PublicShareKind,
  sourceRows: object[],
  options: BuildSnapshotOptions = {},
): PublicShareSnapshot {
  if (!Array.isArray(sourceRows)) throw new TypeError('Share rows must be an array.');
  if (sourceRows.length > MAX_ROWS) {
    throw new RangeError('A public snapshot can contain at most 10,000 rows.');
  }

  const rows = sourceRows.map((row, index) => {
    if (!isRecord(row)) throw new TypeError(`Share row ${index + 1} must be an object.`);
    return row;
  });
  const columns = columnsFor(kind, rows);
  return {
    version: 1,
    summary: [
      { label: 'Rows', value: rows.length },
      ...(options.summary ?? []).map((item) => ({
        label: String(item.label),
        value: displayValue(item.value) as string | number | boolean | null,
        ...(item.tone ? { tone: String(item.tone) } : {}),
      })),
    ],
    columns: columns.map((column) => ({ ...column })),
    rows: rows.map((row) => projectRow(kind, row, columns)),
    notes: (options.notes ?? []).map((note) => String(note)),
  };
}
