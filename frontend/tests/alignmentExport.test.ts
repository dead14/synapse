import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAlignmentExportPayload,
  createExcelExportRows,
  createPipelineExportData,
  createRuncompReportRows,
} from '../src/utils/alignmentExport.ts';

test('creates compact Excel export rows using the report fields and aliases', () => {
  const source = {
    'Abs. Dist NEW (m)': 1868.81,
    'Feature Type NEW': 'girth weld',
    'Identif. NEW': 16235,
    'Joint Number NEW': 44,
    'Joint Length NEW (m)': 12.5,
    'Dist to US GW NEW (m)': 0,
    'Wall Thickness NEW (mm)': 8.7,
    "O'Clock NEW": '3:00',
    'Length NEW (mm)': 0,
    'Width NEW (mm)': 15,
    'Depth NEW (%WT)': 20,
    'Surface NEW': 'external',
    'ERF ASME NEW': 0.95,
    'Psafe NEW (bar)': 99,
    'Comment NEW': 'verified',
    'Log Dist OLD (m)': 4.243,
    match_status: 'Matched',
    __resultGroup: 'GW',
    'Internal only': 'must not be exported',
  };

  const [row] = createExcelExportRows([source]);

  assert.deepEqual(row, {
    'Log Dist NEW (m)': 1868.81,
    'Feature Type NEW': 'girth weld',
    'Identif. NEW': 16235,
    'Joint No. NEW': 44,
    'Joint Len NEW (m)': 12.5,
    'Dist GW NEW (m)': 0,
    'Wall WT NEW (mm)': 8.7,
    "O'Clock NEW": '3:00',
    'Length NEW (mm)': 0,
    'Width NEW (mm)': 15,
    'Depth NEW (%WT)': 20,
    'Surface NEW': 'external',
    'ERF ASME NEW': 0.95,
    'Psafe NEW (bar)': 99,
    'Comment NEW': 'verified',
    'Log Dist OLD (m)': 4.243,
    'Match/Unmatch': 'Matched',
  });
  assert.equal(Object.hasOwn(row, '__resultGroup'), false);
  assert.equal(Object.hasOwn(row, 'Internal only'), false);
  assert.equal(source['Dist to US GW NEW (m)'], 0);
});

test('creates a complete runcomp report while removing browser-only metadata', () => {
  const [row] = createRuncompReportRows([{
    'Run Pair': '2021 → 2026',
    'Result Group': 'ANOMALY',
    'Match/Unmatch': 'Matched',
    'Depth NEW (%WT)': 23,
    'Physics Warning': '',
    __origIdx: 4,
    __intervention: { excluded: false },
  }]);

  assert.deepEqual(row, {
    'Run Pair': '2021 → 2026',
    'Result Group': 'ANOMALY',
    'Match/Unmatch': 'Matched',
    'Depth NEW (%WT)': 23,
    'Physics Warning': '',
  });
});

test('serializes structured engine evidence into safe report cells', () => {
  const [row] = createRuncompReportRows([{
    physics_warnings: [{ code: 'DEPTH_DECREASE' }],
    scalar: 4,
  }]);

  assert.equal(row.physics_warnings, '[{"code":"DEPTH_DECREASE"}]');
  assert.equal(row.scalar, 4);
});

test('sends one report row set and lets the server reuse it for comparison', () => {
  const payload = createAlignmentExportPayload(
    [{ 'Match/Unmatch': 'Matched', __origIdx: 7 }],
    { pipelineName: 'North Line' },
  );

  assert.deepEqual(payload, {
    pipelineData: { pipelineName: 'North Line' },
    report: [{ 'Match/Unmatch': 'Matched' }],
  });
  assert.equal(Object.hasOwn(payload, 'comparison'), false);
});

test('pipeline export keeps uploaded metadata and derives inspection runs for legacy sessions', () => {
  const pipeline = createPipelineExportData({
    pipelineData: { pipelineName: 'North Line', environment: 'Onshore' },
    summaryData: {
      masterRun: { runId: 2, year: '2026', vendor: 'NEW Vendor', name: 'new.xlsx', total: 20 },
      historicalRuns: [
        { runId: 1, year: '2021', vendor: 'OLD Vendor', name: 'old.xlsx', total: 18 },
      ],
    },
  });

  assert.equal(pipeline.pipelineName, 'North Line');
  assert.deepEqual(pipeline.inspectionRuns, [
    { role: 'Master', year: '2026', vendor: 'NEW Vendor', fileName: 'new.xlsx', runId: 2, total: 20 },
    { role: 'Historical', year: '2021', vendor: 'OLD Vendor', fileName: 'old.xlsx', runId: 1, total: 18 },
  ]);
});
