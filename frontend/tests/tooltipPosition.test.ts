import test from 'node:test';
import assert from 'node:assert/strict';

import { clampTooltipPosition } from '../src/utils/tooltipPosition.ts';

const viewport = { viewportWidth: 1280, viewportHeight: 800 };
const size = { tooltipWidth: 256, tooltipHeight: 300 };

test('tooltip sits below-right of the pointer when there is room', () => {
  const placement = clampTooltipPosition({ pointerX: 100, pointerY: 100, ...size, ...viewport });
  assert.deepEqual(placement, { left: 115, top: 115 });
});

test('tooltip flips left of the pointer at the right viewport edge', () => {
  const placement = clampTooltipPosition({ pointerX: 1250, pointerY: 100, ...size, ...viewport });
  assert.equal(placement.left, 1250 - 256 - 15);
  assert.equal(placement.top, 115);
  assert.ok(placement.left + 256 <= 1280);
});

test('tooltip flips above the pointer at the bottom viewport edge', () => {
  const placement = clampTooltipPosition({ pointerX: 100, pointerY: 780, ...size, ...viewport });
  assert.equal(placement.top, 780 - 300 - 15);
  assert.ok(placement.top + 300 <= 800);
});

test('tooltip never leaves the top-left margins even when flipping lacks room', () => {
  const placement = clampTooltipPosition({ pointerX: 5, pointerY: 5, tooltipWidth: 1400, tooltipHeight: 900, ...viewport });
  assert.deepEqual(placement, { left: 8, top: 8 });
});

test('custom offset and margin are honored', () => {
  const placement = clampTooltipPosition({
    pointerX: 0,
    pointerY: 0,
    tooltipWidth: 100,
    tooltipHeight: 100,
    viewportWidth: 500,
    viewportHeight: 500,
    offset: 10,
    margin: 4,
  });
  assert.deepEqual(placement, { left: 10, top: 10 });
});
