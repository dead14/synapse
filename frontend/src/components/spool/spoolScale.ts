/**
 * Axial scale shared by the 3D ruler and the unrolled plot. Both panes read the
 * same window, so they must also agree on where the ticks fall — otherwise the
 * two pictures of one spool carry two different rulers.
 */

/**
 * Stand-in outside diameter — 12" NPS — used only until the reviewer supplies
 * the real one. The 3D pane says so on screen rather than passing it off as
 * known.
 */
export const NOMINAL_OD_MM = 323.9;

/**
 * How much wider than life the pipe is drawn.
 *
 * At true proportions a transmission spool is a hair: 12 m of 12" pipe is 37
 * diameters long, which renders as a line you cannot read metal off. So the
 * girth — and only the girth — is exaggerated by this constant, which brings a
 * single spool to a legible ~9:1 and leaves a 30" pipe visibly fatter than an
 * 8" one, because every diameter is exaggerated by the same amount.
 *
 * It is deliberately a constant rather than something fitted to the window. The
 * axis stays true metres, so selecting two spools draws a pipe exactly twice as
 * long as one spool — which is the whole point of the picture. A factor that
 * adapted to the span would squeeze every selection back to the same shape and
 * throw that away, which is what the old fixed 10–40 unit stage did.
 */
export const GIRTH_EXAGGERATION = 4;

/** Long-radius elbow: 1.5 diameters, the default for transmission pipe. */
export const BEND_RADIUS_FACTOR = 3;

/**
 * How close a bend's centreline curve may come to the drawn shell before the
 * pipe folds through itself. The inner wall of an elbow sits at
 * (bend radius − pipe radius); at 0.8 it keeps a fifth of the bend radius as
 * clearance, which reads as an elbow rather than a crease.
 */
const BEND_CLEARANCE = 0.8;

/**
 * The bend radius an elbow actually turns on, in true metres.
 *
 * This is a master-axis quantity: the arc it consumes is odometer distance, so
 * it is derived from the pipe's real radius. Deriving it from the drawn radius
 * made every bend consume the girth exaggeration's worth of extra arc and
 * shifted every feature downstream of it.
 */
export function bendRadiusM(trueRadius: number): number {
  return trueRadius * BEND_RADIUS_FACTOR;
}

/**
 * The scale the 3D pane draws at.
 *
 * Axial distance is true metres — one world unit is one metre — so length on
 * screen is proportional to length on the pipe and the ruler is exact. Radial
 * and circumferential size carries {@link GIRTH_EXAGGERATION}, stated on
 * screen, so the spool reads as a pipe rather than a thread.
 */
export interface SceneScale {
  /** Outside radius as drawn, in world units (metres × girth exaggeration). */
  radius: number;
  /** Outside radius as measured, in metres. What the readouts must quote. */
  trueRadius: number;
  /** The multiplier between the two, for the on-screen statement. */
  girth: number;
  /** Axial span of the window, in metres. Never exaggerated. */
  spanM: number;
  /** Text height in world units, sized to stay legible at framing distance. */
  label: number;
  /** False while the outside diameter is the nominal stand-in. */
  odKnown: boolean;
}

export function sceneScale(
  spanM: number,
  odMm: number | null,
  { hasBend = false }: { hasBend?: boolean } = {},
): SceneScale {
  const trueRadius = (odMm ?? NOMINAL_OD_MM) / 2000;
  // A bend turns the centreline on a true-metre radius, because the arc it
  // consumes is odometer distance. Fattening the shell past that radius would
  // draw the inner wall through the centre of the turn, so a window with a bend
  // in it takes as much exaggeration as the elbow can carry and no more. The
  // factor is reported, so the picture always says what it is drawn at.
  const girth = hasBend
    ? Math.max(1, Math.min(GIRTH_EXAGGERATION, BEND_RADIUS_FACTOR * BEND_CLEARANCE))
    : GIRTH_EXAGGERATION;
  const radius = trueRadius * girth;
  return {
    radius,
    trueRadius,
    girth,
    spanM,
    // A long window is framed by its length, a short one by its girth; the
    // label has to stay readable in both, so it follows whichever dominates.
    label: Math.max(spanM, radius * 6) * 0.022,
    odKnown: odMm !== null,
  };
}

// ─── Drawn defect size ──────────────────────────────────────────────────────

/** Drawn arc for a defect whose width cannot be turned into a real angle. */
export const NOMINAL_ARC_DEG = 8;
/** Drawn size for a defect the run reported without a length or a width. */
export const NOMINAL_PATCH_MM = 25;

/**
 * Ceilings on how large the marker magnification may draw one defect.
 *
 * The magnification exists so a two-centimetre pit is visible on a twelve-metre
 * spool. Applied without a ceiling it also multiplies the features that were
 * already large, and the result is not a bigger patch but a shape that has left
 * the pipe: a 60 mm box on an 8" line covers a third of the circumference, and
 * six times that is 340 degrees of arc drawn as one flat plate metres across —
 * a slab hanging in space that the reviewer reads as a broken picture, because
 * it is one.
 *
 * So magnification may lift a patch up to these ceilings and no further. A
 * feature whose measured extent already exceeds one keeps its measured extent —
 * clamping a real 300-degree cluster down to 90 would be a lie about the metal,
 * where declining to magnify it is only a decision about drawing.
 */
export const MAX_DRAWN_ARC_DEG = 90;
const MAX_DRAWN_AXIAL_SHARE = 0.25;
/** A patch may not eat more of the wall than this, or it exits the bore. */
const MAX_DRAWN_RADIAL_SHARE = 0.6;

/**
 * Circumferential extent to draw a defect at, in degrees.
 *
 * `trueArcDeg` is null when the outside diameter is unknown, in which case the
 * views draw a nominal band. That band is never magnified: multiplying a
 * made-up width is what smears the patches into circumferential streaks.
 */
export function drawnArcDeg(
  trueArcDeg: number | null,
  markerScale: number,
  nominalArcDeg: number = NOMINAL_ARC_DEG,
): number {
  if (trueArcDeg === null || !Number.isFinite(trueArcDeg)) return nominalArcDeg;
  // A defect cannot wrap further than the pipe it is on.
  const measured = Math.min(Math.max(trueArcDeg, 0), 360);
  const magnified = measured * Math.max(1, markerScale);
  return Math.min(magnified, Math.max(measured, MAX_DRAWN_ARC_DEG));
}

/** Axial extent to draw a defect at, in metres, inside a window of `spanM`. */
export function drawnAxialM(
  lengthMm: number | null,
  markerScale: number,
  spanM: number,
  nominalMm: number = NOMINAL_PATCH_MM,
): number {
  const measured = Math.max(0, (lengthMm ?? nominalMm)) / 1000;
  const magnified = measured * Math.max(1, markerScale);
  const ceiling = Math.max(measured, Math.max(0, spanM) * MAX_DRAWN_AXIAL_SHARE);
  return Math.min(magnified, ceiling);
}

/** Radial extent to draw wall loss at, in world units, on a pipe of `radius`. */
export function drawnRadialM(
  wallLossMm: number,
  markerScale: number,
  radius: number,
  girth: number,
): number {
  const magnified = (Math.max(0, wallLossMm) / 1000) * girth * Math.max(1, markerScale);
  return Math.min(Math.max(magnified, radius * 0.004), radius * MAX_DRAWN_RADIAL_SHARE);
}

/**
 * True when the ceilings above actually bit for this pair of extents, so the
 * pane can say the magnification was not applied in full rather than quietly
 * showing a factor it did not use.
 */
export function drawnSizeIsCapped(
  trueArcDeg: number | null,
  lengthMm: number | null,
  markerScale: number,
  spanM: number,
): boolean {
  if (markerScale <= 1) return false;
  const arcCapped = trueArcDeg !== null && Number.isFinite(trueArcDeg)
    && drawnArcDeg(trueArcDeg, markerScale) < Math.min(trueArcDeg, 360) * markerScale - 1e-9;
  const axialCapped = drawnAxialM(lengthMm, markerScale, spanM)
    < ((lengthMm ?? NOMINAL_PATCH_MM) / 1000) * markerScale - 1e-9;
  return arcCapped || axialCapped;
}

/**
 * Tick spacing that lands on numbers an engineer reads without decoding: a
 * 1 / 2 / 2.5 / 5 ladder aiming for roughly eight labels across the window.
 */
export function niceStep(spanM: number): number {
  const raw = spanM / 8;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-6)));
  return [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw)
    ?? magnitude * 10;
}

/** Tick positions inside [startM, endM], on the {@link niceStep} ladder. */
export function axialTicks(startM: number, endM: number): number[] {
  const step = niceStep(Math.max(endM - startM, 1e-6));
  const first = Math.ceil(startM / step) * step;
  const ticks: number[] = [];
  for (let value = first; value <= endM + 1e-6; value += step) {
    ticks.push(Number(value.toFixed(6)));
  }
  return ticks;
}
