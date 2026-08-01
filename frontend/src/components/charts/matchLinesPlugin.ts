import type { Chart, Plugin } from 'chart.js';

/** A tie between the same feature's OLD and NEW position on one chart. */
export interface MatchLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Draws the OLD→NEW tie lines behind the markers.
 *
 * A run pair carries tens of thousands of matched features, and the earlier
 * version opened and stroked a separate path for each one — tens of thousands
 * of canvas state changes on every single frame, which is what made these
 * charts crawl on a real dataset. Every visible tie now goes into one path and
 * is stroked once; the colour is fixed per chart, so nothing is lost by it.
 */
export function createMatchLinesPlugin(lines: MatchLine[], color: string): Plugin {
  return {
    id: 'matchLinesPlugin',
    beforeDatasetsDraw(chart: Chart) {
      if (lines.length === 0) return;
      const { ctx, chartArea } = chart;
      const x = chart.scales.x;
      const y = chart.scales.y;
      // Guard the first render, before the scales have been laid out.
      if (!chartArea || !x || !y) return;

      ctx.save();
      ctx.beginPath();
      ctx.lineWidth = 1;
      ctx.strokeStyle = color;

      for (const line of lines) {
        const x1 = x.getPixelForValue(line.x1);
        const x2 = x.getPixelForValue(line.x2);
        // Cull on x first: it rejects most off-screen ties for two conversions
        // rather than four, which matters when the loop runs 50,000 times.
        if (Math.max(x1, x2) < chartArea.left || Math.min(x1, x2) > chartArea.right) continue;
        const y1 = y.getPixelForValue(line.y1);
        const y2 = y.getPixelForValue(line.y2);
        if (Math.max(y1, y2) < chartArea.top || Math.min(y1, y2) > chartArea.bottom) continue;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }

      ctx.stroke();
      ctx.restore();
    },
  };
}
