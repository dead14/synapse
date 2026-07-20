import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseIliRow,
  parseLocaleNumber,
  summarizeIliRows,
} from '../src/utils/iliRowParser.ts';


test('maps a styled vendor row by canonical field meaning', () => {
  const parsed = parseIliRow(
    {
      'Feature #': 17,
      'Abs. distance (m)': 125.75,
      'Feature type *': 'ANOM',
      'Max. depth [%]': '32,5',
      "Orientation o'clock": 0.5,
      'Length [mm]': 120,
      'Width [mm]': 45,
    },
    0,
  );

  assert.equal(parsed.id, '17');
  assert.equal(parsed.dist, 125.75);
  assert.equal(parsed.type, 'anomaly');
  assert.equal(parsed.depth, 32.5);
  assert.equal(parsed.clock, '12:00');
  assert.equal(parsed.length, 120);
  assert.equal(parsed.width, 45);
});

test('does not invent distance from the first unrelated numeric column', () => {
  const parsed = parseIliRow(
    {
      'Feature #': 99,
      'Joint number': 42,
      'Feature type': 'WELD',
      'Depth [%]': 12,
    },
    0,
  );

  assert.equal(parsed.dist, null);
});

test('parses common decimal and thousands separator variants', () => {
  assert.equal(parseLocaleNumber('1,234.56'), 1234.56);
  assert.equal(parseLocaleNumber('1.234,56'), 1234.56);
  assert.equal(parseLocaleNumber('32,5'), 32.5);
  assert.equal(parseLocaleNumber('not numeric'), null);
});

test('summarizes anchors and invalid anchor distances deterministically', () => {
  const result = summarizeIliRows([
    { 'Feature #': 1, 'Absolute Distance, m': 0, 'component/anomaly type': 'WELD' },
    { 'Feature #': 2, 'Absolute Distance, m': 10, 'component/anomaly type': 'CORROSION' },
    { 'Feature #': 3, 'component/anomaly type': 'VALV' },
  ]);

  assert.equal(result.counts.total, 3);
  assert.equal(result.counts.welds, 1);
  assert.equal(result.counts.anomalies, 1);
  assert.equal(result.counts.valves, 1);
  assert.equal(result.counts.gwAnchors, 2);
  assert.equal(result.counts.invalidAnchorDistances, 1);
});
