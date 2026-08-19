/**
 * Reopening a published FFS assessment.
 *
 * The results page holds its whole case in navigation state and persists
 * nothing, so a public link has to carry that case verbatim. JSON has no date
 * type, which is the one field that cannot survive the round trip untouched —
 * everything else is read back exactly as it was published, including the
 * screening assumptions, because a reader who is shown different assumptions is
 * being shown a different assessment.
 */

import type { FfsShareState } from '../sharing/publicShareSnapshot.ts';
import { normaliseScreeningConfig } from './types.ts';
import type {
  FfsConfig,
  FfsRepairDispositionPatch,
  FfsResult,
  FfsScreeningConfig,
} from './types.ts';
import type {
  AlignmentImportProvenance,
  AlignmentImportSkipped,
  FfsGirthWeld,
  FfsIntakeScope,
  FfsSpoolCensusRow,
  RejectedAlignmentRow,
} from './alignmentImport.ts';
import type { FfsSpoolDisposition } from './spoolReview.ts';

/** The reviewer's own decisions, kept with the case they belong to. */
export interface RevivedFfsReviewState {
  repairOverrides: Record<number, FfsRepairDispositionPatch>;
  spoolDispositions: Record<string, FfsSpoolDisposition>;
}

export interface RevivedFfsShareState {
  results: FfsResult[];
  config: FfsConfig;
  screening: FfsScreeningConfig;
  alignmentImport?: {
    sessionId: string;
    /** How much of the run was assessed. Older cases carry no scope. */
    scope?: FfsIntakeScope;
    accepted: AlignmentImportProvenance[];
    rejected: RejectedAlignmentRow[];
    skipped?: AlignmentImportSkipped;
    girthWelds?: FfsGirthWeld[];
    census?: FfsSpoolCensusRow[];
    warningCount: number;
  };
  review: RevivedFfsReviewState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** ISO string back to a Date; an unreadable one is refused, never guessed. */
function reviveDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A stored numeric column, or null when the document carries nothing readable. */
function storedNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The stored results, under the column names this build reads.
 *
 * `crDepth`/`crLength` became `crDepthSource`/`crLengthSource` when the source
 * column and the rate the projection was run on stopped being the same thing.
 * The rename is carried here so a case filed before it is read back with the
 * rates it was filed with: without this every reader of the new names saw
 * `undefined`, which the tables absorbed silently and the what-if drawer did
 * not — it formats the seed before anything can reject it, so opening the
 * drawer on a stored case took the whole workspace down.
 *
 * Only the names are translated. No value is substituted, and a document that
 * already carries the current names is passed through untouched.
 */
function reviveResults(value: unknown): FfsResult[] {
  return asArray<unknown>(value).map((row) => {
    if (!isRecord(row)) return row as FfsResult;
    if (row.crDepthSource !== undefined && row.crLengthSource !== undefined) return row as unknown as FfsResult;
    return {
      ...row,
      crDepthSource: row.crDepthSource ?? storedNumber(row.crDepth) ?? 0,
      crLengthSource: row.crLengthSource ?? storedNumber(row.crLength) ?? 0,
    } as unknown as FfsResult;
  });
}

/**
 * The published state as the results page expects it, or null when the link
 * carries nothing the page could honestly render.
 */
export function reviveFfsShareState(state: FfsShareState | null | undefined): RevivedFfsShareState | null {
  if (!state || state.kind !== 'FFS' || !isRecord(state.config)) return null;
  const iliDate = reviveDate(state.config.iliDate);
  if (!iliDate) return null;
  const results = reviveResults(state.results);
  if (results.length === 0) return null;

  const config = { ...state.config, iliDate } as unknown as FfsConfig;
  const alignmentImport = isRecord(state.alignmentImport)
    ? {
      sessionId: String(state.alignmentImport.sessionId ?? ''),
      ...(state.alignmentImport.scope === 'all' || state.alignmentImport.scope === 'released'
        ? { scope: state.alignmentImport.scope as FfsIntakeScope }
        : {}),
      accepted: asArray<AlignmentImportProvenance>(state.alignmentImport.accepted),
      rejected: asArray<RejectedAlignmentRow>(state.alignmentImport.rejected),
      ...(isRecord(state.alignmentImport.skipped)
        ? { skipped: state.alignmentImport.skipped as unknown as AlignmentImportSkipped }
        : {}),
      girthWelds: asArray<FfsGirthWeld>(state.alignmentImport.girthWelds),
      census: asArray<FfsSpoolCensusRow>(state.alignmentImport.census),
      warningCount: Number(state.alignmentImport.warningCount ?? 0) || 0,
    }
    : undefined;

  return {
    results,
    config,
    screening: normaliseScreeningConfig(state.screening ?? undefined),
    ...(alignmentImport ? { alignmentImport } : {}),
    review: reviveReviewState(state.review),
  };
}

/**
 * The reviewer's decisions as the workspace holds them.
 *
 * Keys are read back defensively: a repair override is keyed by the result's
 * position in the case, and JSON turns that number into a string. An override
 * that came back under a string key silently applied to nothing.
 */
function reviveReviewState(value: unknown): RevivedFfsReviewState {
  const repairOverrides: Record<number, FfsRepairDispositionPatch> = {};
  const spoolDispositions: Record<string, FfsSpoolDisposition> = {};
  if (!isRecord(value)) return { repairOverrides, spoolDispositions };

  const storedRepairs = value.repairOverrides;
  if (isRecord(storedRepairs)) {
    for (const [key, patch] of Object.entries(storedRepairs)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || !isRecord(patch)) continue;
      repairOverrides[index] = patch as unknown as FfsRepairDispositionPatch;
    }
  }

  const storedSpools = value.spoolDispositions;
  if (isRecord(storedSpools)) {
    for (const [key, disposition] of Object.entries(storedSpools)) {
      if (isRecord(disposition)) {
        spoolDispositions[key] = disposition as unknown as FfsSpoolDisposition;
      }
    }
  }

  return { repairOverrides, spoolDispositions };
}
