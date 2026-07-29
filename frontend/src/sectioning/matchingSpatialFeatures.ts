import { buildHistoricalLanes } from './historicalLanes.ts';
import { interpolateAlongRoute } from './geo.ts';
import { pairKey } from './pairing.ts';
import { maxOf } from '../utils/numericRange.ts';
import type { HistoricalGwLane, SpatialFeature, SpatialFeatures } from './types';

export interface MatchingLockedGw {
  key: string;
  oldId: string;
  oldDistance: number;
  newId: string;
  newDistance: number;
}

interface Input {
  masterRun?: Record<string, unknown>;
  historicalRuns?: unknown;
  masterRows?: unknown;
  lockedGws?: MatchingLockedGw[];
  gwOrphans?: unknown;
  route?: [number, number][];
}

const finiteDistance = (row: Record<string, unknown>) => {
  for (const value of [row.dist, row.abs_distance_m, row.log_distance_m, row.odometer, row.distance, row.val]) {
    const distance = Number(value);
    if (Number.isFinite(distance)) return distance;
  }
  if (row.raw && typeof row.raw === 'object') {
    const raw = row.raw as Record<string, unknown>;
    for (const value of [raw.dist, raw.log_distance_m, raw.odometer, raw.distance, raw.val]) {
      const distance = Number(value);
      if (Number.isFinite(distance)) return distance;
    }
  }
  return null;
};

const featureType = (row: Record<string, unknown>) => [
  row.type,
  row.originalType,
  row.feature_type,
  row.feature_identification,
]
  .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
  .map((value) => String(value).trim())
  .join(' ')
  .toLowerCase();

const isWeld = (type: string) => /weld|girth|seam|\bgw\b/.test(type);
const isVisiblePhysicalFeature = (type: string) => /\b(bend|elbow|valve|tee|casing|riser|jog)\b/.test(type);
function onlyOld(orphan: Record<string, unknown>) {
  const status = String(orphan.status ?? '').toUpperCase();
  return status === 'ONLY_OLD' || (!orphan.newId && !orphan.new_id && (orphan.oldId || orphan.old_id));
}

function onlyNew(orphan: Record<string, unknown>) {
  const status = String(orphan.status ?? '').toUpperCase();
  return status === 'ONLY_NEW' || (!orphan.oldId && !orphan.old_id && (orphan.newId || orphan.new_id));
}

function orphanDistance(orphan: Record<string, unknown>, side: 'old' | 'new') {
  const values = side === 'old'
    ? [orphan.oldDist, orphan.old_odometer, orphan.oldDistance, orphan.odometer, orphan.dist]
    : [orphan.newDist, orphan.new_odometer, orphan.newDistance, orphan.odometer, orphan.dist];
  for (const value of values) {
    const distance = Number(value);
    if (Number.isFinite(distance)) return distance;
  }
  return null;
}

function primaryHistoricalRun(historicalRuns: unknown) {
  const runs = Array.isArray(historicalRuns) ? historicalRuns : [];
  return runs.length > 0 ? runs : [{ name: 'Historical OLD', year: '' }];
}

export function buildMatchingSpatialFeatures({
  masterRun = {},
  historicalRuns = [],
  masterRows = [],
  lockedGws = [],
  gwOrphans = [],
  route = [],
}: Input): SpatialFeatures {
  const sourceRows = Array.isArray(masterRows) ? masterRows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object') : [];
  const orphans = Array.isArray(gwOrphans) ? gwOrphans.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object') : [];
  // A reduction, not a spread: `Math.max(...rows)` throws RangeError past
  // ~125k arguments, which a real master run exceeds.
  const maxMasterDistance = Math.max(
    0,
    maxOf(sourceRows.map(finiteDistance).filter((distance): distance is number => distance !== null)),
    maxOf(lockedGws.map((gw) => gw.newDistance).filter(Number.isFinite)),
    maxOf(orphans.filter(onlyNew).map((orphan) => orphanDistance(orphan, 'new')).filter((distance): distance is number => distance !== null)),
  );
  const matchedByMaster = new Map(lockedGws.map((gw) => [pairKey(gw.newId, gw.newDistance), gw]));
  const matchedByMasterId = lockedGws.reduce((pairs, gw) => {
    const current = pairs.get(gw.newId) ?? [];
    current.push(gw);
    pairs.set(gw.newId, current);
    return pairs;
  }, new Map<string, MatchingLockedGw[]>());
  const matchedMasterPair = (id: string, distance: number) => {
    const exactPair = matchedByMaster.get(pairKey(id, distance));
    if (exactPair) return exactPair;
    const pairsWithSameId = matchedByMasterId.get(id) ?? [];
    return pairsWithSameId.length === 1 ? pairsWithSameId[0] : undefined;
  };
  const coordinateAt = (distance: number) => interpolateAlongRoute(route, maxMasterDistance > 0 ? distance / maxMasterDistance : 0);

  const sourceMasterWelds = sourceRows.flatMap((row, index): SpatialFeature[] => {
    const distance = finiteDistance(row);
    const type = featureType(row);
    if (distance === null || !isWeld(type)) return [];
    // Persisted anchors carry `id` as the database row key, while matching
    // evidence uses the inspection's `feature_id`. Prefer the latter so a
    // canonical lock can reconnect to the master marker after reload.
    const id = String(row.feature_id ?? row.id ?? row.sourceFeatureId ?? `NEW-GW-${index + 1}`);
    const pair = matchedMasterPair(id, distance);
    return [{
      id,
      dist: distance,
      type: type || 'weld',
      runRole: 'MASTER',
      runYear: String(masterRun.year ?? ''),
      status: pair ? 'MATCHED' : 'UNRESOLVED',
      rawData: {
        ...row,
        ...(pair ? {
          lockedKey: pair.key,
          oldId: pair.oldId,
          oldDistance: pair.oldDistance,
          masterDistance: pair.newDistance,
        } : { missingReason: 'No paired OLD GW' }),
      },
      ...coordinateAt(distance),
    }];
  });

  const fallbackMasterWelds: SpatialFeature[] = sourceMasterWelds.length > 0 ? sourceMasterWelds : lockedGws.map((gw): SpatialFeature => ({
    id: gw.newId,
    dist: gw.newDistance,
    type: 'weld',
    runRole: 'MASTER' as const,
    runYear: String(masterRun.year ?? ''),
    status: 'MATCHED' as const,
    rawData: {
      lockedKey: gw.key,
      oldId: gw.oldId,
      oldDistance: gw.oldDistance,
      masterDistance: gw.newDistance,
    },
    ...coordinateAt(gw.newDistance),
  }));
  const masterWelds = new Map<string, SpatialFeature>(fallbackMasterWelds.map((feature): [string, SpatialFeature] => [
    pairKey(feature.id, feature.dist), feature,
  ]));
  orphans.filter(onlyNew).forEach((orphan, index) => {
    const distance = orphanDistance(orphan, 'new');
    const id = String(orphan.newId ?? orphan.new_id ?? orphan.id ?? `NEW-MISSING-${index + 1}`);
    if (distance === null) return;
    const key = pairKey(id, distance);
    const existing = masterWelds.get(key);
    if (existing) {
      if (existing.status === 'MATCHED') return;
      existing.status = 'UNRESOLVED';
      existing.rawData.missingReason = 'No paired OLD GW';
      return;
    }
    masterWelds.set(key, {
      id,
      dist: distance,
      type: 'weld',
      runRole: 'MASTER',
      runYear: String(masterRun.year ?? ''),
      status: 'UNRESOLVED',
      rawData: { ...orphan, missingReason: 'No paired OLD GW' },
      ...coordinateAt(distance),
    });
  });

  const physicalFeatures = sourceRows.flatMap((row, index): SpatialFeature[] => {
    const distance = finiteDistance(row);
    const type = featureType(row);
    if (distance === null || isWeld(type) || !isVisiblePhysicalFeature(type)) return [];
    return [{
      id: String(row.feature_id ?? row.id ?? row.sourceFeatureId ?? `MASTER-${index + 1}`),
      dist: distance,
      type: type || 'other',
      runRole: 'MASTER',
      runYear: String(masterRun.year ?? ''),
      status: 'MASTER',
      rawData: row,
      ...coordinateAt(distance),
    }];
  });

  const matchRows = lockedGws.map((gw) => ({
    old_id: gw.oldId,
    old_odometer: gw.oldDistance,
    new_id: gw.newId,
    new_odometer: gw.newDistance,
  }));
  const lanes = buildHistoricalLanes(primaryHistoricalRun(historicalRuns), matchRows, []);
  const historicalLanes: HistoricalGwLane[] = lanes.map((lane, laneIndex) => {
    if (laneIndex !== 0) return lane;
    const gws = new Map<string, SpatialFeature>(lane.gws.map((gw): [string, SpatialFeature] => [
      pairKey(gw.id, gw.dist), gw,
    ]));
    orphans.filter(onlyOld).forEach((orphan, index) => {
      const distance = orphanDistance(orphan, 'old');
      const id = String(orphan.oldId ?? orphan.old_id ?? orphan.id ?? `OLD-MISSING-${index + 1}`);
      if (distance === null) return;
      const key = pairKey(id, distance);
      const existing = gws.get(key);
      if (existing) {
        if (existing.status === 'MATCHED') return;
        existing.status = 'MISSING_IN_MASTER';
        existing.rawData.missingReason = 'No paired NEW GW';
        return;
      }
      gws.set(key, {
        id,
        dist: distance,
        type: 'weld',
        runRole: 'HISTORICAL',
        runYear: lane.year,
        status: 'MISSING_IN_MASTER',
        rawData: { ...orphan, sourceDistance: distance, missingReason: 'No paired NEW GW' },
        lat: Number.NaN,
        lng: Number.NaN,
      });
    });
    return { ...lane, gws: [...gws.values()].sort((left, right) => left.dist - right.dist) };
  });
  const gws = [...masterWelds.values()].sort((left, right) => left.dist - right.dist);

  return {
    gws,
    allFeatures: [...physicalFeatures, ...gws].sort((left, right) => left.dist - right.dist),
    historicalLanes,
    stats: {
      totalLength: maxMasterDistance,
      gwCount: gws.length,
      bendCount: physicalFeatures.filter((feature) => feature.type.includes('bend')).length,
      missingGwCount: historicalLanes.reduce((total, lane) => total + lane.gws.filter((gw) => gw.status === 'MISSING_IN_MASTER').length, 0),
    },
  };
}
