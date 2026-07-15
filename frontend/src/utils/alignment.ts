import { apiFetch } from './api';

export type ComparisonRow = Record<string, unknown>;

type InitialAlignmentResponse = {
  comparison?: unknown;
  jobId?: string;
};

type JobResponse = {
  state: 'waiting' | 'active' | 'completed' | 'failed';
  failedReason?: string;
  result?: { comparison?: unknown };
};

const POLL_INTERVAL_MS = 2_000;
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

export async function fetchAlignmentComparison(
  sessionId: string,
  onProgress?: (progress: number, message: string) => void,
  signal?: AbortSignal,
): Promise<ComparisonRow[]> {
  const initial = await apiFetch<InitialAlignmentResponse>(
    `/api/ili-results?sessionId=${encodeURIComponent(sessionId)}`,
    { signal },
  );

  if (!initial.jobId) {
    return asComparisonRows(initial.comparison);
  }

  const messages = [
    'Job diterima, memulai eksekusi...',
    'Memuat data ILI dari database...',
    'Mencocokkan welding group dan anomali...',
    'Menyusun hasil alignment...',
  ];

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    const progress = Math.min(10 + Math.floor((attempt / MAX_POLL_ATTEMPTS) * 80), 90);
    onProgress?.(progress, messages[Math.min(Math.floor(attempt / 30), messages.length - 1)]);

    await waitForPoll(signal);
    const job = await apiFetch<JobResponse>(`/api/job/${encodeURIComponent(initial.jobId)}/result`, { signal });

    if (job.state === 'completed') {
      onProgress?.(100, 'Selesai! Memuat hasil...');
      return asComparisonRows(job.result?.comparison);
    }

    if (job.state === 'failed') {
      throw new Error(job.failedReason || 'Alignment gagal diproses.');
    }
  }

  throw new Error('Waktu tunggu alignment habis. Silakan coba buka sesi ini kembali.');
}
