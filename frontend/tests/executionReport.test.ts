import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executionContextLines,
  executionResultLines,
} from '../src/wizard/executionReport.ts';

test('execution context reports real input and matcher settings', () => {
  const lines = executionContextLines({
    sessionName: 'Line A',
    algorithm: 'dtw_hungarian',
    summaryData: {
      masterRun: { name: '2024.xlsx', year: 2024, totalRecords: 120 },
      historicalRuns: [{ name: '2019.xlsx', year: 2019, totalRecords: 100 }],
    },
    ToleranceConfig: {
      clock_tolerance: 15,
      ds_gw_distance_tolerance: 0.2,
      length_tolerance: 50,
    },
  });

  assert.ok(lines.some((line) => line.includes('Line A')));
  assert.ok(lines.some((line) => line.includes('220 source rows')));
  assert.ok(lines.some((line) => line.includes('Clock 15')));
});

test('execution result reports match groups and conservation evidence', () => {
  const lines = executionResultLines({
    comparison: [
      { 'Match/Unmatch': 'Matched' },
      { match_status: 'Only OLD' },
      { 'Match/Unmatch': 'Matched' },
    ],
    groups: {
      audit: {
        isConserved: true,
        old: { inputCount: 2, outputReferences: 2 },
        new: { inputCount: 1, outputReferences: 1 },
      },
    },
  });

  assert.ok(lines.some((line) => line.includes('3 result rows')));
  assert.ok(lines.some((line) => line.includes('Matched 2')));
  assert.ok(lines.some((line) => line.includes('OLD 2/2')));
});
