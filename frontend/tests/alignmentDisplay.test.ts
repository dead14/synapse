import assert from 'node:assert/strict';
import test from 'node:test';

import { alignmentDisplayValue, isAlignmentDisplayMetadata } from '../src/utils/alignmentDisplay.ts';
import { createExcelExportRows } from '../src/utils/alignmentExport.ts';

test('shows original source log distance while retaining mapped values in the result row', () => {
  const row = {
    'Log Dist OLD (m)': 3905.57,
    'Log Dist NEW (m)': 3905.57,
    'Original Log Dist OLD (m)': 42.243,
    'Original Log Dist NEW (m)': 3905.57,
    'Feature Type OLD': 'girth weld',
  };

  assert.equal(alignmentDisplayValue(row, 'Log Dist OLD (m)'), 42.243);
  assert.equal(alignmentDisplayValue(row, 'Log Dist NEW (m)'), 3905.57);
  assert.equal(alignmentDisplayValue(row, 'Feature Type OLD'), 'girth weld');
  assert.equal(row['Log Dist OLD (m)'], 3905.57);
});

test('falls back to the mapped value when the original distance is unavailable', () => {
  const row = {
    'Log Dist OLD (m)': 3905.57,
    'Original Log Dist OLD (m)': '-',
  };

  assert.equal(alignmentDisplayValue(row, 'Log Dist OLD (m)'), 3905.57);
});

test('keeps original-distance metadata out of selectable result columns', () => {
  assert.equal(isAlignmentDisplayMetadata('Original Log Dist OLD (m)'), true);
  assert.equal(isAlignmentDisplayMetadata('Original Log Dist NEW (m)'), true);
  assert.equal(isAlignmentDisplayMetadata('Log Dist OLD (m)'), false);
});

test('keeps mapped distances in export because original distance is display-only', () => {
  const [exportRow] = createExcelExportRows([{
    'Log Dist OLD (m)': 3905.57,
    'Log Dist NEW (m)': 3905.57,
    'Original Log Dist OLD (m)': 42.243,
    'Original Log Dist NEW (m)': 3905.57,
  }]);

  assert.equal(exportRow['Log Dist OLD (m)'], 3905.57);
  assert.equal(exportRow['Log Dist NEW (m)'], 3905.57);
  assert.equal(Object.hasOwn(exportRow, 'Original Log Dist OLD (m)'), false);
});
