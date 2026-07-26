import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pairGwResult,
  pairTieIn,
  primaryRunPair,
  resolveRunPairs,
  runPairKey,
  sectionsForPair,
} from '../src/domain/runPairs.ts';

const threeRunSummary = {
  masterRun: { runId: 30, year: '2024' },
  oldRun: { runId: 20, year: '2021' },
  newRun: { runId: 30, year: '2024' },
  historicalRuns: [{ runId: 20, year: '2021' }, { runId: 10, year: '2019' }],
  runPairs: [
    { oldRun: { runId: 10, year: '2019' }, newRun: { runId: 20, year: '2021' } },
    { oldRun: { runId: 20, year: '2021' }, newRun: { runId: 30, year: '2024' } },
  ],
};

test('resolves one pair per chain transition, oldest first', () => {
  const pairs = resolveRunPairs(threeRunSummary);
  assert.deepEqual(pairs.map((pair) => pair.key), ['10->20', '20->30']);
  assert.deepEqual(pairs.map((pair) => pair.label), ['2019 → 2021', '2021 → 2024']);
});

test('degrades a legacy two-run session to a single pair', () => {
  assert.deepEqual(
    resolveRunPairs({ oldRun: { runId: 4, year: '2020' }, newRun: { runId: 7, year: '2023' } })
      .map((pair) => pair.key),
    ['4->7'],
  );
});

test('rejects pairs that cannot be identified by persisted run id', () => {
  assert.equal(runPairKey(0, 5), null);
  assert.equal(runPairKey(5, undefined), null);
  assert.deepEqual(resolveRunPairs({ oldRun: { runId: 9 }, newRun: { runId: 9 } }), []);
  assert.deepEqual(resolveRunPairs(undefined), []);
});

test('drops duplicate transitions so evidence cannot be filed twice', () => {
  const pairs = resolveRunPairs({
    runPairs: [
      { oldRun: { runId: 1 }, newRun: { runId: 2 } },
      { oldRun: { runId: 1 }, newRun: { runId: 2 } },
    ],
  });
  assert.deepEqual(pairs.map((pair) => pair.key), ['1->2']);
});

test('the primary pair is the newest transition into the master run', () => {
  assert.equal(primaryRunPair(threeRunSummary)?.key, '20->30');
});

test('per-pair tie-in evidence wins over the top-level fallback', () => {
  const config = {
    summaryData: threeRunSummary,
    globalOffset: 900,
    tieInTransform: { knots: ['primary'] },
    pairTieIns: {
      '10->20': { globalOffset: 120, tieInTransform: { knots: ['scoped'] } },
    },
  };
  const [older, newer] = resolveRunPairs(threeRunSummary);
  assert.equal(pairTieIn(config, older).globalOffset, 120);
  assert.equal(pairTieIn(config, newer).globalOffset, 900);
});

test('a non-primary pair never inherits the primary pair top-level evidence', () => {
  const config = { summaryData: threeRunSummary, gwMatchesFinal: [{ old_id: 'a' }] };
  const [older, newer] = resolveRunPairs(threeRunSummary);
  assert.equal(pairGwResult(config, older), null);
  assert.deepEqual(pairGwResult(config, newer).gwMatchesFinal, [{ old_id: 'a' }]);
});

test('unscoped sections belong to the primary pair only', () => {
  const [older, newer] = resolveRunPairs(threeRunSummary);
  const primary = primaryRunPair(threeRunSummary);
  const sections = [
    { id: 'legacy' },
    { id: 'older', pairKey: '10->20' },
    { id: 'newer', pairKey: '20->30' },
  ];
  assert.deepEqual(sectionsForPair(sections, older, primary).map((s) => s.id), ['older']);
  assert.deepEqual(sectionsForPair(sections, newer, primary).map((s) => s.id), ['legacy', 'newer']);
});
