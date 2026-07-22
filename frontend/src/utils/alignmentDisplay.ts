const ORIGINAL_DISTANCE_COLUMN: Record<string, string> = {
  'Log Dist OLD (m)': 'Original Log Dist OLD (m)',
  'Log Dist NEW (m)': 'Original Log Dist NEW (m)',
};

const DISPLAY_METADATA_COLUMNS = new Set(Object.values(ORIGINAL_DISTANCE_COLUMN));

function hasDistance(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && (value.trim() === '' || value.trim() === '-')) return false;
  return Number.isFinite(Number(value));
}

export function alignmentDisplayValue<T extends Record<string, unknown>>(row: T, column: string): T[string] {
  const originalColumn = ORIGINAL_DISTANCE_COLUMN[column];
  const originalDistance = originalColumn ? row[originalColumn] : undefined;
  return (hasDistance(originalDistance) ? originalDistance : row[column]) as T[string];
}

export function isAlignmentDisplayMetadata(column: string): boolean {
  return DISPLAY_METADATA_COLUMNS.has(column);
}

function displayedDistance<T extends Record<string, unknown>>(row: T, column: string): number | null {
  const distance = Number(alignmentDisplayValue(row, column));
  return Number.isFinite(distance) ? distance : null;
}

export function sortAlignmentRowsByDisplayedLogDistance<T extends Record<string, unknown>>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({
      row,
      index,
      oldDistance: displayedDistance(row, 'Log Dist OLD (m)'),
      newDistance: displayedDistance(row, 'Log Dist NEW (m)'),
    }))
    .sort((left, right) => {
      const leftHasNew = left.newDistance !== null;
      const rightHasNew = right.newDistance !== null;
      if (leftHasNew !== rightHasNew) return leftHasNew ? -1 : 1;

      const leftDistance = left.newDistance ?? left.oldDistance ?? Number.POSITIVE_INFINITY;
      const rightDistance = right.newDistance ?? right.oldDistance ?? Number.POSITIVE_INFINITY;
      return leftDistance - rightDistance || left.index - right.index;
    })
    .map(({ row }) => row);
}
