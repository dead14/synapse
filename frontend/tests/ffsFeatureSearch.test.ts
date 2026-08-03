import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMPTY_FEATURE_QUERY,
  isFeatureQueryActive,
  parseBound,
  searchFeatures,
} from '../src/lib/ffs/featureSearch.ts';
import type { FfsRepairStatus, FfsScreenedResult } from '../src/lib/ffs/types.ts';

interface FixtureOptions {
  featureId?: string | null;
  ld: number;
  section?: string;
  depthPct?: number;
  repairStatus?: FfsRepairStatus;
}

function feature({
  featureId = null,
  ld,
  section = 'Aerial CPA',
  depthPct = 30,
  repairStatus = 'unrepaired',
}: FixtureOptions): FfsScreenedResult {
  return {
    key: `f-${ld}`,
    index: Math.round(ld),
    nominal: { featureId, ld, section, maxDepthPct: depthPct, repairStatus },
  } as unknown as FfsScreenedResult;
}

const population = [
  feature({ featureId: '34806', ld: 1881.823, section: 'Aerial HL279', depthPct: 12 }),
  feature({ featureId: '33630', ld: 2261.932, section: 'Aerial CPA', depthPct: 44, repairStatus: 'temporary-repair' }),
  feature({ featureId: '41154', ld: 3947.537, section: 'Aerial CPA', depthPct: 71 }),
  feature({ featureId: null, ld: 658.019, section: 'Riser RC#86', depthPct: 58, repairStatus: 'permanent-repair-verified' }),
];

test('an empty query returns the whole population, never an empty list', () => {
  assert.deepEqual(searchFeatures(population, EMPTY_FEATURE_QUERY), population);
  assert.equal(isFeatureQueryActive(EMPTY_FEATURE_QUERY), false);
});

test('text matches the feature id, the section name, or the printed distance', () => {
  const byId = searchFeatures(population, { ...EMPTY_FEATURE_QUERY, text: '34806' });
  assert.deepEqual(byId.map((item) => item.nominal.featureId), ['34806']);

  const bySection = searchFeatures(population, { ...EMPTY_FEATURE_QUERY, text: 'riser' });
  assert.deepEqual(bySection.map((item) => item.nominal.section), ['Riser RC#86']);

  const byDistance = searchFeatures(population, { ...EMPTY_FEATURE_QUERY, text: '1881.8' });
  assert.deepEqual(byDistance.map((item) => item.nominal.featureId), ['34806']);
});

test('text matching ignores case and tolerates surrounding whitespace', () => {
  const matched = searchFeatures(population, { ...EMPTY_FEATURE_QUERY, text: '  AERIAL cpa ' });
  assert.equal(matched.length, 2);
});

test('a feature with no vendor id is still reachable by section or distance', () => {
  const matched = searchFeatures(population, { ...EMPTY_FEATURE_QUERY, text: '658' });
  assert.equal(matched.length, 1);
  assert.equal(matched[0].nominal.featureId, null);
});

test('a half-filled range still narrows the list', () => {
  const past = searchFeatures(population, { ...EMPTY_FEATURE_QUERY, ldFromM: 2000 });
  assert.deepEqual(past.map((item) => item.nominal.featureId), ['33630', '41154']);

  const before = searchFeatures(population, { ...EMPTY_FEATURE_QUERY, ldToM: 1000 });
  assert.deepEqual(before.map((item) => item.nominal.ld), [658.019]);
});

test('range bounds are inclusive at both ends', () => {
  const matched = searchFeatures(population, {
    ...EMPTY_FEATURE_QUERY,
    ldFromM: 1881.823,
    ldToM: 2261.932,
  });
  assert.deepEqual(matched.map((item) => item.nominal.featureId), ['34806', '33630']);
});

test('depth and distance filters compose rather than override each other', () => {
  const matched = searchFeatures(population, {
    ...EMPTY_FEATURE_QUERY,
    ldFromM: 1000,
    depthFromPct: 40,
  });
  assert.deepEqual(matched.map((item) => item.nominal.featureId), ['33630', '41154']);
});

test('the repair-status filter isolates what still needs a disposition', () => {
  const unrepaired = searchFeatures(population, { ...EMPTY_FEATURE_QUERY, repairStatus: 'unrepaired' });
  assert.deepEqual(unrepaired.map((item) => item.nominal.featureId), ['34806', '41154']);

  const temporary = searchFeatures(population, { ...EMPTY_FEATURE_QUERY, repairStatus: 'temporary-repair' });
  assert.deepEqual(temporary.map((item) => item.nominal.featureId), ['33630']);
});

test('a blank bound means no bound, not zero', () => {
  assert.equal(parseBound(''), null);
  assert.equal(parseBound('   '), null);
  assert.equal(parseBound('not a number'), null);
  assert.equal(parseBound('0'), 0);
  assert.equal(parseBound(' 1881.823 '), 1881.823);
});

test('any single filter marks the query as active so the clear control appears', () => {
  assert.equal(isFeatureQueryActive({ ...EMPTY_FEATURE_QUERY, text: 'a' }), true);
  assert.equal(isFeatureQueryActive({ ...EMPTY_FEATURE_QUERY, depthToPct: 0 }), true);
  assert.equal(isFeatureQueryActive({ ...EMPTY_FEATURE_QUERY, repairStatus: 'unrepaired' }), true);
  assert.equal(isFeatureQueryActive({ ...EMPTY_FEATURE_QUERY, text: '   ' }), false);
});
