import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMatchingRulesConfig,
  defaultMatchingRules,
} from '../src/wizard/matchingRules.ts';

test('combined scenario and tolerance settings persist the exact engine contract', () => {
  const defaults = defaultMatchingRules({
    ToleranceConfig: {
      clock_tolerance: 20,
      us_gw_distance_tolerance: 0.4,
      ds_gw_distance_tolerance: 0.6,
      use_us_gw_distance: false,
      length_tolerance: 75,
    },
  });
  const result = buildMatchingRulesConfig({
    shared: defaults.shared,
    byPair: {},
    pairs: [],
    perPairEnabled: false,
  });

  assert.deepEqual(result.ToleranceConfig, {
    clock_tolerance: 20,
    us_gw_distance_tolerance: 0.4,
    ds_gw_distance_tolerance: 0.6,
    use_us_gw_distance: false,
    length_tolerance: 75,
  });
  assert.equal(result.pairToleranceConfigs, undefined);
  assert.equal(result.distThresh, undefined);
  assert.equal(result.hiddenFeatures, undefined);
  assert.equal(result.scenario, undefined);
});

test('hiddenFeatures are forwarded when non-empty', () => {
  const shared = defaultMatchingRules({}).shared;
  const result = buildMatchingRulesConfig({
    shared,
    byPair: {},
    pairs: [],
    perPairEnabled: false,
    hiddenFeatures: ['bend', 'valve'],
  });
  assert.deepEqual(result.hiddenFeatures, ['bend', 'valve']);
});

test('hiddenFeatures omitted when empty array', () => {
  const shared = defaultMatchingRules({}).shared;
  const result = buildMatchingRulesConfig({
    shared,
    byPair: {},
    pairs: [],
    perPairEnabled: false,
    hiddenFeatures: [],
  });
  assert.equal(result.hiddenFeatures, undefined);
});

test('per-pair mode sends each run pair its own engine tolerances', () => {
  const shared = defaultMatchingRules({}).shared;
  const result = buildMatchingRulesConfig({
    shared,
    byPair: {
      '1->2': { ...shared, clock_tolerance: 10 },
      '2->3': { ...shared, clock_tolerance: 30 },
    },
    pairs: [{ key: '1->2' }, { key: '2->3' }],
    primaryPairKey: '2->3',
    perPairEnabled: true,
  });

  assert.equal(result.ToleranceConfig.clock_tolerance, 30);
  assert.equal(result.pairToleranceConfigs?.['1->2'].clock_tolerance, 10);
  assert.equal(result.pairToleranceConfigs?.['2->3'].clock_tolerance, 30);
});
