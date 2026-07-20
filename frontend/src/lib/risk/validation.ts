import { RiskModelValidationError } from './errors.ts';
import type {
  LinePipeRiskInput,
  RiskBandDefinition,
  RiskFactorInput,
  RiskModelOptions,
} from './types.ts';

function fail(path: string, message: string): never {
  throw new RiskModelValidationError(path, message);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'must be an object');
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, 'must be a finite number');
  }
  return value;
}

function boundedFraction(value: unknown, path: string): number {
  const number = finiteNumber(value, path);
  if (number < 0 || number > 1) fail(path, 'must be between 0 and 1 inclusive');
  return number;
}

function positiveWeight(value: unknown, path: string): number {
  const number = finiteNumber(value, path);
  if (number <= 0) fail(path, 'weight must be greater than 0');
  return number;
}

function nonBlankString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(path, 'must be a non-blank string');
  return value;
}

function validateFactor(value: unknown, path: string): asserts value is RiskFactorInput {
  const factor = asRecord(value, path);
  nonBlankString(factor.id, `${path}.id`);

  if (factor.unit !== 'fraction' && factor.unit !== 'percent') {
    fail(`${path}.unit`, 'must be "fraction" or "percent"');
  }
  const upperBound = factor.unit === 'percent' ? 100 : 1;
  const centralValue = finiteNumber(factor.value, `${path}.value`);
  if (centralValue < 0 || centralValue > upperBound) {
    fail(`${path}.value`, `must be between 0 and ${upperBound} inclusive`);
  }
  positiveWeight(factor.weight, `${path}.weight`);

  const uncertainty = asRecord(factor.uncertainty, `${path}.uncertainty`);
  const lower = finiteNumber(uncertainty.lower, `${path}.uncertainty.lower`);
  const upper = finiteNumber(uncertainty.upper, `${path}.uncertainty.upper`);
  if (lower < 0 || lower > upperBound) {
    fail(`${path}.uncertainty.lower`, `must be between 0 and ${upperBound} inclusive`);
  }
  if (upper < 0 || upper > upperBound) {
    fail(`${path}.uncertainty.upper`, `must be between 0 and ${upperBound} inclusive`);
  }
  if (lower > upper) fail(`${path}.uncertainty`, 'lower must not exceed upper');
  if (centralValue < lower || centralValue > upper) {
    fail(`${path}.uncertainty`, 'must contain the central value');
  }

  const evidence = asRecord(factor.evidence, `${path}.evidence`);
  boundedFraction(evidence.completeness, `${path}.evidence.completeness`);
  boundedFraction(evidence.verification, `${path}.evidence.verification`);
  boundedFraction(evidence.recency, `${path}.evidence.recency`);

  if (factor.label !== undefined) nonBlankString(factor.label, `${path}.label`);
  if (factor.sourceReference !== undefined) {
    nonBlankString(factor.sourceReference, `${path}.sourceReference`);
  }
}

function validateFactorList(value: unknown, path: string): asserts value is RiskFactorInput[] {
  if (!Array.isArray(value) || value.length === 0) fail(path, 'must contain at least one factor');
  const ids = new Set<string>();
  value.forEach((factor, index) => {
    validateFactor(factor, `${path}[${index}]`);
    if (ids.has(factor.id)) fail(`${path}[${index}].id`, `duplicate factor id "${factor.id}"`);
    ids.add(factor.id);
  });
}

export function validateLinePipeRiskInput(input: unknown): asserts input is LinePipeRiskInput {
  const record = asRecord(input, 'input');
  nonBlankString(record.segmentId, 'input.segmentId');
  nonBlankString(record.scenarioId, 'input.scenarioId');
  validateFactorList(record.likelihoodFactors, 'input.likelihoodFactors');
  validateFactorList(record.consequenceFactors, 'input.consequenceFactors');
}

function validateBands(value: unknown): asserts value is readonly RiskBandDefinition[] {
  if (!Array.isArray(value) || value.length === 0) fail('options.bands', 'must contain at least one band');
  const ids = new Set<string>();
  let previous = -1;
  value.forEach((candidate, index) => {
    const band = asRecord(candidate, `options.bands[${index}]`);
    if (!['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH'].includes(String(band.id))) {
      fail(`options.bands[${index}].id`, 'is not a supported qualitative band id');
    }
    if (ids.has(String(band.id))) fail(`options.bands[${index}].id`, 'must be unique');
    ids.add(String(band.id));
    const upper = boundedFraction(
      band.upperBoundInclusive,
      `options.bands[${index}].upperBoundInclusive`,
    );
    if (upper <= previous) fail('options.bands', 'upper bounds must be strictly increasing');
    previous = upper;
  });
  if (previous !== 1) fail('options.bands', 'final upper bound must equal 1');
}

function validatePositiveWeightObject(
  value: unknown,
  path: string,
  keys: readonly string[],
) {
  const record = asRecord(value, path);
  for (const key of keys) positiveWeight(record[key], `${path}.${key}`);
}

export function validateRiskModelOptions(options: unknown): asserts options is RiskModelOptions {
  const record = asRecord(options, 'options');
  if (record.bands !== undefined) validateBands(record.bands);
  if (record.evidenceDimensionWeights !== undefined) {
    validatePositiveWeightObject(
      record.evidenceDimensionWeights,
      'options.evidenceDimensionWeights',
      ['completeness', 'verification', 'recency'],
    );
  }
  if (record.dataQualityDomainWeights !== undefined) {
    validatePositiveWeightObject(
      record.dataQualityDomainWeights,
      'options.dataQualityDomainWeights',
      ['likelihood', 'consequence'],
    );
  }
}
