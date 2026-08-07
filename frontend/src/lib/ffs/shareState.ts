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
import type { FfsConfig, FfsResult, FfsScreeningConfig } from './types.ts';
import type { AlignmentImportProvenance, FfsGirthWeld, FfsSpoolCensusRow } from './alignmentImport.ts';

export interface RevivedFfsShareState {
  results: FfsResult[];
  config: FfsConfig;
  screening: FfsScreeningConfig;
  alignmentImport?: {
    sessionId: string;
    accepted: AlignmentImportProvenance[];
    rejected: unknown[];
    girthWelds?: FfsGirthWeld[];
    census?: FfsSpoolCensusRow[];
    warningCount: number;
  };
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
      accepted: asArray<AlignmentImportProvenance>(state.alignmentImport.accepted),
      rejected: asArray<unknown>(state.alignmentImport.rejected),
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
  };
}
