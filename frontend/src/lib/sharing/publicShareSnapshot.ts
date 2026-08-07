/**
 * What a public link carries.
 *
 * Only two results are publishable, and a link to either opens the same screen
 * the engineer was reading — the alignment comparison workspace, or the FFS
 * assessment workspace — in read-only mode. There is no separate "shared
 * result" table: a recipient who is shown a different page from the author is a
 * recipient reading different evidence.
 *
 * The snapshot therefore holds the page's own state, not a projection of it:
 *
 * - ILI_ALIGNMENT freezes the reviewer's edits (interventions) and the section
 *   names, and points at the exact alignment run through the share's
 *   `sourceRef`. The rows themselves stay server-side and are paged in, because
 *   a run is far too large to inline.
 * - FFS freezes the whole assessment — results, configuration and screening
 *   assumptions — because that page never persists anything server-side and
 *   would otherwise have nothing to reopen.
 */

export type PublicShareKind = 'ILI_ALIGNMENT' | 'FFS';

export type PublicShareValue =
  | string
  | number
  | boolean
  | null
  | PublicShareValue[]
  | { [key: string]: PublicShareValue };

export interface PublicShareSummaryItem {
  label: string;
  value: string | number | boolean | null;
  tone?: string;
}

/** Frozen alignment review state. The rows are read from the named run. */
export interface AlignmentShareState {
  kind: 'ILI_ALIGNMENT';
  interventions: PublicShareValue[];
  sections: PublicShareValue[];
}

/** Frozen FFS assessment state — everything FfsResultsPage needs to reopen. */
export interface FfsShareState {
  kind: 'FFS';
  results: PublicShareValue[];
  config: Record<string, PublicShareValue>;
  screening: Record<string, PublicShareValue> | null;
  alignmentImport: Record<string, PublicShareValue> | null;
}

export type PublicShareState = AlignmentShareState | FfsShareState;

export interface PublicShareSnapshot {
  version: 1;
  summary: PublicShareSummaryItem[];
  notes: string[];
  state: PublicShareState;
}

interface BuildSnapshotOptions {
  summary?: PublicShareSummaryItem[];
  notes?: string[];
}

const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DEPTH = 12;
/**
 * Same ceiling the API enforces; failing here reports the size before spending
 * a large upload on a request the server would refuse. Keep it in step with
 * MAX_SNAPSHOT_BYTES in publicShareContract.js.
 */
const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Plain-JSON copy of a value: Dates become ISO strings, non-finite numbers
 * become null, and functions, symbols and prototype-polluting keys are dropped.
 * Nothing is rounded or relabelled — a shared number is the number the page had.
 */
export function shareValue(value: unknown, depth = 0): PublicShareValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value)) return value.map((item) => shareValue(item, depth + 1));
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, item]) => [String(key), shareValue(item, depth + 1)]),
    );
  }
  if (value instanceof Set) return [...value].map((item) => shareValue(item, depth + 1));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, item]) => (
          !BLOCKED_KEYS.has(key.toLowerCase())
          && typeof item !== 'function'
          && typeof item !== 'symbol'
          && item !== undefined
        ))
        .map(([key, item]) => [key, shareValue(item, depth + 1)]),
    );
  }
  return null;
}

function shareArray(value: unknown): PublicShareValue[] {
  return Array.isArray(value) ? value.map((item) => shareValue(item)) : [];
}

function shareRecord(value: unknown): Record<string, PublicShareValue> | null {
  const copied = isRecord(value) ? shareValue(value) : null;
  return isRecord(copied) ? (copied as Record<string, PublicShareValue>) : null;
}

export function buildAlignmentShareState(input: {
  interventions?: unknown;
  sections?: unknown;
}): AlignmentShareState {
  return {
    kind: 'ILI_ALIGNMENT',
    interventions: shareArray(input.interventions),
    sections: shareArray(input.sections),
  };
}

export function buildFfsShareState(input: {
  results: unknown;
  config: unknown;
  screening?: unknown;
  alignmentImport?: unknown;
}): FfsShareState {
  const config = shareRecord(input.config);
  if (!config) throw new TypeError('The FFS configuration is missing, so there is nothing to share.');
  return {
    kind: 'FFS',
    results: shareArray(input.results),
    config,
    screening: shareRecord(input.screening),
    alignmentImport: shareRecord(input.alignmentImport),
  };
}

export function buildPublicShareSnapshot(
  state: PublicShareState,
  options: BuildSnapshotOptions = {},
): PublicShareSnapshot {
  const snapshot: PublicShareSnapshot = {
    version: 1,
    summary: (options.summary ?? []).map((item) => ({
      label: String(item.label),
      value: shareValue(item.value) as string | number | boolean | null,
      ...(item.tone ? { tone: String(item.tone) } : {}),
    })),
    notes: (options.notes ?? []).map((note) => String(note)),
    state,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).length;
  if (bytes > MAX_SNAPSHOT_BYTES) {
    throw new RangeError(
      `This result is ${(bytes / 1024 / 1024).toFixed(1)} MB, past the ${MAX_SNAPSHOT_BYTES / 1024 / 1024} MB a public link can carry. Narrow the assessment before sharing it.`,
    );
  }
  return snapshot;
}
