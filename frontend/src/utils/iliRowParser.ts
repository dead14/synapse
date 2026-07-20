import { canonicalFieldForHeader, type CanonicalField } from './headerDetection.ts';


export type IliFeatureType = 'anomaly' | 'weld' | 'valve' | 'tee' | 'offtake' | 'bend' | 'other';

export interface ParsedIliFeature extends Record<string, unknown> {
  id: string;
  type: IliFeatureType;
  dist: number | null;
  originalType: unknown;
  depth: number | null;
  clock: string;
  length: number | null;
  width: number | null;
}

export interface IliRunCounts {
  total: number;
  anomalies: number;
  welds: number;
  valves: number;
  tees: number;
  offtakes: number;
  bends: number;
  others: number;
  gwAnchors: number;
  invalidAnchorDistances: number;
}

function canonicalValue(
  row: Record<string, unknown>,
  canonicalField: CanonicalField,
): unknown {
  let emptyMatch: unknown;
  for (const [header, value] of Object.entries(row)) {
    if (canonicalFieldForHeader(header) !== canonicalField) continue;
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
    emptyMatch = value;
  }
  return emptyMatch;
}

export function parseLocaleNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  let text = value.trim().replace(/[\s\u00a0]/g, '');
  if (!text) return null;
  const isParenthesizedNegative = text.startsWith('(') && text.endsWith(')');
  text = text.replace(/[^0-9,.eE+-]/g, '');

  const commaCount = (text.match(/,/g) || []).length;
  const dotCount = (text.match(/\./g) || []).length;
  if (commaCount && dotCount) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (commaCount > 1) {
    const groups = text.split(',');
    text = groups.slice(1).every((group) => /^\d{3}$/.test(group))
      ? groups.join('')
      : `${groups.slice(0, -1).join('')}.${groups.at(-1)}`;
  } else if (commaCount === 1) {
    text = text.replace(',', '.');
  }

  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return null;
  return isParenthesizedNegative ? -Math.abs(numeric) : numeric;
}

function normalizeFeatureLabel(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function classifyFeatureType(value: unknown): IliFeatureType | null {
  const label = normalizeFeatureLabel(value);
  if (!label) return null;
  const tokens = new Set(label.split(' '));

  if (
    label.includes('metal loss')
    || label.includes('corrosion')
    || tokens.has('anom')
    || tokens.has('cocl')
    || tokens.has('corr')
    || tokens.has('ml')
  ) return 'anomaly';
  if (label.includes('weld') || tokens.has('gw')) return 'weld';
  if (label.includes('valve') || tokens.has('valv')) return 'valve';
  if (label.includes('offtake') || label.includes('off take') || tokens.has('offt')) return 'offtake';
  if (label.includes('tee')) return 'tee';
  if (label.includes('bend') || label.includes('elbow')) return 'bend';
  return null;
}

function parseClock(value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === '') return '-';
  const raw = String(value).trim();
  if (raw.includes(':')) return raw;

  const numeric = parseLocaleNumber(value);
  if (numeric === null) return raw;
  if (numeric >= 0 && numeric <= 1) {
    const totalHours = numeric * 24;
    let hours = Math.floor(totalHours);
    let minutes = Math.round((totalHours - hours) * 60);
    if (minutes === 60) {
      hours += 1;
      minutes = 0;
    }
    if (hours === 0 || hours === 24) hours = 12;
    return `${hours}:${minutes.toString().padStart(2, '0')}`;
  }
  return raw;
}

function featureId(value: unknown, index: number): string {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  const cleaned = String(value ?? '').trim();
  return cleaned || `F-${index + 1}`;
}

export function parseIliRow(
  row: Record<string, unknown>,
  index: number,
): ParsedIliFeature {
  const originalType = canonicalValue(row, 'feature_type');
  const identification = canonicalValue(row, 'feature_identification');
  const type = classifyFeatureType(originalType) ?? classifyFeatureType(identification) ?? 'other';

  return {
    ...row,
    id: featureId(canonicalValue(row, 'feature_id'), index),
    type,
    dist: parseLocaleNumber(canonicalValue(row, 'log_distance_m')),
    originalType: originalType ?? identification ?? 'Unknown',
    depth: parseLocaleNumber(canonicalValue(row, 'depth_pct')),
    clock: parseClock(canonicalValue(row, 'clock_position')),
    length: parseLocaleNumber(canonicalValue(row, 'length_mm')),
    width: parseLocaleNumber(canonicalValue(row, 'width_mm')),
  };
}

export function summarizeIliRows(rows: Record<string, unknown>[]): {
  rawFeatures: ParsedIliFeature[];
  counts: IliRunCounts;
} {
  const rawFeatures = rows.map(parseIliRow);
  const counts: IliRunCounts = {
    total: rawFeatures.length,
    anomalies: 0,
    welds: 0,
    valves: 0,
    tees: 0,
    offtakes: 0,
    bends: 0,
    others: 0,
    gwAnchors: 0,
    invalidAnchorDistances: 0,
  };

  rawFeatures.forEach((feature) => {
    if (feature.type === 'anomaly') counts.anomalies += 1;
    else if (feature.type === 'weld') counts.welds += 1;
    else if (feature.type === 'valve') counts.valves += 1;
    else if (feature.type === 'tee') counts.tees += 1;
    else if (feature.type === 'offtake') counts.offtakes += 1;
    else if (feature.type === 'bend') counts.bends += 1;
    else counts.others += 1;

    if (feature.type === 'weld' || feature.type === 'valve' || feature.type === 'tee') {
      counts.gwAnchors += 1;
      if (feature.dist === null) counts.invalidAnchorDistances += 1;
    }
  });

  return { rawFeatures, counts };
}
