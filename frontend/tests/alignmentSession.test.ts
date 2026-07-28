import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAlignmentSessionId } from '../src/utils/alignmentSession.ts';

test('resolves the current URL session instead of retaining the previous fallback', () => {
  assert.equal(
    resolveAlignmentSessionId({
      search: '?sessionId=42',
      storedSessionId: '41',
    }),
    '42',
  );
});

test('keeps a public share pinned to its server-authored session reference', () => {
  assert.equal(
    resolveAlignmentSessionId({
      sharedSessionId: '99',
      search: '?sessionId=42',
      storedSessionId: '41',
    }),
    '99',
  );
});
