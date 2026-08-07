import type { ComparisonRow } from './alignment';

/**
 * A reviewer's edits to an engine result, kept as an append-only event log.
 *
 * Three families live here:
 *
 * - EXCLUDE_* / RESTORE_EXCLUSION drop a row from the released outputs. A row
 *   is excludable whatever it holds — an unmatched anomaly, a valve, a tee, or
 *   a matched pair — because "this record must not reach the report" is a
 *   statement about the record, not about how the engine classified it.
 * - REASSIGN_NEW / REASSIGN_OLD move one side of a feature onto a row that has
 *   no partner on that side, which is how a mis-paired match is repaired.
 * - UNASSIGN_PAIR breaks a match back into the two single-run rows it was made
 *   from, so both halves become available to be re-paired with something else.
 *
 * Every event addresses features by source key, never by row index: the row
 * order changes with sorting, filtering, and later events, and an index-keyed
 * log would silently rewrite whichever row happened to sit at that offset.
 */

type ExclusionSide = 'OLD' | 'NEW';
/** A matched row is excluded as one thing, so it needs a scope of its own. */
export type ExclusionScope = ExclusionSide | 'PAIR';

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

export interface ReassignOldEvent extends InterventionBase {
  type: 'REASSIGN_OLD';
  sourceOldKey: string;
  targetNewKey: string;
  evidenceScore: number;
}

export interface UnassignPairEvent extends InterventionBase {
  type: 'UNASSIGN_PAIR';
  /** The pair's OLD source key; identifies the row that keeps the OLD side. */
  sourceOldKey: string;
  /** The NEW source key that is detached into its own row. */
  sourceNewKey: string;
}

export interface ExcludeFeatureEvent extends InterventionBase {
  type: 'EXCLUDE_FEATURE';
  side: ExclusionScope;
  pairIndex: number;
  sourceKey: string;
}

export interface ExcludeRangeEvent extends InterventionBase {
  type: 'EXCLUDE_RANGE';
  side: ExclusionScope;
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
  | ReassignOldEvent
  | UnassignPairEvent
  | ExcludeFeatureEvent
  | ExcludeRangeEvent
  | RestoreExclusionEvent;

const present = (value: unknown) => value !== undefined && value !== null && value !== '' && value !== '-';

function hasSide(row: ComparisonRow, side: ExclusionSide): boolean {
  return present(row[`Source Key ${side}`]) || present(row[`Identif. ${side}`]);
}

export function exclusionSide(row: ComparisonRow): ExclusionSide | null {
  const hasOld = hasSide(row, 'OLD');
  const hasNew = hasSide(row, 'NEW');
  if (hasOld === hasNew) return null;
  return hasOld ? 'OLD' : 'NEW';
}

/** True when the row carries both runs, which is what a match is. */
export function isMatchedRow(row: ComparisonRow): boolean {
  return hasSide(row, 'OLD') && hasSide(row, 'NEW');
}

/**
 * How a row is addressed by an exclusion: which scope it belongs to and the
 * source key that identifies it inside that scope. Returns null only for a row
 * that carries neither run, which the engine never emits.
 */
export function exclusionTarget(
  row: ComparisonRow,
): { side: ExclusionScope; sourceKey: string } | null {
  if (isMatchedRow(row)) {
    const key = sourceKey(row, 'OLD') ?? sourceKey(row, 'NEW');
    return key === null ? null : { side: 'PAIR', sourceKey: key };
  }
  const side = exclusionSide(row);
  if (!side) return null;
  const key = sourceKey(row, side);
  return key === null ? null : { side, sourceKey: key };
}

export function isExcludedRow(row: ComparisonRow): boolean {
  return row.__excluded === true;
}

export function includedInterventionRows<T extends ComparisonRow>(rows: T[]): T[] {
  return rows.filter((row) => !isExcludedRow(row));
}

/** Exclusion IDs currently holding this row out of the released outputs. */
export function exclusionIdsOf(row: ComparisonRow): string[] {
  return Array.isArray(row.__exclusionIds)
    ? row.__exclusionIds.filter((value): value is string => typeof value === 'string')
    : [];
}

function sourceKey(row: ComparisonRow, side: ExclusionSide): string | null {
  const value = row[`Source Key ${side}`];
  return present(value) ? String(value) : null;
}

/** Position used to order rows inside an exclusion scope. */
function scopeDistance(row: ComparisonRow, side: ExclusionScope): number | null {
  const keys = side === 'PAIR'
    ? ['Log Dist NEW (m)', 'Log Dist OLD (m)']
    : [`Log Dist ${side} (m)`];
  for (const key of keys) {
    if (!present(row[key])) continue;
    const value = Number(row[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function pairIndex(row: ComparisonRow): number {
  const value = Number(row.pair_index);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function markExcluded(
  row: ComparisonRow,
  event: ExcludeFeatureEvent | ExcludeRangeEvent,
): void {
  row.__excluded = true;
  row.__exclusionIds = [...new Set([...exclusionIdsOf(row), event.id])];
  row.__exclusionSide = event.side;
}

/** Keys that carry one run's reading of a feature. */
function sideKeys(row: ComparisonRow, side: ExclusionSide): string[] {
  return Object.keys(row).filter((key) => key.includes(side));
}

function blankValue(value: unknown): unknown {
  return typeof value === 'number' ? Number.NaN : '-';
}

/** Move every `side` field from `source` onto `target`, blanking the source. */
function transferSide(source: ComparisonRow, target: ComparisonRow, side: ExclusionSide): void {
  for (const key of sideKeys(source, side)) {
    target[key] = source[key];
    source[key] = blankValue(source[key]);
  }
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

    if (event.type === 'UNASSIGN_PAIR') {
      const paired = rows.find((row) => (
        sourceKey(row, 'OLD') === event.sourceOldKey
        && sourceKey(row, 'NEW') === event.sourceNewKey
      ));
      // Only a live match can be broken. Re-applying the log must not split a
      // row twice, and a half already moved elsewhere is no longer this pair.
      if (!paired || !isMatchedRow(paired)) continue;
      const detached: ComparisonRow = { ...paired };
      for (const key of sideKeys(paired, 'OLD')) detached[key] = blankValue(paired[key]);
      for (const key of sideKeys(paired, 'NEW')) paired[key] = blankValue(paired[key]);
      paired['Match/Unmatch'] = 'Only OLD';
      paired.match_status = 'Only OLD';
      detached['Match/Unmatch'] = 'Only NEW';
      detached.match_status = 'Only NEW';
      paired['Intervention ID'] = event.id;
      detached['Intervention ID'] = event.id;
      delete paired['Evidence Score'];
      delete detached['Evidence Score'];
      rows.push(detached);
      continue;
    }

    if (event.type !== 'REASSIGN_NEW' && event.type !== 'REASSIGN_OLD') continue;
    // The moving side and the side the target must be missing are the same one.
    const moving: ExclusionSide = event.type === 'REASSIGN_NEW' ? 'NEW' : 'OLD';
    const sourceKeyValue = event.type === 'REASSIGN_NEW' ? event.sourceNewKey : event.sourceOldKey;
    const targetKeyValue = event.type === 'REASSIGN_NEW' ? event.targetOldKey : event.targetNewKey;
    const anchor: ExclusionSide = moving === 'NEW' ? 'OLD' : 'NEW';
    const source = rows.find((row) => sourceKey(row, moving) === sourceKeyValue);
    const target = rows.find((row) => sourceKey(row, anchor) === targetKeyValue);
    if (!source || !target || source === target) continue;
    // Never overwrite another feature.  A second explicit event is needed
    // to move that identity first, preserving one-source/one-output semantics.
    if (hasSide(target, moving)) continue;

    transferSide(source, target, moving);
    target['Match/Unmatch'] = 'Match';
    target['Intervention ID'] = event.id;
    target['Evidence Score'] = event.evidenceScore;
  }

  const conservedRows = rows.filter((row) => present(row['Identif. OLD']) || present(row['Identif. NEW']));
  for (const event of exclusions) {
    if (restoredExclusionIds.has(event.id)) continue;
    const inScope = (row: ComparisonRow) => {
      const target = exclusionTarget(row);
      return target?.side === event.side && pairIndex(row) === event.pairIndex;
    };
    if (event.type === 'EXCLUDE_FEATURE') {
      const row = conservedRows.find((candidate) => (
        inScope(candidate) && exclusionTarget(candidate)?.sourceKey === event.sourceKey
      ));
      if (row) markExcluded(row, event);
      continue;
    }

    const candidates = conservedRows.filter(inScope);
    const start = candidates.find((row) => exclusionTarget(row)?.sourceKey === event.startSourceKey);
    const end = candidates.find((row) => exclusionTarget(row)?.sourceKey === event.endSourceKey);
    const startDistance = start ? scopeDistance(start, event.side) : null;
    const endDistance = end ? scopeDistance(end, event.side) : null;
    if (startDistance === null || endDistance === null) continue;
    const lower = Math.min(startDistance, endDistance);
    const upper = Math.max(startDistance, endDistance);
    for (const row of candidates) {
      const distance = scopeDistance(row, event.side);
      if (distance !== null && distance >= lower && distance <= upper) {
        markExcluded(row, event);
      }
    }
  }

  return conservedRows;
}
