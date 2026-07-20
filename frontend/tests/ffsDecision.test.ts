import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFfsDecision } from '../src/lib/ffs/assessmentDecision.ts';
import type { FfsResult } from '../src/lib/ffs/types.ts';

const base = {
  ld: 100, section: 'S1', surface: 'External', maxDepthPct: 40, length: 100, width: 30,
  orient: '06:00', wall: 10, crDepth: 0.2, crLength: 1, df: 0.72, od: 508, smys: 415,
  p0: 6, SF: 1.3889, d: 4, dt: 0.4, z: 1.9685, M: 1.4, sflow: 484, Sf: 350,
  Pf: 13.78, So: 152.4, safePressure: 9.92, ERF: 0.61, acceptance: 'Acceptable',
  branch: 'z≤50', expectedLife: 18, yearService: '2044-01-01', failureCriteria: 'ERF = 1',
  atFailure_ERF: 1, atFailure_depth: 76, atFailure_Sf: 210, method: 'modified', saMode: 'smys69',
} satisfies FfsResult;

test('builds a scheduled decision with provenance and conservative sensitivity', () => {
  const decision = buildFfsDecision({
    nominal: base,
    conservative: { ...base, ERF: 0.82, safePressure: 7.4, expectedLife: 8 },
    provenance: { sourceRunId: 'run-2', sourceFeatureKey: 'feature-9', calculationVersion: '1.0.0' },
    confidence: { dataQuality: 0.9, alignment: 0.85, measurement: 0.8 },
  });
  assert.equal(decision.responseCategory, 'scheduled');
  assert.equal(decision.sensitivity.expectedLifeDeltaYears, -10);
  assert.equal(decision.provenance.methodEdition, 'ASME B31G-2023');
  assert.equal(decision.requiresEngineeringReview, true);
});

test('fails closed for an unacceptable or low-confidence case', () => {
  const immediate = buildFfsDecision({
    nominal: { ...base, ERF: 1.02, acceptance: 'Un-Acceptable', expectedLife: 0 },
    provenance: { sourceRunId: 'r', sourceFeatureKey: 'f', calculationVersion: '1' },
    confidence: { dataQuality: 0.4, alignment: 0.5, measurement: 0.5 },
  });
  assert.equal(immediate.responseCategory, 'immediate');
  assert.match(immediate.explanation.join(' '), /confidence/i);
});
