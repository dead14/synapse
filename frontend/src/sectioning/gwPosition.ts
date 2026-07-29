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
  const source = rawData.raw && typeof rawData.raw === 'object' && !Array.isArray(rawData.raw)
    ? rawData.raw as Record<string, unknown>
    : null;
  const sourceKeys = [
    'Original LD',
    'original_ld',
    'source_log_distance_m',
    'raw_log_distance_m',
    'Log Distance',
    'Log Distance (m)',
    'Log Dist NEW (m)',
    'log_distance_m',
    'log_distance',
    'Odometer',
    'odometer',
  ];
  const read = (candidate: Record<string, unknown>) => {
    for (const key of sourceKeys) {
      if (candidate[key] !== undefined && candidate[key] !== null && String(candidate[key]).trim() !== '') {
        return String(candidate[key]);
      }
    }
    return null;
  };

  const nestedSourceLd = source ? read(source) : null;
  if (nestedSourceLd !== null) return nestedSourceLd;
  const directSourceLd = read(rawData);
  if (directSourceLd !== null) return directSourceLd;

  // Legacy in-memory rows used `dist`/`distance` for source LD. Do not use
  // those ambiguous fields when an adjusted absolute position is present.
  if (rawData.abs_distance_m === undefined) {
    for (const key of ['distance', 'dist', 'val']) {
      if (rawData[key] !== undefined && rawData[key] !== null && String(rawData[key]).trim() !== '') {
        return String(rawData[key]);
      }
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
