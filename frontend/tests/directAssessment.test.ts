import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDirectAssessmentPlan } from '../src/lib/directAssessment/directAssessment.ts';

test('builds ECDA phases and holds reassessment when direct examination is incomplete', () => {
  const plan = buildDirectAssessmentPlan({
    id: 'da-1', method: 'ECDA', piggable: false,
    indirectSurveys: ['CIPS', 'DCVG'], directExaminationsComplete: false,
  });
  assert.equal(plan.phases.length, 5);
  assert.equal(plan.reassessmentReady, false);
  assert.match(plan.holds.join(' '), /direct examination/i);
});

test('rejects DA for piggable selection without documented basis', () => {
  assert.throws(() => buildDirectAssessmentPlan({
    id: 'da-2', method: 'ICDA', piggable: true, indirectSurveys: [], directExaminationsComplete: false,
  }), /selection basis/i);
});
