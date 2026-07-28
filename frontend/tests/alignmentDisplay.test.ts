import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alignmentDisplayValue,
  isAlignmentDisplayMetadata,
  sortAlignmentRowsByMasterAxis,
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

test('exposes the canonical master-axis coordinate without replacing reported LD', () => {
  const oldOnly = {
    'Log Dist OLD (m)': 1931.918,
    'Original Log Dist OLD (m)': 67.648,
    'Log Dist NEW (m)': '-',
  };
  const newOnly = {
    'Log Dist OLD (m)': '-',
    'Log Dist NEW (m)': 1931.917,
  };

  assert.equal(alignmentDisplayValue(oldOnly, 'Master Axis (m)'), 1931.918);
  assert.equal(alignmentDisplayValue(oldOnly, 'Log Dist OLD (m)'), 67.648);
  assert.equal(alignmentDisplayValue(newOnly, 'Master Axis (m)'), 1931.917);
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

test('sorts matched and NEW-only rows by the canonical master log distance', () => {
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

  const sorted = sortAlignmentRowsByMasterAxis(rows);

  assert.deepEqual(
    sorted.map((row) => alignmentDisplayValue(row, 'Log Dist NEW (m)')),
    [1893.527, 1893.602, 1893.756, 1893.814, 1893.857, 1893.903, 1893.903, 1893.932],
  );
});

test('interleaves unmatched OLD and NEW rows on the canonical master axis', () => {
  const rows = [
    {
      id: 'HU_CPA_2024-28062',
      'Log Dist OLD (m)': 1931.918,
      'Original Log Dist OLD (m)': 67.648,
      'Log Dist NEW (m)': '-',
    },
    {
      id: 'HU_CPA_2026-33845',
      'Log Dist OLD (m)': '-',
      'Log Dist NEW (m)': 1932.134,
    },
    {
      id: 'HU_CPA_2026-33844',
      'Log Dist OLD (m)': '-',
      'Log Dist NEW (m)': 1931.917,
    },
  ];

  assert.deepEqual(
    sortAlignmentRowsByMasterAxis(rows).map((row) => row.id),
    ['HU_CPA_2026-33844', 'HU_CPA_2024-28062', 'HU_CPA_2026-33845'],
  );
});

test('sorting preserves a pre-assigned __origIdx so each row keeps pointing at its source row', () => {
  // ResultsPanel stamps __origIdx (the index in the unsorted source array)
  // BEFORE sorting; selection, defect-viewer highlighting, and drag-drop
  // reassignment all rely on the sort not renumbering or copying rows.
  const rows = [
    { id: 'c', 'Log Dist NEW (m)': 30 },
    { id: 'a', 'Log Dist NEW (m)': 10 },
    { id: 'b', 'Log Dist NEW (m)': 20 },
  ].map((row, index) => ({ ...row, __origIdx: index }));

  const sorted = sortAlignmentRowsByMasterAxis(rows);

  assert.deepEqual(sorted.map((row) => row.id), ['a', 'b', 'c']);
  assert.deepEqual(sorted.map((row) => row.__origIdx), [1, 2, 0]);
  // Every sorted entry is the very same object as its source row, so
  // rows[sorted[i].__origIdx] always recovers the original row.
  for (const row of sorted) {
    assert.equal(row, rows[row.__origIdx]);
  }
});

test('sorting does not invent or renumber identity for equal-distance rows', () => {
  const rows = [
    { id: 'first', 'Log Dist NEW (m)': 5 },
    { id: 'second', 'Log Dist NEW (m)': 5 },
  ].map((row, index) => ({ ...row, __origIdx: index }));

  const sorted = sortAlignmentRowsByMasterAxis(rows);

  // Ties keep input order (stable), and identities ride along untouched.
  assert.deepEqual(sorted.map((row) => row.id), ['first', 'second']);
  assert.deepEqual(sorted.map((row) => row.__origIdx), [0, 1]);
});
