import { REQUIRED_COLUMNS } from './types.ts';

export interface ValidationError {
  row: number;
  col: string;
  msg: string;
}

const NUMERIC_COLS = [
  REQUIRED_COLUMNS[0], REQUIRED_COLUMNS[3], REQUIRED_COLUMNS[4], REQUIRED_COLUMNS[5],
  REQUIRED_COLUMNS[7], REQUIRED_COLUMNS[8], REQUIRED_COLUMNS[9], REQUIRED_COLUMNS[10],
  REQUIRED_COLUMNS[11], REQUIRED_COLUMNS[12], REQUIRED_COLUMNS[13],
];

const POSITIVE_COLS = [
  REQUIRED_COLUMNS[4], REQUIRED_COLUMNS[5], REQUIRED_COLUMNS[7], REQUIRED_COLUMNS[10],
  REQUIRED_COLUMNS[11], REQUIRED_COLUMNS[12], REQUIRED_COLUMNS[13],
];

const NON_NEGATIVE_COLS = [REQUIRED_COLUMNS[0], REQUIRED_COLUMNS[3], REQUIRED_COLUMNS[8], REQUIRED_COLUMNS[9]];

export function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateHeaders(headers: string[]): string[] {
  const available = new Set(headers.map((header) => String(header).trim()));
  return REQUIRED_COLUMNS.filter((column) => !available.has(column));
}

/**
 * Validates either an alignment mapping or a manually uploaded workbook before
 * handing the rows to the B31G engine.
 */
export function validateData(rows: Record<string, string>[]): ValidationError[] {
  const errors: ValidationError[] = [];
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    for (const column of NUMERIC_COLS) {
      const value = row[column];
      if (value === undefined || value === null || String(value).trim() === '') {
        errors.push({ row: rowNumber, col: column, msg: 'Missing value' });
        continue;
      }
      if (!Number.isFinite(Number(String(value).trim()))) {
        errors.push({ row: rowNumber, col: column, msg: `"${value}" must be a finite number` });
      }
    }

    for (const column of POSITIVE_COLS) {
      const value = Number(String(row[column]).trim());
      if (Number.isFinite(value) && value <= 0) {
        errors.push({ row: rowNumber, col: column, msg: `Must be > 0 (got ${value})` });
      }
    }

    for (const column of NON_NEGATIVE_COLS) {
      const value = Number(String(row[column]).trim());
      if (Number.isFinite(value) && value < 0) {
        errors.push({ row: rowNumber, col: column, msg: `Must be non-negative (got ${value})` });
      }
    }

    const depth = Number(String(row[REQUIRED_COLUMNS[3]]).trim());
    if (Number.isFinite(depth) && (depth < 0 || depth >= 100)) {
      errors.push({ row: rowNumber, col: REQUIRED_COLUMNS[3], msg: `Must be 0 to <100 (got ${depth})` });
    }

    const designFactor = Number(String(row[REQUIRED_COLUMNS[10]]).trim());
    if (Number.isFinite(designFactor) && designFactor > 1) {
      errors.push({ row: rowNumber, col: REQUIRED_COLUMNS[10], msg: `Must be <= 1 (got ${designFactor})` });
    }

    const outerDiameter = Number(String(row[REQUIRED_COLUMNS[11]]).trim());
    if (Number.isFinite(outerDiameter) && outerDiameter < 50) {
      errors.push({ row: rowNumber, col: REQUIRED_COLUMNS[11], msg: `Pipeline OD must be >= 50 mm (got ${outerDiameter})` });
    }

    const repairStatus = String(row['Repair Status'] ?? '').trim();
    if (repairStatus && !['Unrepaired', 'Temporary repair', 'Permanent repair verified'].includes(repairStatus)) {
      errors.push({
        row: rowNumber,
        col: 'Repair Status',
        msg: 'Use Unrepaired, Temporary repair, or Permanent repair verified',
      });
    }

    const repairDate = String(row['Repair Date'] ?? '').trim();
    if (repairDate && !isIsoCalendarDate(repairDate)) {
      errors.push({ row: rowNumber, col: 'Repair Date', msg: 'Use a valid calendar date in YYYY-MM-DD format' });
    }
  });
  return errors;
}
