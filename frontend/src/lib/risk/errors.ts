export class RiskModelValidationError extends TypeError {
  readonly code = 'INVALID_LINE_PIPE_RISK_INPUT';
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'RiskModelValidationError';
    this.path = path;
  }
}
