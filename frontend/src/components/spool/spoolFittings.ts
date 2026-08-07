/**
 * Pipe furniture inside the picked spool: the bends, tees, valves and flanges
 * the run reported between the two girth welds.
 *
 * The reviewer picks two welds; whatever the run says sits between them is what
 * the 3D pane has to draw. A bend there turns the pipe, a tee puts a branch on
 * it, a valve puts a body on it — and each of those changes where a defect's
 * clock position actually points.
 *
 * ILI exports are inconsistent about bend angles: some carry a dedicated
 * column, some fold it into the feature type ("Bend 45"), and many carry
 * neither. An angle that was not reported is assumed to be 90° and marked as
 * assumed, and the pane lets the engineer set the real one — a drawn angle
 * nobody reported must never read as measured evidence.
 */

import type { SpoolFeature } from '../../domain/spoolFeatures.ts';

export type SpoolFittingKind = 'bend' | 'tee' | 'valve' | 'flange' | 'other';

export interface SpoolFitting {
  key: string;
  rowIndex: number;
  maM: number;
  kind: SpoolFittingKind;
  /** The feature type exactly as the run reported it. */
  label: string;
  /** Turn angle in degrees for a bend; null for furniture that does not turn. */
  angleDeg: number | null;
  /** True when no angle was reported and the drawing assumed one. */
  angleAssumed: boolean;
  /** Clock position the bend deflects towards, or the branch points at. */
  rollDeg: number;
  /** Set when the engineer overrode what the run reported. */
  isOverridden: boolean;
}

/** What the engineer can override per fitting. */
export interface SpoolFittingOverride {
  kind?: SpoolFittingKind;
  angleDeg?: number;
  rollDeg?: number;
}

const KIND_PATTERNS: Array<[SpoolFittingKind, RegExp]> = [
  ['bend', /\b(bend|elbow|jog)\b/],
  ['tee', /\btee\b|offtake|off[\s_-]?take|branch/],
  ['valve', /valve/],
  ['flange', /flange/],
];

export const FITTING_LABEL: Record<SpoolFittingKind, string> = {
  bend: 'Bend / elbow',
  tee: 'Tee / branch',
  valve: 'Valve',
  flange: 'Flange',
  other: 'Straight (no fitting)',
};

/** Angles an engineer picks from; ILI rarely reports anything else. */
export const BEND_ANGLE_CHOICES = [11.25, 22.5, 30, 45, 60, 90] as const;

/** Clock positions a bend or branch can be pointed at. */
export const ROLL_CHOICES: Array<[string, number]> = [
  ['12:00 up', 0],
  ['3:00 right', 90],
  ['6:00 down', 180],
  ['9:00 left', 270],
];

export function classifyFitting(featureType: string): SpoolFittingKind | null {
  const haystack = featureType.toLowerCase();
  for (const [kind, pattern] of KIND_PATTERNS) {
    if (pattern.test(haystack)) return kind;
  }
  return null;
}

/**
 * The bend angle the run reported, read from the feature type ("Bend 45",
 * "45 deg elbow"). Returns null when the run said nothing, which the caller
 * must present as an assumption rather than as a reading.
 */
export function reportedBendAngle(featureType: string): number | null {
  const text = String(featureType || '');
  const tagged = text.match(/(?:bend|elbow|jog)[^0-9]{0,8}(\d+(?:[.,]\d+)?)/i)
    ?? text.match(/(\d+(?:[.,]\d+)?)\s*(?:°|deg|degree)/i)
    ?? text.match(/(\d+(?:[.,]\d+)?)[^0-9]{0,8}(?:bend|elbow)/i);
  if (!tagged) return null;
  const angle = Number(tagged[1].replace(',', '.'));
  if (!Number.isFinite(angle) || angle <= 0 || angle >= 180) return null;
  return angle;
}

const ASSUMED_BEND_ANGLE_DEG = 90;

/**
 * Every fitting the run reported inside the window, in order along the line,
 * with any engineer override applied.
 */
export function collectSpoolFittings(
  features: readonly SpoolFeature[],
  window: { startM: number; endM: number },
  overrides: Record<string, SpoolFittingOverride> = {},
): SpoolFitting[] {
  const fittings: SpoolFitting[] = [];
  for (const feature of features) {
    if (feature.maM < window.startM || feature.maM > window.endM) continue;
    const featureType = feature.current.featureType || feature.previous.featureType;
    const reportedKind = classifyFitting(featureType);
    const override = overrides[feature.key];
    if (!reportedKind && !override?.kind) continue;

    const kind = override?.kind ?? reportedKind ?? 'other';
    const reportedAngle = kind === 'bend' ? reportedBendAngle(featureType) : null;
    const angleDeg = kind === 'bend'
      ? override?.angleDeg ?? reportedAngle ?? ASSUMED_BEND_ANGLE_DEG
      : null;
    fittings.push({
      key: feature.key,
      rowIndex: feature.rowIndex,
      maM: feature.maM,
      kind,
      label: featureType || FITTING_LABEL[kind],
      angleDeg,
      angleAssumed: kind === 'bend' && reportedAngle === null && override?.angleDeg === undefined,
      // A run reports where a feature sits on the clock but not which way the
      // line turns, so the deflection defaults to the feature's own clock and
      // stays editable.
      rollDeg: override?.rollDeg ?? (Number.isFinite(feature.clockDeg) ? feature.clockDeg : 0),
      isOverridden: override !== undefined && (
        override.kind !== undefined
        || override.angleDeg !== undefined
        || override.rollDeg !== undefined
      ),
    });
  }
  return fittings.sort((left, right) => left.maM - right.maM);
}
