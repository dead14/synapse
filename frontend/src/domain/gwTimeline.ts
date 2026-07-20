import type { GwReviewDisposition } from './alignmentReview';

export type TimelineStatus = 'matched' | 'review' | 'missing';

export type TimelineMatchLike = {
  id?: string | number;
  status?: string;
  flagged?: boolean;
  oldId?: string | number | null;
  newId?: string | number | null;
  oldVal?: number | null;
  newVal?: number | null;
  offset?: number | null;
  confidence?: number | null;
  matchConfidence?: number | null;
};

export type GwTimelineMatch = TimelineMatchLike & {
  oldDesc?: string;
  newDesc?: string;
  originalOldVal?: number | null;
  originalNewVal?: number | null;
  deviationRatio?: number | null;
  rawVarPct?: number | null;
  sOld?: number | null;
  sNew?: number | null;
};

export type TimelineSummary = {
  matched: number;
  review: number;
  missing: number;
  total: number;
  matchedPercent: number;
  meanOffset: number;
  maxOffset: number;
};

type ViewportMetrics = {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
};

const clamp = (value: number, minimum: number, maximum: number) => (
  Math.min(maximum, Math.max(minimum, value))
);

const hasSide = (id: unknown, distance: unknown) => (
  (id !== null && id !== undefined && String(id).trim() !== '') || Number.isFinite(Number(distance))
);

export function classifyTimelineMatch(
  match: TimelineMatchLike,
  disposition?: GwReviewDisposition,
): TimelineStatus {
  if (disposition === 'excluded') return 'missing';

  const normalizedStatus = String(match.status ?? '').trim().toLowerCase();
  const hasOld = hasSide(match.oldId, match.oldVal);
  const hasNew = hasSide(match.newId, match.newVal);
  if (!hasOld || !hasNew || ['skipped', 'missing', 'orphan', 'unmatched'].includes(normalizedStatus)) {
    return 'missing';
  }

  if (disposition === 'accepted') return 'matched';
  if (disposition === 'review' || match.flagged || normalizedStatus === 'flagged') return 'review';
  return 'matched';
}

export function buildTimelineSummary(
  matches: TimelineMatchLike[],
  dispositionsById: Record<string, GwReviewDisposition> = {},
): TimelineSummary {
  const summary = matches.reduce((current, match) => {
    const disposition = match.id === undefined ? undefined : dispositionsById[String(match.id)];
    const status = classifyTimelineMatch(match, disposition);
    current[status] += 1;

    if (status !== 'missing' && Number.isFinite(Number(match.offset))) {
      current.offsets.push(Number(match.offset));
    }
    return current;
  }, { matched: 0, review: 0, missing: 0, offsets: [] as number[] });

  const total = summary.matched + summary.review + summary.missing;
  return {
    matched: summary.matched,
    review: summary.review,
    missing: summary.missing,
    total,
    matchedPercent: total === 0 ? 0 : Number(((summary.matched / total) * 100).toFixed(1)),
    meanOffset: summary.offsets.length === 0
      ? 0
      : summary.offsets.reduce((sum, offset) => sum + offset, 0) / summary.offsets.length,
    maxOffset: summary.offsets.length === 0 ? 0 : Math.max(...summary.offsets.map(Math.abs)),
  };
}

export function buildOffsetHistogram(values: number[], binCount = 16) {
  const samples = values.map(Number).filter(Number.isFinite);
  const safeBinCount = clamp(Math.trunc(binCount) || 1, 1, 64);
  const maximum = Math.max(1, ...samples.map(Math.abs));
  const minimum = -maximum;
  const binWidth = (maximum * 2) / safeBinCount;
  const bins = Array.from({ length: safeBinCount }, (_, index) => ({
    from: minimum + index * binWidth,
    to: minimum + (index + 1) * binWidth,
    count: 0,
  }));

  samples.forEach((sample) => {
    const index = sample === maximum
      ? safeBinCount - 1
      : clamp(Math.floor((sample - minimum) / binWidth), 0, safeBinCount - 1);
    bins[index].count += 1;
  });

  return bins;
}

export function calculateViewportWindow({ scrollLeft, clientWidth, scrollWidth }: ViewportMetrics) {
  if (!Number.isFinite(scrollWidth) || scrollWidth <= 0 || !Number.isFinite(clientWidth) || clientWidth <= 0) {
    return { leftPercent: 0, widthPercent: 100 };
  }

  const widthPercent = clamp((clientWidth / scrollWidth) * 100, 0, 100);
  const leftPercent = clamp((Math.max(0, scrollLeft) / scrollWidth) * 100, 0, 100 - widthPercent);
  return { leftPercent, widthPercent };
}

export function readMatchConfidence(match: TimelineMatchLike): number | null {
  const candidates = [match.confidence, match.matchConfidence];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (!Number.isFinite(value) || value < 0) continue;
    if (value <= 1) return Number((value * 100).toFixed(1));
    if (value <= 100) return Number(value.toFixed(1));
  }
  return null;
}
