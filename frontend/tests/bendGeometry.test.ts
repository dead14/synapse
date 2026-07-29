import test from 'node:test';
import assert from 'node:assert/strict';

import { bendDefinition, isBendType } from '../src/sectioning/bendGeometry.ts';

test('isBendType recognizes every persisted bend label without matching unrelated text', () => {
  assert.equal(isBendType('Bend'), true);
  assert.equal(isBendType('Pipeline Elbow'), true);
  assert.equal(isBendType('Pipe Jog'), true);
  assert.equal(isBendType('Valve'), false);
});

test('bendDefinition reads a jog angle from the persisted feature label', () => {
  assert.deepEqual(bendDefinition({
    id: 'JOG-30',
    dist: 50,
    type: 'Pipe Jog 30',
    runRole: 'MASTER',
    rawData: {},
    lat: Number.NaN,
    lng: Number.NaN,
  }), { angleDeg: 30, inferred: false });
});
