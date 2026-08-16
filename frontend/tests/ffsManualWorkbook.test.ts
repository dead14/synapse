import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';

import {
  MAX_MANUAL_FFS_ROWS,
  createManualFfsTemplate,
  parseManualFfsWorkbook,
} from '../src/lib/ffs/manualWorkbook.ts';
import { OPTIONAL_COLUMNS, REQUIRED_COLUMNS } from '../src/lib/ffs/types.ts';

function workbookBytes(rows: unknown[][]): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'ILI data');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
}

test('manual FFS template exposes calculation and repair-evidence columns with a sample row', () => {
  const template = createManualFfsTemplate();
  const sheet = template.Sheets[template.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

  assert.deepEqual(rows[0], [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].length, REQUIRED_COLUMNS.length + OPTIONAL_COLUMNS.length);
});

test('manual workbook parser accepts a valid workbook and normalizes cell values', () => {
  // Width is not among the required columns: B31G does not read it, and a
  // workbook that omits it is complete.
  const bytes = workbookBytes([
    [...REQUIRED_COLUMNS],
    [100.5, 'Joint-1', 'Internal', 25, 45, '06:00', 12.7, 0.1, 0.05, 0.72, 508, 358, 6.5],
  ]);

  const parsed = parseManualFfsWorkbook(bytes);

  assert.deepEqual(parsed.missingColumns, []);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]['LD [m]'], '100.5');
  assert.equal(parsed.rows[0]['Orient. (hrs:mins)'], '06:00');
  assert.equal(parsed.rows[0]['Repair Status'], '', 'legacy workbooks default to an unrepaired disposition');
});

test('manual workbook parser preserves optional feature and repair evidence', () => {
  const bytes = workbookBytes([
    [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS],
    [
      100.5, 'Joint-1', 'Internal', 25, 45, '06:00', 12.7, 0.1, 0.05, 0.72, 508, 358, 6.5,
      'F-001', 30, '1.39', 'Yes', 'Temporary repair', 'Composite wrap', '2025-01-20', 'REP-17', 'Permanent repair', 'Integrity',
    ],
  ]);

  const parsed = parseManualFfsWorkbook(bytes);

  assert.equal(parsed.rows[0]['Feature ID'], 'F-001');
  assert.equal(parsed.rows[0]['Width [mm]'], '30');
  assert.equal(parsed.rows[0]['Repair Status'], 'Temporary repair');
  assert.equal(parsed.rows[0]['Repair Reference'], 'REP-17');
  assert.equal(parsed.rows[0]['Clustered Metal Loss'], 'Yes');
  assert.equal(parsed.rows[0]['Safety Factor'], '1.39');
});

test('manual workbook parser reports missing columns before assessment', () => {
  const parsed = parseManualFfsWorkbook(workbookBytes([
    ['LD [m]', 'Section'],
    [100.5, 'Joint-1'],
  ]));

  assert.ok(parsed.missingColumns.includes('Max Depth [%]'));
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
