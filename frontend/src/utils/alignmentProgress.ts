export const ALIGNMENT_RESULT_PAGE_SIZE = 20_000;
/**
 * The first page is deliberately small.
 *
 * Nothing reaches the screen until a page lands, and a full 20,000-row page of
 * a wide comparison is megabytes of JSON — which is why a published link sat on
 * "Checking alignment status…" for so long that the reader gave up. A short
 * first page paints the table almost immediately; the rest of the run streams
 * in behind it at the full page size, so the total number of round trips is
 * unchanged but one.
 */
export const ALIGNMENT_FIRST_PAGE_SIZE = 1_000;

export function nextAlignmentProgress(current: number, candidate: number): number {
  const safeCurrent = Number.isFinite(current)
    ? Math.max(0, Math.min(100, Math.round(current)))
    : 0;
  if (!Number.isFinite(candidate)) return safeCurrent;
  const safeCandidate = Math.max(0, Math.min(100, Math.round(candidate)));
  return Math.max(safeCurrent, safeCandidate);
}
