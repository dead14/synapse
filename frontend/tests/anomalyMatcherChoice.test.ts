import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANOMALY_MATCHERS,
  buildMatchingRulesConfig,
  defaultMatchingRules,
  normalizeToleranceValues,
  US_GW_DISTANCE_SOURCES,
  type ToleranceValues,
} from '../src/wizard/matchingRules.ts';
import { projectMatchOutcome, sameTolerances } from '../src/wizard/toleranceModel.ts';
import { alignmentResultColumns, MATCH_EVIDENCE_KEY, MATCH_METHOD_LABELS } from '../src/utils/alignmentDisplay.ts';

const INPUT = { oldAnomalies: 400, newAnomalies: 460 };

function shared(overrides: Partial<ToleranceValues> = {}): ToleranceValues {
  return { ...defaultMatchingRules({}).shared, ...overrides };
}

test('a fresh session defaults to the gated matcher', () => {
  const values = defaultMatchingRules({}).shared;
  assert.equal(values.anomaly_matcher, 'hungarian');
  // `auto` is the safe default for the distance source: it uses the vendor
  // column when it is there and derives when it is not, so a pipetally without
  // the column stops silently losing its strongest identity evidence.
  assert.equal(values.us_gw_distance_source, 'auto');
});

test('a session saved before the source selector existed keeps its old meaning', () => {
  assert.equal(
    defaultMatchingRules({ ToleranceConfig: { use_us_gw_distance: false } }).shared
      .us_gw_distance_source,
    'off',
  );
  assert.equal(
    defaultMatchingRules({ ToleranceConfig: { use_us_gw_distance: true } }).shared
      .us_gw_distance_source,
    'uploaded',
  );
});

test('an unrecognised persisted choice falls back instead of reaching the engine', () => {
  const values = defaultMatchingRules({
    ToleranceConfig: { anomaly_matcher: 'quantum_vibes', us_gw_distance_source: 'telepathy' },
  }).shared;

  assert.equal(values.anomaly_matcher, 'hungarian');
  assert.equal(values.us_gw_distance_source, 'uploaded');
});

test('the legacy gate boolean is kept in step with the source selector', () => {
  // The engine reads the boolean as its fallback for older sessions, so the two
  // must never disagree on the wire.
  assert.equal(
    normalizeToleranceValues(shared({ us_gw_distance_source: 'off' })).use_us_gw_distance,
    false,
  );
  for (const source of ['uploaded', 'auto', 'derived'] as const) {
    assert.equal(
      normalizeToleranceValues(shared({ us_gw_distance_source: source })).use_us_gw_distance,
      true,
      source,
    );
  }
});

test('the matcher choice reaches the engine contract', () => {
  const result = buildMatchingRulesConfig({
    shared: shared({ anomaly_matcher: 'bayesian_drift', us_gw_distance_source: 'derived' }),
    byPair: {},
    pairs: [],
    perPairEnabled: false,
  });

  assert.equal(result.ToleranceConfig.anomaly_matcher, 'bayesian_drift');
  assert.equal(result.ToleranceConfig.us_gw_distance_source, 'derived');
});

test('each run pair can choose its own matcher', () => {
  const result = buildMatchingRulesConfig({
    shared: shared(),
    byPair: {
      '1->2': shared({ anomaly_matcher: 'bayesian_drift' }),
      '2->3': shared({ anomaly_matcher: 'hungarian' }),
    },
    pairs: [{ key: '1->2' }, { key: '2->3' }],
    primaryPairKey: '2->3',
    perPairEnabled: true,
  });

  assert.equal(result.pairToleranceConfigs?.['1->2'].anomaly_matcher, 'bayesian_drift');
  assert.equal(result.pairToleranceConfigs?.['2->3'].anomaly_matcher, 'hungarian');
});

test('switching matcher counts as a change to the tolerance set', () => {
  const gated = shared();
  assert.equal(sameTolerances(gated, shared({ anomaly_matcher: 'bayesian_drift' })), false);
  assert.equal(sameTolerances(gated, shared({ us_gw_distance_source: 'derived' })), false);
  assert.equal(sameTolerances(gated, shared()), true);
});

test('the gate projection reports itself inapplicable rather than guessing', () => {
  const gated = projectMatchOutcome(shared(), INPUT);
  const ungated = projectMatchOutcome(shared({ anomaly_matcher: 'bayesian_drift' }), INPUT);

  assert.equal(gated.gatesApply, true);
  assert.ok(gated.candidatePairs > 0);
  // Not a low number — no number. The model projects gate pass fractions, and
  // this matcher has no gates to model.
  assert.equal(ungated.gatesApply, false);
  assert.equal(ungated.candidatePairs, 0);
});

test('every offered choice is one the wizard can describe', () => {
  for (const matcher of ANOMALY_MATCHERS) {
    assert.ok(matcher.label.length > 0 && matcher.hint.length > 0, matcher.id);
  }
  for (const source of US_GW_DISTANCE_SOURCES) {
    assert.ok(source.label.length > 0 && source.hint.length > 0, source.id);
  }
});

test('every matcher has a label for the method stamped on a result row', () => {
  // Without this the evidence drawer would title itself with a raw enum.
  assert.equal(MATCH_METHOD_LABELS.HUNGARIAN !== undefined, true);
  assert.equal(MATCH_METHOD_LABELS.BAYESIAN_DRIFT !== undefined, true);
});

test('the evidence object never becomes a table column', () => {
  const columns = alignmentResultColumns([
    {
      'Match/Unmatch': 'Matched',
      'Match Method': 'BAYESIAN_DRIFT',
      'Match Confidence (%)': 99.4,
      [MATCH_EVIDENCE_KEY]: { method: 'BAYESIAN_DRIFT', channels: [] },
    },
  ]);

  assert.equal(columns.includes(MATCH_EVIDENCE_KEY), false);
  assert.equal(columns.includes('Match Confidence (%)'), true);
  assert.equal(columns.includes('Match Method'), true);
});
