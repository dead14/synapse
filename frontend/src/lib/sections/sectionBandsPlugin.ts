/**
 * Chart.js plugin that names the sections along a distance axis and lets an
 * engineer click one to hold it highlighted.
 *
 * It draws a ribbon of labelled segments across the top of the plot area and,
 * when a band is selected, tints that band's full height and dims the rest — so
 * "where is RC#86 on this chart" and "show me only that stretch" are both one
 * glance and one click, on every chart that plots against metres.
 *
 * The plugin owns nothing: bands, the selected id, and the click handler are all
 * passed in through chart options, so the selection can be shared across several
 * charts at once.
 */

import { layouts, type Chart, type ChartType, type LayoutItem, type Plugin } from 'chart.js';

import { formatBandRange, type SectionBand } from './bands.ts';

export const SECTION_BANDS_PLUGIN_ID = 'sectionBands';

declare module 'chart.js' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface PluginOptionsByType<TType extends ChartType> {
    sectionBands?: SectionBandsPluginOptions;
  }
}

export interface SectionBandsPluginOptions {
  bands: SectionBand[];
  /** Id of the held band, or null. */
  selectedId: string | null;
  /** Called with the clicked band's id, or null when the ribbon is clicked off a band. */
  onSelect?: (id: string | null) => void;
  /** Height of the label ribbon in pixels. */
  ribbonHeight?: number;
  /** Palette hooks so the ribbon reads in both themes. */
  labelColor?: string;
  ribbonBackground?: string;
  /** Set false to draw the ribbon without reacting to clicks (PNG export, print). */
  interactive?: boolean;
}

const DEFAULT_RIBBON_HEIGHT = 16;
/** Gap between the ribbon and the top of the plot. */
const RIBBON_GAP = 4;
/** Segments narrower than this cannot hold a readable label. */
const MIN_LABEL_WIDTH = 34;

interface Segment {
  band: SectionBand;
  left: number;
  right: number;
}

/**
 * Maps each band onto pixel space. Bands entirely outside the current axis
 * range are dropped; a band straddling an edge is clipped to the plot.
 */
function layoutSegments(chart: Chart, bands: SectionBand[]): Segment[] {
  const scale = chart.scales.x;
  const area = chart.chartArea;
  if (!scale || !area) return [];

  const segments: Segment[] = [];
  for (const band of bands) {
    const rawLeft = scale.getPixelForValue(band.startM);
    const rawRight = scale.getPixelForValue(band.endM);
    if (!Number.isFinite(rawLeft) || !Number.isFinite(rawRight)) continue;
    const left = Math.max(area.left, Math.min(rawLeft, rawRight));
    const right = Math.min(area.right, Math.max(rawLeft, rawRight));
    if (right < area.left || left > area.right) continue;
    // A section holding one feature has zero width; give it enough to be seen.
    segments.push({ band, left, right: Math.max(right, left + 2) });
  }
  return segments;
}

function readOptions(chart: Chart): SectionBandsPluginOptions | null {
  const options = (chart.options.plugins as Record<string, unknown> | undefined)?.[SECTION_BANDS_PLUGIN_ID];
  if (!options || typeof options !== 'object') return null;
  const typed = options as SectionBandsPluginOptions;
  return Array.isArray(typed.bands) && typed.bands.length > 0 ? typed : null;
}

/**
 * The ribbon is a Chart.js layout box, not something drawn into borrowed
 * padding.
 *
 * Reserving space with `layout.padding.top` looked equivalent but was not:
 * padding is taken from the canvas edge and the legend is then fitted *below*
 * it, so a ribbon positioned relative to `chartArea.top` landed on top of the
 * legend text on every chart that had one. As a box the ribbon is placed by the
 * same layout pass that places the legend and the scales, so nothing can be
 * laid out over it and no chart has to remember to reserve room for it.
 */
class SectionRibbonBox implements LayoutItem {
  readonly position = 'top' as const;
  /**
   * Lower weight sits closer to the plot. The legend's default weight is 1000,
   * so it keeps its place at the outside and the ribbon hugs the plot — which
   * is also where it is readable, directly above the axis it describes.
   */
  readonly weight = 0;
  /** Constrained to the plot width so a band's pixels match its data range. */
  readonly fullSize = false;
  /**
   * Required at runtime even though `LayoutItem` does not declare it: Chart.js
   * unconditionally destructures `box.options.stack` while wrapping boxes for
   * layout, so a box without this throws before anything is drawn. Empty means
   * "not stacked with any other box", which is what this ribbon wants.
   */
  readonly options: { stack?: string; stackWeight?: number; display?: boolean } = {};

  width = 0;
  height = 0;
  left = 0;
  top = 0;
  right = 0;
  bottom = 0;

  // Assigned in the body rather than as a parameter property: parameter
  // properties are not erasable, and the test runner strips types rather than
  // compiling them.
  private readonly chart: Chart;

  constructor(chart: Chart) {
    this.chart = chart;
  }

  isHorizontal(): boolean {
    return true;
  }

  /** Zero height when the chart carries no bands, so the layout is unchanged. */
  update(width: number): void {
    const options = readOptions(this.chart);
    this.width = width;
    this.height = options ? (options.ribbonHeight ?? DEFAULT_RIBBON_HEIGHT) + RIBBON_GAP : 0;
  }

  draw(): void {
    drawRibbon(this.chart, this);
  }
}

const ribbonBoxes = new WeakMap<Chart, SectionRibbonBox>();

/** Exported so the layout contract can be exercised without a canvas. */
export function createSectionRibbonBox(chart: Chart): LayoutItem {
  return new SectionRibbonBox(chart);
}

/** Rect the ribbon itself occupies, excluding the gap that separates it from the plot. */
function ribbonRect(box: SectionRibbonBox, ribbonHeight: number) {
  return { top: box.top, bottom: box.top + ribbonHeight };
}

function drawRibbon(chart: Chart, box: SectionRibbonBox): void {
  const options = readOptions(chart);
  if (!options) return;
  const area = chart.chartArea;
  if (!area) return;

  const segments = layoutSegments(chart, options.bands);
  if (segments.length === 0) return;

  const { ctx } = chart;
  const ribbonHeight = options.ribbonHeight ?? DEFAULT_RIBBON_HEIGHT;
  const { top } = ribbonRect(box, ribbonHeight);
  const selectedId = options.selectedId ?? null;

  ctx.save();
  ctx.beginPath();
  ctx.rect(area.left, top, area.right - area.left, ribbonHeight);
  ctx.clip();

  if (options.ribbonBackground) {
    ctx.fillStyle = options.ribbonBackground;
    ctx.fillRect(area.left, top, area.right - area.left, ribbonHeight);
  }

  ctx.font = '600 10px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';

  for (const segment of segments) {
    const width = segment.right - segment.left;
    const held = selectedId !== null && segment.band.id === selectedId;

    ctx.fillStyle = segment.band.color;
    ctx.globalAlpha = held ? 1 : selectedId === null ? 0.75 : 0.3;
    ctx.fillRect(segment.left, top, Math.max(2, width), ribbonHeight);
    ctx.globalAlpha = 1;

    if (width < MIN_LABEL_WIDTH) continue;
    // Truncate rather than overflow into the neighbouring section's chip.
    let label = segment.band.name;
    while (label.length > 1 && ctx.measureText(label).width > width - 8) {
      label = label.slice(0, -1);
    }
    if (label !== segment.band.name) label = `${label.slice(0, -1)}…`;
    ctx.fillStyle = options.labelColor ?? '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(label, (segment.left + segment.right) / 2, top + ribbonHeight / 2);
  }

  ctx.restore();
}

export const sectionBandsPlugin: Plugin<ChartType> = {
  id: SECTION_BANDS_PLUGIN_ID,

  start(chart) {
    const box = new SectionRibbonBox(chart);
    ribbonBoxes.set(chart, box);
    layouts.addBox(chart, box);
  },

  stop(chart) {
    const box = ribbonBoxes.get(chart);
    if (!box) return;
    layouts.removeBox(chart, box);
    ribbonBoxes.delete(chart);
  },

  /**
   * Drawn before the datasets so the tint sits behind the markers, and the
   * ribbon reserves the top strip of the plot rather than covering points.
   */
  beforeDatasetsDraw(chart) {
    const options = readOptions(chart);
    if (!options) return;
    const area = chart.chartArea;
    if (!area) return;

    const segments = layoutSegments(chart, options.bands);
    if (segments.length === 0) return;

    const { ctx } = chart;
    const selectedId = options.selectedId ?? null;
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.left, area.top, area.right - area.left, area.bottom - area.top);
    ctx.clip();

    for (const segment of segments) {
      const held = selectedId !== null && segment.band.id === selectedId;
      // Alternating wash keeps neighbouring sections apart without a legend.
      ctx.fillStyle = segment.band.color;
      ctx.globalAlpha = held ? 0.16 : segment.band.order % 2 === 0 ? 0.05 : 0.02;
      ctx.fillRect(segment.left, area.top, segment.right - segment.left, area.bottom - area.top);

      ctx.globalAlpha = held ? 0.85 : 0.35;
      ctx.strokeStyle = segment.band.color;
      ctx.lineWidth = held ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(segment.left, area.top);
      ctx.lineTo(segment.left, area.bottom);
      ctx.stroke();
    }

    ctx.restore();
  },

  /**
   * Clicks land on the ribbon only, so selecting a section never competes with
   * the chart's own click-to-open-a-feature behaviour in the plot body.
   */
  afterEvent(chart, args) {
    const options = readOptions(chart);
    if (!options || options.interactive === false || !options.onSelect) return;
    const box = ribbonBoxes.get(chart);
    const event = args.event;
    const area = chart.chartArea;
    if (!box || !area || event.x === null || event.y === null) return;

    const ribbonHeight = options.ribbonHeight ?? DEFAULT_RIBBON_HEIGHT;
    const { top, bottom } = ribbonRect(box, ribbonHeight);
    const inRibbon = event.y >= top
      && event.y <= bottom
      && event.x >= area.left
      && event.x <= area.right;

    // Signal that the ribbon is clickable without forcing a redraw for it.
    if (event.type === 'mousemove') {
      const cursor = chart.canvas.style.cursor;
      if (inRibbon && cursor !== 'pointer') chart.canvas.style.cursor = 'pointer';
      else if (!inRibbon && cursor === 'pointer') chart.canvas.style.cursor = '';
      return;
    }
    if (event.type !== 'click' || !inRibbon) return;

    const segments = layoutSegments(chart, options.bands);
    const hit = segments.find((segment) => event.x! >= segment.left && event.x! <= segment.right);
    // Clicking the held band again releases it, so the ribbon is a toggle.
    options.onSelect(hit && hit.band.id !== options.selectedId ? hit.band.id : null);
    args.changed = true;
  },
};

/**
 * Tooltip line naming the section a plotted distance falls in — the same answer
 * the ribbon gives, for readers who are already hovering a point.
 */
export function sectionTooltipLine(bands: SectionBand[], distanceM: number): string | null {
  for (const band of bands) {
    if (distanceM >= band.startM && distanceM <= band.endM) {
      return `Section ${band.name} · ${formatBandRange(band)}`;
    }
  }
  return null;
}
