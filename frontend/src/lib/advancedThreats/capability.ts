export type AdvancedThreat = 'crack' | 'dent-strain' | 'geohazard';
export function advancedThreatCapability(threat: AdvancedThreat) {
  const labels = { crack: 'Crack management', 'dent-strain': 'Dent and strain assessment', geohazard: 'Geohazard and crossing management' };
  return {
    threat,
    label: labels[threat],
    workflowAvailable: true,
    calculationAvailable: false,
    requiresValidatedAdapter: true,
    requiredEvidence: ['Controlled inspection input', 'Method and edition', 'Measurement uncertainty', 'Qualified engineering approval'],
  };
}
