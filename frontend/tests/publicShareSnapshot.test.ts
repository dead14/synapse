import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAlignmentShareState,
  buildFfsShareState,
  buildPublicShareSnapshot,
  shareValue,
} from '../src/lib/sharing/publicShareSnapshot.ts';
import { reviveFfsShareState } from '../src/lib/ffs/shareState.ts';
import {
  publicShareScopeKey,
  publicShareUrl,
  tokenFromLocationHash,
} from '../src/lib/sharing/publicShareLink.ts';

test('an alignment link carries the reviewer edits, so the reader sees the reviewed result', () => {
  const interventions = [
    { id: 'exclude-1', type: 'EXCLUDE_FEATURE', side: 'PAIR', pairIndex: 0, sourceKey: 'old:7' },
    { id: 'unassign-1', type: 'UNASSIGN_PAIR', sourceOldKey: 'old:3', sourceNewKey: 'new:3' },
  ];
  const snapshot = buildPublicShareSnapshot(
    buildAlignmentShareState({
      interventions,
      sections: [{ name: 'KP 0-5' }],
      hiddenFeatures: ['bend'],
    }),
    { notes: ['Frozen to this alignment run.'] },
  );

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.state.kind, 'ILI_ALIGNMENT');
  assert.deepEqual(snapshot.state, {
    kind: 'ILI_ALIGNMENT',
    interventions,
    sections: [{ name: 'KP 0-5' }],
    // Frozen with the edits: a recipient shown rows the author had switched
    // off is reading a different report from the one that was published.
    hiddenFeatures: ['bend'],
  });
  assert.deepEqual(snapshot.notes, ['Frozen to this alignment run.']);
});

test('an alignment snapshot is a copy, so later edits cannot change a published link', () => {
  const interventions = [{ id: 'exclude-1', type: 'EXCLUDE_FEATURE', sourceKey: 'old:7' }];
  const state = buildAlignmentShareState({ interventions, sections: [] });

  interventions[0].sourceKey = 'old:9';
  interventions.push({ id: 'exclude-2', type: 'EXCLUDE_FEATURE', sourceKey: 'old:8' });

  assert.equal(state.interventions.length, 1);
  assert.deepEqual(state.interventions[0], { id: 'exclude-1', type: 'EXCLUDE_FEATURE', sourceKey: 'old:7' });
});

test('an FFS link carries the whole assessment and reopens with the same assumptions', () => {
  const iliDate = new Date('2026-03-14T00:00:00.000Z');
  const state = buildFfsShareState({
    results: [{ key: 'ffs:1', ERF: 0.82, acceptance: 'Acceptable' }],
    config: { lineName: 'Line 12', method: 'modified', modifiedSa: 'smys11', iliDate, highlightYears: 5 },
    screening: { depthTolerancePct: 7, forecastYears: 12, growthBasis: 'measured' },
    alignmentImport: { sessionId: '42', accepted: [], rejected: [], warningCount: 0 },
  });

  assert.equal(state.config.iliDate, iliDate.toISOString());

  const revived = reviveFfsShareState(state);
  assert.ok(revived);
  assert.equal(revived.config.lineName, 'Line 12');
  assert.equal(revived.config.iliDate.getTime(), iliDate.getTime());
  assert.equal(revived.screening.depthTolerancePct, 7);
  assert.equal(revived.screening.forecastYears, 12);
  assert.equal(revived.results.length, 1);
  assert.equal(revived.alignmentImport?.sessionId, '42');
});

test('a filed assessment keeps the reviewer decisions, not only the numbers', () => {
  // The engineering judgement on top of the calculation is half of what an
  // assessment is. Until this was carried, re-opening a filed session came back
  // with every repair disposition and spool decision blank.
  const state = buildFfsShareState({
    results: [{ key: 'ffs:1', ERF: 0.42 }],
    config: { lineName: 'Line 12', iliDate: new Date('2026-03-14T00:00:00.000Z') },
    review: {
      repairOverrides: { 3: { repairStatus: 'temporary-repair', repairMethod: 'Composite wrap' } },
      spoolDispositions: { 'spool:12': { decision: 'repair', note: 'Sleeve at next shutdown' } },
    },
  });

  const revived = reviveFfsShareState(state);
  assert.ok(revived);
  // JSON turns a numeric key into a string; an override that came back under a
  // string key silently applied to nothing.
  assert.deepEqual(revived.review.repairOverrides[3], {
    repairStatus: 'temporary-repair',
    repairMethod: 'Composite wrap',
  });
  assert.equal(revived.review.spoolDispositions['spool:12'].decision, 'repair');
});

test('a case filed before reviewer decisions were carried revives with empty ones', () => {
  const revived = reviveFfsShareState(buildFfsShareState({
    results: [{ key: 'ffs:1' }],
    config: { lineName: 'Line 12', iliDate: new Date('2026-03-14T00:00:00.000Z') },
  }));

  assert.ok(revived);
  assert.deepEqual(revived.review, { repairOverrides: {}, spoolDispositions: {} });
});

test('an FFS link with no readable date or result is refused rather than half-rendered', () => {
  const base = buildFfsShareState({
    results: [{ key: 'ffs:1' }],
    config: { lineName: 'Line 12', iliDate: new Date('2026-03-14T00:00:00.000Z') },
  });

  assert.equal(reviveFfsShareState({ ...base, config: { ...base.config, iliDate: 'not a date' } }), null);
  assert.equal(reviveFfsShareState({ ...base, results: [] }), null);
  assert.equal(reviveFfsShareState(null), null);
});

test('sharing refuses to publish a result larger than the link can carry', () => {
  // Past the 50 MB ceiling the API enforces. Built from a few very large values
  // rather than many small ones so the test spends no time on structure.
  const results = Array.from({ length: 55 }, (_, index) => ({
    key: `ffs:${index}`,
    note: 'x'.repeat(1024 * 1024),
  }));

  assert.throws(
    () => buildPublicShareSnapshot(buildFfsShareState({
      results,
      config: { lineName: 'Line 12', iliDate: new Date('2026-03-14T00:00:00.000Z') },
    })),
    /MB a public link can carry/i,
  );
});

test('non-finite calculation output and functions never reach a published link', () => {
  const copied = shareValue({
    erf: Number.NaN,
    safePressure: Number.POSITIVE_INFINITY,
    depth: 35,
    onSave() {},
    nested: { life: Number.NEGATIVE_INFINITY, label: 'Acceptable' },
  }) as Record<string, unknown>;

  assert.equal(copied.erf, null);
  assert.equal(copied.safePressure, null);
  assert.equal(copied.depth, 35);
  assert.equal(Object.hasOwn(copied, 'onSave'), false);
  assert.deepEqual(copied.nested, { life: null, label: 'Acceptable' });
});

test('keeps the bearer secret in the URL fragment and recovers it safely', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const secret = 'abc_DEF-123';
  const url = new URL(publicShareUrl(id, secret, 'https://synapse.example'));

  assert.equal(url.pathname, `/share/${id}`);
  assert.equal(url.search, '');
  assert.equal(url.hash, `#${secret}`);
  assert.equal(tokenFromLocationHash(url.hash), secret);
  assert.equal(tokenFromLocationHash('#%E0%A4%A'), '');
});

test('changes the share scope when the referenced alignment run changes', () => {
  const firstRun = publicShareScopeKey('ILI_ALIGNMENT', 'Final ILI alignment', 'alignment-job:run-41');
  const secondRun = publicShareScopeKey('ILI_ALIGNMENT', 'Final ILI alignment', 'alignment-job:run-42');

  assert.notEqual(firstRun, secondRun);
});

test('a case filed under the old growth column names revives under the current ones', () => {
  // crDepth/crLength became crDepthSource/crLengthSource when the source column
  // and the rate the projection ran on stopped being the same thing. A document
  // filed before that came back with the new names undefined, which the tables
  // absorbed silently and the what-if drawer did not.
  const revived = reviveFfsShareState(buildFfsShareState({
    results: [{ key: 'ffs:1', crDepth: 0.31, crLength: 1.4 }],
    config: { lineName: 'Line 12', iliDate: new Date('2026-03-14T00:00:00.000Z') },
  }));

  assert.ok(revived);
  assert.equal(revived.results[0].crDepthSource, 0.31);
  assert.equal(revived.results[0].crLengthSource, 1.4);
});

test('a case that carries the current growth columns is not rewritten by the rename bridge', () => {
  const revived = reviveFfsShareState(buildFfsShareState({
    results: [{ key: 'ffs:1', crDepthSource: 0, crLengthSource: 0, crDepth: 9, crLength: 9 }],
    config: { lineName: 'Line 12', iliDate: new Date('2026-03-14T00:00:00.000Z') },
  }));

  assert.ok(revived);
  assert.equal(revived.results[0].crDepthSource, 0);
  assert.equal(revived.results[0].crLengthSource, 0);
});
