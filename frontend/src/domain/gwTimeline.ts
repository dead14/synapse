import type { GwReviewDisposition } from './alignmentReview';
import { extentOf, maxOf } from '../utils/numericRange.ts';

export type TimelineStatus = 'matched' | 'review' | 'missing';

/**
 * The display term for a timeline status.
 *
 * `missing` is the engine's bucket key and stays that way on the wire. On a
 * girth-weld lane it must not be *read* as "missing", though: a weld with no
 * counterpart in the other run is a weld the comparison could not match, not a
 * weld that has gone. "Missing" is the metal-loss word — a feature that was in
 * the OLD run and is absent from the NEW one — and using it for both makes two
 * different findings look like one.
 */
export const TIMELINE_STATUS_LABEL: Record<TimelineStatus, string> = {
  matched: 'Matched',
  review: 'Review',
  missing: 'Not match',
};

type RunLaneLike = { year?: unknown; vendor?: unknown; surveyDate?: unknown } | null | undefined;

/**
 * What to write on each lane of the viewer.
 *
 * Engineers read the two lanes as survey years, so that is all the lane says.
 * "OLD" and "NEW" are the engine's names for the sides of a pair and mean
 * nothing on a screen that already shows which year sits where — worse, in a
 * chain the NEW side of an intermediate pair is not the master run, so the word
 * actively misled. A run with no year falls back to its vendor, and identical
 * fallbacks are disambiguated by position rather than left ambiguous.
 */
export function timelineLaneLabels(oldRun: RunLaneLike, newRun: RunLaneLike): {
  old: string;
  new: string;
} {
  const name = (run: RunLaneLike) => {
    const year = String(run?.year ?? '').trim();
    if (/^\d{4}$/.test(year)) return year;
    const date = String(run?.surveyDate ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date.slice(0, 4);
    const vendor = String(run?.vendor ?? '').trim();
    return vendor || 'Undated run';
  };
  const oldLabel = name(oldRun);
  const newLabel = name(newRun);
  if (oldLabel !== newLabel) return { old: oldLabel, new: newLabel };
  return { old: `${oldLabel} (earlier)`, new: `${newLabel} (later)` };
}

export type TimelineMatchLike = {
  id?: string | number;
  status?: string;
  flagged?: boolean;
  oldId?: string | number | null;
  newId?: string | number | null;
  oldVal?: number | null;
  newVal?: number | null;
  offset?: number | null;
  originalOldVal?: number | null;
  originalNewVal?: number | null;
  confidence?: number | null;
  matchConfidence?: number | null;
};

export function sourceOdometerDistance(
  match: TimelineMatchLike,
  side: 'old' | 'new',
): number | null {
  const candidates = side === 'old'
    ? [match.originalOldVal, match.oldVal]
    : [match.originalNewVal, match.newVal];
  for (const candidate of candidates) {
    const distance = Number(candidate);
    if (Number.isFinite(distance)) return distance;
  }
  return null;
}

export function sourceOdometerOffset(match: TimelineMatchLike): number | null {
  const oldDistance = sourceOdometerDistance(match, 'old');
  const newDistance = sourceOdometerDistance(match, 'new');
  return oldDistance !== null && newDistance !== null
    ? newDistance - oldDistance
    : null;
}

export type GwTimelineMatch = TimelineMatchLike & {
  oldDesc?: string;
  newDesc?: string;
  originalOldVal?: number | null;
  originalNewVal?: number | null;
  deviationRatio?: number | null;
  rawVarPct?: number | null;
  sOld?: number | null;
  sNew?: number | null;
  timelineOnly?: boolean;
  timelineReason?: string | null;
};

export type TimelineFeatureEvidence = {
  id?: string | number | null;
  type?: string | null;
  displayDistanceM?: number | null;
  sourceDistanceM?: number | null;
  inOverlap?: boolean;
  reason?: string | null;
};

export type TimelineCoverage = {
  startM?: number | null;
  endM?: number | null;
  sourceStartM?: number | null;
  sourceEndM?: number | null;
};

export type TimelineEvidence = {
  coordinateSystem?: string;
  domain?: TimelineCoverage | null;
  oldCoverage?: TimelineCoverage | null;
  newCoverage?: TimelineCoverage | null;
  oldFeatures?: TimelineFeatureEvidence[] | null;
  newFeatures?: TimelineFeatureEvidence[] | null;
};

export type TimelineGeometry = {
  domain: { startM: number; endM: number };
  oldCoverage: { startM: number; endM: number } | null;
  newCoverage: { startM: number; endM: number } | null;
  oldGWs: number[];
  newGWs: number[];
  oldValves: number[];
  newValves: number[];
  oldTees: number[];
  newTees: number[];
  oldFeatures: Array<TimelineFeatureEvidence & { displayDistanceM: number }>;
  newFeatures: Array<TimelineFeatureEvidence & { displayDistanceM: number }>;
  matches: GwTimelineMatch[];
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

const finiteDistance = (value: unknown): number | null => {
  const distance = Number(value);
  return Number.isFinite(distance) ? distance : null;
};

export function rawLdForTimelineMarker(
  sourceDistanceM: unknown,
  match: GwTimelineMatch | undefined,
  side: 'old' | 'new',
) {
  const originalDistance = side === 'old' ? match?.originalOldVal : match?.originalNewVal;
  const mappedDistance = side === 'old' ? match?.oldVal : match?.newVal;

  for (const candidate of [sourceDistanceM, originalDistance, mappedDistance]) {
    if (candidate === null || candidate === undefined || candidate === '') continue;
    const distance = finiteDistance(candidate);
    if (distance !== null) return distance;
  }
  return null;
}

const normalizedCoverage = (coverage: TimelineCoverage | null | undefined) => {
  const startM = finiteDistance(coverage?.startM);
  const endM = finiteDistance(coverage?.endM);
  return startM !== null && endM !== null && endM >= startM ? { startM, endM } : null;
};

const featureKind = (feature: TimelineFeatureEvidence) => {
  const value = String(feature.type ?? '').trim().toLowerCase();
  if (/\bvalve\b/.test(value)) return 'valve';
  if (/\b(?:tee|offtake|branch)\b/.test(value)) return 'tee';
  if (/\b(?:weld|girth|seam)\b/.test(value)) return 'weld';
  return value;
};

type NormalizedTimelineFeature = TimelineFeatureEvidence & {
  displayDistanceM: number;
  sourceDistanceM: number | null;
};

const normalizedFeatures = (
  features: TimelineFeatureEvidence[] | null | undefined,
): NormalizedTimelineFeature[] => (
  (Array.isArray(features) ? features : [])
    .flatMap((feature): NormalizedTimelineFeature[] => {
      const displayDistanceM = finiteDistance(feature.displayDistanceM);
      if (displayDistanceM === null) return [];
      return [{
        ...feature,
        displayDistanceM,
        sourceDistanceM: finiteDistance(feature.sourceDistanceM),
      }];
    })
    .sort((left, right) => left.displayDistanceM - right.displayDistanceM)
);

const representedOnSide = (
  matches: GwTimelineMatch[],
  feature: TimelineFeatureEvidence & { displayDistanceM: number },
  side: 'old' | 'new',
) => matches.some((match) => {
  const matchId = side === 'old' ? match.oldId : match.newId;
  const matchDistance = finiteDistance(side === 'old' ? match.oldVal : match.newVal);
  if (feature.id !== null && feature.id !== undefined && matchId !== null && matchId !== undefined) {
    return String(feature.id) === String(matchId);
  }
  return matchDistance !== null && Math.abs(matchDistance - feature.displayDistanceM) < 0.0005;
});

export function buildTimelineModel(
  matches: GwTimelineMatch[],
  evidence?: TimelineEvidence | null,
): TimelineGeometry {
  const oldFeatures = normalizedFeatures(evidence?.oldFeatures);
  const newFeatures = normalizedFeatures(evidence?.newFeatures);
  const baseMatches = Array.isArray(matches) ? matches : [];
  const timelineMatches = [...baseMatches];

  oldFeatures.forEach((feature, index) => {
    if (representedOnSide(baseMatches, feature, 'old')) return;
    timelineMatches.push({
      id: `timeline-old-${String(feature.id ?? index)}-${feature.displayDistanceM}`,
      status: 'Skipped',
      oldId: feature.id,
      newId: null,
      oldVal: feature.displayDistanceM,
      newVal: null,
      originalOldVal: feature.sourceDistanceM,
      originalNewVal: null,
      offset: null,
      timelineOnly: true,
      timelineReason: feature.reason ?? null,
    });
  });
  newFeatures.forEach((feature, index) => {
    if (representedOnSide(baseMatches, feature, 'new')) return;
    timelineMatches.push({
      id: `timeline-new-${String(feature.id ?? index)}-${feature.displayDistanceM}`,
      status: 'Skipped',
      oldId: null,
      newId: feature.id,
      oldVal: null,
      newVal: feature.displayDistanceM,
      originalOldVal: null,
      originalNewVal: feature.sourceDistanceM,
      offset: null,
      timelineOnly: true,
      timelineReason: feature.reason ?? null,
    });
  });

  const evidenceDomain = normalizedCoverage(evidence?.domain);
  const knownDistances = [
    ...oldFeatures.map((feature) => feature.displayDistanceM),
    ...newFeatures.map((feature) => feature.displayDistanceM),
    ...baseMatches.flatMap((match) => [finiteDistance(match.oldVal), finiteDistance(match.newVal)])
      .filter((distance): distance is number => distance !== null),
  ];
  const knownExtent = extentOf(knownDistances, { min: 0, max: 1 });
  const derivedStart = knownExtent.min;
  const derivedEnd = knownExtent.max;
  const domain = evidenceDomain ?? {
    startM: derivedStart,
    endM: derivedEnd > derivedStart ? derivedEnd : derivedStart + 1,
  };

  const distancesFor = (kind: 'weld' | 'valve' | 'tee', features: typeof oldFeatures) => (
    features.filter((feature) => featureKind(feature) === kind).map((feature) => feature.displayDistanceM)
  );

  return {
    domain,
    oldCoverage: normalizedCoverage(evidence?.oldCoverage),
    newCoverage: normalizedCoverage(evidence?.newCoverage),
    oldGWs: distancesFor('weld', oldFeatures),
    newGWs: distancesFor('weld', newFeatures),
    oldValves: distancesFor('valve', oldFeatures),
    newValves: distancesFor('valve', newFeatures),
    oldTees: distancesFor('tee', oldFeatures),
    newTees: distancesFor('tee', newFeatures),
    oldFeatures,
    newFeatures,
    matches: timelineMatches,
  };
}

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
    maxOffset: maxOf(summary.offsets.map(Math.abs)),
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

/**
 * What the offset series says, as three numbers an engineer acts on.
 *
 * The mean says how far the two runs sit apart, the maximum says where the
 * worst disagreement is (so it can be opened), and the slope says whether the
 * gap grows along the line — a steady slope is odometer scale error, a step is
 * a missed weld or an inserted spool. Reported in mm/m because that is the
 * magnitude these actually land at; m/m would be a column of zeroes.
 */
export function offsetTrend(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return null;
  const ordered = [...points].sort((left, right) => left.x - right.x);
  const mean = ordered.reduce((sum, point) => sum + point.y, 0) / ordered.length;

  let worst = ordered[0];
  for (const point of ordered) {
    if (Math.abs(point.y) > Math.abs(worst.y)) worst = point;
  }

  const meanX = ordered.reduce((sum, point) => sum + point.x, 0) / ordered.length;
  let covariance = 0;
  let variance = 0;
  for (const point of ordered) {
    covariance += (point.x - meanX) * (point.y - mean);
    variance += (point.x - meanX) ** 2;
  }
  // Every pair at the same chainage means there is no run to fit a line along.
  // Reporting 0 mm/m there would claim a flat trend that was never measured.
  const slopeMmPerM = variance === 0 ? null : (covariance / variance) * 1_000;

  return {
    mean,
    maxAbs: Math.abs(worst.y),
    maxAt: worst.x,
    drift: ordered[ordered.length - 1].y - ordered[0].y,
    spanFrom: ordered[0].x,
    spanTo: ordered[ordered.length - 1].x,
    slopeMmPerM,
  };
}
