import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildComparisonLanes,
  buildProjector,
  classifyFeatureKind,
  featureAxisValue,
  formatClockLabel,
  laneFeaturesInWindow,
  laneJoints,
  laneReadoutAt,
  placeLane,
  type ComparisonRow,
} from '../src/domain/comparisonLanes.ts';

function gwRow(overrides: ComparisonRow): ComparisonRow {
  return {
    'Result Group': 'GW',
    'Feature Type OLD': 'Girth Weld',
    'Feature Type NEW': 'Girth Weld',
    ...overrides,
  };
}

function anomalyRow(overrides: ComparisonRow): ComparisonRow {
  return {
    'Result Group': 'ANOMALY',
    'Feature Type OLD': 'Metal Loss',
    'Feature Type NEW': 'Metal Loss',
    ...overrides,
  };
}

// 2018 -> 2021, single pair. The engine maps OLD onto the NEW odometer and
// leaves NEW untouched.
const twoRunRows: ComparisonRow[] = [
  gwRow({
    'Identif. OLD': 'GW-O-1', 'Identif. NEW': 'GW-N-1',
    'Source Key OLD': 'old:gw1', 'Source Key NEW': 'new:gw1',
    'Original Log Dist OLD (m)': 100, 'Log Dist OLD (m)': 102,
    'Original Log Dist NEW (m)': 102, 'Log Dist NEW (m)': 102,
    'Run Year OLD': 2018, 'Run Year NEW': 2021,
  }),
  gwRow({
    'Identif. OLD': 'GW-O-2', 'Identif. NEW': 'GW-N-2',
    'Source Key OLD': 'old:gw2', 'Source Key NEW': 'new:gw2',
    'Original Log Dist OLD (m)': 112, 'Log Dist OLD (m)': 114,
    'Original Log Dist NEW (m)': 114, 'Log Dist NEW (m)': 114,
    'Run Year OLD': 2018, 'Run Year NEW': 2021,
  }),
  anomalyRow({
    'Identif. OLD': 'A-O-1', 'Identif. NEW': 'A-N-1',
    'Source Key OLD': 'old:a1', 'Source Key NEW': 'new:a1',
    'Original Log Dist OLD (m)': 105.4, 'Log Dist OLD (m)': 107.4,
    'Original Log Dist NEW (m)': 107.5, 'Log Dist NEW (m)': 107.5,
    "O'Clock OLD": '1:30', "O'Clock NEW": '1:30',
    'Depth OLD (%WT)': 22, 'Depth NEW (%WT)': 31,
    'Dist GW OLD (m)': 5.4, 'Dist GW NEW (m)': 5.5,
    'Surface OLD': 'EXT', 'Surface NEW': 'EXT',
    'Run Year OLD': 2018, 'Run Year NEW': 2021,
  }),
  anomalyRow({
    'Identif. OLD': '-', 'Identif. NEW': 'A-N-2',
    'Source Key OLD': '-', 'Source Key NEW': 'new:a2',
    'Log Dist OLD (m)': '-', 'Original Log Dist OLD (m)': '-',
    'Original Log Dist NEW (m)': 110.2, 'Log Dist NEW (m)': 110.2,
    "O'Clock NEW": '6:00', 'Depth NEW (%WT)': 12,
    'Run Year OLD': 2018, 'Run Year NEW': 2021,
  }),
];

test('a single pair produces two lanes, one per inspection run', () => {
  const model = buildComparisonLanes(twoRunRows);
  assert.equal(model.pairCount, 1);
  assert.deepEqual(model.lanes.map((lane) => lane.label), ['ILI 2018', 'ILI 2021']);
  assert.equal(model.lanes[1].isMaster, true);
  assert.deepEqual(model.unalignedRuns, []);
});

test('each lane keeps its own reported log distance and never borrows the other run\'s', () => {
  const [older, master] = buildComparisonLanes(twoRunRows).lanes;
  const olderAnomaly = older.features.find((feature) => feature.id === 'A-O-1');
  const masterAnomaly = master.features.find((feature) => feature.id === 'A-N-1');

  assert.equal(olderAnomaly?.rawM, 105.4);
  assert.equal(masterAnomaly?.rawM, 107.5);
  // Calibrated view snaps a matched pair onto its partner's own raw distance
  // (107.5), not the engine's mapped-but-approximate 107.4, so matched
  // features sit at the exact same X on the chart.
  assert.equal(olderAnomaly?.alignedM, 107.5);
  assert.equal(masterAnomaly?.alignedM, 107.5);
  assert.equal(featureAxisValue(olderAnomaly!, 'raw'), 105.4);
  assert.equal(featureAxisValue(olderAnomaly!, 'aligned'), 107.5);
});

test('girth welds stay on the lane of the run that reported them', () => {
  const [older, master] = buildComparisonLanes(twoRunRows).lanes;
  assert.deepEqual(older.gws.map((gw) => gw.rawM), [100, 112]);
  assert.deepEqual(master.gws.map((gw) => gw.rawM), [102, 114]);
});

test('clock position is carried through at full resolution', () => {
  const [older] = buildComparisonLanes(twoRunRows).lanes;
  const anomaly = older.features.find((feature) => feature.id === 'A-O-1');
  assert.equal(anomaly?.clockHours, 1.5);
  assert.equal(anomaly?.clockDeg, 45);
  assert.equal(anomaly?.clockLabel, '01:30');
  assert.equal(anomaly?.usGwM, 5.4);
  assert.equal(anomaly?.external, true);
});

test('a feature missing from the older run is flagged new, not matched', () => {
  const master = buildComparisonLanes(twoRunRows).lanes[1];
  const fresh = master.features.find((feature) => feature.id === 'A-N-2');
  assert.equal(fresh?.matchedBack, false);
  assert.equal(fresh?.status, 'new');
  const carried = master.features.find((feature) => feature.id === 'A-N-1');
  assert.equal(carried?.matchedBack, true);
  // Nothing newer than the master exists, so there is no forward verdict.
  assert.equal(carried?.matchedForward, null);
  assert.equal(carried?.status, 'persistent');
});

// 2018 -> 2021 -> 2024. The 2021 run is the NEW side of pair 0 and the OLD side
// of pair 1, so it must collapse into a single lane.
const threeRunRows: ComparisonRow[] = [
  gwRow({
    pair_index: 0, pair_old_year: 2018, pair_new_year: 2021,
    'Identif. OLD': 'GW18-1', 'Identif. NEW': 'GW21-1',
    'Source Key OLD': 'r18:gw1', 'Source Key NEW': 'r21:gw1',
    'Original Log Dist OLD (m)': 100, 'Log Dist OLD (m)': 102,
    'Original Log Dist NEW (m)': 102, 'Log Dist NEW (m)': 102,
  }),
  gwRow({
    pair_index: 0, pair_old_year: 2018, pair_new_year: 2021,
    'Identif. OLD': 'GW18-2', 'Identif. NEW': 'GW21-2',
    'Source Key OLD': 'r18:gw2', 'Source Key NEW': 'r21:gw2',
    'Original Log Dist OLD (m)': 200, 'Log Dist OLD (m)': 203,
    'Original Log Dist NEW (m)': 203, 'Log Dist NEW (m)': 203,
  }),
  anomalyRow({
    pair_index: 0, pair_old_year: 2018, pair_new_year: 2021,
    'Identif. OLD': 'A18-1', 'Identif. NEW': 'A21-1',
    'Source Key OLD': 'r18:a1', 'Source Key NEW': 'r21:a1',
    'Original Log Dist OLD (m)': 150, 'Log Dist OLD (m)': 152.5,
    'Original Log Dist NEW (m)': 152.5, 'Log Dist NEW (m)': 152.5,
    "O'Clock OLD": '3:00', "O'Clock NEW": '3:00',
  }),
  gwRow({
    pair_index: 1, pair_old_year: 2021, pair_new_year: 2024,
    'Identif. OLD': 'GW21-1', 'Identif. NEW': 'GW24-1',
    'Source Key OLD': 'r21:gw1', 'Source Key NEW': 'r24:gw1',
    'Original Log Dist OLD (m)': 102, 'Log Dist OLD (m)': 105,
    'Original Log Dist NEW (m)': 105, 'Log Dist NEW (m)': 105,
  }),
  gwRow({
    pair_index: 1, pair_old_year: 2021, pair_new_year: 2024,
    'Identif. OLD': 'GW21-2', 'Identif. NEW': 'GW24-2',
    'Source Key OLD': 'r21:gw2', 'Source Key NEW': 'r24:gw2',
    'Original Log Dist OLD (m)': 203, 'Log Dist OLD (m)': 207,
    'Original Log Dist NEW (m)': 207, 'Log Dist NEW (m)': 207,
  }),
  anomalyRow({
    pair_index: 1, pair_old_year: 2021, pair_new_year: 2024,
    'Identif. OLD': 'A21-1', 'Identif. NEW': 'A24-1',
    'Source Key OLD': 'r21:a1', 'Source Key NEW': 'r24:a1',
    'Original Log Dist OLD (m)': 152.5, 'Log Dist OLD (m)': 155.9,
    'Original Log Dist NEW (m)': 155.9, 'Log Dist NEW (m)': 155.9,
    "O'Clock OLD": '3:00', "O'Clock NEW": '3:00',
  }),
];

test('a three-run chain produces three lanes, with the shared run folded into one', () => {
  const model = buildComparisonLanes(threeRunRows);
  assert.equal(model.pairCount, 2);
  assert.deepEqual(model.lanes.map((lane) => lane.label), ['ILI 2018', 'ILI 2021', 'ILI 2024']);
  const middle = model.lanes[1];
  assert.deepEqual(middle.features.map((feature) => feature.id), ['GW21-1', 'A21-1', 'GW21-2']);
  assert.deepEqual(middle.gws.map((gw) => gw.rawM), [102, 203]);
});

test('the shared run reports both a backward and a forward match verdict', () => {
  const middle = buildComparisonLanes(threeRunRows).lanes[1];
  const anomaly = middle.features.find((feature) => feature.id === 'A21-1');
  assert.equal(anomaly?.matchedBack, true);
  assert.equal(anomaly?.matchedForward, true);
  assert.equal(anomaly?.status, 'persistent');
});

test('the oldest run of a chain is composed onto the newest odometer through the intermediate pair', () => {
  const model = buildComparisonLanes(threeRunRows);
  const [oldest, middle, master] = model.lanes;
  const oldestGw = oldest.gws.find((gw) => gw.id === 'GW18-1');

  // Reported 2018 distance is untouched...
  assert.equal(oldestGw?.rawM, 100);
  // ...while the aligned position walks 100 -> 102 (2021) -> 105 (2024).
  assert.equal(oldestGw?.alignedM, 105);
  assert.equal(oldest.alignedIsDerived, true);
  assert.equal(middle.features.find((feature) => feature.id === 'A21-1')?.alignedM, 155.9);
  assert.equal(middle.alignedIsDerived, false);
  assert.equal(master.gws.every((gw) => gw.alignedM === gw.rawM), true);
  assert.deepEqual(model.unalignedRuns, []);
});

test('composing a chain interpolates between the matched welds of the intermediate pair', () => {
  const oldest = buildComparisonLanes(threeRunRows).lanes[0];
  const anomaly = oldest.features.find((feature) => feature.id === 'A18-1');
  // The engine put this anomaly at 152.5 on the 2021 odometer. 152.5 sits
  // halfway between the 2021 welds at 102 and 203, whose 2024 positions are
  // 105 and 207, so the composed position lands halfway between those too.
  assert.equal(anomaly?.rawM, 150);
  assert.equal(anomaly?.alignedM, 156);
});

test('joint length is reported from the run own odometer even on the aligned axis', () => {
  const [oldest] = buildComparisonLanes(threeRunRows).lanes;
  const rawJoints = laneJoints(oldest, 'raw');
  const alignedJoints = laneJoints(oldest, 'aligned');

  assert.equal(rawJoints.length, 1);
  assert.equal(rawJoints[0].trueLengthM, 100);
  assert.equal(rawJoints[0].spanM, 100);
  // The aligned axis stretches the drawn span but the stated joint length is
  // still the real one from the 2018 tally.
  assert.equal(alignedJoints[0].spanM, 102);
  assert.equal(alignedJoints[0].trueLengthM, 100);
});

test('reading a lane at a point on the aligned axis returns that run true log distance', () => {
  const [oldest] = buildComparisonLanes(threeRunRows).lanes;
  const readout = laneReadoutAt(placeLane(oldest, 'aligned'), 105);
  assert.ok(Math.abs((readout.trueLdM ?? 0) - 100) < 1e-6);
  assert.equal(readout.jointIndex, 0);
  assert.equal(readout.usGwM, 0);
  assert.equal(readout.usGwId, 'GW18-1');
  assert.equal(readout.jointLengthM, 100);
  assert.equal(readout.interpolated, true);
});

test('reading a lane on the raw axis reports the distance from the upstream weld', () => {
  const [oldest] = buildComparisonLanes(threeRunRows).lanes;
  const readout = laneReadoutAt(placeLane(oldest, 'raw'), 150);
  assert.equal(readout.trueLdM, 150);
  assert.equal(readout.usGwM, 50);
  assert.equal(readout.usGwId, 'GW18-1');
  assert.equal(readout.interpolated, false);
});

test('a run with no alignment evidence is reported instead of being drawn at a guessed position', () => {
  const rows: ComparisonRow[] = [
    anomalyRow({
      pair_index: 0, pair_old_year: 2018, pair_new_year: 2021,
      'Identif. OLD': 'A18', 'Identif. NEW': '-',
      'Source Key OLD': 'r18:a', 'Source Key NEW': '-',
      'Original Log Dist OLD (m)': 10, 'Log Dist OLD (m)': '-',
      'Original Log Dist NEW (m)': '-', 'Log Dist NEW (m)': '-',
    }),
    anomalyRow({
      pair_index: 1, pair_old_year: 2021, pair_new_year: 2024,
      'Identif. OLD': '-', 'Identif. NEW': 'A24',
      'Source Key OLD': '-', 'Source Key NEW': 'r24:a',
      'Original Log Dist NEW (m)': 40, 'Log Dist NEW (m)': 40,
    }),
  ];
  const model = buildComparisonLanes(rows);
  assert.deepEqual(model.unalignedRuns, ['ILI 2018']);
  assert.equal(model.lanes[0].features[0].alignedM, null);
  assert.equal(model.lanes[0].features[0].rawM, 10);
});

test('window thinning keeps welds and the deepest anomalies, and reports what was hidden', () => {
  const rows: ComparisonRow[] = [
    gwRow({
      'Identif. OLD': 'GW-1', 'Identif. NEW': 'GW-1n',
      'Source Key OLD': 'o:gw', 'Source Key NEW': 'n:gw',
      'Original Log Dist OLD (m)': 0, 'Log Dist OLD (m)': 0,
      'Original Log Dist NEW (m)': 0, 'Log Dist NEW (m)': 0,
    }),
    ...[5, 15, 45, 25].map((depth, index) => anomalyRow({
      'Identif. OLD': `A-${index}`, 'Identif. NEW': '-',
      'Source Key OLD': `o:a${index}`, 'Source Key NEW': '-',
      'Original Log Dist OLD (m)': index + 1, 'Log Dist OLD (m)': index + 1,
      'Depth OLD (%WT)': depth,
    })),
  ];
  const [lane] = buildComparisonLanes(rows).lanes;
  const window = laneFeaturesInWindow(placeLane(lane, 'raw'), 0, 10, 3);

  assert.equal(window.total, 5);
  assert.deepEqual(window.features.map((feature) => feature.id), ['GW-1', 'A-2', 'A-3']);
  assert.deepEqual(window.features.map((feature) => feature.position), [0, 3, 4]);
});

test('a window only reaches the features inside it, whatever sits outside', () => {
  const rows: ComparisonRow[] = [0, 5, 10, 15, 20].map((distance, index) => anomalyRow({
    'Identif. OLD': `A-${index}`, 'Identif. NEW': '-',
    'Source Key OLD': `o:a${index}`, 'Source Key NEW': '-',
    'Original Log Dist OLD (m)': distance, 'Log Dist OLD (m)': distance,
  }));
  const placement = placeLane(buildComparisonLanes(rows).lanes[0], 'raw');

  assert.deepEqual(laneFeaturesInWindow(placement, 4, 16, 50).features.map((f) => f.position), [5, 10, 15]);
  assert.deepEqual(laneFeaturesInWindow(placement, 21, 30, 50).features, []);
  assert.equal(laneFeaturesInWindow(placement, -5, 100, 50).features.length, 5);
});

test('buildProjector interpolates between anchors and extrapolates past them', () => {
  const project = buildProjector([{ from: 0, to: 10 }, { from: 100, to: 210 }]);
  assert.equal(project?.(0), 10);
  assert.equal(project?.(50), 110);
  assert.equal(project?.(100), 210);
  assert.equal(project?.(200), 410);
  assert.equal(project?.(-10), -10);
});

test('buildProjector degrades to a constant offset on one anchor and to null on none', () => {
  assert.equal(buildProjector([])?.(1), undefined);
  assert.equal(buildProjector([]), null);
  assert.equal(buildProjector([{ from: 5, to: 8 }])?.(100), 103);
});

test('feature kinds are read from the vendor feature type, falling back to the result group', () => {
  assert.equal(classifyFeatureKind('Girth Weld', 'GW'), 'weld');
  assert.equal(classifyFeatureKind('Metal Loss', 'ANOMALY'), 'anomaly');
  assert.equal(classifyFeatureKind('Ball Valve', 'BYPASSED'), 'valve');
  assert.equal(classifyFeatureKind('', 'GW'), 'weld');
  assert.equal(classifyFeatureKind('Casing', 'BYPASSED'), 'other');
});

test('clock labels round to whole minutes and wrap at twelve', () => {
  assert.equal(formatClockLabel(0), '12:00');
  assert.equal(formatClockLabel(1.5), '01:30');
  assert.equal(formatClockLabel(11.999), '12:00');
  assert.equal(formatClockLabel(null), '-');
});
