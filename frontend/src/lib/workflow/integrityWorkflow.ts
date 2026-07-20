export const INTEGRITY_STAGES = ['import', 'validate', 'align', 'assess', 'decide', 'repair', 'verify'] as const;
export type IntegrityStage = typeof INTEGRITY_STAGES[number];

export interface ApprovalEvent {
  id: string;
  decision: 'approved' | 'rejected';
  actorId: string;
  reason: string;
  at: string;
}

export interface WorkflowEvent {
  id: string;
  type: 'case-created' | 'stage-advanced';
  stage: IntegrityStage;
  actorId: string;
  at: string;
}

export interface IntegrityCase {
  id: string;
  anomalyKey: string;
  stage: IntegrityStage;
  dataQualityConfidence: number;
  requiresEngineeringReview: boolean;
  approvals: ApprovalEvent[];
  events: WorkflowEvent[];
}

function required(value: string, field: string) {
  if (!value.trim()) throw new Error(`${field} is required`);
}

function validTimestamp(value: string) {
  if (!Number.isFinite(Date.parse(value))) throw new Error('event timestamp must be valid');
}

export function createIntegrityCase(input: {
  id: string; anomalyKey: string; createdBy: string; dataQualityConfidence: number;
}): IntegrityCase {
  required(input.id, 'id');
  required(input.anomalyKey, 'anomalyKey');
  required(input.createdBy, 'createdBy');
  if (!Number.isFinite(input.dataQualityConfidence) || input.dataQualityConfidence < 0 || input.dataQualityConfidence > 1) {
    throw new Error('dataQualityConfidence must be between 0 and 1');
  }
  const at = new Date().toISOString();
  return {
    id: input.id,
    anomalyKey: input.anomalyKey,
    stage: 'import',
    dataQualityConfidence: input.dataQualityConfidence,
    requiresEngineeringReview: input.dataQualityConfidence < 0.7,
    approvals: [],
    events: [{ id: `${input.id}-created`, type: 'case-created', stage: 'import', actorId: input.createdBy, at }],
  };
}

export function recordApproval(integrityCase: IntegrityCase, approval: ApprovalEvent): IntegrityCase {
  if (integrityCase.stage !== 'decide') throw new Error('approval is only valid at decide stage');
  required(approval.id, 'approval.id');
  required(approval.actorId, 'approval.actorId');
  required(approval.reason, 'approval.reason');
  validTimestamp(approval.at);
  if (integrityCase.approvals.some((item) => item.id === approval.id)) throw new Error(`duplicate approval id: ${approval.id}`);
  return { ...integrityCase, approvals: [...integrityCase.approvals, { ...approval }] };
}

export function advanceIntegrityCase(
  integrityCase: IntegrityCase,
  nextStage: IntegrityStage,
  actorId: string,
  at = new Date().toISOString(),
): IntegrityCase {
  required(actorId, 'actorId');
  validTimestamp(at);
  const expectedStage = INTEGRITY_STAGES[INTEGRITY_STAGES.indexOf(integrityCase.stage) + 1];
  if (nextStage !== expectedStage) throw new Error(`next stage must be ${expectedStage ?? 'none'}`);
  if (nextStage === 'repair') {
    const approval = integrityCase.approvals.at(-1);
    if (!approval) throw new Error('approval is required before repair');
    if (approval.decision !== 'approved') throw new Error('repair must be approved');
  }
  return {
    ...integrityCase,
    stage: nextStage,
    events: [...integrityCase.events, {
      id: `${integrityCase.id}-${nextStage}-${integrityCase.events.length}`,
      type: 'stage-advanced', stage: nextStage, actorId, at,
    }],
  };
}
