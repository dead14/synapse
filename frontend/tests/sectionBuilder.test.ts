import test from 'node:test';
import assert from 'node:assert/strict';

import {
  autoSectionsAtBoundaries,
  autoSectionsByLength,
  coverageGaps,
  coveredLengthM,
  fillCoverageGaps,
  lockedIndexOf,
  parsePosition,
  snapToLockedGw,
} from '../src/sectioning/sectionBuilder.ts';
import type { LockedGwPair, MatchingSection } from '../src/wizard/matchingSections.ts';

/** A locked GW every 100 m, ids GW-0 … GW-n, from 0 m to `count * 100` m. */
const lockedGws = (count: number): LockedGwPair[] =>
  Array.from({ length: count + 1 }, (_, index) => ({
    key: `k${index}`,
    oldId: `O-${index}`,
    newId: `GW-${index}`,
    oldDistance: index * 100,
    newDistance: index * 100,
  }));

const section = (id: string, startKey: string, endKey: string): MatchingSection => ({
  id,
  name: id,
  policy: 'MATCH',
  startGwKey: startKey,
  endGwKey: endKey,
});

test('snapping picks the nearer locked GW on either side of the target', () => {
  const gws = lockedGws(10);
  assert.equal(snapToLockedGw(gws, 240)?.pair.newId, 'GW-2');
  assert.equal(snapToLockedGw(gws, 260)?.pair.newId, 'GW-3');
  // Exactly halfway resolves deterministically rather than throwing.
  assert.ok(snapToLockedGw(gws, 250) !== null);
});

test('snapping reports the signed distance from the requested position', () => {
  const gws = lockedGws(10);
  assert.equal(snapToLockedGw(gws, 240)?.deviationM, 40);
  assert.equal(snapToLockedGw(gws, 260)?.deviationM, -40);
});

test('snapping clamps to the ends instead of running off the line', () => {
  const gws = lockedGws(5);
  assert.equal(snapToLockedGw(gws, -900)?.index, 0);
  assert.equal(snapToLockedGw(gws, 99_999)?.index, 5);
});

test('snapping refuses unusable input rather than guessing', () => {
  assert.equal(snapToLockedGw([], 100), null);
  assert.equal(snapToLockedGw(lockedGws(3), Number.NaN), null);
});

test('uniform sections tile the line end to end without overlapping', () => {
  const gws = lockedGws(10); // 0 … 1000 m
  const sections = autoSectionsByLength(gws, 300, { name: 'S', sectionType: 'BUR', policy: 'MATCH' }, 'test');

  assert.ok(sections.length >= 3);
  assert.equal(sections[0].startGwKey, gws[0].key);
  assert.equal(sections[sections.length - 1].endGwKey, gws[10].key);

  for (let i = 1; i < sections.length; i += 1) {
    assert.equal(sections[i].startGwKey, sections[i - 1].endGwKey, 'sections must be contiguous');
  }
});

test('a trailing stub shorter than half a span is absorbed, not left dangling', () => {
  const gws = lockedGws(10); // 1000 m total
  // 1000 / 450 would leave a 100 m tail, which merges into the preceding section.
  const sections = autoSectionsByLength(gws, 450, { name: 'S', sectionType: 'BUR', policy: 'MATCH' }, 'test');
  const last = sections[sections.length - 1];

  assert.equal(last.endGwKey, gws[10].key);
  const lastLength = coveredLengthM([last], gws);
  assert.ok(lastLength >= 225, `trailing section was ${lastLength} m, shorter than half a span`);
});

test('uniform sectioning always advances so it cannot loop forever', () => {
  const gws = lockedGws(4);
  // A span far shorter than the weld spacing must still terminate.
  const sections = autoSectionsByLength(gws, 1, { name: 'S', sectionType: 'BUR', policy: 'MATCH' }, 'test');
  assert.equal(sections.length, 4);
});

test('feature boundaries snap to locked GWs and always close at both line ends', () => {
  const gws = lockedGws(10);
  const sections = autoSectionsAtBoundaries(gws, [312, 655], { name: 'B', sectionType: 'BUR', policy: 'MATCH' }, 'test');

  assert.equal(sections.length, 3);
  assert.equal(sections[0].startGwKey, gws[0].key);
  assert.equal(sections[0].endGwKey, gws[3].key);
  assert.equal(sections[1].endGwKey, gws[7].key);
  assert.equal(sections[2].endGwKey, gws[10].key);
});

test('duplicate feature boundaries collapse instead of producing zero-length sections', () => {
  const gws = lockedGws(10);
  // Three bends inside the same weld spacing resolve to one boundary.
  const sections = autoSectionsAtBoundaries(gws, [498, 501, 503], { name: 'B', sectionType: 'BUR', policy: 'MATCH' }, 'test');
  assert.equal(sections.length, 2);
  assert.ok(sections.every((entry) => entry.startGwKey !== entry.endGwKey));
});

test('gaps report every uncovered stretch of the line', () => {
  const gws = lockedGws(10);
  const gaps = coverageGaps([section('a', gws[2].key, gws[5].key)], gws);
  assert.deepEqual(gaps, [
    { startM: 0, endM: 200 },
    { startM: 500, endM: 1000 },
  ]);
});

test('a fully covered line reports no gaps', () => {
  const gws = lockedGws(10);
  assert.deepEqual(coverageGaps([section('a', gws[0].key, gws[10].key)], gws), []);
});

test('filling gaps preserves existing sections and closes the rest', () => {
  const gws = lockedGws(10);
  const existing = [section('a', gws[2].key, gws[5].key)];
  const filled = fillCoverageGaps(existing, gws, { name: 'Gap', sectionType: 'UNCLASSIFIED', policy: 'MATCH' }, 'test');

  assert.ok(filled.some((entry) => entry.id === 'a'), 'the manual section survives');
  assert.deepEqual(coverageGaps(filled, gws), [], 'nothing is left uncovered');
});

test('covered length counts overlapping sections once', () => {
  const gws = lockedGws(10);
  const overlapping = [section('a', gws[0].key, gws[6].key), section('b', gws[3].key, gws[8].key)];
  assert.equal(coveredLengthM(overlapping, gws), 800);
});

test('covered length ignores sections whose boundaries are not locked GWs', () => {
  const gws = lockedGws(10);
  assert.equal(coveredLengthM([section('ghost', 'missing-start', 'missing-end')], gws), 0);
});

test('lockedIndexOf reports a miss rather than silently returning the first entry', () => {
  const gws = lockedGws(3);
  assert.equal(lockedIndexOf(gws, gws[2].key), 2);
  assert.equal(lockedIndexOf(gws, 'nope'), -1);
});

test('typed positions accept the operator conventions seen in the field', () => {
  assert.equal(parsePosition('2.4', 'km'), 2400);
  assert.equal(parsePosition('2,4', 'km'), 2400);
  assert.equal(parsePosition('2400', 'm'), 2400);
  // An explicit unit overrides the selected one.
  assert.equal(parsePosition('2400 m', 'km'), 2400);
  assert.equal(parsePosition('2.4km', 'm'), 2400);
});

test('typed positions reject unusable input instead of coercing it to zero', () => {
  assert.equal(parsePosition('', 'km'), null);
  assert.equal(parsePosition('abc', 'km'), null);
  assert.equal(parsePosition('   ', 'm'), null);
});
