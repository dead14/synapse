import assert from 'node:assert/strict';
import test from 'node:test';
import { advancedThreatCapability } from '../src/lib/advancedThreats/capability.ts';
import { createCopilotSuggestion } from '../src/lib/copilot/safeCopilot.ts';

test('advanced threats expose workflow without unsupported calculation claims', () => {
  const capability = advancedThreatCapability('crack');
  assert.equal(capability.calculationAvailable, false);
  assert.equal(capability.requiresValidatedAdapter, true);
});

test('copilot output is advisory and cannot approve engineering decisions', () => {
  const suggestion = createCopilotSuggestion({
    caseId: 'case-1', prompt: 'Review missing data', findings: ['Tool tolerance is missing'],
  });
  assert.equal(suggestion.authority, 'advisory-only');
  assert.equal(suggestion.canApprove, false);
  assert.equal(suggestion.requiresHumanReview, true);
});
