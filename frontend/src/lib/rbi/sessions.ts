/**
 * Saved RBI screenings.
 *
 * What is stored is the entered record only, never the derived result. The
 * sections, categories and intervals are recomputed from the record and the
 * filed assessment it cites every time it is opened, so a corrected
 * fitness-for-service assessment flows through to the ranking instead of leaving
 * a stale answer in a database looking authoritative.
 */

import { apiFetch } from '../../utils/api.ts';
import { reviveRbiRecord } from './record.ts';
import type { RbiAssessment, RbiRecord, RbiStepId } from './types.ts';

export interface RbiSessionSummary {
  sections?: number;
  high?: number;
  unacceptable?: number;
  nextDue?: string;
  [key: string]: number | string | boolean | undefined;
}

export interface RbiSessionListItem {
  id: string;
  ffsSessionId: string | null;
  /** Null once the cited assessment has been deleted. Shown, not hidden. */
  ffsLabel: string | null;
  pipelineId: number | null;
  pipelineName: string | null;
  label: string;
  status: 'draft' | 'issued';
  currentStep: RbiStepId | null;
  summary: RbiSessionSummary;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RbiSessionRecordResponse extends RbiSessionListItem {
  record: unknown;
}

export interface SaveRbiSessionInput {
  record: RbiRecord;
  status: 'draft' | 'issued';
  currentStep: RbiStepId;
  summary: RbiSessionSummary;
}

function payloadOf(input: SaveRbiSessionInput) {
  return {
    label: input.record.title.trim() || input.record.segment.trim() || 'RBI screening',
    status: input.status,
    currentStep: input.currentStep,
    summary: input.summary,
    record: input.record,
  };
}

export async function createRbiSession(input: SaveRbiSessionInput): Promise<string> {
  const response = await apiFetch<{ id?: string }>('/api/rbi/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payloadOf(input), ffsSessionId: input.record.ffsSessionId }),
  });
  if (!response.id) throw new Error('The assessment was saved without an identifier.');
  return response.id;
}

export async function updateRbiSession(
  sessionId: string,
  input: SaveRbiSessionInput,
): Promise<void> {
  await apiFetch(`/api/rbi/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payloadOf(input)),
  });
}

export async function listRbiSessions(limit = 50): Promise<RbiSessionListItem[]> {
  const response = await apiFetch<{ items?: RbiSessionListItem[] }>(
    `/api/rbi/sessions?limit=${encodeURIComponent(String(limit))}`,
  );
  return Array.isArray(response.items) ? response.items : [];
}

/**
 * The stored record, brought forward into the shape the wizard renders.
 *
 * `reviveRbiRecord` merges over a blank record so an assessment written before a
 * field existed still opens, and a threat added to the catalogue since appears
 * as unreviewed rather than silently missing from the probability.
 */
export async function fetchRbiSession(
  sessionId: string,
): Promise<{ session: RbiSessionListItem; record: RbiRecord }> {
  const response = await apiFetch<RbiSessionRecordResponse>(
    `/api/rbi/sessions/${encodeURIComponent(sessionId)}`,
  );
  const { record: stored, ...session } = response;
  return { session, record: reviveRbiRecord(stored) };
}

export async function deleteRbiSession(sessionId: string): Promise<void> {
  await apiFetch(`/api/rbi/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}

/** The handful of numbers the register shows without opening the record. */
export function summarize(assessment: RbiAssessment | null): RbiSessionSummary {
  if (!assessment) return {};
  return {
    sections: assessment.sections.length,
    features: assessment.totals.features,
    high: assessment.totals.byLevel.High,
    unacceptable: assessment.totals.unacceptable,
    nextDue: assessment.totals.nextDueIso ?? '',
  };
}
