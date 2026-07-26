import assert from 'node:assert/strict';
import test from 'node:test';

import { advanceIntegrityCase, createIntegrityCase, recordApproval } from '../src/lib/workflow/integrityWorkflow.ts';

test('enforces Import → Validate → Align → Assess → Decide → Repair → Verify', () => {
  let integrityCase = createIntegrityCase({
    id: 'case-1', anomalyKey: 'anomaly-1', createdBy: 'engineer-1', dataQualityConfidence: 0.9,
  });
  for (const stage of ['validate', 'align', 'assess', 'decide'] as const) {
    integrityCase = advanceIntegrityCase(integrityCase, stage, 'engineer-1');
  }
  assert.throws(() => advanceIntegrityCase(integrityCase, 'repair', 'engineer-1'), /approval/i);
  integrityCase = recordApproval(integrityCase, {
    id: 'approval-1', decision: 'approved', actorId: 'approver-1',
    reason: 'Assessment and repair basis reviewed.', at: '2026-07-16T12:00:00.000Z',
  });
  integrityCase = advanceIntegrityCase(integrityCase, 'repair', 'engineer-1');
  integrityCase = advanceIntegrityCase(integrityCase, 'verify', 'engineer-1');
  assert.equal(integrityCase.stage, 'verify');
  assert.equal(integrityCase.events.length, 7);
});

test('rejects skipped stages and exposes low-confidence review requirement', () => {
  const integrityCase = createIntegrityCase({
    id: 'case-2', anomalyKey: 'anomaly-2', createdBy: 'engineer-1', dataQualityConfidence: 0.3,
  });
  assert.equal(integrityCase.requiresEngineeringReview, true);
  assert.throws(() => advanceIntegrityCase(integrityCase, 'assess', 'engineer-1'), /next stage/i);
});
