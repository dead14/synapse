/**
 * Layout maths for the pressure comparison rail.
 *
 * The rail plots the three pressures a B31G assessment actually produces —
 * required pressure, safe pressure, and failure pressure — on one axis so the
 * remaining margin is readable without arithmetic. Nothing here recalculates an
 * assessment; it only decides where each already-calculated value sits.
 */

export type PressureRailMarkerId = 'required' | 'safe' | 'failure';

export type PressureRailBandId = 'service' | 'margin' | 'deficit' | 'reserve';

export interface PressureRailMarker {
  id: PressureRailMarkerId;
  /** Engineering symbol shown in the callout, e.g. `P_safe`. */
  symbol: string;
  /** Plain-language name shown in the legend. */
  label: string;
  valueMpa: number;
  /** Where the dot sits on the axis, 0–100. */
  positionPct: number;
  /** Where the callout sits, nudged clear of its neighbours, 0–100. */
  labelPct: number;
}

export interface PressureRailBand {
  id: PressureRailBandId;
  fromPct: number;
  toPct: number;
}

export interface PressureRailLayout {
  axisMaximumMpa: number;
  ticksMpa: number[];
  markers: PressureRailMarker[];
  bands: PressureRailBand[];
  /** Safe pressure covers the required pressure. */
  acceptable: boolean;
  /** Safe pressure minus required pressure, in MPa. */
  marginMpa: number;
}

export interface PressureRailInput {
  requiredPressureMpa: number;
  safePressureMpa: number;
  failurePressureMpa: number;
}

/** Minimum horizontal separation between two callouts, in axis percent. */
export const CALLOUT_MIN_GAP_PCT = 24;

function finiteOrZero(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function axisStep(maximum: number): number {
  if (maximum <= 5) return 1;
  if (maximum <= 15) return 2.5;
  if (maximum <= 40) return 5;
  if (maximum <= 100) return 10;
  return 25;
}

export function axisMaximum(values: number[]): number {
  const maximum = Math.max(1, ...values.map(finiteOrZero));
  const step = axisStep(maximum);
  return Math.ceil((maximum * 1.08) / step) * step;
}

export function positionOnAxis(value: number, maximum: number): number {
  if (maximum <= 0) return 0;
  // An unbounded capacity still has to render somewhere; pinning it to the far
  // end keeps the ordering of the markers honest.
  if (value === Number.POSITIVE_INFINITY) return 100;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, (value / maximum) * 100));
}

/**
 * Pushes overlapping callouts apart while keeping their original left-to-right
 * order and staying inside the plot. Returns positions in the input order.
 */
export function spreadCallouts(positions: number[], minGapPct: number): number[] {
  if (positions.length === 0) return [];
  const edge = minGapPct / 2;
  const lowest = edge;
  const highest = 100 - edge;
  const ordered = positions
    .map((position, index) => ({ position, index }))
    .sort((a, b) => a.position - b.position);
  const spread = ordered.map((entry) => Math.max(lowest, Math.min(highest, entry.position)));

  for (let index = 1; index < spread.length; index += 1) {
    spread[index] = Math.max(spread[index], spread[index - 1] + minGapPct);
  }
  for (let index = spread.length - 1; index >= 0; index -= 1) {
    const ceiling = index === spread.length - 1 ? highest : spread[index + 1] - minGapPct;
    spread[index] = Math.min(spread[index], ceiling);
  }
  // The backward pass can drive the leftmost callout past the left edge when the
  // markers cannot all fit; clamping again keeps every callout on the plot.
  for (let index = 0; index < spread.length; index += 1) {
    const floor = index === 0 ? lowest : spread[index - 1] + minGapPct;
    spread[index] = Math.max(spread[index], floor);
  }

  const result = new Array<number>(positions.length);
  ordered.forEach((entry, order) => {
    result[entry.index] = spread[order];
  });
  return result;
}

export function pressureRailLayout(
  input: PressureRailInput,
  minGapPct: number = CALLOUT_MIN_GAP_PCT,
): PressureRailLayout {
  const { requiredPressureMpa, safePressureMpa, failurePressureMpa } = input;
  const axisMaximumMpa = axisMaximum([requiredPressureMpa, safePressureMpa, failurePressureMpa]);
  const requiredPct = positionOnAxis(requiredPressureMpa, axisMaximumMpa);
  const safePct = positionOnAxis(safePressureMpa, axisMaximumMpa);
  const failurePct = positionOnAxis(failurePressureMpa, axisMaximumMpa);
  const labelPositions = spreadCallouts([requiredPct, safePct, failurePct], minGapPct);

  const markers: PressureRailMarker[] = [
    { id: 'required', symbol: 'P₀', label: 'Required', valueMpa: requiredPressureMpa, positionPct: requiredPct, labelPct: labelPositions[0] },
    { id: 'safe', symbol: 'Pₛₐᶠₑ', label: 'Safe', valueMpa: safePressureMpa, positionPct: safePct, labelPct: labelPositions[1] },
    { id: 'failure', symbol: 'Pᶠ', label: 'Failure', valueMpa: failurePressureMpa, positionPct: failurePct, labelPct: labelPositions[2] },
  ];

  const acceptable = safePressureMpa >= requiredPressureMpa;
  // Ordered back to front. When the required pressure sits above the safe
  // pressure the service and deficit bands deliberately paint over the reserve,
  // so the shortfall is the band the eye lands on.
  const bands: PressureRailBand[] = [
    { id: 'reserve', fromPct: safePct, toPct: Math.max(safePct, failurePct) },
    { id: 'service', fromPct: 0, toPct: requiredPct },
    {
      id: acceptable ? 'margin' : 'deficit',
      fromPct: Math.min(requiredPct, safePct),
      toPct: Math.max(requiredPct, safePct),
    },
  ];

  return {
    axisMaximumMpa,
    ticksMpa: Array.from({ length: 5 }, (_, index) => (axisMaximumMpa * index) / 4),
    markers,
    bands,
    acceptable,
    marginMpa: safePressureMpa - requiredPressureMpa,
  };
}
