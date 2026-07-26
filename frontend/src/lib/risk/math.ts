import type {
  EvidenceQualityInput,
  LinePipeRiskInput,
  RiskBandDefinition,
  RiskFactorInput,
} from './types.ts';

export function normalizeScore(value: number, unit: 'fraction' | 'percent'): number {
  return unit === 'percent' ? value / 100 : value;
}

export function normalizeWeightRecord<T extends object>(
  weights: T,
): { [Key in keyof T]: number } {
  const entries = Object.entries(weights as Record<string, number>);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  return Object.fromEntries(
    entries.map(([id, value]) => [id, value / total]),
  ) as { [Key in keyof T]: number };
}

export function weightedMean(values: readonly number[], weights: readonly number[]): number {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  return values.reduce((sum, value, index) => sum + value * weights[index], 0) / totalWeight;
}

export function evidenceQualityIndex(
  evidence: EvidenceQualityInput,
  weights: EvidenceQualityInput,
): number {
  return weightedMean(
    [evidence.completeness, evidence.verification, evidence.recency],
    [weights.completeness, weights.verification, weights.recency],
  );
}

export function bandFor(
  value: number,
  bands: readonly RiskBandDefinition[],
): RiskBandDefinition {
  return bands.find((band) => value <= band.upperBoundInclusive) ?? bands[bands.length - 1];
}

function cloneFactor(factor: RiskFactorInput): RiskFactorInput {
  return {
    ...factor,
    uncertainty: { ...factor.uncertainty },
    evidence: { ...factor.evidence },
  };
}

export function cloneInput(input: LinePipeRiskInput): LinePipeRiskInput {
  return {
    segmentId: input.segmentId,
    scenarioId: input.scenarioId,
    likelihoodFactors: input.likelihoodFactors.map(cloneFactor),
    consequenceFactors: input.consequenceFactors.map(cloneFactor),
  };
}
