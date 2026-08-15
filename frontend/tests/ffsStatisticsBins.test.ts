import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_LD_BINS,
  MIN_LD_BIN_SIZE_M,
  assignBinIndex,
  buildDistributionTable,
  buildLdBins,
  buildWorstTable,
  resolveLdBinSize,
  DEFAULT_DEPTH_BUCKETS,
} from '../src/lib/ffs/statistics.ts';
import { screenResults } from '../src/lib/ffs/screening.ts';
import { processRow } from '../src/lib/ffs/calcEngine.ts';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig } from '../src/lib/ffs/types.ts';

const config: FfsConfig = {
  lineName: 'Bin line',
  method: 'modified',
  modifiedSa: 'smys69',
  iliDate: new Date('2024-08-23'),
  highlightYears: 5,
  analysisHorizonYears: 30,
};

function feature(ld: number, depthPct = 40) {
  return {
    'Feature ID': `F-${ld}`,
    'LD [m]': String(ld),
    Section: 'Line pipe',
    Surface: 'External',
    'Max Depth [%]': String(depthPct),
    'Length [mm]': '40',
    'Width [mm]': '30',
    'Orient. (hrs:mins)': '6:00',
    'Nominal Wall Thickness [mm]': '10',
    'CR Depth [mm/y]': '0.1',
    'CR Length [mm/y]': '0',
    'Design Factor': '0.72',
    'Outer Diameter Ds': '508',
    'SMYS [MPa]': '359',
    'Operating Pressure P₀ [MPa]': '5',
  };
}

/** Features spread across a long line, which is what makes the bin count blow up. */
function longLinePopulation() {
  return screenResults(
    [feature(0), feature(40_000, 55), feature(80_000, 30), feature(120_000, 65)]
      .map((row) => processRow(row, config)),
    config,
    DEFAULT_SCREENING_CONFIG,
  );
}

test('a bin finer than the line can carry is widened, never honoured', () => {
  const items = longLinePopulation();

  // The `min` attribute on the bin inputs is a spinner hint the browser does
  // not apply to typed text.  A stray 0.01 m over a 120 km line asks for twelve
  // million bins — one array allocated per bin in buildWorstTable — and used to
  // take the tab down with it.
  const resolved = resolveLdBinSize(items, 0.01);
  assert.ok(resolved > 0.01);
  assert.equal(buildLdBins(items, 0.01).length <= MAX_LD_BINS + 1, true);
});

test('a bin size that fits is left exactly as asked for', () => {
  const items = longLinePopulation();

  assert.equal(resolveLdBinSize(items, 500), 500);
  const bins = buildLdBins(items, 500);
  assert.equal(bins[0].end - bins[0].start, 500);
  assert.equal(bins.length, 241);
});

test('a nonsensical bin size falls back to the floor rather than emptying the table', () => {
  const items = longLinePopulation();

  for (const bad of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
    const resolved = resolveLdBinSize(items, bad);
    assert.ok(resolved >= MIN_LD_BIN_SIZE_M, `${bad} resolved to ${resolved}`);
    assert.ok(Number.isFinite(resolved));
  }
  // Zero used to return no bins at all, so every feature silently vanished from
  // the distribution table instead of being counted in a coarse one.
  assert.ok(buildLdBins(items, 0).length > 0);
});

test('every feature is still counted once when the bin size is widened', () => {
  const items = longLinePopulation();

  // assignBinIndex reads the width off the bins rather than being handed it
  // again.  When the two disagreed, a widened bin placed every feature past the
  // first one outside the array and dropped it from the totals.
  const table = buildDistributionTable(items, 0.01, DEFAULT_DEPTH_BUCKETS);
  assert.equal(table.totals.total, items.length);

  const worst = buildWorstTable(items, 0.01, 'depth');
  assert.equal(worst.reduce((total, row) => total + row.count, 0), items.length);
});

test('a feature lands in the bin that spans its log distance', () => {
  const items = longLinePopulation();
  const bins = buildLdBins(items, 500);

  for (const item of items) {
    const index = assignBinIndex(item, bins);
    assert.notEqual(index, -1);
    const bin = bins[index];
    const ld = Number(item.nominal.ld);
    assert.ok(ld >= bin.start && ld < bin.end, `${ld} outside [${bin.start}, ${bin.end})`);
  }
});
