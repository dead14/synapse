import type { ComparisonRow } from './alignment';

type InterventionSide = 'OLD' | 'NEW';

interface InterventionBase {
  id: string;
  createdAt?: string;
  createdByUserId?: number;
}

export interface ReassignNewEvent extends InterventionBase {
  type: 'REASSIGN_NEW';
  sourceNewKey: string;
  targetOldKey: string;
  evidenceScore: number;
}

export interface ExcludeFeatureEvent extends InterventionBase {
  type: 'EXCLUDE_FEATURE';
  side: InterventionSide;
  pairIndex: number;
  sourceKey: string;
}

export interface ExcludeRangeEvent extends InterventionBase {
  type: 'EXCLUDE_RANGE';
  side: InterventionSide;
  pairIndex: number;
  startSourceKey: string;
  endSourceKey: string;
}

export interface RestoreExclusionEvent extends InterventionBase {
  type: 'RESTORE_EXCLUSION';
  exclusionId: string;
}

export type InterventionEvent =
  | ReassignNewEvent
  | ExcludeFeatureEvent
  | ExcludeRangeEvent
  | RestoreExclusionEvent;

const present = (value: unknown) => value !== undefined && value !== null && value !== '' && value !== '-';

export function exclusionSide(row: ComparisonRow): InterventionSide | null {
  const hasOld = present(row['Source Key OLD']) || present(row['Identif. OLD']);
  const hasNew = present(row['Source Key NEW']) || present(row['Identif. NEW']);
  if (hasOld === hasNew) return null;
  return hasOld ? 'OLD' : 'NEW';
}

export function isExcludedRow(row: ComparisonRow): boolean {
  return row.__excluded === true;
}

export function includedInterventionRows<T extends ComparisonRow>(rows: T[]): T[] {
  return rows.filter((row) => !isExcludedRow(row));
}

function sourceKey(row: ComparisonRow, side: InterventionSide): string | null {
  const value = row[`Source Key ${side}`];
  return present(value) ? String(value) : null;
}

function sideDistance(row: ComparisonRow, side: InterventionSide): number | null {
  if (!present(row[`Log Dist ${side} (m)`])) return null;
  const value = Number(row[`Log Dist ${side} (m)`]);
  return Number.isFinite(value) ? value : null;
}

function pairIndex(row: ComparisonRow): number {
  const value = Number(row.pair_index);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function markExcluded(
  row: ComparisonRow,
  event: ExcludeFeatureEvent | ExcludeRangeEvent,
): void {
  const ids = Array.isArray(row.__exclusionIds)
    ? row.__exclusionIds.filter((value): value is string => typeof value === 'string')
    : [];
  row.__excluded = true;
  row.__exclusionIds = [...new Set([...ids, event.id])];
  row.__exclusionSide = event.side;
}

export function applyInterventions(
  sourceRows: ComparisonRow[],
  events: InterventionEvent[],
): ComparisonRow[] {
  const rows = sourceRows.map((row) => ({ ...row }));
  const exclusions: Array<ExcludeFeatureEvent | ExcludeRangeEvent> = [];
  const restoredExclusionIds = new Set<string>();

  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    if (event.type === 'EXCLUDE_FEATURE' || event.type === 'EXCLUDE_RANGE') {
      exclusions.push(event);
      continue;
    }
    if (event.type === 'RESTORE_EXCLUSION') {
      restoredExclusionIds.add(event.exclusionId);
      continue;
    }
    if (event.type !== 'REASSIGN_NEW') continue;
    const source = rows.find((row) => String(row['Source Key NEW'] || '') === event.sourceNewKey);
    const target = rows.find((row) => String(row['Source Key OLD'] || '') === event.targetOldKey);
    if (!source || !target || source === target) continue;
    // Never overwrite another NEW feature.  A second explicit event is needed
    // to move that identity first, preserving one-source/one-output semantics.
    if (present(target['Source Key NEW'])) continue;

    const payload = Object.fromEntries(
      Object.entries(source).filter(([key]) => key.includes('NEW') || key === "O'Clock NEW"),
    );
    for (const [key, value] of Object.entries(payload)) {
      target[key] = value;
      source[key] = typeof value === 'number' ? Number.NaN : '-';
    }
    target['Match/Unmatch'] = 'Match';
    target['Intervention ID'] = event.id;
    target['Evidence Score'] = event.evidenceScore;
  }

  const conservedRows = rows.filter((row) => present(row['Identif. OLD']) || present(row['Identif. NEW']));
  for (const event of exclusions) {
    if (restoredExclusionIds.has(event.id)) continue;
    if (event.type === 'EXCLUDE_FEATURE') {
      const row = conservedRows.find((candidate) => (
        exclusionSide(candidate) === event.side
        && pairIndex(candidate) === event.pairIndex
        && sourceKey(candidate, event.side) === event.sourceKey
      ));
      if (row) markExcluded(row, event);
      continue;
    }

    const candidates = conservedRows.filter((row) => (
      exclusionSide(row) === event.side
      && pairIndex(row) === event.pairIndex
    ));
    const start = candidates.find((row) => sourceKey(row, event.side) === event.startSourceKey);
    const end = candidates.find((row) => sourceKey(row, event.side) === event.endSourceKey);
    const startDistance = start ? sideDistance(start, event.side) : null;
    const endDistance = end ? sideDistance(end, event.side) : null;
    if (startDistance === null || endDistance === null) continue;
    const lower = Math.min(startDistance, endDistance);
    const upper = Math.max(startDistance, endDistance);
    for (const row of candidates) {
      const distance = sideDistance(row, event.side);
      if (distance !== null && distance >= lower && distance <= upper) {
        markExcluded(row, event);
      }
    }
  }

  return conservedRows;
}
