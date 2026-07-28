import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyInterventions,
  exclusionSide,
  includedInterventionRows,
  isExcludedRow,
  type InterventionEvent,
} from '../src/utils/interventions.ts';

const oldOnly = (sourceKey: string, distance: number) => ({
  'Source Key OLD': sourceKey,
  'Source Key NEW': '-',
  'Identif. OLD': sourceKey,
  'Identif. NEW': '-',
  'Log Dist OLD (m)': distance,
  'Log Dist NEW (m)': '-',
  'Match/Unmatch': 'Only OLD',
});

const newOnly = (sourceKey: string, distance: number) => ({
  'Source Key OLD': '-',
  'Source Key NEW': sourceKey,
  'Identif. OLD': '-',
  'Identif. NEW': sourceKey,
  'Log Dist OLD (m)': '-',
  'Log Dist NEW (m)': distance,
  'Match/Unmatch': 'Only NEW',
});

test('single exclusion marks only the selected unmatched side', () => {
  const rows = [
    { ...oldOnly('old:a', 10), pair_index: 1 },
    { ...oldOnly('old:a', 10), pair_index: 0 },
    { ...newOnly('new:a', 10), pair_index: 0 },
    {
      ...oldOnly('old:matched', 12),
      pair_index: 0,
      'Source Key NEW': 'new:matched',
      'Identif. NEW': 'new:matched',
      'Log Dist NEW (m)': 12,
      'Match/Unmatch': 'Matched',
    },
  ];
  const events: InterventionEvent[] = [{
    id: 'exclude-single',
    type: 'EXCLUDE_FEATURE',
    side: 'OLD',
    pairIndex: 0,
    sourceKey: 'old:a',
  }];

  const result = applyInterventions(rows, events);

  assert.equal(isExcludedRow(result[0]), false);
  assert.equal(isExcludedRow(result[1]), true);
  assert.equal(isExcludedRow(result[2]), false);
  assert.equal(isExcludedRow(result[3]), false);
  assert.equal(exclusionSide(result[1]), 'OLD');
});

test('range exclusion is inclusive, side-specific, and never hides matched rows', () => {
  const rows = [
    { ...oldOnly('old:a', 10), pair_index: 0 },
    { ...oldOnly('old:b', 20), pair_index: 0 },
    { ...newOnly('new:b', 20), pair_index: 0 },
    {
      ...oldOnly('old:matched', 25),
      pair_index: 0,
      'Source Key NEW': 'new:matched',
      'Identif. NEW': 'new:matched',
      'Log Dist NEW (m)': 25,
      'Match/Unmatch': 'Matched',
    },
    { ...oldOnly('old:c', 30), pair_index: 0 },
    { ...oldOnly('old:outside', 31), pair_index: 0 },
    { ...oldOnly('other-pair', 20), pair_index: 1 },
  ];
  const events: InterventionEvent[] = [{
    id: 'exclude-range',
    type: 'EXCLUDE_RANGE',
    side: 'OLD',
    pairIndex: 0,
    startSourceKey: 'old:a',
    endSourceKey: 'old:c',
  }];

  const result = applyInterventions(rows, events);

  assert.deepEqual(result.map(isExcludedRow), [true, true, false, false, true, false, false]);
  assert.deepEqual(result[1].__exclusionIds, ['exclude-range']);
  assert.equal(includedInterventionRows(result).length, 4);
});

test('restore event reverses the complete exclusion decision', () => {
  const rows = [oldOnly('old:a', 10), oldOnly('old:b', 20)];
  const events: InterventionEvent[] = [
    {
      id: 'exclude-range',
      type: 'EXCLUDE_RANGE',
      side: 'OLD',
      pairIndex: 0,
      startSourceKey: 'old:a',
      endSourceKey: 'old:b',
    },
    {
      id: 'restore-range',
      type: 'RESTORE_EXCLUSION',
      exclusionId: 'exclude-range',
    },
  ];

  const result = applyInterventions(rows, events);

  assert.deepEqual(result.map(isExcludedRow), [false, false]);
});
