import { apiFetch } from './api';
import {
  ALIGNMENT_RESULT_PAGE_SIZE,
  nextAlignmentProgress,
} from './alignmentProgress';

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
  old: ConservationSideAudit;
  new: ConservationSideAudit;
  isConserved: boolean;
}

export interface AlignmentFetchResult {
  comparison: ComparisonRow[];
  audit?: ConservationAudit;
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
const MAX_POLL_ATTEMPTS = 180;

function asComparisonRows(value: unknown): ComparisonRow[] {
  if (!Array.isArray(value)) {
    throw new Error('Respons hasil alignment tidak memiliki data perbandingan yang valid.');
  }

  return value.filter((row): row is ComparisonRow => Boolean(row) && typeof row === 'object' && !Array.isArray(row));
}

function waitForPoll(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, POLL_INTERVAL_MS);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Permintaan dibatalkan.', 'AbortError'));
    }, { once: true });
  });
}

function jobProgressMessage(state: JobResponse['state'] | undefined, progress: number): string {
  if (state === 'waiting' || state === 'queued') return 'Menunggu worker alignment...';
  if (state === 'retrying') return 'Mencoba kembali proses alignment...';
  if (progress < 25) return 'Memuat data ILI dari database...';
  if (progress < 80) return 'Mencocokkan welding group dan anomali...';
  return 'Menyusun hasil alignment...';
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
    reportProgress(90, 'Selesai diproses. Memuat hasil...');
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
        `${comparison.length.toLocaleString()} baris hasil dimuat...`,
      );
    } while (cursor);
    reportProgress(100, 'Selesai!');
    return { comparison, audit };
  };

  if (initial.state === 'completed') {
    return loadCompletedResult(initial.groups?.audit);
  }

  const initialProgress = Math.max(5, Number(initial.progress) || 0);
  reportProgress(initialProgress, jobProgressMessage(initial.state, initialProgress));

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
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
      throw new Error(job.failedReason || 'Alignment gagal diproses.');
    }

    const estimatedProgress = Math.min(
      10 + Math.floor((attempt / MAX_POLL_ATTEMPTS) * 80),
      89,
    );
    reportProgress(
      estimatedProgress,
      jobProgressMessage(job.state, estimatedProgress),
    );
    await waitForPoll(signal);
  }

  throw new Error('Waktu tunggu alignment habis. Silakan coba buka sesi ini kembali.');
}

export async function fetchAlignmentComparison(
  sessionId: string,
  onProgress?: (progress: number, message: string) => void,
  signal?: AbortSignal,
): Promise<ComparisonRow[]> {
  return (await fetchAlignmentResult(sessionId, onProgress, signal)).comparison;
}
