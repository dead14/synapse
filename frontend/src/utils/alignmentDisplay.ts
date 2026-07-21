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
