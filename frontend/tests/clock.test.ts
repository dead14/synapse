import assert from 'node:assert/strict';
import test from 'node:test';

import { parseClockToDegrees, parseClockToHours } from '../src/utils/clock.ts';

test('converts HH:MM clock strings to degrees around the pipe', () => {
  assert.equal(parseClockToDegrees('12:00'), 0);
  assert.equal(parseClockToDegrees('3:00'), 90);
  assert.equal(parseClockToDegrees('6:00'), 180);
  assert.equal(parseClockToDegrees('9:00'), 270);
  assert.equal(parseClockToDegrees('6:30'), 195);
  // 12:30 wraps: 12 o'clock is 0°, plus 30 minutes = 15°.
  assert.equal(parseClockToDegrees('12:30'), 15);
});

test('converts plain numeric clock hours to degrees', () => {
  assert.equal(parseClockToDegrees(3), 90);
  assert.equal(parseClockToDegrees(6), 180);
  assert.equal(parseClockToDegrees(4.5), 135);
  assert.equal(parseClockToDegrees(12), 0);
  assert.equal(parseClockToDegrees('9'), 270);
});

test('converts Excel time serials (fraction of a day) to degrees', () => {
  // 0.25 of a day = 06:00 -> 180°; 0.5 = 12:00 -> 0°; 0.125 = 03:00 -> 90°.
  assert.equal(parseClockToDegrees(0.25), 180);
  assert.equal(parseClockToDegrees(0.5), 0);
  assert.equal(parseClockToDegrees(0.125), 90);
  // 0.75 of a day = 18:00 -> 6 o'clock -> 180°.
  assert.equal(parseClockToDegrees(0.75), 180);
});

test('missing or unparseable clock values resolve to 0 degrees', () => {
  assert.equal(parseClockToDegrees(null), 0);
  assert.equal(parseClockToDegrees(undefined), 0);
  assert.equal(parseClockToDegrees('-'), 0);
  assert.equal(parseClockToDegrees(''), 0);
  assert.equal(parseClockToDegrees('not-a-clock'), 0);
  assert.equal(parseClockToDegrees('ab:cd'), 0);
});

test('parseClockToHours keeps hours in the [0, 12) clock range', () => {
  assert.equal(parseClockToHours('6:30'), 6.5);
  assert.equal(parseClockToHours(12), 0);
  assert.equal(parseClockToHours(0.25), 6);
});
