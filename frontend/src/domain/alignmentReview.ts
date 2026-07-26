export type GwReviewDisposition = 'accepted' | 'review' | 'excluded';

export type GwReviewDecision = {
  disposition: GwReviewDisposition;
  note: string;
  reviewedAt: string;
};

export type GwReviewState = Record<string, GwReviewDecision>;

type RecordLike = Record<string, unknown>;

function record(value: unknown): RecordLike {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordLike : {};
}

function finiteCount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

function text(value: unknown, maxLength = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function identityPart(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(6);
  return 'none';
}

export function gwReviewKey(value: unknown): string {
  const row = record(value);
  const oldId = row.oldId ?? row.old_id;
  const newId = row.newId ?? row.new_id;
  if (oldId !== null && oldId !== undefined && newId !== null && newId !== undefined) {
    return `${identityPart(oldId)}::${identityPart(newId)}`;
  }
  return `${identityPart(row.oldVal ?? row.oldDist ?? row.old_odometer)}::${identityPart(row.newVal ?? row.newDist ?? row.new_odometer)}`;
}

export function buildDataReview(summary: unknown, acknowledged: boolean, reviewedAt = new Date().toISOString()) {
  const source = record(summary);
  const masterFeatureCount = finiteCount(record(source.newRun).total);
  const historicalFeatureCount = finiteCount(record(source.oldRun).total);
  if (!acknowledged || masterFeatureCount === 0 || historicalFeatureCount === 0) return null;
  return {
    status: 'acknowledged' as const,
    reviewedAt: timestamp(reviewedAt) ?? new Date().toISOString(),
    masterFeatureCount,
    historicalFeatureCount,
  };
}

export function normalizeGwReview(value: unknown): GwReviewState {
  const source = record(value);
  const entries = Object.entries(source).slice(0, 10_000);
  return entries.reduce<GwReviewState>((normalized, [key, rawDecision]) => {
    const decision = record(rawDecision);
    const disposition = decision.disposition;
    const reviewedAt = timestamp(decision.reviewedAt);
    const note = text(decision.note, 500);
    if (!key.trim() || !reviewedAt || (disposition !== 'accepted' && disposition !== 'review' && disposition !== 'excluded')) {
      return normalized;
    }
    normalized[key] = { disposition, note, reviewedAt };
    return normalized;
  }, {});
}

export function selectReviewedGwLocks<T>(locks: T[], review: GwReviewState): T[] {
  if (!Array.isArray(locks)) return [];
  return locks.filter((lock) => review[gwReviewKey(lock)]?.disposition !== 'excluded');
}
