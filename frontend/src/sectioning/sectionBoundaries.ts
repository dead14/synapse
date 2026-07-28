import type { SpatialFeature, SpatialFeatures } from './types.ts';
import type { LockedGwPair, SectionBoundary } from '../wizard/matchingSections.ts';

function interpolate(value: number, from: number[], to: number[]): number | null {
  if (from.length === 0 || from.length !== to.length) return null;
  if (from.length === 1) return value + (to[0] - from[0]);

  let upper = from.findIndex((point) => point >= value);
  if (upper <= 0) upper = 1;
  if (upper < 0) upper = from.length - 1;
  const lower = upper - 1;
  const span = from[upper] - from[lower];
  if (span === 0) return null;
  const ratio = (value - from[lower]) / span;
  return to[lower] + ratio * (to[upper] - to[lower]);
}

function projectedDistance(
  distance: number,
  side: 'OLD' | 'NEW',
  locks: LockedGwPair[],
): number | null {
  const ordered = [...locks].sort((left, right) => (
    side === 'NEW'
      ? left.newDistance - right.newDistance
      : left.oldDistance - right.oldDistance
  ));
  return side === 'NEW'
    ? interpolate(distance, ordered.map((lock) => lock.newDistance), ordered.map((lock) => lock.oldDistance))
    : interpolate(distance, ordered.map((lock) => lock.oldDistance), ordered.map((lock) => lock.newDistance));
}

export function sectionBoundaryForFeature(
  feature: SpatialFeature,
  locks: LockedGwPair[],
): SectionBoundary | null {
  const lockedKey = String(feature.rawData.lockedKey ?? '');
  if (lockedKey) {
    const lock = locks.find((candidate) => candidate.key === lockedKey);
    if (!lock) return null;
    return {
      key: lock.key,
      side: 'MATCHED',
      label: lock.newId,
      oldId: lock.oldId,
      newId: lock.newId,
      oldDistance: lock.oldDistance,
      newDistance: lock.newDistance,
      sourceDistance: lock.newDistance,
    };
  }

  const side = feature.runRole === 'HISTORICAL' ? 'OLD' : 'NEW';
  const counterpart = projectedDistance(feature.dist, side, locks);
  if (counterpart === null || !Number.isFinite(counterpart)) return null;
  return {
    key: `UNMATCHED::${side}::${feature.id}::${feature.dist.toFixed(6)}`,
    side,
    label: feature.id,
    oldId: side === 'OLD' ? feature.id : null,
    newId: side === 'NEW' ? feature.id : null,
    oldDistance: side === 'OLD' ? feature.dist : counterpart,
    newDistance: side === 'NEW' ? feature.dist : counterpart,
    sourceDistance: feature.dist,
  };
}

export function buildSectionBoundaries(
  features: SpatialFeatures,
  locks: LockedGwPair[],
  includeUnmatched: boolean,
): SectionBoundary[] {
  const candidates = [
    ...features.gws,
    ...features.historicalLanes.flatMap((lane) => lane.gws.filter((gw) => gw.status !== 'MATCHED')),
  ];
  const boundaries = candidates
    .map((feature) => sectionBoundaryForFeature(feature, locks))
    .filter((boundary): boundary is SectionBoundary => Boolean(boundary))
    .filter((boundary) => includeUnmatched || boundary.side === 'MATCHED');
  return [...new Map(boundaries.map((boundary) => [boundary.key, boundary])).values()]
    .sort((left, right) => left.newDistance - right.newDistance);
}
