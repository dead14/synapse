export type ComplianceEvidenceStatus = 'gap' | 'requested' | 'submitted' | 'accepted' | 'rejected' | null;
export function assessComplianceReadiness(requirements: {
  code: string; applicable: boolean; evidenceStatus: ComplianceEvidenceStatus;
}[]) {
  const applicable = requirements.filter((item) => item.applicable);
  const gaps = applicable.filter((item) => item.evidenceStatus !== 'accepted').map((item) => item.code);
  return {
    applicable: applicable.length,
    accepted: applicable.length - gaps.length,
    gaps,
    ready: applicable.length > 0 && gaps.length === 0,
  };
}
