import { RISK_METHOD_VERSION } from './constants.ts';
import { assessLinePipeRisk } from './engine.ts';
import { RiskModelValidationError } from './errors.ts';
import type {
  LinePipeRepairPriorityResult,
  LinePipeRiskInput,
  LinePipeRiskResult,
  LinePipeScenarioComparisonResult,
  RiskModelOptions,
  ScenarioRiskDirection,
} from './types.ts';

function requireNonEmptyArray<T>(value: readonly T[], path: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RiskModelValidationError(path, 'must contain at least one item');
  }
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function directionFor(delta: number): ScenarioRiskDirection {
  if (delta < 0) return 'REDUCED';
  if (delta > 0) return 'INCREASED';
  return 'UNCHANGED';
}

function bandRank(result: LinePipeRiskResult): number {
  return result.provenance.bands.findIndex((band) => band.id === result.risk.band.id);
}

export function compareLinePipeRiskScenarios(
  baselineInput: LinePipeRiskInput,
  alternativeInputs: readonly LinePipeRiskInput[],
  options: RiskModelOptions = {},
): LinePipeScenarioComparisonResult {
  requireNonEmptyArray(alternativeInputs, 'alternativeInputs');
  const baseline = assessLinePipeRisk(baselineInput, options);
  const scenarioIds = new Set([baseline.scenarioId]);

  const alternatives = alternativeInputs.map((input, index) => {
    if (input.segmentId !== baseline.segmentId) {
      throw new RiskModelValidationError(
        `alternativeInputs[${index}].segmentId`,
        'all scenarios must use the same segmentId as the baseline',
      );
    }
    if (scenarioIds.has(input.scenarioId)) {
      throw new RiskModelValidationError(
        `alternativeInputs[${index}].scenarioId`,
        'scenarioId values must be unique within a comparison',
      );
    }
    scenarioIds.add(input.scenarioId);

    const assessment = assessLinePipeRisk(input, options);
    const riskDelta = assessment.risk.index - baseline.risk.index;
    const relativeChange = baseline.risk.index === 0
      ? null
      : riskDelta / baseline.risk.index;

    return {
      assessment,
      direction: directionFor(riskDelta),
      delta: {
        riskIndex: riskDelta,
        riskIntervalLower: assessment.risk.interval.lower - baseline.risk.interval.lower,
        riskIntervalUpper: assessment.risk.interval.upper - baseline.risk.interval.upper,
        relativeChangeFraction: relativeChange,
        riskReductionFraction: relativeChange === null ? null : -relativeChange,
        dataQualityIndex:
          assessment.confidence.dataQualityIndex - baseline.confidence.dataQualityIndex,
        decisionConfidenceIndex:
          assessment.confidence.decisionConfidenceIndex -
          baseline.confidence.decisionConfidenceIndex,
        bandRank: bandRank(assessment) - bandRank(baseline),
      },
    };
  });

  return {
    baseline,
    alternatives,
    provenance: {
      comparisonMethod: 'ALTERNATIVE_MINUS_BASELINE',
      methodVersion: RISK_METHOD_VERSION,
      baselineScenarioId: baseline.scenarioId,
      alternativeScenarioIds: alternatives.map((item) => item.assessment.scenarioId),
      definition: 'Signed delta equals alternative assessment minus baseline assessment.',
    },
  };
}

export function prioritizeLinePipeRepairCandidates(
  candidateInputs: readonly LinePipeRiskInput[],
  options: RiskModelOptions = {},
): LinePipeRepairPriorityResult {
  requireNonEmptyArray(candidateInputs, 'candidateInputs');
  const keys = new Set<string>();
  const assessments = candidateInputs.map((input, index) => {
    const key = `${input.segmentId}\u0000${input.scenarioId}`;
    if (keys.has(key)) {
      throw new RiskModelValidationError(
        `candidateInputs[${index}]`,
        'duplicate segmentId/scenarioId candidate key',
      );
    }
    keys.add(key);
    return assessLinePipeRisk(input, options);
  });

  const ordered = [...assessments].sort((left, right) => {
    const upperBound = right.risk.interval.upper - left.risk.interval.upper;
    if (upperBound !== 0) return upperBound;
    const pointEstimate = right.risk.index - left.risk.index;
    if (pointEstimate !== 0) return pointEstimate;
    const confidence =
      left.confidence.decisionConfidenceIndex - right.confidence.decisionConfidenceIndex;
    if (confidence !== 0) return confidence;
    const segment = compareText(left.segmentId, right.segmentId);
    if (segment !== 0) return segment;
    return compareText(left.scenarioId, right.scenarioId);
  });

  return {
    candidates: ordered.map((assessment, index) => ({
      rank: index + 1,
      priorityIndex: assessment.risk.interval.upper,
      assessment,
      rationale: [
        `Conservative risk upper bound ${assessment.risk.interval.upper}.`,
        `Point risk index ${assessment.risk.index}.`,
        `Decision confidence index ${assessment.confidence.decisionConfidenceIndex}.`,
      ],
    })),
    provenance: {
      orderingMethod: 'CONSERVATIVE_UPPER_BOUND',
      methodVersion: RISK_METHOD_VERSION,
      comparator: [
        'risk interval upper bound descending',
        'risk point estimate descending',
        'decision confidence ascending',
        'segmentId ascending',
        'scenarioId ascending',
      ],
      limitations: [
        'This is a conservative screening order; final repair decisions require engineering review.',
        'Mandatory response criteria, defect-specific assessment, and operational constraints take precedence.',
      ],
    },
  };
}

