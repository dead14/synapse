/**
 * Saved API 580 assessments.
 *
 * An RBI assessment is not a calculation you run and read; it is a document
 * authored over days, reviewed by a second engineer, signed, and then revisited
 * whenever §15 says it must be. §16.2 makes the durable record a requirement
 * rather than a convenience, so the wizard writes to a session from the first
 * step and keeps writing to the same one.
 *
 * What is stored is the *authored record only* — never the derived assessment.
 * The units, the categories and the intervals are recomputed from the record and
 * the FFS session it cites every time it is opened, so a corrected fitness-for-
 * service assessment flows through to the risk ranking instead of leaving a
 * stale answer sitting in a database looking authoritative.
 */

import { apiFetch } from '../../utils/api.ts';
import { reviveRbiRecord } from './record.ts';
import type { RbiAssessment, RbiRecord, RbiStepId } from './types.ts';

export interface RbiSessionSummary {
  units?: number;
  high?: number;
  unacceptable?: number;
  nextDue?: string;
  shallMet?: number;
  shallTotal?: number;
  [key: string]: number | string | boolean | undefined;
}

export interface RbiSessionListItem {
  id: string;
  ffsSessionId: string | null;
  /** Null once the cited FFS assessment has been deleted. Shown, not hidden. */
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
    label: input.record.title.trim() || 'API 580 assessment',
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
    body: JSON.stringify({
      ...payloadOf(input),
      ffsSessionId: input.record.ffsSessionId,
    }),
  });
  if (!response.id) throw new Error('The RBI assessment was saved without an identifier.');
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
 * The stored document, brought forward into the shape the wizard renders.
 *
 * `reviveRbiRecord` merges over a blank record so an assessment authored before
 * a field existed still opens — which is the §16.2 requirement about recreating
 * an assessment later, not a nicety.
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

/**
 * The handful of numbers the registry shows without opening the document.
 *
 * Denormalised deliberately: listing twenty assessments should not mean
 * recomputing twenty risk rankings, and the counts here are the ones an engineer
 * scans a list for — how much of the line is unacceptable, and what is due next.
 */
export function summarize(
  assessment: RbiAssessment | null,
  checklist: { shallMet: number; shallTotal: number },
): RbiSessionSummary {
  if (!assessment) {
    return { shallMet: checklist.shallMet, shallTotal: checklist.shallTotal };
  }
  return {
    units: assessment.units.length,
    features: assessment.totals.features,
    high: assessment.totals.byLevel.High,
    mediumHigh: assessment.totals.byLevel['Medium high'],
    unacceptable: assessment.totals.byAcceptance.unacceptable,
    nextDue: assessment.totals.nextDueIso ?? '',
    shallMet: checklist.shallMet,
    shallTotal: checklist.shallTotal,
  };
}
