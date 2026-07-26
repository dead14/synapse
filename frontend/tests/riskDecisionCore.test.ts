import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessLinePipeRisk,
  compareLinePipeRiskScenarios,
  prioritizeLinePipeRepairCandidates,
  RiskModelValidationError,
} from '../src/lib/risk/index.ts';

const completeEvidence = {
  completeness: 1,
  verification: 1,
  recency: 1,
};

function factor(
  id: string,
  value: number,
  options: {
    unit?: 'fraction' | 'percent';
    weight?: number;
    lower?: number;
    upper?: number;
    evidence?: typeof completeEvidence;
  } = {},
) {
  return {
    id,
    value,
    unit: options.unit ?? 'fraction',
    weight: options.weight ?? 1,
    uncertainty: {
      lower: options.lower ?? value,
      upper: options.upper ?? value,
    },
    evidence: options.evidence ?? completeEvidence,
  };
}

function singleFactorAssessment(likelihood: number, consequence: number) {
  return {
    segmentId: 'SEG-001',
    scenarioId: 'CURRENT',
    likelihoodFactors: [factor('LIKELIHOOD', likelihood)],
    consequenceFactors: [factor('CONSEQUENCE', consequence)],
  };
}

function assertApproximately(actual: number, expected: number, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test('computes a transparent weighted likelihood x consequence relative risk index', () => {
  const input = {
    segmentId: 'SEG-42',
    scenarioId: 'CURRENT',
    likelihoodFactors: [
      factor('CORROSION', 20, {
        unit: 'percent',
        weight: 1,
        lower: 10,
        upper: 30,
        evidence: { completeness: 1, verification: 0.5, recency: 0.5 },
      }),
      factor('GEOHAZARD', 0.8, {
        weight: 3,
        lower: 0.7,
        upper: 0.9,
        evidence: { completeness: 0.5, verification: 0.5, recency: 0.5 },
      }),
    ],
    consequenceFactors: [
      factor('PEOPLE_ENVIRONMENT_SERVICE', 0.4, {
        weight: 2,
        lower: 0.3,
        upper: 0.5,
        evidence: { completeness: 0.75, verification: 1, recency: 0.5 },
      }),
    ],
  };

  const result = assessLinePipeRisk(input);

  assertApproximately(result.likelihood.index, 0.65);
  assertApproximately(result.likelihood.interval.lower, 0.55);
  assertApproximately(result.likelihood.interval.upper, 0.75);
  assertApproximately(result.consequence.index, 0.4);
  assertApproximately(result.consequence.interval.lower, 0.3);
  assertApproximately(result.consequence.interval.upper, 0.5);
  assertApproximately(result.risk.index, 0.26);
  assertApproximately(result.risk.interval.lower, 0.165);
  assertApproximately(result.risk.interval.upper, 0.375);
  assert.equal(result.risk.band.id, 'HIGH');
  assert.equal(result.risk.intervalBands.lower.id, 'MODERATE');
  assert.equal(result.risk.intervalBands.upper.id, 'HIGH');

  assertApproximately(result.confidence.dataQualityIndex, 0.675);
  assertApproximately(result.confidence.inputUncertaintyIndex, 0.2);
  assertApproximately(result.confidence.decisionConfidenceIndex, 0.54);
});

test('returns every raw input, normalized factor weight, model weight, formula, and method version in provenance', () => {
  const input = singleFactorAssessment(0.4, 0.5);
  const result = assessLinePipeRisk(input);

  assert.notEqual(result.provenance.input, input);
  assert.deepEqual(result.provenance.input, input);
  assert.equal(result.provenance.method.id, 'SYNAPSE_LINE_PIPE_RELATIVE_RISK_INDEX');
  assert.match(result.provenance.method.version, /^1\./);
  assert.equal(result.provenance.method.modelClass, 'RELATIVE_LINE_PIPE_RISK_INDEX');
  assert.equal(
    result.provenance.method.equation,
    'riskIndex = likelihoodIndex * consequenceIndex',
  );
  assert.equal(result.provenance.weights.likelihoodFactors.LIKELIHOOD, 1);
  assert.equal(result.provenance.weights.consequenceFactors.CONSEQUENCE, 1);
  assert.deepEqual(result.provenance.weights.evidenceDimensions, {
    completeness: 0.4,
    verification: 0.4,
    recency: 0.2,
  });
  assert.deepEqual(result.provenance.weights.dataQualityDomains, {
    likelihood: 0.5,
    consequence: 0.5,
  });
  assert.ok(result.provenance.formulas.some((formula) => formula.includes('weightedMean')));
  assert.ok(result.provenance.limitations.some((item) => /not.*probability/i.test(item)));
  assert.ok(result.provenance.limitations.some((item) => /not.*repair criterion/i.test(item)));
});

test('converts percent inputs and uncertainty bounds before calculation', () => {
  const result = assessLinePipeRisk({
    segmentId: 'SEG-PERCENT',
    scenarioId: 'CURRENT',
    likelihoodFactors: [factor('LIKELIHOOD', 50, { unit: 'percent', lower: 40, upper: 60 })],
    consequenceFactors: [factor('CONSEQUENCE', 40, { unit: 'percent', lower: 30, upper: 50 })],
  });

  assertApproximately(result.likelihood.index, 0.5);
  assert.deepEqual(result.likelihood.interval, { lower: 0.4, upper: 0.6 });
  assertApproximately(result.risk.index, 0.2);
  assert.deepEqual(result.risk.interval, { lower: 0.12, upper: 0.3 });
});

test('uses inclusive, deterministic qualitative band boundaries', () => {
  const cases = [
    { risk: 0, band: 'LOW' },
    { risk: 0.1, band: 'LOW' },
    { risk: 0.1000001, band: 'MODERATE' },
    { risk: 0.25, band: 'MODERATE' },
    { risk: 0.2500001, band: 'HIGH' },
    { risk: 0.5, band: 'HIGH' },
    { risk: 0.5000001, band: 'VERY_HIGH' },
    { risk: 1, band: 'VERY_HIGH' },
  ];

  for (const { risk, band } of cases) {
    assert.equal(assessLinePipeRisk(singleFactorAssessment(1, risk)).risk.band.id, band);
  }
});

test('accepts explicit custom band policy and returns it in provenance', () => {
  const bands = [
    { id: 'LOW' as const, upperBoundInclusive: 0.05 },
    { id: 'MODERATE' as const, upperBoundInclusive: 0.2 },
    { id: 'HIGH' as const, upperBoundInclusive: 0.4 },
    { id: 'VERY_HIGH' as const, upperBoundInclusive: 1 },
  ];

  const result = assessLinePipeRisk(singleFactorAssessment(0.5, 0.5), { bands });

  assert.equal(result.risk.band.id, 'HIGH');
  assert.deepEqual(result.provenance.bands, bands);
});

test('rejects missing factors, duplicate identifiers, invalid units, weights, values, intervals, and evidence bounds', () => {
  const valid = singleFactorAssessment(0.4, 0.5);
  const invalidInputs: Array<{ input: unknown; pattern: RegExp }> = [
    {
      input: { ...valid, likelihoodFactors: [] },
      pattern: /likelihoodFactors.*at least one/i,
    },
    {
      input: {
        ...valid,
        likelihoodFactors: [factor('DUPLICATE', 0.2), factor('DUPLICATE', 0.3)],
      },
      pattern: /duplicate/i,
    },
    {
      input: { ...valid, likelihoodFactors: [{ ...factor('L', 0.2), unit: 'mpa' }] },
      pattern: /unit/i,
    },
    {
      input: { ...valid, likelihoodFactors: [factor('L', 0.2, { weight: 0 })] },
      pattern: /weight.*greater than 0/i,
    },
    {
      input: { ...valid, likelihoodFactors: [factor('L', 1.01)] },
      pattern: /value.*0.*1/i,
    },
    {
      input: { ...valid, likelihoodFactors: [factor('L', 101, { unit: 'percent' })] },
      pattern: /value.*0.*100/i,
    },
    {
      input: { ...valid, likelihoodFactors: [factor('L', 0.5, { lower: 0.6, upper: 0.8 })] },
      pattern: /uncertainty.*contain/i,
    },
    {
      input: {
        ...valid,
        likelihoodFactors: [
          factor('L', 0.5, {
            evidence: { completeness: 1.1, verification: 1, recency: 1 },
          }),
        ],
      },
      pattern: /completeness.*0.*1/i,
    },
  ];

  for (const { input, pattern } of invalidInputs) {
    assert.throws(
      () => assessLinePipeRisk(input as never),
      (error: unknown) => error instanceof RiskModelValidationError && pattern.test(error.message),
    );
  }
});

test('rejects every non-finite numeric field at the public boundary', () => {
  const valid = singleFactorAssessment(0.4, 0.5);
  const invalidValues = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

  for (const invalid of invalidValues) {
    const fields = [
      { ...factor('L', 0.4), value: invalid },
      { ...factor('L', 0.4), weight: invalid },
      { ...factor('L', 0.4), uncertainty: { lower: invalid, upper: 0.5 } },
      {
        ...factor('L', 0.4),
        evidence: { completeness: invalid, verification: 1, recency: 1 },
      },
    ];

    for (const candidate of fields) {
      assert.throws(
        () => assessLinePipeRisk({ ...valid, likelihoodFactors: [candidate] } as never),
        (error: unknown) =>
          error instanceof RiskModelValidationError && /finite/i.test(error.message),
      );
    }
  }
});

test('rejects malformed band and data-quality weight policies', () => {
  const input = singleFactorAssessment(0.4, 0.5);

  assert.throws(
    () => assessLinePipeRisk(input, {
      bands: [
        { id: 'LOW', upperBoundInclusive: 0.2 },
        { id: 'MODERATE', upperBoundInclusive: 0.1 },
        { id: 'HIGH', upperBoundInclusive: 0.5 },
        { id: 'VERY_HIGH', upperBoundInclusive: 1 },
      ],
    }),
    /strictly increasing/i,
  );

  assert.throws(
    () => assessLinePipeRisk(input, {
      evidenceDimensionWeights: { completeness: 0, verification: 0, recency: 0 },
    }),
    /weight.*greater than 0/i,
  );
});

test('compares mitigation scenarios against one baseline with signed and relative deltas', () => {
  const baseline = {
    ...singleFactorAssessment(0.8, 0.5),
    segmentId: 'SEG-SCENARIO',
    scenarioId: 'CURRENT',
  };
  const mitigated = {
    ...singleFactorAssessment(0.4, 0.5),
    segmentId: 'SEG-SCENARIO',
    scenarioId: 'COATING_REHABILITATION',
  };
  const increased = {
    ...singleFactorAssessment(0.9, 0.6),
    segmentId: 'SEG-SCENARIO',
    scenarioId: 'DEFERRED_ACTION',
  };

  const comparison = compareLinePipeRiskScenarios(baseline, [mitigated, increased]);

  assertApproximately(comparison.baseline.risk.index, 0.4);
  assert.deepEqual(
    comparison.alternatives.map((item) => item.assessment.scenarioId),
    ['COATING_REHABILITATION', 'DEFERRED_ACTION'],
  );
  assert.equal(comparison.alternatives[0].direction, 'REDUCED');
  assertApproximately(comparison.alternatives[0].delta.riskIndex, -0.2);
  assertApproximately(comparison.alternatives[0].delta.relativeChangeFraction ?? 0, -0.5);
  assertApproximately(comparison.alternatives[0].delta.riskReductionFraction ?? 0, 0.5);
  assert.equal(comparison.alternatives[0].delta.bandRank, -1);
  assert.equal(comparison.alternatives[1].direction, 'INCREASED');
  assertApproximately(comparison.alternatives[1].delta.riskIndex, 0.14);
  assert.equal(comparison.provenance.comparisonMethod, 'ALTERNATIVE_MINUS_BASELINE');
  assert.deepEqual(comparison.provenance.alternativeScenarioIds, [
    'COATING_REHABILITATION',
    'DEFERRED_ACTION',
  ]);
});

test('reports null relative deltas when the baseline risk index is zero', () => {
  const baseline = {
    ...singleFactorAssessment(0, 0.5),
    segmentId: 'SEG-ZERO',
    scenarioId: 'CURRENT',
  };
  const alternative = {
    ...singleFactorAssessment(0.1, 0.5),
    segmentId: 'SEG-ZERO',
    scenarioId: 'ALTERNATIVE',
  };

  const result = compareLinePipeRiskScenarios(baseline, [alternative]);

  assert.equal(result.alternatives[0].delta.relativeChangeFraction, null);
  assert.equal(result.alternatives[0].delta.riskReductionFraction, null);
});

test('rejects scenario comparisons across segments or with duplicate scenario identifiers', () => {
  const baseline = singleFactorAssessment(0.5, 0.5);

  assert.throws(
    () => compareLinePipeRiskScenarios(baseline, [{
      ...singleFactorAssessment(0.4, 0.5),
      segmentId: 'OTHER-SEGMENT',
      scenarioId: 'MITIGATED',
    }]),
    /same segmentId/i,
  );

  assert.throws(
    () => compareLinePipeRiskScenarios(baseline, [{
      ...singleFactorAssessment(0.4, 0.5),
      scenarioId: baseline.scenarioId,
    }]),
    /scenarioId.*unique/i,
  );
});

test('orders repair candidates conservatively by upper risk bound with deterministic tie-breakers', () => {
  const uncertain = {
    segmentId: 'SEG-A',
    scenarioId: 'CURRENT',
    likelihoodFactors: [factor('L', 0.8, { lower: 0.7, upper: 0.9 })],
    consequenceFactors: [factor('C', 0.5, { lower: 0.4, upper: 0.6 })],
  };
  const higherPointButNarrow = {
    ...singleFactorAssessment(0.9, 0.5),
    segmentId: 'SEG-B',
  };
  const tiedLaterId = {
    ...singleFactorAssessment(0.9, 0.5),
    segmentId: 'SEG-C',
  };
  const low = {
    ...singleFactorAssessment(0.2, 0.2),
    segmentId: 'SEG-D',
  };
  const input = [low, tiedLaterId, higherPointButNarrow, uncertain];
  const snapshot = JSON.stringify(input);

  const result = prioritizeLinePipeRepairCandidates(input);

  assert.equal(JSON.stringify(input), snapshot, 'the caller input must not be mutated');
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.assessment.segmentId),
    ['SEG-A', 'SEG-B', 'SEG-C', 'SEG-D'],
  );
  assert.deepEqual(result.candidates.map((candidate) => candidate.rank), [1, 2, 3, 4]);
  assertApproximately(result.candidates[0].priorityIndex, 0.54);
  assert.equal(result.provenance.orderingMethod, 'CONSERVATIVE_UPPER_BOUND');
  assert.match(result.provenance.comparator.join(' '), /upper.*point.*confidence.*segmentId/i);
  assert.ok(result.provenance.limitations.some((item) => /engineering review/i.test(item)));
});

test('rejects empty or duplicate repair candidate keys', () => {
  assert.throws(() => prioritizeLinePipeRepairCandidates([]), /at least one/i);
  const candidate = singleFactorAssessment(0.5, 0.5);
  assert.throws(
    () => prioritizeLinePipeRepairCandidates([candidate, candidate]),
    /duplicate.*segmentId.*scenarioId/i,
  );
});

test('preserves mathematical bounds and monotonicity over a deterministic score grid', () => {
  let previousRisk = -1;
  for (let likelihoodStep = 0; likelihoodStep <= 20; likelihoodStep += 1) {
    const likelihood = likelihoodStep / 20;
    const result = assessLinePipeRisk(singleFactorAssessment(likelihood, 0.75));

    assert.ok(result.risk.index >= 0 && result.risk.index <= 1);
    assert.ok(result.risk.interval.lower <= result.risk.index);
    assert.ok(result.risk.index <= result.risk.interval.upper);
    assert.ok(result.confidence.dataQualityIndex >= 0 && result.confidence.dataQualityIndex <= 1);
    assert.ok(
      result.confidence.decisionConfidenceIndex >= 0 &&
      result.confidence.decisionConfidenceIndex <= 1,
    );
    assert.ok(result.risk.index >= previousRisk, 'risk must not fall when likelihood rises');
    previousRisk = result.risk.index;
  }
});

test('weighted assessment is invariant to factor order', () => {
  const likelihoodFactors = [
    factor('A', 0.2, { weight: 1 }),
    factor('B', 0.7, { weight: 3 }),
    factor('C', 0.9, { weight: 2 }),
  ];
  const input = {
    segmentId: 'SEG-PERMUTATION',
    scenarioId: 'CURRENT',
    likelihoodFactors,
    consequenceFactors: [factor('CONSEQUENCE', 0.6)],
  };

  const forward = assessLinePipeRisk(input);
  const reverse = assessLinePipeRisk({ ...input, likelihoodFactors: [...likelihoodFactors].reverse() });

  assertApproximately(forward.likelihood.index, reverse.likelihood.index);
  assertApproximately(forward.risk.index, reverse.risk.index);
  assertApproximately(
    forward.confidence.decisionConfidenceIndex,
    reverse.confidence.decisionConfidenceIndex,
  );
});
