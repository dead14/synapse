export type SectionPolicy = 'MATCH' | 'REVIEW' | 'BYPASS';

export interface LockedGwPair {
  key: string;
  oldId: string;
  newId: string;
  oldDistance: number;
  newDistance: number;
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
  sectionType?: string;
  policy: SectionPolicy;
  startGwKey: string;
  endGwKey: string;
  startM?: number;
  endM?: number;
  newStartM?: number;
  newEndM?: number;
  oldStartM?: number;
  oldEndM?: number;
  tolerances?: SectionTolerances;
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

export function validateSectionOrder(sections: MatchingSection[], lockedGws: LockedGwPair[]): string | null {
  // Sectioning is optional. Without sections the entire aligned range uses the
  // global MATCH policy and Hungarian still executes normally.
  if (sections.length === 0) return null;
  const indexes = new Map(lockedGws.map((pair, index) => [pair.key, index]));
  const ranges: Array<{ name: string; start: number; end: number }> = [];

  for (const section of sections) {
    if (!section.name.trim()) return 'Nama section tidak boleh kosong.';
    const start = indexes.get(section.startGwKey);
    const end = indexes.get(section.endGwKey);
    if (start === undefined || end === undefined) return `${section.name}: boundary harus menggunakan GW locked.`;
    if (start >= end) return `${section.name}: End GW harus berada setelah Start GW pada NEW.`;
    if (section.tolerances) {
      const invalidTolerance = Object.entries(section.tolerances).find(
        ([, value]) => !Number.isFinite(value) || value < 0,
      );
      if (invalidTolerance) return `${section.name}: ${invalidTolerance[0]} harus angka non-negatif.`;
    }
    ranges.push({ name: section.name, start, end });
  }

  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start < ranges[index - 1].end) {
      return `${ranges[index].name}: section tidak boleh overlap.`;
    }
  }
  return null;
}

export function resolveSectionDistances(
  section: MatchingSection,
  lockedGws: LockedGwPair[],
): MatchingSection {
  const byKey = new Map(lockedGws.map((pair) => [pair.key, pair]));
  const start = byKey.get(section.startGwKey)!;
  const end = byKey.get(section.endGwKey)!;
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
