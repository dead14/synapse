export interface SectionRange {
  id: string;
  name: string;
  startM: number;
  endM: number;
}

function ordered(section: SectionRange) {
  return section.startM <= section.endM
    ? { start: section.startM, end: section.endM }
    : { start: section.endM, end: section.startM };
}

export function findOverlappingSection(sections: SectionRange[], candidate: SectionRange): SectionRange | null {
  const target = ordered(candidate);
  for (const section of sections) {
    if (section.id === candidate.id) continue;
    const existing = ordered(section);
    // Touching boundaries are fine: sections may share a girth weld.
    if (existing.start < target.end && target.start < existing.end) return section;
  }
  return null;
}

/**
 * Returns an operator-facing message, or null when the range can be saved.
 */
export function validateSectionRange(sections: SectionRange[], candidate: SectionRange): string | null {
  if (!candidate.name.trim()) return 'Nama section tidak boleh kosong.';
  if (!Number.isFinite(candidate.startM) || !Number.isFinite(candidate.endM)) {
    return 'Batas section tidak memiliki log distance yang valid.';
  }
  const { start, end } = ordered(candidate);
  if (end - start <= 0) return 'Start dan End GW harus berbeda.';
  const clash = findOverlappingSection(sections, candidate);
  return clash ? `Section overlap dengan "${clash.name}".` : null;
}

/**
 * Total pipeline length covered by sections, counting overlapping ranges once.
 */
export function coveredLengthMeters(sections: SectionRange[]) {
  const ranges = sections
    .map(ordered)
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end))
    .sort((left, right) => left.start - right.start);

  let covered = 0;
  let currentStart = Number.NaN;
  let currentEnd = Number.NaN;
  for (const range of ranges) {
    if (Number.isNaN(currentStart)) {
      currentStart = range.start;
      currentEnd = range.end;
      continue;
    }
    if (range.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, range.end);
      continue;
    }
    covered += currentEnd - currentStart;
    currentStart = range.start;
    currentEnd = range.end;
  }
  if (!Number.isNaN(currentStart)) covered += currentEnd - currentStart;
  return covered;
}

export function coveragePercent(sections: SectionRange[], totalLength: number) {
  if (!Number.isFinite(totalLength) || totalLength <= 0) return 0;
  return Math.min(100, (coveredLengthMeters(sections) / totalLength) * 100);
}

export function countMissingInRange(
  historicalGws: Array<{ dist: number; status?: string }>,
  startM: number,
  endM: number,
) {
  if (!Number.isFinite(startM) || !Number.isFinite(endM)) return 0;
  const start = Math.min(startM, endM);
  const end = Math.max(startM, endM);
  return historicalGws.filter(
    (gw) => gw.status === 'MISSING_IN_MASTER' && gw.dist >= start && gw.dist <= end,
  ).length;
}
