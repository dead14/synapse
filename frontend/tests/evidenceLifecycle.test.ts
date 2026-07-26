import assert from 'node:assert/strict';
import test from 'node:test';
import { transitionEvidence } from '../src/lib/evidence/evidenceLifecycle.ts';

test('allows controlled evidence lifecycle and requires reviewer for acceptance', () => {
  const submitted = transitionEvidence({ id: 'e1', status: 'requested', history: [] }, 'submitted', 'field-1');
  assert.throws(() => transitionEvidence(submitted, 'accepted', 'field-1'), /reviewed/i);
  const reviewed = transitionEvidence(submitted, 'reviewed', 'reviewer-1');
  const accepted = transitionEvidence(reviewed, 'accepted', 'approver-1');
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.history.length, 3);
});

test('rejects lifecycle skips and changes after superseded', () => {
  assert.throws(() => transitionEvidence({ id: 'e2', status: 'required', history: [] }, 'accepted', 'a'), /transition/i);
  assert.throws(() => transitionEvidence({ id: 'e3', status: 'superseded', history: [] }, 'requested', 'a'), /final/i);
});
