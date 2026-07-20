import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPersistedIliRun,
  ingestPersistedInspectionRunPair,
} from '../src/domain/alignmentIntake.ts';

test('builds a small persisted run reference from server ingestion evidence', () => {
  const run = buildPersistedIliRun({
    pipeline_run_id: 31,
    run_summary: {
      total: 120_000,
      anomalies: 24_000,
      welds: 8_200,
      valves: 2,
      tees: 4,
      offtakes: 3,
      bends: 20,
      others: 87_771,
      gw_anchors: 8_206,
      invalid_anchor_distances: 0,
    },
  }, {
    name: 'north-line-2026.xlsx',
    vendor: 'Vendor A',
    year: '2026',
    tool: 'MFL',
  });

  assert.deepEqual(run, {
    runId: 31,
    name: 'north-line-2026.xlsx',
    vendor: 'Vendor A',
    year: '2026',
    tool: 'MFL',
    total: 120_000,
    anomalies: 24_000,
    welds: 8_200,
    valves: 2,
    tees: 4,
    offtakes: 3,
    bends: 20,
    others: 87_771,
    gwAnchors: 8_206,
    invalidAnchorDistances: 0,
  });
  assert.equal('rawFeatures' in run, false);
});

test('falls back to measured audit counts when a legacy ingest response has no run summary', () => {
  const run = buildPersistedIliRun({
    pipeline_run_id: 7,
    audit: { accepted_rows: 3, feature_counts: { welds: 1, gw_anchors: 1 } },
  }, { name: 'a.csv', vendor: '', year: '', tool: '' });

  assert.equal(run.total, 3);
  assert.equal(run.welds, 1);
  assert.equal(run.gwAnchors, 1);
  assert.equal(run.anomalies, 0);
});

test('persists every selected inspection run before forming the master and historical pair', async () => {
  const selectedRuns = [
    { file: { name: 'north-line-2021.xlsx' }, vendor: 'Vendor A', year: '2021', tool: 'MFL' },
    { file: { name: 'north-line-2026.xlsx' }, vendor: 'Vendor B', year: '2026', tool: 'MFL' },
  ];
  const ingestedFiles: string[] = [];

  const pair = await ingestPersistedInspectionRunPair({
    datasets: selectedRuns,
    masterIndex: 1,
    ingest: async (dataset) => {
      ingestedFiles.push(dataset.file.name);
      return buildPersistedIliRun({
        pipeline_run_id: dataset.file.name.includes('2026') ? 26 : 21,
        run_summary: { total: 10, welds: 2, gw_anchors: 2 },
      }, {
        name: dataset.file.name,
        vendor: dataset.vendor,
        year: dataset.year,
        tool: dataset.tool,
      });
    },
  });

  assert.deepEqual(ingestedFiles, ['north-line-2021.xlsx', 'north-line-2026.xlsx']);
  assert.equal(pair.newRun.runId, 26);
  assert.equal(pair.oldRun.runId, 21);
  assert.equal(pair.masterRun.name, 'north-line-2026.xlsx');
  assert.deepEqual(pair.historicalRuns.map((run) => run.runId), [21]);
});

test('starts every selected run ingestion before waiting for the first completion', async () => {
  const selectedRuns = [
    { file: { name: 'north-line-2021.xlsx' }, vendor: 'Vendor A', year: '2021', tool: 'MFL' },
    { file: { name: 'north-line-2026.xlsx' }, vendor: 'Vendor B', year: '2026', tool: 'MFL' },
  ];
  const startedIndexes: number[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstIngestion = new Promise<void>((resolve) => { releaseFirst = resolve; });

  const pairPromise = ingestPersistedInspectionRunPair({
    datasets: selectedRuns,
    masterIndex: 1,
    ingest: async (dataset, index) => {
      startedIndexes.push(index);
      if (index === 0) await firstIngestion;
      return buildPersistedIliRun({
        pipeline_run_id: index + 1,
        run_summary: { total: 10, welds: 2, gw_anchors: 2 },
      }, {
        name: dataset.file.name,
        vendor: dataset.vendor,
        year: dataset.year,
        tool: dataset.tool,
      });
    },
  });

  try {
    await Promise.resolve();
    assert.deepEqual(startedIndexes, [0, 1]);
  } finally {
    releaseFirst?.();
    await pairPromise;
  }
});
