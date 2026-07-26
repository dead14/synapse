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

export function validateHeaders(headers: string[]): string[] {
  return REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
}

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
    if (Number.isFinite(depth) && (depth < 0 || depth > 80)) {
      errors.push({ row: rowNumber, col: REQUIRED_COLUMNS[3], msg: `Must be 0-80 (got ${depth})` });
    }

    const designFactor = Number(String(row[REQUIRED_COLUMNS[10]]).trim());
    if (Number.isFinite(designFactor) && designFactor > 1) {
      errors.push({ row: rowNumber, col: REQUIRED_COLUMNS[10], msg: `Must be <= 1 (got ${designFactor})` });
    }

    const outerDiameter = Number(String(row[REQUIRED_COLUMNS[11]]).trim());
    if (Number.isFinite(outerDiameter) && outerDiameter < 50) {
      errors.push({ row: rowNumber, col: REQUIRED_COLUMNS[11], msg: `Pipeline OD must be >= 50 mm (got ${outerDiameter})` });
    }
  });
  return errors;
}
