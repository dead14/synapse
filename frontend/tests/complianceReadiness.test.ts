import assert from 'node:assert/strict';
import test from 'node:test';
import { assessComplianceReadiness } from '../src/lib/compliance/complianceReadiness.ts';

test('reports gaps and never treats submitted evidence as accepted', () => {
  const result = assessComplianceReadiness([
    { code: 'PLO-1', applicable: true, evidenceStatus: 'accepted' },
    { code: 'RLA-1', applicable: true, evidenceStatus: 'submitted' },
    { code: 'RE-1', applicable: false, evidenceStatus: null },
  ]);
  assert.equal(result.ready, false);
  assert.deepEqual(result.gaps, ['RLA-1']);
  assert.equal(result.accepted, 1);
});
