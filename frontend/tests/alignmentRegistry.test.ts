import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeAlignmentRegistry,
  presentAlignmentRow,
  summarizeAlignmentRegistry,
  type AlignmentRegistryRow,
} from '../src/domain/alignmentRegistry.ts';

function apiRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '12',
    pipelineId: 3,
    pipelineName: 'HU CPA 20in',
    algorithm: 'dtw_hungarian',
    status: 'completed',
    startedAt: '2026-05-01T09:00:00.000Z',
    completedAt: '2026-05-01T10:00:00.000Z',
    matchRate: 82.4,
    anomaliesFound: 1_204,
    runs: {
      old: { runId: 4, name: 'Rosen 2019', vendor: 'Rosen', surveyYear: 2019, surveyDate: '2019-06-01', rowCount: null },
      new: { runId: 9, name: 'NDT 2024', vendor: 'NDT', surveyYear: 2024, surveyDate: '2024-07-14', rowCount: 40_112 },
    },
    result: { available: true, completedAt: '2026-05-01T10:00:00.000Z' },
    review: { reviewedCount: 120, selectedCount: 18 },
    ffs: null,
    stage: 'released',
    ...overrides,
  };
}

test('the registry reads either an items envelope or a bare array', () => {
  assert.equal(normalizeAlignmentRegistry({ items: [apiRow()] }).length, 1);
  assert.equal(normalizeAlignmentRegistry([apiRow()]).length, 1);
  assert.deepEqual(normalizeAlignmentRegistry(null), []);
});

test('a half-built row is repaired rather than rendered as undefined', () => {
  const [row] = normalizeAlignmentRegistry([{ id: '7' }]);

  assert.equal(row.pipelineName, 'Run 7');
  assert.equal(row.matchRate, null);
  assert.equal(row.anomaliesFound, 0);
  assert.equal(row.result.available, false);
  assert.equal(row.ffs, null);
  assert.deepEqual(row.review, { reviewedCount: 0, selectedCount: 0 });
  // An unknown stage is not invented as "aligned": a row that says nothing about
  // its state must not claim a result exists.
  assert.equal(row.stage, 'running');
});

test('an unrecorded survey year is absent, not zero', () => {
  const [row] = normalizeAlignmentRegistry([apiRow({
    runs: {
      old: { runId: null, name: 'Rosen 2019', vendor: null, surveyYear: null, surveyDate: null, rowCount: null },
      new: { runId: null, name: null, vendor: '', surveyYear: '', surveyDate: null, rowCount: null },
    },
    matchRate: null,
  })]);

  assert.equal(row.runs.old.surveyYear, null);
  assert.equal(row.runs.new.surveyYear, null);
  assert.equal(row.runs.new.rowCount, null);
  assert.equal(row.runs.new.vendor, null);
  assert.equal(row.matchRate, null);
});

test('a row with no id is dropped, because nothing on it could be opened', () => {
  assert.deepEqual(normalizeAlignmentRegistry([{ pipelineName: 'Nameless' }]), []);
});

test('an FFS session is only reported when it carries an id', () => {
  const [withSession] = normalizeAlignmentRegistry([apiRow({
    ffs: { sessionId: 55, createdAt: '2026-06-02T00:00:00.000Z', featureCount: 900, summary: { pass: 700, fail: 12, note: 'x' }, sessionCount: 2 },
    stage: 'assessed',
  })]);
  assert.equal(withSession.ffs?.sessionId, '55');
  assert.equal(withSession.ffs?.sessionCount, 2);
  assert.deepEqual(withSession.ffs?.summary, { pass: 700, fail: 12, note: 'x' });

  const [without] = normalizeAlignmentRegistry([apiRow({ ffs: { featureCount: 3 } })]);
  assert.equal(without.ffs, null);
});

test('a row offers the FFS action it actually has, never both', () => {
  const [aligned] = normalizeAlignmentRegistry([apiRow({ stage: 'aligned', review: { reviewedCount: 0, selectedCount: 0 } })]);
  const alignedView = presentAlignmentRow(aligned);
  assert.equal(alignedView.openFfsHref, null);
  assert.equal(alignedView.runFfsHref, '/ffs?sessionId=12');

  const [assessed] = normalizeAlignmentRegistry([apiRow({
    stage: 'assessed',
    ffs: { sessionId: '55', createdAt: null, featureCount: 900, summary: {}, sessionCount: 1 },
  })]);
  const assessedView = presentAlignmentRow(assessed);
  assert.equal(assessedView.openFfsHref, '/ffs/results?ffsSessionId=55');
  // The old table put a "run FFS" button on every row including this one, which
  // was the only way to reach a filed assessment — and quietly produced a second
  // assessment of the same features.
  assert.equal(assessedView.runFfsHref, null);
});

test('a session with no result offers neither an FFS run nor a result to open', () => {
  const [running] = normalizeAlignmentRegistry([apiRow({
    status: 'in_progress',
    stage: 'running',
    result: { available: false, completedAt: null },
  })]);
  const view = presentAlignmentRow(running);

  assert.equal(view.resultHref, null);
  assert.equal(view.runFfsHref, null);
  assert.equal(view.tone, 'progress');
});

test('a released session says how many features were released', () => {
  const [row] = normalizeAlignmentRegistry([apiRow()]);
  assert.match(presentAlignmentRow(row).note, /18 feature/);
});

test('registry counters split what is done from what is waiting', () => {
  const rows = normalizeAlignmentRegistry([
    apiRow({ id: '1', stage: 'assessed', ffs: { sessionId: '5', featureCount: 10, summary: {}, sessionCount: 1 } }),
    apiRow({ id: '2', stage: 'aligned' }),
    apiRow({ id: '3', stage: 'released' }),
    apiRow({ id: '4', stage: 'running', status: 'in_progress' }),
  ]) as AlignmentRegistryRow[];

  assert.deepEqual(summarizeAlignmentRegistry(rows), {
    total: 4,
    assessed: 1,
    awaitingAssessment: 2,
    running: 1,
    anomalies: 4 * 1_204,
  });
});
