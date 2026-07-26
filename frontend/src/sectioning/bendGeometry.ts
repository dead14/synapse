import type { SpatialFeature } from './types';

function readRawNumber(feature: SpatialFeature, patterns: RegExp[]): number | null {
  for (const [key, rawValue] of Object.entries(feature.rawData || {})) {
    const normalizedKey = key.toLowerCase().replaceAll('_', ' ');
    if (!patterns.some((pattern) => pattern.test(normalizedKey))) continue;
    const value = Number.parseFloat(String(rawValue ?? '').replace(',', '.'));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * ILI exports carry the bend angle either in a dedicated column or folded into
 * the feature type ("Bend 45"). When neither is present the drawing falls back
 * to 90 degrees and flags the result as inferred.
 */
export function bendDefinition(feature: SpatialFeature) {
  const angleFromColumn = readRawNumber(feature, [/bend.*angle/, /deflection/, /^angle$/, /degree/]);
  const angleFromType = Number.parseFloat(feature.type.match(/(?:bend|elbow)[^0-9]*(\d+(?:\.\d+)?)/i)?.[1] || '');
  const angleDeg = Math.max(5, Math.min(175, angleFromColumn ?? (Number.isFinite(angleFromType) ? angleFromType : 90)));
  return { angleDeg, inferred: angleFromColumn === null && !Number.isFinite(angleFromType) };
}

export function bendAngleDeg(feature: SpatialFeature) {
  return bendDefinition(feature).angleDeg;
}
