import { apiFetch } from '../../utils/api.ts';
import type { CorrosionReviewItem } from './analysis.ts';

/** One stored review decision for a single alignment feature. */
export interface FfsCandidateRecord {
  sourceKey: string;
  featureId: string | null;
  selected: boolean;
  reason: string | null;
  signature: string;
  reviewedBy: number | null;
  reviewedAt: string;
}

export interface FfsCandidateReview {
  sessionId: number;
  /** Fingerprint of the alignment result the review must be made against. */
  signature: string;
  /** True when the stored review was made against a superseded alignment. */
  stale: boolean;
  /** False when the session never reached the final phase. */
  reviewable: boolean;
  reason: string | null;
  items: FfsCandidateRecord[];
}

export interface FfsEligibleSession {
  id: string;
  pipelineName: string;
  /**
   * The line this session ran on, when the session records one.
   *
   * FFS reads the pipeline dossier through it, so the design data an engineer
   * filed at intake — diameter, wall, grade, pressures, and the register of
   * stretches a multi-size line is built from — does not have to be typed a
   * second time here.
   */
  pipelineId: number | null;
  /**
   * The day the assessed run was flown, `YYYY-MM-DD`, taken from the master run
   * recorded at upload. Null for sessions built before the intake collected it —
   * the setup screen then asks for the date instead of assuming one.
   */
  inspectionDate: string | null;
  completedAt: string | null;
  reviewedAt: string | null;
  selectedCount: number;
  reviewedCount: number;
  /**
   * Whether this session's saved review can be used as the FFS intake scope: a
   * current review that released at least one feature. False does not withhold
   * the session — every anomaly the run reported can still be assessed — it only
   * says there is no release to narrow the assessment to.
   */
  releaseAvailable: boolean;
  /** Why the release cannot be used, when it cannot. */
  releaseReason: string | null;
  /** True when the review was made against a superseded alignment result. */
  releaseStale: boolean;
}

export interface FfsBlockedSession extends FfsEligibleSession {
  reason: string;
  stale: boolean;
}

export function fetchFfsCandidates(sessionId: string, signal?: AbortSignal): Promise<FfsCandidateReview> {
  return apiFetch<FfsCandidateReview>(
    `/api/alignment-sessions/${encodeURIComponent(sessionId)}/ffs-candidates`,
    { signal },
  );
}

export function saveFfsCandidates(
  sessionId: string,
  payload: { signature: string; items: CorrosionReviewItem[] },
): Promise<FfsCandidateReview & { selectedCount: number }> {
  return apiFetch<FfsCandidateReview & { selectedCount: number }>(
    `/api/alignment-sessions/${encodeURIComponent(sessionId)}/ffs-candidates`,
    { method: 'PUT', body: { signature: payload.signature, items: payload.items } },
  );
}

export function fetchFfsEligibleSessions(
  signal?: AbortSignal,
): Promise<{ items: FfsEligibleSession[]; blocked: FfsBlockedSession[] }> {
  return apiFetch<{ items: FfsEligibleSession[]; blocked: FfsBlockedSession[] }>(
    '/api/ffs/eligible-sessions',
    { signal },
  );
}

/** Selected feature keys from a saved review, ignoring rejected entries. */
export function selectedKeysOf(review: Pick<FfsCandidateReview, 'items'>): Set<string> {
  return new Set(review.items.filter((item) => item.selected).map((item) => item.sourceKey));
}
