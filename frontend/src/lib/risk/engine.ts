import {
  DEFAULT_DATA_QUALITY_DOMAIN_WEIGHTS,
  DEFAULT_EVIDENCE_WEIGHTS,
  DEFAULT_RISK_BANDS,
  RISK_FORMULAS,
  RISK_LIMITATIONS,
  RISK_METHOD_ID,
  RISK_METHOD_VERSION,
} from './constants.ts';
import {
  bandFor,
  cloneInput,
  evidenceQualityIndex,
  normalizeScore,
  normalizeWeightRecord,
  weightedMean,
} from './math.ts';
import type {
  EvidenceQualityInput,
  LinePipeRiskInput,
  LinePipeRiskResult,
  NormalizedRiskFactor,
  RiskDimensionResult,
  RiskFactorInput,
  RiskModelOptions,
} from './types.ts';
import { validateLinePipeRiskInput, validateRiskModelOptions } from './validation.ts';

interface ResolvedOptions {
  bands: NonNullable<RiskModelOptions['bands']>;
  evidenceDimensionWeights: EvidenceQualityInput;
  dataQualityDomainWeights: NonNullable<RiskModelOptions['dataQualityDomainWeights']>;
}

function resolveOptions(options: RiskModelOptions = {}): ResolvedOptions {
  return {
    bands: options.bands ?? DEFAULT_RISK_BANDS,
    evidenceDimensionWeights: options.evidenceDimensionWeights ?? DEFAULT_EVIDENCE_WEIGHTS,
    dataQualityDomainWeights:
      options.dataQualityDomainWeights ?? DEFAULT_DATA_QUALITY_DOMAIN_WEIGHTS,
  };
}

function rawWeightRecord(factors: readonly RiskFactorInput[]): Record<string, number> {
  return Object.fromEntries(factors.map((factor) => [factor.id, factor.weight]));
}

function buildDimension(
  factors: readonly RiskFactorInput[],
  evidenceWeights: EvidenceQualityInput,
): RiskDimensionResult {
  const rawWeights = factors.map((factor) => factor.weight);
  const normalizedWeightById = normalizeWeightRecord(rawWeightRecord(factors));
  const normalizedFactors: NormalizedRiskFactor[] = factors.map((factor) => {
    const lower = normalizeScore(factor.uncertainty.lower, factor.unit);
    const upper = normalizeScore(factor.uncertainty.upper, factor.unit);
    return {
      id: factor.id,
      ...(factor.label === undefined ? {} : { label: factor.label }),
      ...(factor.sourceReference === undefined
        ? {}
        : { sourceReference: factor.sourceReference }),
      rawValue: factor.value,
      rawUnit: factor.unit,
      rawWeight: factor.weight,
      normalizedWeight: normalizedWeightById[factor.id],
      normalizedValue: normalizeScore(factor.value, factor.unit),
      normalizedInterval: { lower, upper },
      evidenceQualityIndex: evidenceQualityIndex(factor.evidence, evidenceWeights),
      inputUncertaintyWidth: upper - lower,
    };
  });

  return {
    index: weightedMean(
      normalizedFactors.map((factor) => factor.normalizedValue),
      rawWeights,
    ),
    interval: {
      lower: weightedMean(
        normalizedFactors.map((factor) => factor.normalizedInterval.lower),
        rawWeights,
      ),
      upper: weightedMean(
        normalizedFactors.map((factor) => factor.normalizedInterval.upper),
        rawWeights,
      ),
    },
    dataQualityIndex: weightedMean(
      normalizedFactors.map((factor) => factor.evidenceQualityIndex),
      rawWeights,
    ),
    inputUncertaintyIndex: weightedMean(
      normalizedFactors.map((factor) => factor.inputUncertaintyWidth),
      rawWeights,
    ),
    factors: normalizedFactors,
  };
}

export function assessLinePipeRisk(
  input: LinePipeRiskInput,
  options: RiskModelOptions = {},
): LinePipeRiskResult {
  validateLinePipeRiskInput(input);
  validateRiskModelOptions(options);
  const resolved = resolveOptions(options);
  const normalizedEvidenceWeights = normalizeWeightRecord(resolved.evidenceDimensionWeights);
  const evidenceWeights = normalizedEvidenceWeights;
  const normalizedDomainWeights = normalizeWeightRecord(resolved.dataQualityDomainWeights);
  const likelihood = buildDimension(input.likelihoodFactors, evidenceWeights);
  const consequence = buildDimension(input.consequenceFactors, evidenceWeights);
  const riskIndex = likelihood.index * consequence.index;
  const riskInterval = {
    lower: likelihood.interval.lower * consequence.interval.lower,
    upper: likelihood.interval.upper * consequence.interval.upper,
  };
  const dataQualityIndex = weightedMean(
    [likelihood.dataQualityIndex, consequence.dataQualityIndex],
    [normalizedDomainWeights.likelihood, normalizedDomainWeights.consequence],
  );
  const inputUncertaintyIndex = weightedMean(
    [likelihood.inputUncertaintyIndex, consequence.inputUncertaintyIndex],
    [normalizedDomainWeights.likelihood, normalizedDomainWeights.consequence],
  );

  return {
    segmentId: input.segmentId,
    scenarioId: input.scenarioId,
    likelihood,
    consequence,
    risk: {
      index: riskIndex,
      interval: riskInterval,
      band: bandFor(riskIndex, resolved.bands),
      intervalBands: {
        lower: bandFor(riskInterval.lower, resolved.bands),
        upper: bandFor(riskInterval.upper, resolved.bands),
      },
    },
    confidence: {
      dataQualityIndex,
      inputUncertaintyIndex,
      decisionConfidenceIndex: dataQualityIndex * (1 - inputUncertaintyIndex),
    },
    provenance: {
      method: {
        id: RISK_METHOD_ID,
        version: RISK_METHOD_VERSION,
        modelClass: 'RELATIVE_LINE_PIPE_RISK_INDEX',
        equation: 'riskIndex = likelihoodIndex * consequenceIndex',
      },
      input: cloneInput(input),
      weights: {
        likelihoodFactors: normalizeWeightRecord(rawWeightRecord(input.likelihoodFactors)),
        consequenceFactors: normalizeWeightRecord(rawWeightRecord(input.consequenceFactors)),
        evidenceDimensions: evidenceWeights,
        dataQualityDomains: normalizedDomainWeights,
        supplied: {
          likelihoodFactors: rawWeightRecord(input.likelihoodFactors),
          consequenceFactors: rawWeightRecord(input.consequenceFactors),
          evidenceDimensions: { ...resolved.evidenceDimensionWeights },
          dataQualityDomains: { ...resolved.dataQualityDomainWeights },
        },
      },
      bands: resolved.bands.map((band) => ({ ...band })),
      formulas: [...RISK_FORMULAS],
      limitations: [...RISK_LIMITATIONS],
    },
  };
}
