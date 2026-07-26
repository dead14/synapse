import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alignmentDisplayValue,
  isAlignmentDisplayMetadata,
  sortAlignmentRowsByDisplayedLogDistance,
} from '../src/utils/alignmentDisplay.ts';
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

test('sorts result rows by the displayed NEW master log distance', () => {
  const rows = [
    { 'Log Dist OLD (m)': '-', 'Log Dist NEW (m)': 1893.527 },
    { 'Log Dist OLD (m)': 1893.650, 'Original Log Dist OLD (m)': 29.241, 'Log Dist NEW (m)': 1893.903 },
    { 'Log Dist OLD (m)': '-', 'Log Dist NEW (m)': 1893.602 },
    { 'Log Dist OLD (m)': '-', 'Log Dist NEW (m)': 1893.756 },
    { 'Log Dist OLD (m)': 1893.840, 'Original Log Dist OLD (m)': 29.347, 'Log Dist NEW (m)': 1893.903 },
    { 'Log Dist OLD (m)': '-', 'Log Dist NEW (m)': 1893.814 },
    { 'Log Dist OLD (m)': '-', 'Log Dist NEW (m)': 1893.857 },
    { 'Log Dist OLD (m)': '-', 'Log Dist NEW (m)': 1893.932 },
  ];

  const sorted = sortAlignmentRowsByDisplayedLogDistance(rows);

  assert.deepEqual(
    sorted.map((row) => alignmentDisplayValue(row, 'Log Dist NEW (m)')),
    [1893.527, 1893.602, 1893.756, 1893.814, 1893.857, 1893.903, 1893.903, 1893.932],
  );
});

test('places OLD-only rows after the ordered NEW master timeline', () => {
  const rows = [
    { id: 'old-2', 'Log Dist OLD (m)': 2, 'Log Dist NEW (m)': '-' },
    { id: 'new-2', 'Log Dist OLD (m)': '-', 'Log Dist NEW (m)': 20 },
    { id: 'old-1', 'Log Dist OLD (m)': 1, 'Log Dist NEW (m)': '-' },
    { id: 'new-1', 'Log Dist OLD (m)': '-', 'Log Dist NEW (m)': 10 },
  ];

  assert.deepEqual(
    sortAlignmentRowsByDisplayedLogDistance(rows).map((row) => row.id),
    ['new-1', 'new-2', 'old-1', 'old-2'],
  );
});
