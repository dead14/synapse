import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bandForDistance,
  bandLengthM,
  buildSectionBands,
  formatBandRange,
  hasSectionNames,
  isSectioned,
  sectionBandColor,
} from '../src/lib/sections/bands.ts';

function point(distanceM: number | null, section: string) {
  return { distanceM, section };
}

test('bands run from the first to the last feature of each contiguous stretch', () => {
  const bands = buildSectionBands([
    point(120, 'BUR-01'),
    point(40, 'BUR-01'),
    point(900, 'RC#86'),
    point(1250, 'RC#86'),
  ]);

  assert.equal(bands.length, 2);
  assert.deepEqual(
    bands.map((band) => [band.name, band.startM, band.endM, band.count]),
    [['BUR-01', 40, 120, 2], ['RC#86', 900, 1250, 2]],
  );
  assert.deepEqual(bands.map((band) => band.order), [0, 1]);
});

test('unsectioned features between two members do not split a stretch', () => {
  const bands = buildSectionBands([
    point(10, 'RC#86'),
    point(20, '-'),
    point(30, ''),
    point(40, 'RC#86'),
  ]);

  assert.equal(bands.length, 1);
  assert.equal(bands[0].startM, 10);
  assert.equal(bands[0].endM, 40);
  assert.equal(bands[0].count, 2, 'unsectioned features are not counted into the band');
});

test('the same section name crossed twice produces two bands', () => {
  // A line can cross the same river twice; collapsing those into one band would
  // draw a section straight through the stretch that sits between them.
  const bands = buildSectionBands([
    point(100, 'RC#86'),
    point(500, 'BUR-02'),
    point(900, 'RC#86'),
  ]);

  assert.equal(bands.length, 3);
  assert.deepEqual(bands.map((band) => band.name), ['RC#86', 'BUR-02', 'RC#86']);
  assert.notEqual(bands[0].id, bands[2].id, 'ids stay distinct so a selection targets one crossing');
  assert.equal(bands[0].color, bands[2].color, 'the same name keeps the same colour');
});

test('features with no usable distance are left out rather than pinned at zero', () => {
  const bands = buildSectionBands([
    point(null, 'RC#86'),
    point(Number.NaN, 'RC#86'),
    point(700, 'RC#86'),
  ]);

  assert.equal(bands.length, 1);
  assert.equal(bands[0].startM, 700);
  assert.equal(bands[0].count, 1);
});

test('an unsectioned population produces no bands at all', () => {
  assert.deepEqual(buildSectionBands([point(10, '-'), point(20, 'Unclassified')]), []);
  assert.equal(hasSectionNames([point(10, '-'), point(20, '')]), false);
  assert.equal(hasSectionNames([point(10, 'RC#86')]), true);
  assert.equal(isSectioned('  -  '), false);
  assert.equal(isSectioned('RC#86'), true);
});

test('a recognised sectioning type prefix keeps its workbench colour', () => {
  assert.equal(sectionBandColor('RIS-04'), '#ef4444', 'riser red matches the sectioning schematic');
  assert.equal(sectionBandColor('rl-1'), '#2dd4bf');
  // An unrecognised name still gets a stable colour rather than a random one.
  assert.equal(sectionBandColor('RC#86'), sectionBandColor('rc#86'));
});

test('a distance resolves to the band containing it, and to nothing in a gap', () => {
  const bands = buildSectionBands([point(100, 'A'), point(200, 'A'), point(900, 'B'), point(1000, 'B')]);

  assert.equal(bandForDistance(bands, 150)?.name, 'A');
  assert.equal(bandForDistance(bands, 950)?.name, 'B');
  assert.equal(bandForDistance(bands, 500), null, 'the reported gap is not filled in');
});

test('band extents are formatted as the KP range the axis reads', () => {
  const [wide, single] = buildSectionBands([
    point(1200, 'A'), point(3400, 'A'), point(9000, 'B'),
  ]);

  assert.equal(formatBandRange(wide), 'KP 1.20–3.40');
  assert.equal(bandLengthM(wide), 2200);
  assert.equal(formatBandRange(single), 'KP 9.00', 'a one-feature section reports a point, not a zero span');
});
