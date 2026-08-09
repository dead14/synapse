import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAlignmentSessionId,
  resolveAlignmentSessionId,
} from '../src/utils/alignmentSession.ts';

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

test('only a positive integer can address a session', () => {
  assert.equal(isAlignmentSessionId('42'), true);
  for (const bad of ['', '   ', 'undefined', 'null', 'NaN', '0', '-3', '4.5', 'abc', null, undefined]) {
    assert.equal(isAlignmentSessionId(bad), false, `expected ${String(bad)} to be refused`);
  }
});

test('a poisoned stored session is ignored rather than sent to the API', () => {
  // A leftover key put a bare "Invalid session ID" from the backend on screen,
  // which told the engineer nothing. Falling back to nothing lets the page say
  // no session is selected and offer the way out.
  assert.equal(resolveAlignmentSessionId({ storedSessionId: 'undefined' }), '');
  assert.equal(resolveAlignmentSessionId({ storedSessionId: '0' }), '');
  assert.equal(resolveAlignmentSessionId({ storedSessionId: '41' }), '41');
});

test('an explicitly requested session is returned even when malformed', () => {
  // The URL and a share reference are things the user just asked for, so the
  // page reports that *this* session is unusable instead of quietly opening a
  // different one it happened to remember.
  assert.equal(
    resolveAlignmentSessionId({ search: '?sessionId=oops', storedSessionId: '41' }),
    'oops',
  );
});
