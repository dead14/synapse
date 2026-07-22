/**
 * Reductions that replace `Math.min(...array)` / `Math.max(...array)`.
 *
 * The spread form passes one argument per element, and V8 throws
 * `RangeError: Maximum call stack size exceeded` somewhere past ~125k
 * arguments.  On ILI-sized runs (a 150k-feature master run is ordinary) the
 * spread form does not degrade — it throws outright and takes the whole view
 * down with it.
 *
 * These also skip non-finite values rather than poisoning the result with NaN,
 * which the spread form does not do.
 */

export function minOf(values: Iterable<number>, fallback = 0): number {
  let result = Number.POSITIVE_INFINITY;
  for (const value of values) {
    if (Number.isFinite(value) && value < result) result = value;
  }
  return result === Number.POSITIVE_INFINITY ? fallback : result;
}

export function maxOf(values: Iterable<number>, fallback = 0): number {
  let result = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (Number.isFinite(value) && value > result) result = value;
  }
  return result === Number.NEGATIVE_INFINITY ? fallback : result;
}

/** Both bounds in a single pass. */
export function extentOf(
  values: Iterable<number>,
  fallback: { min: number; max: number } = { min: 0, max: 0 },
): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === Number.POSITIVE_INFINITY) return fallback;
  return { min, max };
}
