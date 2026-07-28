/**
 * Section construction helpers.
 *
 * Sectioning used to require zooming the schematic past 600% and clicking two
 * small GW markers, which is what field engineers reported as the hard part.
 * These helpers let the same section be produced from a dragged range, a typed
 * KP, a weld picked out of a table, or a one-click preset — every path lands on
 * the same locked-GW boundaries the engine already validates.
 */

import type { LockedGwPair, MatchingSection, SectionPolicy } from '../wizard/matchingSections';

export interface AxisBoundary {
  key: string;
  oldId: string | null;
  newId: string | null;
  oldDistance: number;
  newDistance: number;
}

export interface SnapResult<T extends AxisBoundary = LockedGwPair> {
  pair: T;
  index: number;
  /** Signed metres from the requested position to the GW it snapped to. */
  deviationM: number;
}

export interface SectionSeed {
  name: string;
  sectionType: string;
  policy: SectionPolicy;
}

const DEFAULT_SEED: SectionSeed = { name: 'Section', sectionType: 'BUR', policy: 'MATCH' };

/**
 * Nearest locked GW to a position on the NEW axis. `lockedGws` is sorted by
 * `newDistance` (guaranteed by `normalizeLockedGws`), so this binary searches.
 */
export function snapToLockedGw<T extends AxisBoundary>(lockedGws: T[], targetM: number): SnapResult<T> | null {
  if (lockedGws.length === 0 || !Number.isFinite(targetM)) return null;

  let low = 0;
  let high = lockedGws.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (lockedGws[mid].newDistance < targetM) low = mid + 1;
    else high = mid;
  }

  // `low` is the first GW at or past the target; the previous one may be closer.
  const candidates = low > 0 ? [low - 1, low] : [low];
  let best = candidates[0];
  for (const index of candidates) {
    if (Math.abs(lockedGws[index].newDistance - targetM) < Math.abs(lockedGws[best].newDistance - targetM)) {
      best = index;
    }
  }

  return { pair: lockedGws[best], index: best, deviationM: targetM - lockedGws[best].newDistance };
}

/** Index of the locked GW carrying this key, or -1. */
export function lockedIndexOf<T extends Pick<AxisBoundary, 'key'>>(lockedGws: T[], key: string): number {
  return lockedGws.findIndex((pair) => pair.key === key);
}

function makeSection(
  lockedGws: LockedGwPair[],
  startIndex: number,
  endIndex: number,
  seed: SectionSeed,
  ordinal: number,
  idSalt: string,
): MatchingSection {
  return {
    id: `section-${idSalt}-${ordinal}`,
    name: `${seed.name} ${String(ordinal).padStart(2, '0')}`,
    sectionType: seed.sectionType,
    policy: seed.policy,
    startGwKey: lockedGws[startIndex].key,
    endGwKey: lockedGws[endIndex].key,
  };
}

/**
 * Sections of roughly `spanM` metres, each snapped to real locked GWs. The last
 * section absorbs the remainder rather than leaving a stub shorter than a joint.
 */
export function autoSectionsByLength(
  lockedGws: LockedGwPair[],
  spanM: number,
  seed: SectionSeed = DEFAULT_SEED,
  idSalt = String(Date.now()),
): MatchingSection[] {
  if (lockedGws.length < 2 || !(spanM > 0)) return [];

  const sections: MatchingSection[] = [];
  const lastIndex = lockedGws.length - 1;
  let startIndex = 0;
  let ordinal = 1;

  while (startIndex < lastIndex) {
    const target = lockedGws[startIndex].newDistance + spanM;
    const snapped = snapToLockedGw(lockedGws, target);
    // Always advance at least one GW, and never run past the end of the line.
    let endIndex = Math.min(lastIndex, Math.max(startIndex + 1, snapped?.index ?? startIndex + 1));

    // Absorb a trailing stub shorter than half a span into the current section.
    const remainder = lockedGws[lastIndex].newDistance - lockedGws[endIndex].newDistance;
    if (remainder > 0 && remainder < spanM / 2) endIndex = lastIndex;

    sections.push(makeSection(lockedGws, startIndex, endIndex, seed, ordinal, idSalt));
    ordinal += 1;
    startIndex = endIndex;
  }

  return sections;
}

/**
 * Sections bounded by physical features — bends, valves, tees. Each supplied
 * distance snaps to its nearest locked GW; the pipeline ends close the first and
 * last section.
 */
export function autoSectionsAtBoundaries(
  lockedGws: LockedGwPair[],
  boundaryDistances: number[],
  seed: SectionSeed = DEFAULT_SEED,
  idSalt = String(Date.now()),
): MatchingSection[] {
  if (lockedGws.length < 2) return [];

  const lastIndex = lockedGws.length - 1;
  const indexes = new Set<number>([0, lastIndex]);
  for (const distance of boundaryDistances) {
    const snapped = snapToLockedGw(lockedGws, distance);
    if (snapped) indexes.add(snapped.index);
  }

  const ordered = Array.from(indexes).sort((left, right) => left - right);
  const sections: MatchingSection[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    sections.push(makeSection(lockedGws, ordered[i - 1], ordered[i], seed, i, idSalt));
  }
  return sections;
}

/**
 * Sections covering every stretch the current list leaves uncovered. Existing
 * sections are returned untouched alongside the new ones.
 */
export function fillCoverageGaps(
  existing: MatchingSection[],
  lockedGws: LockedGwPair[],
  seed: SectionSeed = { ...DEFAULT_SEED, name: 'Gap', sectionType: 'UNCLASSIFIED' },
  idSalt = String(Date.now()),
): MatchingSection[] {
  if (lockedGws.length < 2) return existing;

  const lastIndex = lockedGws.length - 1;
  const covered = existing
    .map((section) => ({
      start: lockedIndexOf(lockedGws, section.startGwKey),
      end: lockedIndexOf(lockedGws, section.endGwKey),
    }))
    .filter((range) => range.start >= 0 && range.end > range.start)
    .sort((left, right) => left.start - right.start);

  const added: MatchingSection[] = [];
  let cursor = 0;
  let ordinal = 1;

  for (const range of covered) {
    if (range.start > cursor) {
      added.push(makeSection(lockedGws, cursor, range.start, seed, ordinal, idSalt));
      ordinal += 1;
    }
    cursor = Math.max(cursor, range.end);
  }

  if (cursor < lastIndex) {
    added.push(makeSection(lockedGws, cursor, lastIndex, seed, ordinal, idSalt));
  }

  return [...existing, ...added];
}

/** Metres of NEW axis covered by these sections. */
export function coveredLengthM(sections: MatchingSection[], lockedGws: AxisBoundary[]): number {
  const byKey = new Map(lockedGws.map((pair) => [pair.key, pair]));
  const ranges = sections
    .map((section) => {
      const start = byKey.get(section.startGwKey);
      const end = byKey.get(section.endGwKey);
      return start && end ? { start: start.newDistance, end: end.newDistance } : null;
    })
    .filter((range): range is { start: number; end: number } => range !== null && range.end > range.start)
    .sort((left, right) => left.start - right.start);

  let total = 0;
  let cursor = -Infinity;
  for (const range of ranges) {
    const from = Math.max(range.start, cursor);
    if (range.end > from) {
      total += range.end - from;
      cursor = range.end;
    }
  }
  return total;
}

/** Stretches of the line no section covers, for the gap indicator. */
export function coverageGaps(
  sections: MatchingSection[],
  lockedGws: AxisBoundary[],
): Array<{ startM: number; endM: number }> {
  if (lockedGws.length < 2) return [];
  const lineStart = lockedGws[0].newDistance;
  const lineEnd = lockedGws[lockedGws.length - 1].newDistance;
  const byKey = new Map(lockedGws.map((pair) => [pair.key, pair]));

  const ranges = sections
    .map((section) => {
      const start = byKey.get(section.startGwKey);
      const end = byKey.get(section.endGwKey);
      return start && end ? { start: start.newDistance, end: end.newDistance } : null;
    })
    .filter((range): range is { start: number; end: number } => range !== null && range.end > range.start)
    .sort((left, right) => left.start - right.start);

  const gaps: Array<{ startM: number; endM: number }> = [];
  let cursor = lineStart;
  for (const range of ranges) {
    if (range.start > cursor) gaps.push({ startM: cursor, endM: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < lineEnd) gaps.push({ startM: cursor, endM: lineEnd });
  return gaps;
}

/** "12.531 km" for readouts, "12 531.4 m" when the operator needs metres. */
export function formatKm(metres: number): string {
  return `${(metres / 1000).toFixed(3)} km`;
}

export function formatMetres(metres: number): string {
  return `${metres.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} m`;
}

/** Parses "2.4", "2,4", "2.4 km", "2400 m" into metres on the NEW axis. */
export function parsePosition(input: string, unit: 'km' | 'm'): number | null {
  const cleaned = input.trim().replace(/,/g, '.').replace(/\s+/g, '');
  if (!cleaned) return null;
  const explicitKm = /km$/i.test(cleaned);
  const explicitM = /m$/i.test(cleaned) && !explicitKm;
  const numeric = Number(cleaned.replace(/(km|m)$/i, ''));
  if (!Number.isFinite(numeric)) return null;
  if (explicitKm) return numeric * 1000;
  if (explicitM) return numeric;
  return unit === 'km' ? numeric * 1000 : numeric;
}
