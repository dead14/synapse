export function resolveAuthoritativeLocation(input: {
  chainageM: number;
  stationing?: string;
  latitude?: number;
  longitude?: number;
  coordinateSource?: string;
  transformVersion?: string;
}) {
  if (!Number.isFinite(input.chainageM) || input.chainageM < 0) throw new Error('chainageM must be non-negative');
  const hasLatitude = input.latitude !== undefined;
  const hasLongitude = input.longitude !== undefined;
  if (hasLatitude !== hasLongitude) throw new Error('latitude and longitude must be supplied together');
  if (hasLatitude && (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)
    || input.latitude! < -90 || input.latitude! > 90 || input.longitude! < -180 || input.longitude! > 180)) {
    throw new Error('GPS coordinate is invalid');
  }
  if (hasLatitude && (!input.coordinateSource || !input.transformVersion)) {
    throw new Error('GPS provenance and transformVersion are required');
  }
  return {
    authoritativeMeasure: { type: 'chainage' as const, valueM: input.chainageM, stationing: input.stationing ?? null },
    spatialObservation: hasLatitude ? {
      latitude: input.latitude as number, longitude: input.longitude as number,
      source: input.coordinateSource as string, transformVersion: input.transformVersion as string,
    } : null,
  };
}
