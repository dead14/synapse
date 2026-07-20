import { apiFetch } from './api';

export type ComparisonRow = Record<string, unknown>;

type InitialAlignmentResponse = {
  comparison?: unknown;
  groups?: { audit?: ConservationAudit };
  jobId?: string;
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

  const messages = [
    'Job diterima, memulai eksekusi...',
    'Memuat data ILI dari database...',
    'Mencocokkan welding group dan anomali...',
    'Menyusun hasil alignment...',
  ];

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    const estimatedProgress = Math.min(10 + Math.floor((attempt / MAX_POLL_ATTEMPTS) * 80), 90);
    onProgress?.(estimatedProgress, messages[Math.min(Math.floor(attempt / 30), messages.length - 1)]);

    await waitForPoll(signal);
    const job = await apiFetch<JobResponse>(`/api/job/${encodeURIComponent(initial.jobId)}/result`, { signal });
    const serverProgress = Number(job.progress);
    if (Number.isFinite(serverProgress)) {
      onProgress?.(Math.max(0, Math.min(99, serverProgress)), messages[Math.min(Math.floor(serverProgress / 30), messages.length - 1)]);
    }

    if (job.state === 'completed') {
      onProgress?.(90, 'Selesai! Memuat hasil bertahap...');
      const comparison: ComparisonRow[] = [];
      let cursor: string | null = null;
      do {
        const page = await fetchAlignmentResultPage(sessionId, { limit: 5000, cursor }, signal);
        comparison.push(...page.items);
        cursor = page.nextCursor;
        onProgress?.(Math.min(99, 90 + Math.floor(comparison.length / 5000)), `${comparison.length.toLocaleString()} baris hasil dimuat...`);
      } while (cursor);
      onProgress?.(100, 'Selesai!');
      return { comparison, audit: job.result?.groups?.audit };
    }

    if (job.state === 'failed') {
      throw new Error(job.failedReason || 'Alignment gagal diproses.');
    }
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
