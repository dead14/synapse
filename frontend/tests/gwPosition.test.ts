import test from 'node:test';
import assert from 'node:assert/strict';

import { getGwPositionDetails, getOriginalLd } from '../src/sectioning/gwPosition.ts';

test('getGwPositionDetails presents actual NEW and OLD log distances for a matched weld', () => {
  const details = getGwPositionDetails({
    id: 'GW-NEW-01',
    dist: 1870.354,
    type: 'weld',
    runRole: 'MASTER',
    status: 'MATCHED',
    rawData: { oldId: 'GW-OLD-01', oldDistance: 1868.81 },
    lat: Number.NaN,
    lng: Number.NaN,
  });

  assert.deepEqual(details, {
    primaryLabel: 'Log distance NEW',
    primaryDistance: '1870.354 m',
    primaryOriginalLd: null,
    pairedLabel: 'Log distance OLD',
    pairedDistance: '1868.810 m',
    pairedId: 'GW-OLD-01',
  });
});

test('getGwPositionDetails keeps an unmatched weld explicit without inventing an OLD distance', () => {
  const details = getGwPositionDetails({
    id: 'GW-NEW-02',
    dist: 83.9,
    type: 'weld',
    runRole: 'MASTER',
    status: 'UNRESOLVED',
    rawData: {},
    lat: Number.NaN,
    lng: Number.NaN,
  });

  assert.equal(details.primaryDistance, '83.900 m');
  assert.equal(details.pairedDistance, null);
});

test('getOriginalLd reads nested source data instead of the backend-adjusted plot position', () => {
  assert.equal(getOriginalLd({
    abs_distance_m: 650.75,
    raw: { log_distance_m: 612.25 },
  }), '612.25');
});
