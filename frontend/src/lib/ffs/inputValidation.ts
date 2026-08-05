import { validateData, type ValidationError } from './validation.ts';
import type { FfsConfig } from './types.ts';
import { MAX_FFS_ANALYSIS_HORIZON_YEARS } from './lifeProjection.ts';
import {
  ASME_MIN_ASSESSMENT_SAFETY_FACTOR,
  assessmentSafetyFactor,
  validateFlowStressQualification,
} from './b31g.ts';

export class FfsInputValidationError extends TypeError {
  readonly code = 'INVALID_FFS_INPUT';
  readonly errors: ValidationError[];

  constructor(errors: ValidationError[]) {
    super(`FFS input validation failed: ${errors[0]?.msg ?? 'invalid input'}`);
    this.name = 'FfsInputValidationError';
    this.errors = errors;
  }
}

export function assertValidFfsConfig(config: FfsConfig): void {
  if (!config || typeof config !== 'object') throw new FfsInputValidationError([{ row: 0, col: 'config', msg: 'Configuration is required' }]);
  if (config.method !== 'original' && config.method !== 'modified') {
    throw new FfsInputValidationError([{ row: 0, col: 'method', msg: 'FFS method is invalid' }]);
  }
  if (config.modifiedSa !== 'smys69' && config.modifiedSa !== 'smys11') {
    throw new FfsInputValidationError([{ row: 0, col: 'modifiedSa', msg: 'Modified B31G strength mode is invalid' }]);
  }
  if (!(config.iliDate instanceof Date) || !Number.isFinite(config.iliDate.getTime())) {
    throw new FfsInputValidationError([{ row: 0, col: 'iliDate', msg: 'ILI date must be a valid date' }]);
  }
  if (!Number.isFinite(config.highlightYears) || config.highlightYears < 0) {
    throw new FfsInputValidationError([{ row: 0, col: 'highlightYears', msg: 'Highlight years must be finite and non-negative' }]);
  }
  if (
    config.analysisHorizonYears !== undefined &&
    (!Number.isFinite(config.analysisHorizonYears) ||
      config.analysisHorizonYears < 1 ||
      config.analysisHorizonYears > MAX_FFS_ANALYSIS_HORIZON_YEARS)
  ) {
    throw new FfsInputValidationError([{
      row: 0,
      col: 'analysisHorizonYears',
      msg: `Analysis horizon must be between 1 and ${MAX_FFS_ANALYSIS_HORIZON_YEARS} years`,
    }]);
  }
}

export function assertValidFfsRow(row: Record<string, string>, config: FfsConfig): void {
  assertValidFfsConfig(config);
  const errors = validateData([row]);
  const designFactor = Number(String(row['Design Factor']).trim());
  if (
    Number.isFinite(designFactor) && designFactor > 0 &&
    assessmentSafetyFactor(designFactor) < ASME_MIN_ASSESSMENT_SAFETY_FACTOR &&
    !String(config.applicability?.lowSafetyFactorJustification ?? '').trim()
  ) {
    errors.push({
      row: 2,
      col: 'Design Factor',
      msg: 'Effective assessment safety factor below 1.25 requires documented justification',
    });
  }
  const smysMpa = Number(String(row['SMYS [MPa]']).trim());
  if (config.applicability) {
    for (const message of validateFlowStressQualification({
      method: config.method,
      flowStressMode: config.modifiedSa,
      smysMpa,
      materialClass: config.applicability.materialClass,
      operatingTemperatureC: config.applicability.operatingTemperatureC,
    })) {
      errors.push({ row: 2, col: 'SMYS [MPa]', msg: message });
    }
  }
  if (errors.length > 0) throw new FfsInputValidationError(errors);
}
