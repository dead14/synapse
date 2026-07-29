import type { SpatialFeature } from './types';

const finiteNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function formatLogDistance(distance: number | null | undefined) {
  return Number.isFinite(distance) ? `${Number(distance).toFixed(3)} m` : null;
}

export function getOriginalLd(rawData: Record<string, unknown> | undefined) {
  if (!rawData) return null;
  for (const key of ['Log Distance', 'Log Distance (m)', 'log_distance_m', 'log_distance', 'odometer', 'distance', 'dist', 'val']) {
    if (rawData[key] !== undefined && rawData[key] !== null && String(rawData[key]).trim() !== '') {
      return String(rawData[key]);
    }
  }
  return null;
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
    primaryOriginalLd: getOriginalLd(feature.rawData),
    pairedLabel: `Log distance ${isMaster ? 'OLD' : 'NEW'}`,
    pairedDistance: formatLogDistance(pairedDistance),
    pairedId: pairedId || null,
  };
}
