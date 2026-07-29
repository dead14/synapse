import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMatchingSpatialFeatures } from '../src/sectioning/matchingSpatialFeatures.ts';

test('buildMatchingSpatialFeatures keeps OLD, missing, and bend evidence when runs only persist metadata', () => {
  const features = buildMatchingSpatialFeatures({
    masterRun: { year: '2026' },
    historicalRuns: [{ name: 'ILI 2021', year: '2021' }],
    masterRows: [
      { id: 'NEW-001', type: 'Weld', dist: 12 },
      { id: 'BEND-001', type: 'Other', feature_identification: 'Bend Begin', dist: 18, angleDeg: 45 },
    ],
    lockedGws: [{
      key: 'OLD-001::NEW-001::10.000000::12.000000',
      oldId: 'OLD-001', oldDistance: 10,
      newId: 'NEW-001', newDistance: 12,
    }],
    gwOrphans: [
      { status: 'ONLY_OLD', oldId: 'OLD-002', oldDist: 20 },
      { status: 'ONLY_NEW', newId: 'NEW-002', newDist: 24 },
    ],
  });

  assert.deepEqual(features.historicalLanes[0].gws.map((gw) => ({ id: gw.id, status: gw.status })), [
    { id: 'OLD-001', status: 'MATCHED' },
    { id: 'OLD-002', status: 'MISSING_IN_MASTER' },
  ]);
  assert.equal(features.historicalLanes[0].gws[1].rawData.missingReason, 'No paired NEW GW');
  assert.equal(features.gws.find((gw) => gw.id === 'NEW-002')?.rawData.missingReason, 'No paired OLD GW');
  assert.deepEqual(features.allFeatures.filter((feature) => feature.type.includes('bend')).map((feature) => feature.id), ['BEND-001']);
});

test('buildMatchingSpatialFeatures keeps a locked pair matched when a stale orphan repeats either side', () => {
  const features = buildMatchingSpatialFeatures({
    masterRun: { year: '2026' },
    historicalRuns: [{ name: 'ILI 2024', year: '2024' }],
    masterRows: [{ id: 'NEW-001', type: 'Weld', dist: 9 }],
    lockedGws: [{
      key: 'OLD-001::NEW-001::8.900000::9.000000',
      oldId: 'OLD-001', oldDistance: 8.9,
      newId: 'NEW-001', newDistance: 9,
    }],
    gwOrphans: [
      { status: 'ONLY_NEW', newId: 'NEW-001', newDist: 9 },
      { status: 'ONLY_OLD', oldId: 'OLD-001', oldDist: 8.9 },
    ],
  });

  assert.equal(features.gws.find((gw) => gw.id === 'NEW-001')?.status, 'MATCHED');
  assert.equal(features.historicalLanes[0].gws.find((gw) => gw.id === 'OLD-001')?.status, 'MATCHED');
});

test('buildMatchingSpatialFeatures keeps a locked master weld matched when persisted distance differs only by precision', () => {
  const features = buildMatchingSpatialFeatures({
    masterRun: { year: '2026' },
    historicalRuns: [{ name: 'ILI 2024', year: '2024' }],
    masterRows: [{ id: 'NEW-001', type: 'Weld', dist: 9.0004 }],
    lockedGws: [{
      key: 'OLD-001::NEW-001::8.900000::9.000000',
      oldId: 'OLD-001', oldDistance: 8.9,
      newId: 'NEW-001', newDistance: 9,
    }],
  });

  assert.equal(features.gws.find((gw) => gw.id === 'NEW-001')?.status, 'MATCHED');
  assert.equal(features.gws.find((gw) => gw.id === 'NEW-001')?.rawData.oldId, 'OLD-001');
});

test('buildMatchingSpatialFeatures matches persisted anchor feature_id instead of its database row id', () => {
  const features = buildMatchingSpatialFeatures({
    masterRun: { year: '2026' },
    historicalRuns: [{ name: 'ILI 2024', year: '2024' }],
    masterRows: [{ id: 9876, feature_id: 'NEW-001', type: 'Weld', log_distance_m: 9 }],
    lockedGws: [{
      key: 'OLD-001::NEW-001::8.900000::9.000000',
      oldId: 'OLD-001', oldDistance: 8.9,
      newId: 'NEW-001', newDistance: 9,
    }],
  });

  assert.equal(features.gws.find((gw) => gw.id === 'NEW-001')?.status, 'MATCHED');
});

test('buildMatchingSpatialFeatures plots an elbow at its aligned position while preserving source LD', () => {
  const features = buildMatchingSpatialFeatures({
    masterRun: { year: '2026' },
    masterRows: [{
      id: 81,
      feature_id: 'BEND-081',
      type: 'Other',
      feature_identification: 'Pipeline Elbow',
      dist: 612.25,
      alignedDist: 650.75,
      sourceDist: 612.25,
    }],
  });

  const bend = features.allFeatures.find((feature) => feature.id === 'BEND-081');
  assert.ok(bend);
  assert.equal(bend.dist, 650.75);
  assert.match(bend.type, /elbow/);
  assert.equal(features.stats.bendCount, 1);
  assert.equal(bend.rawData.sourceDist, 612.25);
});

test('buildMatchingSpatialFeatures keeps the persisted Bend / Elbow API shape visible', () => {
  const features = buildMatchingSpatialFeatures({
    masterRun: { year: '2026' },
    masterRows: [{
      id: '81',
      sourceFeatureId: 'BEND-081',
      type: 'Bend / Elbow',
      feature_type: 'Bend / Elbow',
      feature_identification: 'Bend Begin',
      dist: 612.25,
      log_distance_m: 612.25,
      source_log_distance_m: 612.25,
    }],
  });

  const bend = features.allFeatures.find((feature) => feature.type.includes('bend'));
  assert.ok(bend);
  assert.equal(bend.dist, 612.25);
  assert.equal(features.stats.bendCount, 1);
  assert.equal(bend.rawData.sourceFeatureId, 'BEND-081');
  assert.equal(bend.rawData.source_log_distance_m, 612.25);
});
