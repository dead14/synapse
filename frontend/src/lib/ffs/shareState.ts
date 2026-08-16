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

/**
 * The published state as the results page expects it, or null when the link
 * carries nothing the page could honestly render.
 */
export function reviveFfsShareState(state: FfsShareState | null | undefined): RevivedFfsShareState | null {
  if (!state || state.kind !== 'FFS' || !isRecord(state.config)) return null;
  const iliDate = reviveDate(state.config.iliDate);
  if (!iliDate) return null;
  const results = asArray<FfsResult>(state.results);
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
