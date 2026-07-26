import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isMultiRunSession,
  resolveInspectionRuns,
  resolveReferenceRun,
  resolveStarRunPairs,
} from '../src/domain/multiRun.ts';
import { resolveRunPairs } from '../src/domain/runPairs.ts';

const twoRunSummary = {
  masterRun: { runId: 30, year: '2026' },
  oldRun: { runId: 10, year: '2012' },
  newRun: { runId: 30, year: '2026' },
  runPairs: [{ oldRun: { runId: 10, year: '2012' }, newRun: { runId: 30, year: '2026' } }],
};

const threeRunSummary = {
  masterRun: { runId: 30, year: '2026' },
  oldRun: { runId: 20, year: '2024' },
  newRun: { runId: 30, year: '2026' },
  historicalRuns: [{ runId: 20, year: '2024' }, { runId: 10, year: '2012' }],
  runPairs: [
    { oldRun: { runId: 10, year: '2012' }, newRun: { runId: 20, year: '2024' } },
    { oldRun: { runId: 20, year: '2024' }, newRun: { runId: 30, year: '2026' } },
  ],
};

test('collects every inspection run once, oldest first', () => {
  assert.deepEqual(
    resolveInspectionRuns(threeRunSummary).map((run) => [run.runId, run.year]),
    [[10, 2012], [20, 2024], [30, 2026]],
  );
});

test('reads runs from the phylogenetic run slots as well', () => {
  const runs = resolveInspectionRuns({
    ancestorRun: { runId: 1, year: '2010' },
    run1: { runId: 2, year: '2015' },
    run2: { runId: 3, year: '2020' },
    run3: { runId: 4, year: '2025' },
  });
  assert.deepEqual(runs.map((run) => run.runId), [1, 2, 3, 4]);
});

test('undated runs never outrank a dated one for the reference slot', () => {
  // Sorting an undated run first would silently make it the oldest; sorting it
  // last keeps the newest dated run as the default reference.
  const runs = resolveInspectionRuns({
    runPairs: [
      { oldRun: { runId: 10, year: '2012' }, newRun: { runId: 30, year: '2026' } },
      { oldRun: { runId: 20 }, newRun: { runId: 30, year: '2026' } },
    ],
  });
  assert.deepEqual(runs.map((run) => run.runId), [10, 30, 20]);
});

test('only a session with more than two runs takes the stacked path', () => {
  assert.equal(isMultiRunSession(twoRunSummary), false);
  assert.equal(isMultiRunSession(threeRunSummary), true);
  assert.equal(isMultiRunSession({}), false);
});

test('the newest run is the reference by default', () => {
  assert.equal(resolveReferenceRun(threeRunSummary)?.runId, 30);
});

test('the reference can be overridden when the newest run is a partial one', () => {
  // Anchoring to a short newest run would discard every kilometre it never
  // covered, so the choice has to be the operator's.
  assert.equal(resolveReferenceRun(threeRunSummary, 10)?.runId, 10);
  // An id outside the session falls back rather than yielding no reference.
  assert.equal(resolveReferenceRun(threeRunSummary, 999)?.runId, 30);
});

test('every historical run is anchored straight to the reference', () => {
  const pairs = resolveStarRunPairs(threeRunSummary);
  assert.deepEqual(pairs.map((pair) => pair.key), ['10->30', '20->30']);
  assert.deepEqual(pairs.map((pair) => pair.label), ['2012 → 2026', '2024 → 2026']);
});

test('a chain never anchors the oldest run to the reference, star always does', () => {
  // The difference that matters: with a chain the 2012 run can only reach 2026
  // through 2024, so a sparse or partial 2024 breaks the trail entirely.
  assert.deepEqual(resolveRunPairs(threeRunSummary).map((pair) => pair.key), ['10->20', '20->30']);
  assert.deepEqual(resolveStarRunPairs(threeRunSummary).map((pair) => pair.key), ['10->30', '20->30']);
});

test('a two-run session produces the identical single pair either way', () => {
  // The stacked path must be a superset, never a behaviour change, for the
  // sessions that already work today.
  assert.deepEqual(
    resolveStarRunPairs(twoRunSummary).map((pair) => pair.key),
    resolveRunPairs(twoRunSummary).map((pair) => pair.key),
  );
});

test('a session with no persisted runs offers no reference and no pairs', () => {
  assert.equal(resolveReferenceRun({}), null);
  assert.deepEqual(resolveStarRunPairs({}), []);
});
