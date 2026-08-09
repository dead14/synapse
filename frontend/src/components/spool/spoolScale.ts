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
 * The metric scale the 3D pane draws at: one world unit is one metre. A 12 m
 * spool is 12 units long and a 12" pipe is 0.324 units across, so the shape on
 * screen is the shape of the pipe and a measurement taken on it means something.
 *
 * An earlier revision stretched every window onto a fixed 10–40 unit stage,
 * which made the same spool a different shape at every zoom level.
 */
export interface SceneScale {
  /** Outside radius, in metres. */
  radius: number;
  /** Axial span of the window, in metres. */
  spanM: number;
  /** Text height in metres, sized to stay legible at framing distance. */
  label: number;
  /** False while the outside diameter is the nominal stand-in. */
  odKnown: boolean;
}

export function sceneScale(spanM: number, odMm: number | null): SceneScale {
  const radius = (odMm ?? NOMINAL_OD_MM) / 2000;
  return {
    radius,
    spanM,
    // A long window is framed by its length, a short one by its girth; the
    // label has to stay readable in both, so it follows whichever dominates.
    label: Math.max(spanM, radius * 10) * 0.022,
    odKnown: odMm !== null,
  };
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
