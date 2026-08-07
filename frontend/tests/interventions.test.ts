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

const matched = (oldKey: string, newKey: string, distance: number, featureType = 'Metal Loss') => ({
  'Source Key OLD': oldKey,
  'Source Key NEW': newKey,
  'Identif. OLD': oldKey,
  'Identif. NEW': newKey,
  'Log Dist OLD (m)': distance,
  'Log Dist NEW (m)': distance,
  'Feature Type OLD': featureType,
  'Feature Type NEW': featureType,
  'Match/Unmatch': 'Matched',
  pair_index: 0,
});

test('a matched valve can be excluded — the reviewer decides what leaves the report', () => {
  const rows = [
    matched('old:valve', 'new:valve', 30, 'Ball Valve'),
    matched('old:tee', 'new:tee', 40, 'Tee'),
  ];
  const events: InterventionEvent[] = [{
    id: 'exclude-valve',
    type: 'EXCLUDE_FEATURE',
    side: 'PAIR',
    pairIndex: 0,
    sourceKey: 'old:valve',
  }];

  const result = applyInterventions(rows, events);

  assert.deepEqual(result.map(isExcludedRow), [true, false]);
  assert.equal(includedInterventionRows(result).length, 1);
});

test('a range over matched rows excludes every pair between the endpoints', () => {
  const rows = [
    matched('old:a', 'new:a', 10, 'Ball Valve'),
    matched('old:b', 'new:b', 20, 'Tee'),
    { ...oldOnly('old:orphan', 15), pair_index: 0 },
    matched('old:c', 'new:c', 30, 'Flange'),
    matched('old:d', 'new:d', 40, 'Bend'),
  ];
  const events: InterventionEvent[] = [{
    id: 'exclude-fittings',
    type: 'EXCLUDE_RANGE',
    side: 'PAIR',
    pairIndex: 0,
    startSourceKey: 'old:a',
    endSourceKey: 'old:c',
  }];

  const result = applyInterventions(rows, events);

  // The unmatched row inside the span keeps its own scope and is untouched.
  assert.deepEqual(result.map(isExcludedRow), [true, true, false, true, false]);
});

test('unassigning a match splits it back into an OLD-only and a NEW-only row', () => {
  const rows = [matched('old:1', 'new:1', 25)];
  const events: InterventionEvent[] = [{
    id: 'unassign-1',
    type: 'UNASSIGN_PAIR',
    sourceOldKey: 'old:1',
    sourceNewKey: 'new:1',
  }];

  const result = applyInterventions(rows, events);

  assert.equal(result.length, 2);
  assert.equal(result[0]['Source Key OLD'], 'old:1');
  assert.equal(result[0]['Source Key NEW'], '-');
  assert.equal(result[0]['Match/Unmatch'], 'Only OLD');
  assert.equal(result[1]['Source Key NEW'], 'new:1');
  assert.equal(result[1]['Source Key OLD'], '-');
  assert.equal(result[1]['Match/Unmatch'], 'Only NEW');
  assert.equal(exclusionSide(result[0]), 'OLD');
  assert.equal(exclusionSide(result[1]), 'NEW');
});

test('replaying an unassignment twice does not split a row that is already apart', () => {
  const rows = [matched('old:1', 'new:1', 25)];
  const event: InterventionEvent = {
    id: 'unassign-1',
    type: 'UNASSIGN_PAIR',
    sourceOldKey: 'old:1',
    sourceNewKey: 'new:1',
  };

  assert.equal(applyInterventions(rows, [event, { ...event, id: 'unassign-2' }]).length, 2);
});

test('a freed half can then be paired with something else, from either side', () => {
  const rows = [
    matched('old:1', 'new:1', 25),
    { ...oldOnly('old:2', 26), pair_index: 0 },
    { ...newOnly('new:3', 60), pair_index: 0 },
    { ...oldOnly('old:3', 61), pair_index: 0 },
  ];
  const events: InterventionEvent[] = [
    { id: 'unassign-1', type: 'UNASSIGN_PAIR', sourceOldKey: 'old:1', sourceNewKey: 'new:1' },
    { id: 'reassign-new', type: 'REASSIGN_NEW', sourceNewKey: 'new:1', targetOldKey: 'old:2', evidenceScore: 80 },
    { id: 'reassign-old', type: 'REASSIGN_OLD', sourceOldKey: 'old:3', targetNewKey: 'new:3', evidenceScore: 70 },
  ];

  const result = applyInterventions(rows, events);
  const byOldKey = (key: string) => result.find((row) => row['Source Key OLD'] === key);

  // The NEW half moved onto the orphan OLD row that was next to it.
  assert.equal(byOldKey('old:2')?.['Source Key NEW'], 'new:1');
  assert.equal(byOldKey('old:2')?.['Match/Unmatch'], 'Match');
  // The OLD half moved onto the orphan NEW row, which is the mirror direction.
  const newRow = result.find((row) => row['Source Key NEW'] === 'new:3');
  assert.equal(newRow?.['Source Key OLD'], 'old:3');
  assert.equal(newRow?.['Match/Unmatch'], 'Match');
  // Nothing was overwritten: the row that gave up its OLD side is now empty of it.
  assert.equal(result.filter((row) => row['Source Key OLD'] === 'old:3').length, 1);
});

test('a reassignment never overwrites a side that is already taken', () => {
  const rows = [
    { ...newOnly('new:1', 10), pair_index: 0 },
    matched('old:2', 'new:2', 11),
  ];
  const events: InterventionEvent[] = [{
    id: 'reassign-onto-taken',
    type: 'REASSIGN_NEW',
    sourceNewKey: 'new:1',
    targetOldKey: 'old:2',
    evidenceScore: 90,
  }];

  const result = applyInterventions(rows, events);

  assert.equal(result[1]['Source Key NEW'], 'new:2');
  assert.equal(result[0]['Source Key NEW'], 'new:1');
});
