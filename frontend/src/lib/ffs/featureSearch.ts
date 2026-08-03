/**
 * Finding one feature in an assessed population.
 *
 * The repair register used to pick its target from a `<select>` holding every
 * assessed feature. On a real line that is several thousand options in a list
 * you can only scroll, with no way to say "the deep one somewhere past
 * 1,800 m" — which is how an engineer actually remembers a defect. This turns
 * that into a query over the fields they do remember: identifier, position,
 * depth, and whether a repair has already been recorded.
 *
 * Filtering lives here rather than in the component so the rules are testable
 * and so an empty query means "everything", not "nothing".
 */

import type { FfsRepairStatus, FfsScreenedResult } from './types.ts';

export interface FeatureQuery {
  /** Matches the vendor feature id, the section name, or a log distance. */
  text: string;
  ldFromM: number | null;
  ldToM: number | null;
  depthFromPct: number | null;
  depthToPct: number | null;
  repairStatus: FfsRepairStatus | 'any';
}

export const EMPTY_FEATURE_QUERY: FeatureQuery = {
  text: '',
  ldFromM: null,
  ldToM: null,
  depthFromPct: null,
  depthToPct: null,
  repairStatus: 'any',
};

function distanceOf(item: FfsScreenedResult): number {
  const value = Number(item.nominal.ld);
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * A bound is only applied when it is a real number, so a half-filled range
 * ("everything past 1,800 m") still narrows the list instead of clearing it.
 */
function withinBounds(value: number, from: number | null, to: number | null): boolean {
  if (!Number.isFinite(value)) return from === null && to === null;
  if (from !== null && Number.isFinite(from) && value < from) return false;
  if (to !== null && Number.isFinite(to) && value > to) return false;
  return true;
}

function matchesText(item: FfsScreenedResult, needle: string): boolean {
  const term = needle.trim().toLowerCase();
  if (!term) return true;
  const featureId = (item.nominal.featureId ?? '').toLowerCase();
  const section = (item.nominal.section ?? '').toLowerCase();
  if (featureId.includes(term) || section.includes(term)) return true;
  // Typing a distance is the other way engineers refer to a feature; match on
  // the printed value so "1881.8" finds LD 1,881.823.
  const distance = distanceOf(item);
  return Number.isFinite(distance) && String(distance).includes(term);
}

export function searchFeatures(
  items: readonly FfsScreenedResult[],
  query: FeatureQuery,
): FfsScreenedResult[] {
  return items.filter((item) => {
    if (query.repairStatus !== 'any' && item.nominal.repairStatus !== query.repairStatus) return false;
    if (!withinBounds(distanceOf(item), query.ldFromM, query.ldToM)) return false;
    if (!withinBounds(item.nominal.maxDepthPct, query.depthFromPct, query.depthToPct)) return false;
    return matchesText(item, query.text);
  });
}

/** True when the query would narrow the population at all. */
export function isFeatureQueryActive(query: FeatureQuery): boolean {
  return query.text.trim() !== ''
    || query.ldFromM !== null
    || query.ldToM !== null
    || query.depthFromPct !== null
    || query.depthToPct !== null
    || query.repairStatus !== 'any';
}

/** Parses a filter input, treating blank as "no bound" rather than as zero. */
export function parseBound(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
