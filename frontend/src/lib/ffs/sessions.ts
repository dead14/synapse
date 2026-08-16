/**
 * Saved FFS assessments.
 *
 * The results workspace used to hold its whole case in navigation state and
 * persist nothing, so a refresh lost the assessment and nothing outside that
 * one tab could link to it. A completed assessment is now filed as a session:
 * the same frozen case a published link carries, stored against the alignment
 * session its features were released from.
 *
 * The stored document is built and revived by the public-share helpers, so a
 * saved session and a shared link are read back through one code path and
 * cannot drift into two different notions of "the assessment".
 */

import { apiFetch } from '../../utils/api.ts';
import { buildFfsShareState } from '../sharing/publicShareSnapshot.ts';
import { reviveFfsShareState, type RevivedFfsShareState } from './shareState.ts';
import { createFfsReportContext } from './reportCase.ts';
import { screenResults } from './screening.ts';
import { exportResultsWorkbook } from './exports.ts';
import type { FfsConfig, FfsResult, FfsScreeningConfig } from './types.ts';

export interface FfsSessionSummary {
  pass?: number;
  review?: number;
  fail?: number;
  [key: string]: number | string | boolean | undefined;
}

export interface FfsSessionListItem {
  id: string;
  alignmentSessionId: string | null;
  pipelineId: number | null;
  pipelineName: string | null;
  label: string;
  method: string | null;
  featureCount: number;
  summary: FfsSessionSummary;
  createdBy: string | null;
  createdAt: string;
}

interface FfsSessionRecord extends FfsSessionListItem {
  state: unknown;
}

export interface SaveFfsSessionInput {
  results: FfsResult[];
  config: FfsConfig;
  screening: FfsScreeningConfig;
  alignmentImport?: unknown;
  alignmentSessionId?: string | null;
  /** The reviewer's repair dispositions and spool decisions. */
  review?: unknown;
  summary?: FfsSessionSummary;
}

/**
 * File the assessment. Returns the new session id; the caller decides whether a
 * failure is worth interrupting the engineer for, because the results on screen
 * are still valid whether or not the save landed.
 */
export async function saveFfsSession(input: SaveFfsSessionInput): Promise<string> {
  const response = await apiFetch<{ id?: string }>('/api/ffs/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      label: input.config.lineName || 'FFS assessment',
      method: input.config.method,
      alignmentSessionId: input.alignmentSessionId ?? null,
      featureCount: input.results.length,
      summary: input.summary ?? {},
      state: buildSessionState(input),
    }),
  });

  if (!response.id) throw new Error('The FFS session was saved without an identifier.');
  return response.id;
}

/**
 * Re-file an assessment that already has a session.
 *
 * The reviewer keeps working after the run — repair dispositions, spool
 * decisions, retuned screening assumptions — and all of it belongs to the same
 * assessment. Without this the only way to keep that work was to run the whole
 * thing again, which filed a second session for one piece of work and left the
 * registry showing two assessments of the same features.
 */
export async function updateFfsSession(
  sessionId: string,
  input: SaveFfsSessionInput,
): Promise<void> {
  await apiFetch(`/api/ffs/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      label: input.config.lineName || 'FFS assessment',
      method: input.config.method,
      featureCount: input.results.length,
      summary: input.summary ?? {},
      state: buildSessionState(input),
    }),
  });
}

function buildSessionState(input: SaveFfsSessionInput) {
  return buildFfsShareState({
    results: input.results,
    config: input.config,
    screening: input.screening,
    alignmentImport: input.alignmentImport,
    review: input.review,
  });
}

export async function listFfsSessions(limit = 30): Promise<FfsSessionListItem[]> {
  const response = await apiFetch<{ items?: FfsSessionListItem[] }>(
    `/api/ffs/sessions?limit=${encodeURIComponent(String(limit))}`,
  );
  return Array.isArray(response.items) ? response.items : [];
}

/**
 * The stored case, revived into what the results workspace renders. Null when
 * the document cannot be read back into an honest assessment — the workspace
 * shows nothing rather than a partial one.
 */
export async function fetchFfsSession(
  sessionId: string,
): Promise<{ record: FfsSessionListItem; state: RevivedFfsShareState } | null> {
  const record = await apiFetch<FfsSessionRecord>(
    `/api/ffs/sessions/${encodeURIComponent(sessionId)}`,
  );
  const state = reviveFfsShareState(record.state as never);
  if (!state) return null;
  const { state: _stored, ...listItem } = record;
  return { record: listItem, state };
}

export async function deleteFfsSession(sessionId: string): Promise<void> {
  await apiFetch(`/api/ffs/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

/**
 * Build and download the FFS workbook for a stored session.
 *
 * The workbook is produced by the same client-side builder the results page
 * uses, from the stored case, so a report pulled from the registry is the report
 * the engineer would have exported from the workspace.
 */
export async function downloadFfsSessionReport(sessionId: string): Promise<void> {
  const loaded = await fetchFfsSession(sessionId);
  if (!loaded) throw new Error('This FFS session carries no readable result.');

  const { config, results, screening, alignmentImport } = loaded.state;
  const screened = screenResults(results, config, screening);
  exportResultsWorkbook(
    screened,
    config,
    screening,
    alignmentImport?.accepted ?? [],
    createFfsReportContext(config),
    alignmentImport && {
      scope: alignmentImport.scope,
      rejected: alignmentImport.rejected ?? [],
      skipped: alignmentImport.skipped,
      censusCount: alignmentImport.census?.length ?? null,
    },
  );
}
