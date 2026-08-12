import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAlignmentSessionId,
  parseAlignmentShareReference,
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

test('a published link is read through its own reference, not as a session id', () => {
  // The share carries what it was created from. Feeding that string to the
  // session resolver made every published alignment link open on
  // "…is not an alignment session reference", because a prefixed reference can
  // never be a positive integer.
  assert.deepEqual(
    parseAlignmentShareReference('alignment-job:9d1f4c2a-77b0-4e51-9a3e-2f6b8c0d1e42'),
    { kind: 'job', id: '9d1f4c2a-77b0-4e51-9a3e-2f6b8c0d1e42' },
  );
  assert.deepEqual(
    parseAlignmentShareReference('alignment-session:12'),
    { kind: 'session', id: '12' },
  );
  // Links published before references were prefixed carry the bare id.
  assert.deepEqual(parseAlignmentShareReference('12'), { kind: 'session', id: '12' });
  for (const bad of ['', '   ', 'oops', 'alignment-job:', null, undefined]) {
    assert.equal(parseAlignmentShareReference(bad), null, `expected ${String(bad)} to be refused`);
  }
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
