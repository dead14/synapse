import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AURORA_MODE_LABELS,
  collectAuroraArtifacts,
  formatMetres,
  formatPercent,
  type AuroraArtifacts,
} from '../src/domain/auroraEvidence.ts';

function artifacts(pairLabel: string): AuroraArtifacts {
  return {
    summary: {
      state: 'REVIEW_READY',
      mode: 'M2_SEVERE_DRIFT',
      modeReasons: ['axial drift varies by 4.10 m across the run'],
      matchGroups: 12,
      autoAccepted: 10,
      reviewRequired: 2,
      regionOnly: 0,
      structuralChange: 0,
      anchorPairs: 40,
      rescueAttempts: 3,
      rescueAccepted: 2,
      configVersion: 'universal-v1.2.0',
      modelVersion: 'aurora-calibration-v1-logistic',
      pairLabel,
    },
    capabilityProfile: null,
    anchorMap: null,
    persistentJointMap: null,
    transformField: null,
    rescueCases: [],
    reviewQueue: [],
    reviewQueueTotal: 0,
    warnings: [],
    failureReason: null,
  };
}

test('a single-pair audit yields exactly one artifact set', () => {
  const found = collectAuroraArtifacts({ aurora: artifacts('2012 → 2026') });
  assert.equal(found.length, 1);
  assert.equal(found[0].summary.pairLabel, '2012 → 2026');
});

test('a chain audit yields one artifact set per run pair', () => {
  // A chain run merges one audit per pair; reading only the top level would
  // show no evidence at all for the sessions that need it most.
  const found = collectAuroraArtifacts({
    pairs: [
      { aurora: artifacts('2012 → 2019') },
      {},
      { aurora: artifacts('2019 → 2026') },
    ],
  });
  assert.deepEqual(
    found.map((item) => item.summary.pairLabel),
    ['2012 → 2019', '2019 → 2026'],
  );
});

test('an audit from any other strategy contributes nothing', () => {
  assert.deepEqual(collectAuroraArtifacts(undefined), []);
  assert.deepEqual(collectAuroraArtifacts({}), []);
  assert.deepEqual(collectAuroraArtifacts({ pairs: [{}, {}] }), []);
});

test('every operating mode the engine can select has an operator-facing name', () => {
  for (const mode of [
    'M1_STANDARD', 'M2_SEVERE_DRIFT', 'M3_SPARSE_ANCHOR', 'M4_CROSS_TECH',
    'M5_STRUCTURAL_CHANGE', 'M6_MULTI_RUN', 'M7_PATTERN_RESCUE',
  ]) {
    assert.ok(AURORA_MODE_LABELS[mode], mode);
  }
});

test('unavailable evidence reads as unknown, never as zero', () => {
  assert.equal(formatPercent(null), '—');
  assert.equal(formatPercent(undefined), '—');
  assert.equal(formatPercent(0), '0%');
  assert.equal(formatMetres(null), '—');
  assert.equal(formatMetres(0), '0.00 m');
});
