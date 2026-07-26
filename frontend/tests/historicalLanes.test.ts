import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHistoricalLanes,
  displayDistanceOnMaster,
  parseWallThicknessMm,
} from '../src/sectioning/historicalLanes.ts';

test('buildHistoricalLanes renders primary OLD GWs from comparison rows when run metadata has no raw features', () => {
  const lanes = buildHistoricalLanes(
    [{ name: 'ILI 2021', year: '2021' }],
    [{ old_id: 'OLD-002', old_odometer: 120, new_id: 'NEW-002', new_odometer: 125 }],
    [
      { 'Feature Type OLD': 'Weld', 'Identif. OLD': 'OLD-001', 'Log Dist OLD (m)': 10 },
      { 'Feature Type OLD': 'Weld', 'Identif. OLD': 'OLD-002', 'Log Dist OLD (m)': 120 },
      { 'Feature Type OLD': 'Metal loss', 'Identif. OLD': 'ML-001', 'Log Dist OLD (m)': 121 },
    ],
  );

  assert.deepEqual(lanes[0].gws.map((gw) => ({ id: gw.id, dist: gw.dist, status: gw.status })), [
    { id: 'OLD-001', dist: 10, status: 'MISSING_IN_MASTER' },
    { id: 'OLD-002', dist: 120, status: 'MATCHED' },
  ]);
});

test('buildHistoricalLanes renders locked OLD GWs when comparison rows omit OLD weld records', () => {
  const lanes = buildHistoricalLanes(
    [{ name: 'ILI 2021', year: '2021' }],
    [
      { old_id: 'OLD-001', old_odometer: 10, new_id: 'NEW-001', new_odometer: 12 },
      { old_id: 'OLD-002', old_odometer: 120, new_id: 'NEW-002', new_odometer: 125 },
    ],
    [
      { 'Feature Type OLD': 'Weld', 'Identif. OLD': 'OLD-001', 'Log Dist OLD (m)': 10 },
      { 'Feature Type OLD': 'Metal loss', 'Identif. OLD': 'ML-001', 'Log Dist OLD (m)': 121 },
    ],
  );

  assert.deepEqual(lanes[0].gws.map((gw) => ({
    id: gw.id,
    dist: gw.dist,
    masterDistance: gw.rawData.masterDistance,
    status: gw.status,
  })), [
    { id: 'OLD-001', dist: 10, masterDistance: 12, status: 'MATCHED' },
    { id: 'OLD-002', dist: 120, masterDistance: 125, status: 'MATCHED' },
  ]);
});

test('buildHistoricalLanes reads a run that persisted its own raw features and keeps bends separate', () => {
  const [lane] = buildHistoricalLanes(
    [{
      name: 'ILI 2019',
      year: '2019',
      rawFeatures: [
        { id: 'OLD-1', type: 'Girth Weld', dist: 10 },
        { id: 'OLD-2', type: 'Girth Weld', dist: 20 },
        { id: 'OLD-B', type: 'Bend', dist: 15 },
      ],
    }],
    [{ old_id: 'OLD-1', old_odometer: 10, new_id: 'NEW-1', new_odometer: 12 }],
    [],
  );

  assert.deepEqual(lane.gws.map((gw) => ({ id: gw.id, status: gw.status })), [
    { id: 'OLD-1', status: 'MATCHED' },
    { id: 'OLD-2', status: 'MISSING_IN_MASTER' },
  ]);
  assert.deepEqual(lane.bends.map((bend) => bend.id), ['OLD-B']);
  assert.equal(lane.gws[0].rawData.sourceDistance, 10, 'keeps the original OLD odometer');
  assert.equal(displayDistanceOnMaster(lane.gws[1]), 20, 'unmatched welds stay at their own distance');
});

test('buildHistoricalLanes leaves runs beyond the primary lane unresolved instead of claiming a match', () => {
  const lanes = buildHistoricalLanes(
    [
      { name: 'ILI 2021', year: '2021', rawFeatures: [{ id: 'OLD-1', type: 'Weld', dist: 10 }] },
      { name: 'ILI 2015', year: '2015', rawFeatures: [{ id: 'OLD15-1', type: 'Weld', dist: 11 }] },
    ],
    [{ old_id: 'OLD-1', old_odometer: 10, new_id: 'NEW-1', new_odometer: 12 }],
    [],
  );

  assert.equal(lanes.length, 2);
  assert.deepEqual(lanes[1].gws.map((gw) => gw.status), ['UNRESOLVED']);
});

test('buildHistoricalLanes tolerates a missing or empty run list', () => {
  assert.deepEqual(buildHistoricalLanes(undefined, [], []), []);
  assert.deepEqual(buildHistoricalLanes([], [], []), []);
});

test('wall thickness is read from the varied column names ILI vendors ship', () => {
  assert.equal(parseWallThicknessMm({ wall_thickness_mm: 9.5 }), 9.5);
  assert.equal(parseWallThicknessMm({ 'Wall WT NEW (mm)': '12,7' }), 12.7);
  assert.equal(parseWallThicknessMm({ 'Nominal Wall Thickness': '  8.1 ' }), 8.1);
  assert.equal(parseWallThicknessMm({ unrelated: 5 }), null);
  assert.equal(parseWallThicknessMm(undefined), null);
});

test('displayDistanceOnMaster uses a matched OLD GW master coordinate', () => {
  assert.equal(displayDistanceOnMaster({
    id: 'OLD-002',
    dist: 120,
    type: 'weld',
    runRole: 'HISTORICAL',
    status: 'MATCHED',
    rawData: { masterDistance: 125 },
    lat: Number.NaN,
    lng: Number.NaN,
  }), 125);
});
