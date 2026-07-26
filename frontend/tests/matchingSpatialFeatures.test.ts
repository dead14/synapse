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
  assert.equal(features.historicalLanes[0].gws[1].rawData.missingReason, 'Tidak ada GW NEW pasangan');
  assert.equal(features.gws.find((gw) => gw.id === 'NEW-002')?.rawData.missingReason, 'Tidak ada GW OLD pasangan');
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
