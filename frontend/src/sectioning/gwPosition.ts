import type { SpatialFeature } from './types';

const finiteNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function formatLogDistance(distance: number | null | undefined) {
  return Number.isFinite(distance) ? `${Number(distance).toFixed(3)} m` : null;
}

export function getGwPositionDetails(feature: SpatialFeature) {
  const isMaster = feature.runRole === 'MASTER';
  const pairedDistance = finiteNumber(isMaster ? feature.rawData.oldDistance : feature.rawData.masterDistance);
  const pairedId = isMaster
    ? String(feature.rawData.oldId ?? '')
    : String(feature.rawData.matchedMasterId ?? '');

  return {
    primaryLabel: `Log distance ${isMaster ? 'NEW' : 'OLD'}`,
    primaryDistance: formatLogDistance(feature.dist)!,
    pairedLabel: `Log distance ${isMaster ? 'OLD' : 'NEW'}`,
    pairedDistance: formatLogDistance(pairedDistance),
    pairedId: pairedId || null,
  };
}
