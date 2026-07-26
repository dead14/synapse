/**
 * Identity of a feature within one run.  Distances arrive from several sources
 * (engine payload, persisted rows, spreadsheet exports) that round differently,
 * so the key is fixed to 6 decimals to keep those sources comparable.
 */
export function pairKey(id: string, distance: number) {
  return `${id}::${Number(distance).toFixed(6)}`;
}
