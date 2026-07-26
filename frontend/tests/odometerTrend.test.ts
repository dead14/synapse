import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceOdometerDistance, sourceOdometerOffset } from '../src/domain/gwTimeline.ts';

test('uses source odometers for GW trend after canonical TIE-IN mapping', () => {
  const match = {
    oldVal: 1868.81,
    newVal: 1868.81,
    originalOldVal: 4.243,
    originalNewVal: 1868.81,
  };

  assert.equal(sourceOdometerDistance(match, 'old'), 4.243);
  assert.equal(sourceOdometerDistance(match, 'new'), 1868.81);
  assert.equal(sourceOdometerOffset(match), 1864.567);
});

test('falls back to display coordinates for legacy GW matches', () => {
  assert.equal(sourceOdometerOffset({ oldVal: 100, newVal: 106 }), 6);
});
