import type { FfsResult } from './types.ts';

export type FfsResponseCategory = 'immediate' | 'scheduled' | 'monitor' | 'engineering_review';

export interface FfsDecisionInput {
  nominal: FfsResult;
  conservative?: FfsResult;
  provenance: {
    sourceRunId: string;
    sourceFeatureKey: string;
    calculationVersion: string;
  };
  confidence: {
    dataQuality: number;
    alignment: number;
    measurement: number;
  };
}

function fraction(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
  return value;
}

export function buildFfsDecision(input: FfsDecisionInput) {
  const confidence = {
    dataQuality: fraction(input.confidence.dataQuality, 'dataQuality'),
    alignment: fraction(input.confidence.alignment, 'alignment'),
    measurement: fraction(input.confidence.measurement, 'measurement'),
  };
  const overallConfidence = Math.min(confidence.dataQuality, confidence.alignment, confidence.measurement);
  const governing = input.conservative ?? input.nominal;
  let responseCategory: FfsResponseCategory;
  if (governing.acceptance === 'Un-Acceptable' || governing.ERF >= 1 || governing.expectedLife <= 1) {
    responseCategory = 'immediate';
  } else if (overallConfidence < 0.7) {
    responseCategory = 'engineering_review';
  } else if (governing.ERF >= 0.8 || governing.expectedLife <= 10) {
    responseCategory = 'scheduled';
  } else {
    responseCategory = 'monitor';
  }

  const explanation = [
    `Governing ERF is ${governing.ERF.toFixed(3)} and safe operating pressure is ${governing.safePressure.toFixed(3)} MPa.`,
    `Remaining-life projection is ${governing.expectedLife.toFixed(2)} years, governed by ${governing.failureCriteria}.`,
  ];
  if (overallConfidence < 0.7) {
    explanation.push(`Overall confidence is ${overallConfidence.toFixed(2)}; engineering review is mandatory before action.`);
  }
  if (!input.conservative) {
    explanation.push('No conservative tolerance scenario was supplied.');
  }

  return {
    responseCategory,
    requiresEngineeringReview: true,
    nominal: input.nominal,
    conservative: input.conservative ?? null,
    sensitivity: input.conservative ? {
      erfDelta: input.conservative.ERF - input.nominal.ERF,
      safePressureDeltaMpa: input.conservative.safePressure - input.nominal.safePressure,
      expectedLifeDeltaYears: input.conservative.expectedLife - input.nominal.expectedLife,
    } : null,
    confidence: { ...confidence, overall: overallConfidence },
    explanation,
    missingData: input.conservative ? [] : ['Measurement-tolerance conservative scenario'],
    provenance: {
      ...input.provenance,
      method: input.nominal.method === 'modified' ? 'Modified B31G' : 'Original B31G',
      methodEdition: 'ASME B31G-2023',
      units: 'SI',
      validationStatus: 'screening-implementation',
    },
  };
}
