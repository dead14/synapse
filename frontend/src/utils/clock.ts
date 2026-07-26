/**
 * Parse an ILI clock-position value into degrees around the pipe circumference:
 * 12:00 -> 0°, 3:00 -> 90°, 6:00 -> 180°, 9:00 -> 270°.
 *
 * Vendor spreadsheets deliver the same column in three shapes:
 * - "HH:MM" strings (e.g. "6:30")
 * - plain numeric clock hours (e.g. 6 or 6.5)
 * - Excel time serials, 0 < v < 1 (fraction of a 24-hour day)
 *
 * Unparseable or missing values resolve to 0 (top of pipe), matching the
 * previous inline behaviour of the visualizer.
 */
export function parseClockToDegrees(value: unknown): number {
  return parseClockToHours(value) * 30;
}

/** Clock hours in the range [0, 12); shared base for the degree conversion. */
export function parseClockToHours(value: unknown): number {
  if (value === null || value === undefined || value === '-') return 0;
  const text = String(value).trim();
  if (text.includes(':')) {
    const [hours, minutes] = text.split(':').map(Number);
    if (!Number.isFinite(hours)) return 0;
    return (hours % 12) + ((Number.isFinite(minutes) ? minutes : 0) / 60);
  }
  const numeric = parseFloat(text);
  if (!Number.isFinite(numeric)) return 0;
  // Excel time serial: fraction of a 24-hour day
  if (numeric > 0 && numeric < 1) return (numeric * 24) % 12;
  return numeric % 12;
}
