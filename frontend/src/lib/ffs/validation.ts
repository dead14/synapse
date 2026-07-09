import { REQUIRED_COLUMNS } from './types';

export interface ValidationError {
  row: number;
  col: string;
  msg: string;
}

const NUMERIC_COLS = [
  'Max Depth [%]', 'Length [mm]', 'Width [mm]',
  'Nominal Wall Thickness [mm]', 'CR Depth [mm/y]', 'CR Length [mm/y]',
  'Design Factor', 'Outer Diameter Ds', 'SMYS [MPa]', 'Operating Pressure P₀ [MPa]'
];

const POSITIVE_COLS = [
  'Length [mm]', 'Nominal Wall Thickness [mm]', 'Design Factor',
  'Outer Diameter Ds', 'SMYS [MPa]', 'Operating Pressure P₀ [MPa]'
];

export function validateHeaders(headers: string[]): string[] {
  const missing: string[] = [];
  for (const col of REQUIRED_COLUMNS) {
    if (!headers.includes(col)) missing.push(col);
  }
  return missing;
}

export function validateData(rows: Record<string, string>[]): ValidationError[] {
  const errors: ValidationError[] = [];
  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // CSV row 1 is header
    for (const col of NUMERIC_COLS) {
      const val = row[col];
      if (val === undefined || val === null || String(val).trim() === '') {
        errors.push({ row: rowNum, col, msg: 'Missing value' });
      } else if (isNaN(parseFloat(String(val)))) {
        errors.push({ row: rowNum, col, msg: `"${val}" is not a number` });
      }
    }
    for (const col of POSITIVE_COLS) {
      const v = parseFloat(String(row[col]));
      if (!isNaN(v) && v <= 0) {
        errors.push({ row: rowNum, col, msg: `Must be > 0 (got ${v})` });
      }
    }
    const depth = parseFloat(String(row['Max Depth [%]']));
    if (!isNaN(depth) && (depth < 0 || depth > 100)) {
      errors.push({ row: rowNum, col: 'Max Depth [%]', msg: `Must be 0–100 (got ${depth})` });
    }
  });
  return errors;
}
