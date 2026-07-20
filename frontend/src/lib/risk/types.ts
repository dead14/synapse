export type NormalizedScoreUnit = 'fraction' | 'percent';

export type RiskBandId = 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';

export interface EvidenceQualityInput {
  completeness: number;
  verification: number;
  recency: number;
}

export interface RiskFactorInput {
  id: string;
  label?: string;
  value: number;
  unit: NormalizedScoreUnit;
  weight: number;
  uncertainty: {
    lower: number;
    upper: number;
  };
  evidence: EvidenceQualityInput;
  sourceReference?: string;
}

export interface LinePipeRiskInput {
  segmentId: string;
  scenarioId: string;
  likelihoodFactors: readonly RiskFactorInput[];
  consequenceFactors: readonly RiskFactorInput[];
}

export interface RiskBandDefinition {
  id: RiskBandId;
  upperBoundInclusive: number;
}

export interface RiskModelOptions {
  bands?: readonly RiskBandDefinition[];
  evidenceDimensionWeights?: EvidenceQualityInput;
  dataQualityDomainWeights?: {
    likelihood: number;
    consequence: number;
  };
}

export interface NormalizedRiskFactor {
  id: string;
  label?: string;
  sourceReference?: string;
  rawValue: number;
  rawUnit: NormalizedScoreUnit;
  rawWeight: number;
  normalizedWeight: number;
  normalizedValue: number;
  normalizedInterval: {
    lower: number;
    upper: number;
  };
  evidenceQualityIndex: number;
  inputUncertaintyWidth: number;
}

export interface RiskDimensionResult {
  index: number;
  interval: {
    lower: number;
    upper: number;
  };
  dataQualityIndex: number;
  inputUncertaintyIndex: number;
  factors: readonly NormalizedRiskFactor[];
}

export interface LinePipeRiskResult {
  segmentId: string;
  scenarioId: string;
  likelihood: RiskDimensionResult;
  consequence: RiskDimensionResult;
  risk: {
    index: number;
    interval: {
      lower: number;
      upper: number;
    };
    band: RiskBandDefinition;
    intervalBands: {
      lower: RiskBandDefinition;
      upper: RiskBandDefinition;
    };
  };
  confidence: {
    dataQualityIndex: number;
    inputUncertaintyIndex: number;
    decisionConfidenceIndex: number;
  };
  provenance: {
    method: {
      id: 'SYNAPSE_LINE_PIPE_RELATIVE_RISK_INDEX';
      version: string;
      modelClass: 'RELATIVE_LINE_PIPE_RISK_INDEX';
      equation: 'riskIndex = likelihoodIndex * consequenceIndex';
    };
    input: LinePipeRiskInput;
    weights: {
      likelihoodFactors: Readonly<Record<string, number>>;
      consequenceFactors: Readonly<Record<string, number>>;
      evidenceDimensions: EvidenceQualityInput;
      dataQualityDomains: {
        likelihood: number;
        consequence: number;
      };
      supplied: {
        likelihoodFactors: Readonly<Record<string, number>>;
        consequenceFactors: Readonly<Record<string, number>>;
        evidenceDimensions: EvidenceQualityInput;
        dataQualityDomains: {
          likelihood: number;
          consequence: number;
        };
      };
    };
    bands: readonly RiskBandDefinition[];
    formulas: readonly string[];
    limitations: readonly string[];
  };
}

export type ScenarioRiskDirection = 'REDUCED' | 'UNCHANGED' | 'INCREASED';

export interface LinePipeScenarioComparisonResult {
  baseline: LinePipeRiskResult;
  alternatives: readonly {
    assessment: LinePipeRiskResult;
    direction: ScenarioRiskDirection;
    delta: {
      riskIndex: number;
      riskIntervalLower: number;
      riskIntervalUpper: number;
      relativeChangeFraction: number | null;
      riskReductionFraction: number | null;
      dataQualityIndex: number;
      decisionConfidenceIndex: number;
      bandRank: number;
    };
  }[];
  provenance: {
    comparisonMethod: 'ALTERNATIVE_MINUS_BASELINE';
    methodVersion: string;
    baselineScenarioId: string;
    alternativeScenarioIds: readonly string[];
    definition: string;
  };
}

export interface LinePipeRepairPriorityResult {
  candidates: readonly {
    rank: number;
    priorityIndex: number;
    assessment: LinePipeRiskResult;
    rationale: readonly string[];
  }[];
  provenance: {
    orderingMethod: 'CONSERVATIVE_UPPER_BOUND';
    methodVersion: string;
    comparator: readonly string[];
    limitations: readonly string[];
  };
}
