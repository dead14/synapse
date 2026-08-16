import { REQUIRED_COLUMNS } from './types.ts';

export interface ValidationError {
  row: number;
  col: string;
  msg: string;
}

/**
 * Column rules, by name.
 *
 * These used to be positional indexes into REQUIRED_COLUMNS, which meant a
 * column moving in or out of that list silently re-pointed every rule at its
 * neighbour. Names cost nothing and cannot slip.
 */
const DEPTH_COLUMN = 'Max Depth [%]';
const DESIGN_FACTOR_COLUMN = 'Design Factor';
const OUTER_DIAMETER_COLUMN = 'Outer Diameter Ds';

const NUMERIC_COLS = [
  'LD [m]', DEPTH_COLUMN, 'Length [mm]', 'Nominal Wall Thickness [mm]',
  'CR Depth [mm/y]', 'CR Length [mm/y]', DESIGN_FACTOR_COLUMN,
  OUTER_DIAMETER_COLUMN, 'SMYS [MPa]', 'Operating Pressure P₀ [MPa]',
];

const POSITIVE_COLS = [
  'Length [mm]', 'Nominal Wall Thickness [mm]', DESIGN_FACTOR_COLUMN,
  OUTER_DIAMETER_COLUMN, 'SMYS [MPa]', 'Operating Pressure P₀ [MPa]',
];

const NON_NEGATIVE_COLS = ['LD [m]', DEPTH_COLUMN, 'CR Depth [mm/y]', 'CR Length [mm/y]'];

/**
 * Columns that must hold a number when they hold anything at all.
 *
 * Width is the only one. B31G is a longitudinal method — depth and axial length
 * govern the failure pressure and width appears in no formula — so demanding it
 * of every feature refused whole runs from vendors that report no width column,
 * losing anomalies the assessment had everything else it needed for. A blank
 * width is carried as "not reported"; a present one still has to be a number.
 */
const OPTIONAL_NUMERIC_COLS = ['Width [mm]'];

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

    for (const column of OPTIONAL_NUMERIC_COLS) {
      const value = row[column];
      if (value === undefined || value === null || String(value).trim() === '') continue;
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

    // Depth is bounded by the wall, not by the 80 %WT line.
    //
    // This used to reject anything over 80 %WT, and `assertValidFfsRow` throws
    // on the first error, so a single deep anomaly aborted the whole assessment
    // — silently removing from the report exactly the features most likely to
    // govern it. The 80 % figure is a project rejection threshold, configurable
    // through `FfsScreeningConfig.depthRejectionPct`; B31G-2023 para. 1.2(f)
    // admits metal loss of any depth, asking only that the sizing accuracy and
    // the effective corrosion rate be justified above it. The engine already
    // handles these rows properly: the kernel flags `beyondDepthLimit`, the
    // nominal acceptance fails them, the screening severity fails them, and the
    // applicability check raises them for review. Only the validator disagreed.
    //
    // Past 100 %WT there is nothing left to assess — that is a through-wall
    // penetration or a data error, and it is still refused.
    const depth = Number(String(row[DEPTH_COLUMN]).trim());
    if (Number.isFinite(depth) && depth > 100) {
      errors.push({
        row: rowNumber,
        col: DEPTH_COLUMN,
        msg: `Must not exceed 100% of wall (got ${depth})`,
      });
    }

    const designFactor = Number(String(row[DESIGN_FACTOR_COLUMN]).trim());
    if (Number.isFinite(designFactor) && designFactor > 1) {
      errors.push({ row: rowNumber, col: DESIGN_FACTOR_COLUMN, msg: `Must be <= 1 (got ${designFactor})` });
    }

    const outerDiameter = Number(String(row[OUTER_DIAMETER_COLUMN]).trim());
    if (Number.isFinite(outerDiameter) && outerDiameter < 50) {
      errors.push({ row: rowNumber, col: OUTER_DIAMETER_COLUMN, msg: `Pipeline OD must be >= 50 mm (got ${outerDiameter})` });
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
