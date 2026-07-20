import { validateData, type ValidationError } from './validation.ts';
import type { FfsConfig } from './types.ts';

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
}

export function assertValidFfsRow(row: Record<string, string>, config: FfsConfig): void {
  assertValidFfsConfig(config);
  const errors = validateData([row]);
  if (errors.length > 0) throw new FfsInputValidationError(errors);
}
