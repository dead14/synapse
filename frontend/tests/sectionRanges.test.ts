import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countMissingInRange,
  coveragePercent,
  coveredLengthMeters,
  findOverlappingSection,
  validateSectionRange,
} from '../src/sectioning/sectionRanges.ts';

const range = (id: string, startM: number, endM: number, name = id) => ({ id, name, startM, endM });

test('overlapping section ranges are rejected with the clashing section named', () => {
  const existing = [range('a', 0, 100, 'River crossing')];
  assert.equal(findOverlappingSection(existing, range('b', 50, 150))?.id, 'a');
  assert.match(validateSectionRange(existing, range('b', 50, 150))!, /River crossing/);
});

test('sections may share a boundary weld without counting as overlap', () => {
  const existing = [range('a', 0, 100)];
  assert.equal(findOverlappingSection(existing, range('b', 100, 200)), null);
  assert.equal(validateSectionRange(existing, range('b', 100, 200)), null);
});

test('editing a section does not report it as overlapping itself', () => {
  const existing = [range('a', 0, 100)];
  assert.equal(validateSectionRange(existing, range('a', 10, 90)), null);
});

test('section ranges are validated regardless of the order the welds were clicked', () => {
  const existing = [range('a', 0, 100)];
  assert.equal(findOverlappingSection(existing, range('b', 150, 50))?.id, 'a');
});

test('section validation rejects empty names, zero length, and unusable distances', () => {
  assert.match(validateSectionRange([], { id: 'a', name: '  ', startM: 0, endM: 10 })!, /Section name/);
  assert.match(validateSectionRange([], range('a', 40, 40))!, /must be different/);
  assert.match(validateSectionRange([], range('a', Number.NaN, 10))!, /log distance/);
});

test('coverage counts overlapping sections once', () => {
  assert.equal(coveredLengthMeters([range('a', 0, 100), range('b', 100, 200)]), 200);
  assert.equal(coveredLengthMeters([range('a', 0, 100), range('b', 50, 150)]), 150);
  assert.equal(coveredLengthMeters([]), 0);
});

test('coverage percent is bounded and safe on an unknown pipeline length', () => {
  assert.equal(coveragePercent([range('a', 0, 100)], 400), 25);
  assert.equal(coveragePercent([range('a', 0, 800)], 400), 100);
  assert.equal(coveragePercent([range('a', 0, 100)], 0), 0);
});

test('missing OLD welds are counted only inside the selected range', () => {
  const historical = [
    { dist: 5, status: 'MISSING_IN_MASTER' },
    { dist: 50, status: 'MISSING_IN_MASTER' },
    { dist: 60, status: 'MATCHED' },
    { dist: 500, status: 'MISSING_IN_MASTER' },
  ];
  assert.equal(countMissingInRange(historical, 0, 100), 2);
  assert.equal(countMissingInRange(historical, 100, 0), 2, 'range order must not matter');
  assert.equal(countMissingInRange(historical, 200, 300), 0);
  assert.equal(countMissingInRange(historical, Number.NaN, 100), 0);
});
