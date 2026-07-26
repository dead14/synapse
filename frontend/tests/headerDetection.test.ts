import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalFieldForHeader,
  detectHeaderRowIndex,
} from '../src/utils/headerDetection.ts';

test('detects a universal schema on the first row', () => {
  const rows = [
    ['feature_id', 'log_distance_m', 'joint_number', 'feature_type', 'depth_pct'],
    [1, 0, 10, 'Weld', null],
  ];

  assert.equal(detectHeaderRowIndex(rows), 0);
});

test('skips title, metadata, and grouping rows in the styled ILI template', () => {
  const rows = [
    ['ILI UNIVERSAL DATA TEMPLATE v2.1'],
    ['Pipeline Name:', '', 'Survey Year:', '', 'Vendor:'],
    ['IDENTIFIKASI & POSISI', '', '', '', '', 'FITUR'],
    [
      'Feature #',
      'Abs. distance (m)',
      'Joint number',
      'Dist. U/S GW (m)',
      'Joint length (m)',
      'Feature type *',
      'Feature identification',
      'Depth, % WT',
    ],
    [1, 0, 10, 0, 12, 'Weld', '', null],
  ];

  assert.equal(detectHeaderRowIndex(rows), 3);
});

test('recognizes representative vendor synonyms without relying on column order', () => {
  assert.equal(canonicalFieldForHeader('Absolute Distance, m'), 'log_distance_m');
  assert.equal(canonicalFieldForHeader('log. distance'), 'log_distance_m');
  assert.equal(canonicalFieldForHeader('component/anomaly type'), 'feature_type');
  assert.equal(canonicalFieldForHeader("Orientation o'clock"), 'clock_position');
  assert.equal(canonicalFieldForHeader('Max. depth [%]'), 'depth_pct');
});

test('fails clearly when no row contains both distance and feature type', () => {
  assert.throws(
    () => detectHeaderRowIndex([
      ['Inspection report'],
      ['Pipeline', 'Survey Year', 'Vendor'],
    ]),
    /header/i,
  );
});
