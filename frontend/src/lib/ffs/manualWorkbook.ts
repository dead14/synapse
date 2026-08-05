import * as XLSX from 'xlsx';

import { OPTIONAL_COLUMNS, REQUIRED_COLUMNS } from './types.ts';
import { validateHeaders } from './validation.ts';

export const MAX_MANUAL_FFS_ROWS = 10_000;
export const MAX_MANUAL_FFS_FILE_BYTES = 10 * 1024 * 1024;
export const MANUAL_FFS_ACCEPT = '.xlsx,.xls,.csv';

export interface ManualFfsWorkbook {
  rows: Record<string, string>[];
  missingColumns: string[];
}

const SAMPLE_ROW = [
  100.5,
  'Joint-1',
  'Internal',
  25,
  45,
  30,
  '06:00',
  12.7,
  0.1,
  0.05,
  0.72,
  508,
  358,
  6.5,
  'F-001',
  '',
  'No',
  'Unrepaired',
  '',
  '',
  '',
  '',
  '',
];

export function createManualFfsTemplate(): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  const templateColumns = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS];
  const sheet = XLSX.utils.aoa_to_sheet([templateColumns, SAMPLE_ROW]);
  sheet['!cols'] = templateColumns.map((column) => ({
    wch: Math.max(14, Math.min(34, column.length + 2)),
  }));
  XLSX.utils.book_append_sheet(workbook, sheet, 'ILI data');
  return workbook;
}

export function downloadManualFfsTemplate(): void {
  XLSX.writeFile(createManualFfsTemplate(), 'FFS_Assessment_Template.xlsx');
}

export function parseManualFfsWorkbook(data: ArrayBuffer): ManualFfsWorkbook {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(data, { type: 'array', cellDates: false });
  } catch {
    throw new Error('The workbook could not be read. Upload a valid XLSX, XLS, or CSV file.');
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error('The workbook does not contain a worksheet.');

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheetName], {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  });
  const headerRow = (matrix[0] || []).map((value) => String(value).trim());
  const missingColumns = validateHeaders(headerRow);
  if (missingColumns.length > 0) return { rows: [], missingColumns };

  const dataRows = matrix.slice(1).filter((row) => row.some((value) => String(value).trim() !== ''));
  if (dataRows.length === 0) throw new Error('The workbook contains no data rows.');
  if (dataRows.length > MAX_MANUAL_FFS_ROWS) {
    throw new Error(`The workbook exceeds the maximum of ${MAX_MANUAL_FFS_ROWS.toLocaleString()} data rows.`);
  }

  const headerIndexes = new Map(headerRow.map((header, index) => [header, index]));
  const importedColumns = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS];
  const rows = dataRows.map((row) => Object.fromEntries(
    importedColumns.map((column) => [
      column,
      String(row[headerIndexes.get(column) ?? -1] ?? '').trim(),
    ]),
  ));
  return { rows, missingColumns: [] };
}

export async function readManualFfsFile(file: File): Promise<ManualFfsWorkbook> {
  if (file.size > MAX_MANUAL_FFS_FILE_BYTES) {
    throw new Error('The file exceeds the 10 MB upload limit.');
  }
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
    throw new Error('Upload an XLSX, XLS, or CSV file.');
  }
  return parseManualFfsWorkbook(await file.arrayBuffer());
}
