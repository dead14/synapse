/**
 * Axial scale shared by the 3D ruler and the unrolled plot. Both panes read the
 * same window, so they must also agree on where the ticks fall — otherwise the
 * two pictures of one spool carry two different rulers.
 */

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
