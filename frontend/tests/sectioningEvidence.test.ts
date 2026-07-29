import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchSectioningAnchors,
  prepareSectioningMasterRows,
} from '../src/wizard/sectioningEvidence.ts';

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

test('legacy sectioning plots backend offset positions but preserves source LD', () => {
  const rows = prepareSectioningMasterRows([{
    id: 'bend-1',
    type: 'Bend / Elbow',
    dist: 612.25,
    log_distance_m: 612.25,
    source_log_distance_m: 612.25,
  }], {
    globalOffset: 38.5,
    tieInTransform: null,
    tieInDecision: null,
  });

  assert.equal(rows[0].dist, 650.75);
  assert.equal(rows[0].plot_distance_m, 650.75);
  assert.equal(rows[0].source_log_distance_m, 612.25);
  assert.deepEqual(rows[0].raw, { log_distance_m: 612.25 });
});

test('canonical OLD-to-NEW sectioning leaves NEW master positions unshifted', () => {
  const rows = prepareSectioningMasterRows([{
    id: 'bend-1',
    dist: 612.25,
    log_distance_m: 612.25,
  }], {
    globalOffset: 38.5,
    tieInTransform: { direction: 'OLD_TO_NEW', knots: [[0, 0], [1000, 1010]] },
    tieInDecision: { status: 'AUTO_ACCEPTED' },
  });

  assert.equal(rows[0].dist, 612.25);
  assert.equal(rows[0].source_log_distance_m, 612.25);
});

test('sectioning keeps an explicit backend plot position authoritative', () => {
  const rows = prepareSectioningMasterRows([{
    id: 'bend-1',
    dist: 650.75,
    plot_distance_m: 650.75,
    raw: { log_distance_m: 612.25 },
  }], {
    globalOffset: 99,
  });

  assert.equal(rows[0].dist, 650.75);
  assert.equal(rows[0].source_log_distance_m, 612.25);
  assert.deepEqual(rows[0].raw, { log_distance_m: 612.25 });
});

test('legacy sectioning never mistakes raw abs_distance_m for an aligned position', () => {
  const rows = prepareSectioningMasterRows([{
    id: 'bend-1',
    abs_distance_m: 612.25,
    log_distance_m: 612.25,
  }], {
    globalOffset: 38.5,
  });

  assert.equal(rows[0].dist, 650.75);
  assert.equal(rows[0].plot_distance_m, 650.75);
  assert.equal(rows[0].source_log_distance_m, 612.25);
});

test('sectioning projection is idempotent', () => {
  const tieIn = { globalOffset: 38.5 };
  const first = prepareSectioningMasterRows([{
    id: 'bend-1',
    log_distance_m: 612.25,
  }], tieIn);
  const second = prepareSectioningMasterRows(first, tieIn);

  assert.equal(first[0].dist, 650.75);
  assert.deepEqual(second, first);
});

test('sectioning accepts explicit DTW aligned and source distances', () => {
  const rows = prepareSectioningMasterRows([{
    id: 'bend-1',
    dist: 612.25,
    alignedDist: 650.75,
    sourceDist: 612.25,
  }], {
    globalOffset: 99,
  });

  assert.equal(rows[0].dist, 650.75);
  assert.equal(rows[0].plot_distance_m, 650.75);
  assert.equal(rows[0].source_log_distance_m, 612.25);
});
