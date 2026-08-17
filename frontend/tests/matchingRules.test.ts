import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFeatureRulesConfig,
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
    // The old unchecked box meant "ignore weld-relative distance", so the
    // source selector has to resolve to `off` rather than to the `auto` default.
    // Reading it any other way would switch a saved session's gates back on.
    us_gw_distance_source: 'off',
    // Same rule, for the same reason: a session saved before the girth-weld
    // fill existed reported exactly what its pipetally carried, so reopening it
    // must not start inheriting thicknesses it never had.
    wall_thickness_source: 'uploaded',
    // And again: a session saved before the cluster switch existed ran with
    // clusters held out of alignment, so reopening it must not start pairing
    // them and rewriting its growth rates.
    cluster_alignment: 'bypass',
    // Absent from a saved session means the matcher that existed at the time.
    anomaly_matcher: 'hungarian',
    // A session saved before the weld-offset gate was separated from the
    // odometer window inherits the window, which is exactly what the engine
    // falls back to — so an existing session's results do not move.
    gw_offset_tolerance: 0.4,
    length_tolerance: 75,
  });
  assert.equal(result.pairToleranceConfigs, undefined);
  assert.equal(result.distThresh, undefined);
  assert.equal(result.hiddenFeatures, undefined);
  assert.equal(result.scenario, undefined);
});

test('the tolerance step leaves hiddenFeatures alone', () => {
  const shared = defaultMatchingRules({}).shared;
  const result = buildMatchingRulesConfig({
    shared,
    byPair: {},
    pairs: [],
    perPairEnabled: false,
  });
  // Spreading this over a saved config must not erase what the Feature rules
  // step wrote, so the key has to be absent rather than explicitly undefined.
  assert.equal(Object.hasOwn(result, 'hiddenFeatures'), false);

  const merged = { ...{ hiddenFeatures: ['bend'] }, ...result };
  assert.deepEqual(merged.hiddenFeatures, ['bend']);
});

test('feature rules emit hiddenFeatures only when something is hidden', () => {
  assert.deepEqual(buildFeatureRulesConfig(['bend', 'valve']).hiddenFeatures, ['bend', 'valve']);
  assert.equal(buildFeatureRulesConfig([]).hiddenFeatures, undefined);
});

test('an explicit cluster decision survives the round trip to the engine contract', () => {
  const defaults = defaultMatchingRules({
    ToleranceConfig: { cluster_alignment: 'align' },
  });
  const result = buildMatchingRulesConfig({
    shared: defaults.shared,
    byPair: {},
    pairs: [],
    perPairEnabled: false,
  });

  assert.equal(result.ToleranceConfig.cluster_alignment, 'align');
  // Anything the engine would not recognise falls back to the safe rule
  // rather than reaching it as a value it has to guess about.
  assert.equal(
    defaultMatchingRules({ ToleranceConfig: { cluster_alignment: 'sometimes' } })
      .shared.cluster_alignment,
    'bypass',
  );
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
