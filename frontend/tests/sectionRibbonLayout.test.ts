import assert from 'node:assert/strict';
import test from 'node:test';

import { layouts, type Chart, type LayoutItem } from 'chart.js';

import { createSectionRibbonBox } from '../src/lib/sections/sectionBandsPlugin.ts';
import type { SectionBand } from '../src/lib/sections/bands.ts';

/**
 * `layouts.update` reads only `chart.options.layout.padding` and `chart.boxes`,
 * so the real layout pass can be exercised without a canvas. That matters: the
 * bug this file guards against was invisible to the type checker and only threw
 * once Chart.js wrapped the box for layout.
 */
function fakeChart(bands: SectionBand[]): Chart {
  return {
    options: {
      layout: { padding: 0 },
      plugins: { sectionBands: { bands, selectedId: null } },
    },
    boxes: [],
  } as unknown as Chart;
}

function band(name: string, startM: number, endM: number, order: number): SectionBand {
  return { id: name, name, startM, endM, order, color: '#123456' } as SectionBand;
}

/** Stand-in for the chart legend: a top box that sits outside the ribbon. */
function legendBox(height: number): LayoutItem {
  return {
    position: 'top',
    weight: 1000,
    fullSize: true,
    options: {},
    width: 0,
    height: 0,
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    isHorizontal: () => true,
    update(width: number) {
      this.width = width;
      this.height = height;
    },
    draw: () => {},
  } as unknown as LayoutItem;
}

test('the ribbon box survives the layout pass Chart.js actually runs', () => {
  // Regression: the box carried no `options`, and Chart.js destructures
  // `box.options.stack` while wrapping boxes — which threw "Cannot read
  // properties of undefined (reading 'stack')" and took the whole page down.
  const chart = fakeChart([band('Aerial HL279', 0, 500, 0)]);
  const ribbon = createSectionRibbonBox(chart);

  layouts.addBox(chart, ribbon);
  assert.doesNotThrow(() => layouts.update(chart, 800, 400));
});

test('the ribbon is placed below the legend and above the plot, never over either', () => {
  const chart = fakeChart([band('Aerial HL279', 0, 500, 0)]);
  const ribbon = createSectionRibbonBox(chart);
  const legend = legendBox(30);

  layouts.addBox(chart, legend);
  layouts.addBox(chart, ribbon);
  layouts.update(chart, 800, 400);

  assert.ok(ribbon.height > 0, 'a chart with bands reserves room for the ribbon');
  assert.ok(
    ribbon.top >= legend.bottom,
    `ribbon top ${ribbon.top} must not overlap legend bottom ${legend.bottom}`,
  );
  assert.ok(
    ribbon.bottom <= chart.chartArea.top,
    `ribbon bottom ${ribbon.bottom} must sit above the plot at ${chart.chartArea.top}`,
  );
});

test('a chart without bands reserves no space, so its layout is unchanged', () => {
  const withBands = fakeChart([band('Aerial HL279', 0, 500, 0)]);
  const withoutBands = fakeChart([]);
  const bandedRibbon = createSectionRibbonBox(withBands);
  const emptyRibbon = createSectionRibbonBox(withoutBands);

  layouts.addBox(withBands, bandedRibbon);
  layouts.addBox(withoutBands, emptyRibbon);
  layouts.update(withBands, 800, 400);
  layouts.update(withoutBands, 800, 400);

  assert.equal(emptyRibbon.height, 0);
  assert.ok(withoutBands.chartArea.top < withBands.chartArea.top);
});

test('the ribbon spans the plot width so a band lines up with its data range', () => {
  const chart = fakeChart([band('Aerial HL279', 0, 500, 0)]);
  const ribbon = createSectionRibbonBox(chart);

  layouts.addBox(chart, ribbon);
  layouts.update(chart, 800, 400);

  assert.equal(ribbon.left, chart.chartArea.left);
  assert.equal(ribbon.right, chart.chartArea.right);
});
