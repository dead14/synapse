import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';

import {
  MAX_MANUAL_FFS_ROWS,
  createManualFfsTemplate,
  parseManualFfsWorkbook,
} from '../src/lib/ffs/manualWorkbook.ts';
import { REQUIRED_COLUMNS } from '../src/lib/ffs/types.ts';

function workbookBytes(rows: unknown[][]): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'ILI data');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
}

test('manual FFS template exposes the exact engine columns and a sample row', () => {
  const template = createManualFfsTemplate();
  const sheet = template.Sheets[template.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

  assert.deepEqual(rows[0], [...REQUIRED_COLUMNS]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].length, REQUIRED_COLUMNS.length);
});

test('manual workbook parser accepts a valid workbook and normalizes cell values', () => {
  const bytes = workbookBytes([
    [...REQUIRED_COLUMNS],
    [100.5, 'Joint-1', 'Internal', 25, 45, 30, '06:00', 12.7, 0.1, 0.05, 0.72, 508, 358, 6.5],
  ]);

  const parsed = parseManualFfsWorkbook(bytes);

  assert.deepEqual(parsed.missingColumns, []);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0][REQUIRED_COLUMNS[0]], '100.5');
  assert.equal(parsed.rows[0][REQUIRED_COLUMNS[6]], '06:00');
});

test('manual workbook parser reports missing columns before assessment', () => {
  const parsed = parseManualFfsWorkbook(workbookBytes([
    [REQUIRED_COLUMNS[0], REQUIRED_COLUMNS[1]],
    [100.5, 'Joint-1'],
  ]));

  assert.ok(parsed.missingColumns.includes(REQUIRED_COLUMNS[3]));
  assert.deepEqual(parsed.rows, []);
});

test('manual workbook parser rejects empty and excessive datasets', () => {
  assert.throws(
    () => parseManualFfsWorkbook(workbookBytes([[...REQUIRED_COLUMNS]])),
    /no data rows/i,
  );

  const tooManyRows = Array.from(
    { length: MAX_MANUAL_FFS_ROWS + 1 },
    () => Array(REQUIRED_COLUMNS.length).fill('1'),
  );
  assert.throws(
    () => parseManualFfsWorkbook(workbookBytes([[...REQUIRED_COLUMNS], ...tooManyRows])),
    /maximum/i,
  );
});
