import { apiFetch } from './api';
import {
  ALIGNMENT_RESULT_PAGE_SIZE,
  nextAlignmentProgress,
} from './alignmentProgress';
import { fetchPublicShareResultPage } from '../lib/sharing/publicShareClient';

export {
  ALIGNMENT_RESULT_PAGE_SIZE,
  nextAlignmentProgress,
} from './alignmentProgress';

export type ComparisonRow = Record<string, unknown>;

type InitialAlignmentResponse = {
  comparison?: unknown;
  groups?: { audit?: ConservationAudit };
  jobId?: string;
  state?: JobResponse['state'];
  progress?: number;
};

type JobResponse = {
  state: 'waiting' | 'queued' | 'active' | 'retrying' | 'completed' | 'failed';
  progress?: number;
  failedReason?: string;
  result?: { comparison?: unknown; groups?: { audit?: ConservationAudit } };
};

export interface ConservationSideAudit {
  inputCount: number;
  outputReferences: number;
  missingKeys: string[];
  duplicateKeys: string[];
  unknownKeys: string[];
}

export interface ConservationAudit {
  old?: ConservationSideAudit;
  new?: ConservationSideAudit;
  isConserved?: boolean;
  pairs?: ConservationAudit[];
}

export interface AlignmentFetchResult {
  comparison: ComparisonRow[];
  audit?: ConservationAudit;
  /**
   * The completed run these rows came from. A published link names it so the
   * recipient reads the run the author released, not whichever run is newest
   * for the session by the time they open the link.
   */
  jobId?: string;
}

export interface AlignmentResultPage {
  items: ComparisonRow[];
  nextCursor: string | null;
}

/** Load only one bounded result window for tables, exports, and future viewport consumers. */
export async function fetchAlignmentResultPage(
  sessionId: string,
  options: { limit?: number; cursor?: string | null } = {},
  signal?: AbortSignal,
): Promise<AlignmentResultPage> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.cursor) params.set('cursor', options.cursor);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await apiFetch<{ items?: unknown; nextCursor?: unknown }>(
    `/api/results/${encodeURIComponent(sessionId)}/page${suffix}`,
    { signal },
  );
  return {
    items: asComparisonRows(response.items),
    nextCursor: typeof response.nextCursor === 'string' ? response.nextCursor : null,
  };
}

const POLL_INTERVAL_MS = 1_000;
const MAX_POLL_INTERVAL_MS = 5_000;
/**
 * How long to keep watching a run before calling it lost.
 *
 * This must cover the worker's own ceiling for one run
 * (ALIGNMENT_PROCESS_TIMEOUT_MS, 10 minutes by default) plus the wait for a
 * free worker slot in front of it. A budget shorter than the worker's showed
 * the engineer a timeout for a run that went on to finish, and the reload it
 * invited queued a second run behind the first — which is how a session ends
 * up permanently reporting that it is waiting for the alignment worker.
 */
const POLL_BUDGET_MS = 15 * 60 * 1000;

function asComparisonRows(value: unknown): ComparisonRow[] {
  if (!Array.isArray(value)) {
    throw new Error('Alignment result response did not include valid comparison data.');
  }

  return value.filter((row): row is ComparisonRow => Boolean(row) && typeof row === 'object' && !Array.isArray(row));
}

function waitForPoll(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, delayMs);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Request cancelled.', 'AbortError'));
    }, { once: true });
  });
}

function jobProgressMessage(state: JobResponse['state'] | undefined, progress: number): string {
  if (state === 'waiting' || state === 'queued') return 'Waiting for the alignment worker...';
  if (state === 'retrying') return 'Retrying the alignment process...';
  if (progress < 25) return 'Loading ILI data from the database...';
  if (progress < 80) return 'Matching welding groups and anomalies...';
  return 'Assembling the alignment results...';
}

export async function fetchAlignmentResult(
  sessionId: string,
  onProgress?: (progress: number, message: string) => void,
  signal?: AbortSignal,
): Promise<AlignmentFetchResult> {
  const initial = await apiFetch<InitialAlignmentResponse>(
    `/api/ili-results?sessionId=${encodeURIComponent(sessionId)}`,
    { signal },
  );

  if (!initial.jobId) {
    return { comparison: asComparisonRows(initial.comparison), audit: initial.groups?.audit };
  }

  let reportedProgress = 0;
  const reportProgress = (candidate: number, message: string) => {
    const nextProgress = nextAlignmentProgress(reportedProgress, candidate);
    if (nextProgress <= reportedProgress && reportedProgress !== 0) return;
    reportedProgress = nextProgress;
    onProgress?.(nextProgress, message);
  };

  const loadCompletedResult = async (audit?: ConservationAudit): Promise<AlignmentFetchResult> => {
    reportProgress(90, 'Processing complete. Loading results...');
    const comparison: ComparisonRow[] = [];
    let cursor: string | null = null;
    do {
      const page = await fetchAlignmentResultPage(
        sessionId,
        { limit: ALIGNMENT_RESULT_PAGE_SIZE, cursor },
        signal,
      );
      comparison.push(...page.items);
      cursor = page.nextCursor;
      reportProgress(
        cursor ? 95 : 99,
        `${comparison.length.toLocaleString()} result rows loaded...`,
      );
    } while (cursor);
    reportProgress(100, 'Done!');
    return { comparison, audit, jobId: initial.jobId };
  };

  if (initial.state === 'completed') {
    return loadCompletedResult(initial.groups?.audit);
  }

  const initialProgress = Math.max(5, Number(initial.progress) || 0);
  reportProgress(initialProgress, jobProgressMessage(initial.state, initialProgress));

  const startedAt = Date.now();
  // A run that outlasts the first few seconds is doing real work, so back the
  // polling off rather than asking a busy API the same question every second
  // for the rest of the budget.
  let pollInterval = POLL_INTERVAL_MS;

  while (Date.now() - startedAt < POLL_BUDGET_MS) {
    const job = await apiFetch<JobResponse>(`/api/job/${encodeURIComponent(initial.jobId)}/result`, { signal });
    const serverProgress = Number(job.progress);
    if (Number.isFinite(serverProgress)) {
      reportProgress(
        Math.min(99, serverProgress),
        jobProgressMessage(job.state, serverProgress),
      );
    }

    if (job.state === 'completed') {
      return loadCompletedResult(job.result?.groups?.audit);
    }

    if (job.state === 'failed') {
      throw new Error(job.failedReason || 'Alignment processing failed.');
    }

    const estimatedProgress = Math.min(
      10 + Math.floor(((Date.now() - startedAt) / POLL_BUDGET_MS) * 80),
      89,
    );
    reportProgress(
      estimatedProgress,
      jobProgressMessage(job.state, estimatedProgress),
    );
    await waitForPoll(pollInterval, signal);
    pollInterval = Math.min(pollInterval * 1.5, MAX_POLL_INTERVAL_MS);
  }

  throw new Error('Alignment timed out. Reopen this session to try again.');
}

export async function fetchAlignmentComparison(
  sessionId: string,
  onProgress?: (progress: number, message: string) => void,
  signal?: AbortSignal,
): Promise<ComparisonRow[]> {
  return (await fetchAlignmentResult(sessionId, onProgress, signal)).comparison;
}

export async function fetchSharedAlignmentResult(
  shareId: string,
  accessToken: string,
  onProgress?: (progress: number, message: string) => void,
  signal?: AbortSignal,
): Promise<AlignmentFetchResult> {
  const comparison: ComparisonRow[] = [];
  let cursor: string | null = null;
  do {
    const page = await fetchPublicShareResultPage(
      shareId,
      accessToken,
      { limit: ALIGNMENT_RESULT_PAGE_SIZE, cursor },
      signal,
    );
    comparison.push(...page.items);
    cursor = page.nextCursor;
    onProgress?.(
      cursor ? 95 : 100,
      `${comparison.length.toLocaleString()} shared result rows loaded...`,
    );
  } while (cursor);
  return { comparison };
}
