import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchSectioningAnchors } from '../src/wizard/sectioningEvidence.ts';

test('sectioning evidence fetches only paginated alignment anchors', async () => {
  const requestedPaths: string[] = [];
  const rows = await fetchSectioningAnchors(2, new AbortController().signal, async (path) => {
    requestedPaths.push(path);
    if (requestedPaths.length === 1) {
      return { items: [{ id: 1 }], nextCursor: 'anchor-1' };
    }
    return { items: [{ id: 2 }], nextCursor: null };
  });

  assert.deepEqual(rows, [{ id: 1 }, { id: 2 }]);
  assert.equal(requestedPaths.length, 2);
  assert.match(requestedPaths[0], /^\/api\/inspection-runs\/2\/anchors\?limit=5000$/);
  assert.match(requestedPaths[1], /\/anchors\?/);
  assert.match(requestedPaths[1], /cursor=anchor-1/);
  assert.ok(requestedPaths.every((path) => !path.includes('/features') && !path.includes('/profile')));
});

test('sectioning evidence rejects an invalid run id without making a request', async () => {
  let calls = 0;
  await assert.rejects(
    fetchSectioningAnchors(0, new AbortController().signal, async () => {
      calls += 1;
      return { items: [] };
    }),
    /run id/i,
  );
  assert.equal(calls, 0);
});
