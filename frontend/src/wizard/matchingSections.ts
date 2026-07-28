export type SectionPolicy = 'MATCH' | 'REVIEW' | 'BYPASS';

export interface LockedGwPair {
  key: string;
  oldId: string;
  newId: string;
  oldDistance: number;
  newDistance: number;
}

export interface SectionBoundary {
  key: string;
  side: 'MATCHED' | 'OLD' | 'NEW';
  label: string;
  oldId: string | null;
  newId: string | null;
  oldDistance: number;
  newDistance: number;
  /** Measured distance on the side identified by `side`. */
  sourceDistance: number;
}

export interface SectionTolerances {
  clock_tolerance: number;
  us_gw_distance_tolerance: number;
  ds_gw_distance_tolerance: number;
  length_tolerance: number;
}

export interface MatchingSection {
  id: string;
  name: string;
  /**
   * The run pair whose locked GWs bound this section. Chain alignment sections
   * one pair at a time, and a boundary from another pair does not exist in this
   * pair's lock list. Absent on sections saved before chain support, which are
   * read as belonging to the primary pair.
   */
  pairKey?: string;
  sectionType?: string;
  policy: SectionPolicy;
  startGwKey: string;
  endGwKey: string;
  /** Additive boundary evidence for OLD-only or NEW-only GWs. */
  startBoundary?: SectionBoundary;
  endBoundary?: SectionBoundary;
  startM?: number;
  endM?: number;
  newStartM?: number;
  newEndM?: number;
  oldStartM?: number;
  oldEndM?: number;
  tolerances?: SectionTolerances;
  ota?: number;
}

export function gwPairKey(pair: any): string {
  const oldId = pair?.old_id ?? pair?.oldId;
  const newId = pair?.new_id ?? pair?.newId;
  const oldDistance = Number(pair?.old_odometer ?? pair?.oldVal ?? pair?.oldDist);
  const newDistance = Number(pair?.new_odometer ?? pair?.newVal ?? pair?.newDist);
  return `${oldId}::${newId}::${oldDistance.toFixed(6)}::${newDistance.toFixed(6)}`;
}

export function normalizeLockedGws(pairs: any[]): LockedGwPair[] {
  return pairs
    .map((pair) => ({
      key: gwPairKey(pair),
      oldId: String(pair?.old_id ?? pair?.oldId ?? ''),
      newId: String(pair?.new_id ?? pair?.newId ?? ''),
      oldDistance: Number(pair?.old_odometer ?? pair?.oldVal ?? pair?.oldDist),
      newDistance: Number(pair?.new_odometer ?? pair?.newVal ?? pair?.newDist),
    }))
    .filter((pair) => Number.isFinite(pair.oldDistance) && Number.isFinite(pair.newDistance))
    .sort((left, right) => left.newDistance - right.newDistance);
}

type BoundaryLike = LockedGwPair | SectionBoundary;

function unmatchedBoundary(boundary: BoundaryLike): SectionBoundary | undefined {
  return 'side' in boundary && boundary.side !== 'MATCHED' ? boundary : undefined;
}

function boundaryFor(
  section: MatchingSection,
  edge: 'start' | 'end',
  boundaries: BoundaryLike[],
): BoundaryLike | undefined {
  const explicit = edge === 'start' ? section.startBoundary : section.endBoundary;
  if (explicit) return explicit;
  const key = edge === 'start' ? section.startGwKey : section.endGwKey;
  return boundaries.find((boundary) => boundary.key === key);
}

export function validateSectionOrder(sections: MatchingSection[], boundaries: BoundaryLike[]): string | null {
  // Sectioning is optional. Without sections the entire aligned range uses the
  // global MATCH policy and Hungarian still executes normally.
  if (sections.length === 0) return null;
  const ranges: Array<{ name: string; start: number; end: number }> = [];

  for (const section of sections) {
    if (!section.name.trim()) return 'Section name must not be empty.';
    const start = boundaryFor(section, 'start', boundaries);
    const end = boundaryFor(section, 'end', boundaries);
    if (!start || !end) return `${section.name}: boundary evidence is unavailable.`;
    if (start.newDistance >= end.newDistance || start.oldDistance >= end.oldDistance) {
      return `${section.name}: End GW must come after Start GW on OLD and NEW.`;
    }
    if (section.tolerances) {
      const invalidTolerance = Object.entries(section.tolerances).find(
        ([, value]) => !Number.isFinite(value) || value < 0,
      );
      if (invalidTolerance) return `${section.name}: ${invalidTolerance[0]} must be a non-negative number.`;
    }
    ranges.push({ name: section.name, start: start.newDistance, end: end.newDistance });
  }

  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) {
      return `${ranges[index].name}: sections must not overlap.`;
    }
  }
  return null;
}

export function saveSectionRange(
  current: MatchingSection[],
  nextSection: MatchingSection,
  boundaries: BoundaryLike[],
): MatchingSection[] {
  const ordered = [...boundaries].sort((left, right) => left.newDistance - right.newDistance);
  const indexByKey = new Map(ordered.map((boundary, index) => [boundary.key, index]));
  const first = indexByKey.get(nextSection.startGwKey);
  const second = indexByKey.get(nextSection.endGwKey);
  if (first === undefined || second === undefined || first === second) return current;

  const start = Math.min(first, second);
  const end = Math.max(first, second);
  const retained = current.filter((section) => section.id !== nextSection.id);
  const result: MatchingSection[] = [];

  for (const section of retained) {
    const sectionStart = indexByKey.get(section.startGwKey);
    const sectionEnd = indexByKey.get(section.endGwKey);
    if (sectionStart === undefined || sectionEnd === undefined || sectionEnd <= start || sectionStart >= end) {
      result.push(section);
      continue;
    }
    if (sectionStart < start) {
      result.push({
        ...section,
        id: `${section.id}-left-${nextSection.id}`,
        endGwKey: ordered[start].key,
        endBoundary: unmatchedBoundary(ordered[start]),
      });
    }
    if (sectionEnd > end) {
      result.push({
        ...section,
        id: `${section.id}-right-${nextSection.id}`,
        startGwKey: ordered[end].key,
        startBoundary: unmatchedBoundary(ordered[end]),
      });
    }
  }

  result.push({
    ...nextSection,
    startGwKey: ordered[start].key,
    endGwKey: ordered[end].key,
    startBoundary: unmatchedBoundary(ordered[start]),
    endBoundary: unmatchedBoundary(ordered[end]),
  });
  return result.sort((left, right) => indexByKey.get(left.startGwKey)! - indexByKey.get(right.startGwKey)!);
}

export function deleteMatchingSection(sections: MatchingSection[], sectionId: string): MatchingSection[] {
  return sections.filter((section) => section.id !== sectionId);
}

function finiteDistance(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || value === '-') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function containsDistance(section: MatchingSection, side: 'OLD' | 'NEW', distance: number): boolean {
  const start = finiteDistance(side === 'NEW' ? section.newStartM ?? section.startM : section.oldStartM);
  const end = finiteDistance(side === 'NEW' ? section.newEndM ?? section.endM : section.oldEndM);
  return start !== null && end !== null
    && distance >= Math.min(start, end)
    && distance <= Math.max(start, end);
}

/** Resolve a comparison row against the physical range for whichever run side exists. */
export function sectionNameForComparisonRow(
  row: Record<string, unknown>,
  sections: MatchingSection[],
): string {
  for (const key of ['Section', 'Section NEW', 'Section OLD']) {
    const name = row[key];
    if (typeof name === 'string' && name.trim() && name !== '-') return name;
  }

  const newDistance = finiteDistance(row['Log Dist NEW (m)']);
  if (newDistance !== null) {
    const section = sections.find((candidate) => containsDistance(candidate, 'NEW', newDistance));
    if (section) return section.name;
  }

  const oldDistance = finiteDistance(row['Log Dist OLD (m)']);
  if (oldDistance !== null) {
    const section = sections.find((candidate) => containsDistance(candidate, 'OLD', oldDistance));
    if (section) return section.name;
  }

  return '-';
}

export function resolveSectionDistances(
  section: MatchingSection,
  boundaries: BoundaryLike[],
): MatchingSection {
  const start = boundaryFor(section, 'start', boundaries);
  const end = boundaryFor(section, 'end', boundaries);
  if (!start || !end) return section;
  return {
    ...section,
    startM: start.newDistance,
    endM: end.newDistance,
    newStartM: start.newDistance,
    newEndM: end.newDistance,
    oldStartM: start.oldDistance,
    oldEndM: end.oldDistance,
  };
}
