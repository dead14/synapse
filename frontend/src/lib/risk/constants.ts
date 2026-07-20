import type { EvidenceQualityInput, RiskBandDefinition } from './types.ts';

export const RISK_METHOD_ID = 'SYNAPSE_LINE_PIPE_RELATIVE_RISK_INDEX' as const;
export const RISK_METHOD_VERSION = '1.0.0';

export const DEFAULT_RISK_BANDS: readonly RiskBandDefinition[] = [
  { id: 'LOW', upperBoundInclusive: 0.1 },
  { id: 'MODERATE', upperBoundInclusive: 0.25 },
  { id: 'HIGH', upperBoundInclusive: 0.5 },
  { id: 'VERY_HIGH', upperBoundInclusive: 1 },
];

export const DEFAULT_EVIDENCE_WEIGHTS: EvidenceQualityInput = {
  completeness: 0.4,
  verification: 0.4,
  recency: 0.2,
};

export const DEFAULT_DATA_QUALITY_DOMAIN_WEIGHTS = {
  likelihood: 0.5,
  consequence: 0.5,
};

export const RISK_FORMULAS = [
  'weightedMean(values, weights) = sum(value_i * weight_i) / sum(weight_i)',
  'riskIndex = likelihoodIndex * consequenceIndex',
  'riskInterval = [likelihoodLower * consequenceLower, likelihoodUpper * consequenceUpper]',
  'dataQualityIndex = weightedMean(likelihoodDataQuality, consequenceDataQuality)',
  'inputUncertaintyIndex = weightedMean(normalized factor interval widths)',
  'decisionConfidenceIndex = dataQualityIndex * (1 - inputUncertaintyIndex)',
] as const;

export const RISK_LIMITATIONS = [
  'This relative index is not an annual probability of failure or event frequency.',
  'The qualitative bands are an internal screening policy, not a regulatory repair criterion.',
  'This method does not implement or claim compliance with API 580 or API 581.',
  'Threat-specific engineering methods must normalize factor scores before this core is called.',
  'Uncertainty bounds are deterministic intervals, not statistical confidence intervals.',
] as const;

