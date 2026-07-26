export const ALIGNMENT_RESULT_PAGE_SIZE = 20_000;

export function nextAlignmentProgress(current: number, candidate: number): number {
  const safeCurrent = Number.isFinite(current)
    ? Math.max(0, Math.min(100, Math.round(current)))
    : 0;
  if (!Number.isFinite(candidate)) return safeCurrent;
  const safeCandidate = Math.max(0, Math.min(100, Math.round(candidate)));
  return Math.max(safeCurrent, safeCandidate);
}
