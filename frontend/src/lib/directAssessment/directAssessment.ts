export type DirectAssessmentMethod = 'ECDA' | 'ICDA' | 'SCCDA' | 'CDA';
export function buildDirectAssessmentPlan(input: {
  id: string;
  method: DirectAssessmentMethod;
  piggable: boolean;
  selectionBasis?: string;
  indirectSurveys: string[];
  directExaminationsComplete: boolean;
}) {
  if (!input.id) throw new Error('assessment id is required');
  if (input.piggable && !input.selectionBasis?.trim()) throw new Error('documented DA selection basis is required for a piggable segment');
  const holds: string[] = [];
  if (input.indirectSurveys.length === 0) holds.push('Indirect inspection evidence has not been recorded.');
  if (!input.directExaminationsComplete) holds.push('Direct examination is incomplete.');
  return {
    ...input,
    phases: ['pre-assessment', 'indirect-inspection', 'direct-examination', 'post-assessment', 'reassessment'],
    reassessmentReady: holds.length === 0,
    holds,
    requiresQualifiedApproval: true,
  };
}
