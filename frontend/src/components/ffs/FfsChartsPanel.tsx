import { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, Scatter } from 'react-chartjs-2';
import type { Chart } from 'chart.js';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';
import type { ChartOptions } from 'chart.js';
import {
  buildDepthByLd,
  buildDepthCrScatter,
  buildEnvelopeCurves,
  buildErfScatter,
  buildLengthCrScatter,
  buildOrientationScatter,
  buildScreeningScatter,
  envelopeDomainMm,
  measureUniformity,
  screenAgainstEnvelope,
  type FfsPoint,
  type SplitScatter,
} from '../../lib/ffs/chartData';
import type { ScreeningBasis } from '../../lib/ffs/b31g';
import { DEFAULT_DEPTH_BUCKETS, depthBandLabel, isInternal, type DepthBucket } from '../../lib/ffs/statistics';
import FfsPerspectiveBars from './FfsPerspectiveBars';
import type { FfsConfig, FfsScreenedResult, FfsScreeningConfig } from '../../lib/ffs/types';
import { buildSectionBands, type SectionBand } from '../../lib/sections/bands';
import {
  sectionBandsPlugin,
  sectionTooltipLine,
} from '../../lib/sections/sectionBandsPlugin';
import SectionBandLegend from '../sections/SectionBandLegend';
import { MathInline } from '../ds';
import { formatRemnantLife } from '../../lib/ffs/lifeProjection';
import ChartCard, { ColorControl, SettingsSectionLabel, type PointShape } from './ChartCard';
import { Callout } from './FfsPrimitives';
import { maxBy } from '../../utils/numericRange.ts';

ChartJS.register(
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Title,
  sectionBandsPlugin,
);

/** Chart.js colours resolved from the active theme so both modes stay legible. */
function useChartTheme() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    const observer = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains('dark')),
    );
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return useMemo(
    () => ({
      isDark,
      grid: isDark ? 'rgba(148,163,184,0.16)' : 'rgba(100,116,139,0.14)',
      tick: isDark ? '#94a3b8' : '#64748b',
      text: isDark ? '#e2e8f0' : '#334155',
      tooltipBg: isDark ? '#1e293b' : '#ffffff',
      tooltipBorder: isDark ? '#475569' : '#cbd5e1',
    }),
    [isDark],
  );
}

interface ScatterStyle {
  internalColor: string;
  externalColor: string;
  internalShape: PointShape;
  externalShape: PointShape;
  outlineOnly: boolean;
}

const DEFAULT_SCATTER_STYLE: ScatterStyle = {
  internalColor: '#3b82f6',
  externalColor: '#ef4444',
  internalShape: 'circle',
  externalShape: 'triangle',
  outlineOnly: false,
};

/** Settings drawer shared by every internal/external scatter chart. */
function ScatterSettings({
  style,
  onChange,
  showInternal = true,
  showExternal = true,
}: {
  style: ScatterStyle;
  onChange: (next: ScatterStyle) => void;
  showInternal?: boolean;
  showExternal?: boolean;
}) {
  return (
    <div className="space-y-2">
      <SettingsSectionLabel>Marker style</SettingsSectionLabel>
      {showInternal && (
        <ColorControl
          label="Internal"
          color={style.internalColor}
          onColorChange={(internalColor) => onChange({ ...style, internalColor })}
          shape={style.internalShape}
          onShapeChange={(internalShape) => onChange({ ...style, internalShape })}
        />
      )}
      {showExternal && (
        <ColorControl
          label="External"
          color={style.externalColor}
          onColorChange={(externalColor) => onChange({ ...style, externalColor })}
          shape={style.externalShape}
          onShapeChange={(externalShape) => onChange({ ...style, externalShape })}
        />
      )}
      <label className="flex items-center gap-2 pt-1 text-[11px] text-slate-600 dark:text-slate-300">
        <input
          type="checkbox"
          checked={style.outlineOnly}
          onChange={(event) => onChange({ ...style, outlineOnly: event.target.checked })}
          className="h-3.5 w-3.5 rounded border-slate-300"
        />
        Outline only
      </label>
    </div>
  );
}

/** Editor for the four depth bands driving the stacked bar charts. */
function BucketSettings({
  buckets,
  onChange,
}: {
  buckets: DepthBucket[];
  onChange: (next: DepthBucket[]) => void;
}) {
  const setBoundary = (index: number, value: number) => {
    const next = buckets.map((bucket) => ({ ...bucket }));
    next[index].to = value;
    if (next[index + 1]) next[index + 1].from = value;
    // Keep the visible band names in step with the edited boundaries.
    for (let i = 0; i < next.length; i++) {
      next[i].name = depthBandLabel(next[i].from, next[i].to);
    }
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <SettingsSectionLabel>Depth bands — upper bound and colour</SettingsSectionLabel>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {buckets.map((bucket, index) => (
          <div key={bucket.id} className="flex items-center gap-1.5">
            <input
              type="color"
              value={bucket.color}
              onChange={(event) => {
                const next = buckets.map((b) => ({ ...b }));
                next[index].color = event.target.value;
                onChange(next);
              }}
              aria-label={`${bucket.name} colour`}
              className="h-6 w-7 cursor-pointer rounded border border-slate-300 bg-transparent p-0.5 dark:border-slate-600"
            />
            <span className="text-[11px] tabular-nums text-slate-500">{bucket.from}%</span>
            {Number.isFinite(bucket.to) ? (
              <>
                <span className="text-[11px] text-slate-400">→</span>
                <input
                  type="number"
                  value={bucket.to}
                  min={bucket.from + 1}
                  max={100}
                  onChange={(event) => setBoundary(index, parseFloat(event.target.value) || bucket.to)}
                  aria-label={`${bucket.name} upper bound`}
                  className="w-[52px] rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] tabular-nums text-slate-700 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                />
                <span className="text-[11px] text-slate-400">%</span>
              </>
            ) : (
              <span className="text-[11px] text-slate-400">and above</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The eight analytical views over the assessed population. Each chart carries
 * its own bin size and marker styling so an engineer can tune one view without
 * disturbing the others.
 */
export default function FfsChartsPanel({
  items,
  config,
  screening,
  onSelect,
  onFiguresCaptured,
}: {
  items: FfsScreenedResult[];
  config: FfsConfig;
  screening: FfsScreeningConfig;
  onSelect: (item: FfsScreenedResult) => void;
  /** Receives PNG data URLs keyed by chart id, for the narrative figures. */
  onFiguresCaptured?: (images: Record<string, string>) => void;
}) {
  const theme = useChartTheme();

  const [buckets, setBuckets] = useState<DepthBucket[]>(DEFAULT_DEPTH_BUCKETS);
  const [internalBuckets, setInternalBuckets] = useState<DepthBucket[]>(() =>
    DEFAULT_DEPTH_BUCKETS.map((b, i) => ({ ...b, color: ['#ef4444', '#8b5cf6', '#3b82f6', '#10b981'][i] })),
  );
  const [externalBuckets, setExternalBuckets] = useState<DepthBucket[]>(() =>
    DEFAULT_DEPTH_BUCKETS.map((b, i) => ({ ...b, color: ['#ef4444', '#8b5cf6', '#3b82f6', '#10b981'][i] })),
  );

  const [depthBin, setDepthBin] = useState(1000);
  const [depth3dBin, setDepth3dBin] = useState(200);
  const [depth3dSurface, setDepth3dSurface] = useState<'all' | 'internal' | 'external'>('all');
  const [internalBin, setInternalBin] = useState(1000);
  const [externalBin, setExternalBin] = useState(1000);

  const [orientStyle, setOrientStyle] = useState(DEFAULT_SCATTER_STYLE);
  const [crDepthStyle, setCrDepthStyle] = useState(DEFAULT_SCATTER_STYLE);
  const [crLengthStyle, setCrLengthStyle] = useState(DEFAULT_SCATTER_STYLE);
  const [erfStyle, setErfStyle] = useState(DEFAULT_SCATTER_STYLE);
  const [screenStyle, setScreenStyle] = useState<ScatterStyle>({
    ...DEFAULT_SCATTER_STYLE,
    internalColor: '#10b981',
    externalColor: '#f97316',
  });
  const [hiddenWalls, setHiddenWalls] = useState<Set<number>>(new Set());
  // The screen the chart is titled for. The operating-pressure envelope stays
  // one click away because it is the one that answers "is this pipe safe as it
  // is being run" — but it is not what Level 0 means, so it is not the default.
  const [screenBasis, setScreenBasis] = useState<ScreeningBasis>('level-0');
  // One held section for the whole panel, so highlighting RC#86 on the ERF
  // profile highlights the same stretch on every other distance chart.
  const [heldBandId, setHeldBandId] = useState<string | null>(null);

  const instances = useRef<Record<string, Chart | null>>({});
  // The 3D view draws to a WebGL canvas rather than through Chart.js, so it is
  // registered here and merged into the same figure capture.
  const rawCanvases = useRef<Record<string, HTMLCanvasElement | null>>({});

  /** Binds one chart: records the instance and hands the canvas to ChartCard. */
  const bind =
    (chartId: string, registerCanvas: (canvas: HTMLCanvasElement | null) => void) =>
    (instance: Chart | null) => {
      instances.current[chartId] = instance;
      registerCanvas(instance?.canvas ?? null);
    };

  /**
   * Every input that changes what the figures look like, as one comparable
   * value. The capture below keys off this rather than off "any render":
   * `onFiguresCaptured` lifts the PNGs into the parent's state, which re-renders
   * this panel, so an unkeyed effect re-armed itself and the panel sat there
   * re-encoding eight canvases to PNG every 900 ms for as long as the tab was
   * open. That loop is what made the Charts tab so heavy.
   */
  const figureSignature = JSON.stringify([
    items.length,
    config.method,
    config.modifiedSa,
    screening.reviewBandErf,
    screening.depthTolerancePct,
    screening.lengthToleranceMm,
    screening.growthBasis,
    screening.growthRateMmPerYear,
    screening.forecastYears,
    depthBin, internalBin, externalBin,
    depth3dBin, depth3dSurface,
    buckets, internalBuckets, externalBuckets,
    orientStyle, crDepthStyle, crLengthStyle, erfStyle, screenStyle,
    screenBasis,
    screening.depthRejectionPct,
    [...hiddenWalls].sort(),
    heldBandId,
    theme.isDark,
  ]);
  const capturedSignature = useRef<string | null>(null);

  /**
   * Snapshots each chart to a PNG so the narrative can embed the figures even
   * after this panel unmounts. Debounced so it runs once the charts have
   * settled rather than on every intermediate render.
   */
  useEffect(() => {
    if (!onFiguresCaptured) return;
    if (capturedSignature.current === figureSignature) return;
    const timer = setTimeout(() => {
      const images: Record<string, string> = {};
      const sources: [string, HTMLCanvasElement | null | undefined][] = [
        ...Object.entries(instances.current).map(
          ([chartId, instance]) => [chartId, instance?.canvas] as [string, HTMLCanvasElement | undefined],
        ),
        ...Object.entries(rawCanvases.current),
      ];
      for (const [chartId, canvas] of sources) {
        if (!canvas?.isConnected || !canvas.width || !canvas.height) continue;
        // Flatten onto white so the figure reads on a printed page.
        const output = document.createElement('canvas');
        output.width = canvas.width;
        output.height = canvas.height;
        const ctx = output.getContext('2d');
        if (!ctx) continue;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, output.width, output.height);
        ctx.drawImage(canvas, 0, 0);
        images[chartId] = output.toDataURL('image/png');
      }
      if (!Object.keys(images).length) return;
      capturedSignature.current = figureSignature;
      onFiguresCaptured(images);
    }, 900);
    return () => clearTimeout(timer);
  }, [figureSignature, onFiguresCaptured]);

  // The screening chart's x domain is not the data's own range. See
  // `envelopeDomainMm`: a tally of uniformly short boxes would otherwise keep
  // the axis short enough that no envelope ever bends inside it.
  const maxLength = useMemo(
    () => envelopeDomainMm(items, config, screenBasis),
    [items, config, screenBasis],
  );

  /**
   * Whether the axial length column carries any information at all. All-equal
   * lengths plot as a single vertical stripe with the envelopes beside it
   * meaning nothing, and that is worth saying out loud rather than rendering.
   */
  const lengthUniformity = useMemo(
    () => measureUniformity(items.map((item) => item.nominal.length)),
    [items],
  );

  const bands = useMemo<SectionBand[]>(
    () => buildSectionBands(items.map((item) => ({
      distanceM: Number(item.nominal.ld),
      section: item.nominal.section,
    }))),
    [items],
  );
  const heldBand = useMemo(
    () => bands.find((band) => band.id === heldBandId) ?? null,
    [bands, heldBandId],
  );

  /** Plugin block for a chart whose x axis is log distance in metres. */
  const sectionBandOptions = useMemo(
    () => (bands.length
      ? {
          bands,
          selectedId: heldBandId,
          onSelect: setHeldBandId,
          labelColor: '#ffffff',
          ribbonBackground: theme.isDark ? 'rgba(15,23,42,0.6)' : 'rgba(241,245,249,0.8)',
        }
      : undefined),
    [bands, heldBandId, theme.isDark],
  );

  const depthByLd = useMemo(() => buildDepthByLd(items, depthBin, buckets), [items, depthBin, buckets]);
  const internalDist = useMemo(
    () => buildDepthByLd(items, internalBin, internalBuckets, 'internal'),
    [items, internalBin, internalBuckets],
  );
  const externalDist = useMemo(
    () => buildDepthByLd(items, externalBin, externalBuckets, 'external'),
    [items, externalBin, externalBuckets],
  );

  const orientation = useMemo(() => buildOrientationScatter(items), [items]);
  const crDepth = useMemo(() => buildDepthCrScatter(items), [items]);
  const crLength = useMemo(() => buildLengthCrScatter(items), [items]);
  const erfScatter = useMemo(() => buildErfScatter(items), [items]);
  const screeningScatter = useMemo(() => buildScreeningScatter(items), [items]);
  const envelopes = useMemo(
    () => buildEnvelopeCurves(items, config, maxLength, screening.depthRejectionPct, screenBasis),
    [items, config, maxLength, screening.depthRejectionPct, screenBasis],
  );
  const screenOutcome = useMemo(
    () => screenAgainstEnvelope(items, config, screening.depthRejectionPct, screenBasis),
    [items, config, screening.depthRejectionPct, screenBasis],
  );

  /** Counts per distance bin split by surface — the reference Figure 2.3(b). */
  const surfaceByLd = useMemo(() => {
    const bins = buildDepthByLd(items, depth3dBin, buckets).bins;
    const internal = new Array(bins.length).fill(0);
    const external = new Array(bins.length).fill(0);
    for (const item of items) {
      const index = bins.findIndex(
        (bin) => Number(item.nominal.ld) >= bin.start && Number(item.nominal.ld) < bin.end,
      );
      if (index < 0) continue;
      if (isInternal(item)) internal[index] += 1;
      else external[index] += 1;
    }
    return {
      labels: bins.map((bin) => bin.label),
      series: [
        { label: 'Internal', color: '#dc2626', data: internal },
        { label: 'External', color: '#2563eb', data: external },
      ],
    };
  }, [items, depth3dBin, buckets]);

  /** Counts per distance bin split by depth band — the reference Figure 2.3(c). */
  const bandByLd = useMemo(() => {
    const built = buildDepthByLd(
      depth3dSurface === 'all'
        ? items
        : items.filter((item) => (depth3dSurface === 'internal' ? isInternal(item) : !isInternal(item))),
      depth3dBin,
      buckets,
    );
    return {
      labels: built.labels,
      // Deepest band nearest the reader: it is the row that decides the
      // disposition, and the back rows are the ones that can afford to be
      // partially occluded.
      series: [...built.series].reverse().map((s) => ({ label: s.label, color: s.color, data: s.data })),
    };
  }, [items, depth3dBin, buckets, depth3dSurface]);

  // An ILI run pair routinely carries tens of thousands of anomalies. Animating
  // every marker on every update is what makes these charts crawl, so past this
  // size the transition is dropped and only the finished frame is drawn.
  const heavy = items.length > 2_000;
  const animation = heavy ? (false as const) : undefined;

  /** Shared axis and tooltip configuration for the stacked bar charts. */
  const barOptions = (yLabel: string, xLabel: string): ChartOptions<'bar'> => ({
    responsive: true,
    maintainAspectRatio: false,
    animation,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        stacked: true,
        title: { display: true, text: xLabel, color: theme.tick, font: { size: 10 } },
        ticks: { color: theme.tick, font: { size: 9 }, maxRotation: 60, minRotation: 0 },
        grid: { color: theme.grid },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        title: { display: true, text: yLabel, color: theme.tick, font: { size: 10 } },
        ticks: { color: theme.tick, font: { size: 9 }, precision: 0 },
        grid: { color: theme.grid },
      },
    },
    plugins: {
      legend: {
        position: 'top',
        labels: { color: theme.text, font: { size: 10 }, boxWidth: 10, boxHeight: 10, usePointStyle: true },
      },
      tooltip: {
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        borderWidth: 1,
        titleColor: theme.text,
        bodyColor: theme.text,
        padding: 10,
      },
    },
  });

  /**
   * Shared configuration for the scatter charts, including click-to-select.
   * `distanceAxis` adds the section ribbon and the section tooltip line to any
   * chart whose x axis is log distance in metres.
   */
  const scatterOptions = (
    xLabel: string,
    yLabel: string,
    extra?: Partial<ChartOptions<'scatter'>>,
    distanceAxis = false,
    /** An extra tooltip line only this chart can say about the feature. */
    describe?: (item: FfsScreenedResult) => string | null,
  ): ChartOptions<'scatter'> => ({
    responsive: true,
    maintainAspectRatio: false,
    animation,
    // The points already carry {x, y}, so Chart.js can read them directly
    // instead of walking the whole series to normalise it on every update.
    parsing: false,
    // Hit-testing every marker on every mouse move is the other half of the
    // cost; the nearest-point mode with a radius keeps hover cheap.
    interaction: { mode: 'nearest', intersect: true, axis: 'xy' },
    onClick: (_event, elements) => {
      const first = elements[0];
      if (!first) return;
      const dataset = (first.element as unknown as { $context?: { raw?: FfsPoint } }).$context?.raw;
      const point = dataset ?? undefined;
      if (point?.item) onSelect(point.item);
    },
    scales: {
      x: {
        type: 'linear',
        position: 'bottom',
        title: { display: true, text: xLabel, color: theme.tick, font: { size: 10 } },
        ticks: { color: theme.tick, font: { size: 9 } },
        grid: { color: theme.grid },
      },
      y: {
        title: { display: true, text: yLabel, color: theme.tick, font: { size: 10 } },
        ticks: { color: theme.tick, font: { size: 9 } },
        grid: { color: theme.grid },
      },
    },
    plugins: {
      sectionBands: distanceAxis ? sectionBandOptions : undefined,
      legend: {
        position: 'top',
        labels: { color: theme.text, font: { size: 10 }, boxWidth: 8, boxHeight: 8, usePointStyle: true },
      },
      tooltip: {
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        borderWidth: 1,
        titleColor: theme.text,
        bodyColor: theme.text,
        padding: 10,
        callbacks: {
          label: (context) => {
            const point = context.raw as FfsPoint;
            if (!point?.item) return '';
            const n = point.item.nominal;
            const lines = [
              `LD ${Number(n.ld).toLocaleString()} m · ${n.section}`,
              `${n.surface} · depth ${n.maxDepthPct.toFixed(1)}% · L ${n.length.toFixed(0)} mm`,
              `ERF ${Number.isFinite(n.ERF) ? n.ERF.toFixed(3) : '∞'} · remnant ${formatRemnantLife(n.remnantLife)}`,
            ];
            // Name the stretch the point sits in, so the reader does not have to
            // map the metre value back onto the section list themselves.
            const band = distanceAxis ? sectionTooltipLine(bands, point.x) : null;
            if (band) lines.push(band);
            const extraLine = describe?.(point.item);
            if (extraLine) lines.push(extraLine);
            return lines;
          },
        },
      },
    },
    ...extra,
  });

  /**
   * Builds the internal/external dataset pair for a scatter chart.
   *
   * The marker shrinks on a large population. A four-pixel dot is right for a
   * few hundred anomalies; at ten thousand it is both the frame cost — that is
   * ten thousand filled arcs per chart per redraw — and a solid ink smear that
   * paints over the envelope curves and threshold lines the chart is drawn to
   * compare against. Smaller marks cost less and read as a density.
   */
  const markerRadius = heavy ? 2 : 4;
  const scatterDatasets = (data: SplitScatter, style: ScatterStyle, labels = ['Internal', 'External']) =>
    [
      {
        label: `${labels[0]} (${data.internal.length})`,
        data: data.internal,
        backgroundColor: style.outlineOnly ? 'transparent' : style.internalColor,
        borderColor: style.internalColor,
        borderWidth: style.outlineOnly ? 1.5 : 0.5,
        pointStyle: style.internalShape,
        radius: markerRadius,
        hoverRadius: markerRadius + 3,
      },
      {
        label: `${labels[1]} (${data.external.length})`,
        data: data.external,
        backgroundColor: style.outlineOnly ? 'transparent' : style.externalColor,
        borderColor: style.externalColor,
        borderWidth: style.outlineOnly ? 1.5 : 0.5,
        pointStyle: style.externalShape,
        radius: markerRadius,
        hoverRadius: markerRadius + 3,
      },
    ].filter((dataset) => dataset.data.length > 0);

  /**
   * Stacked bars, dimmed outside the held section. The bar charts bin distance
   * into categories rather than plotting it, so they cannot carry the ribbon —
   * dimming is how the held stretch reads on them.
   */
  const barDatasets = (
    series: { label: string; color: string; data: number[] }[],
    bins: { start: number; end: number }[],
  ) => {
    const inHeldBand = (index: number) => {
      if (!heldBand || !bins[index]) return true;
      return bins[index].end > heldBand.startM && bins[index].start <= heldBand.endM;
    };
    return series.map((s) => ({
      label: s.label,
      data: s.data,
      backgroundColor: heldBand
        ? s.data.map((_, index) => (inHeldBand(index) ? s.color : `${s.color}26`))
        : s.color,
      borderWidth: 0,
      barPercentage: 0.92,
      categoryPercentage: 0.92,
    }));
  };

  if (!items.length) {
    return <Callout tone="warn">No assessed features are available to chart.</Callout>;
  }

  return (
    <div className="space-y-5">
      <Callout>
        Charts read from the full assessed population. Click any point to open its calculation trace. Bin sizes,
        depth bands, and marker styling are per-chart and can be exported as PNG for reporting.
        {bands.length > 0 && ' Click a section — on the ribbon above any distance chart or on a chip below — to hold that stretch highlighted across every chart here.'}
      </Callout>

      {bands.length > 0 && (
        <SectionBandLegend bands={bands} selectedId={heldBandId} onSelect={setHeldBandId} />
      )}

      {/* A measured column that holds one value is a data fault, not a plotting
          problem. Saying so here is the difference between a reader distrusting
          the chart and a reader distrusting the tally. */}
      {lengthUniformity.degenerate && (
        <Callout tone="danger">
          <strong>Axial length is not populated.</strong> All{' '}
          {lengthUniformity.count.toLocaleString()} of {lengthUniformity.total.toLocaleString()} assessed
          features report a length of {lengthUniformity.value} mm
          {lengthUniformity.distinctCount > 1
            ? ` (only ${lengthUniformity.distinctCount} distinct values in the whole population)`
            : ''}
          . Every anomaly therefore plots on one vertical line, and the normalised length{' '}
          <MathInline tex="z = \frac{L^{2}}{D\,t}" label="z equals L squared over D t" />
          {' '}— which selects the branch of the method and drives the Folias term — is the same for
          every feature on a given wall. The screening view, the remaining-strength result, and the
          remnant-life projection are all reading a column the tally did not fill. Check the length
          column mapping in the ILI import before relying on any of them.
        </Callout>
      )}

      {/* Row 1 — depth distribution and orientation */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartCard
          title="Depth category by log distance"
          subtitle="Feature count per bin, split by depth band"
          filename="FFS_depth_category_by_LD"
          binSize={depthBin}
          onBinSizeChange={setDepthBin}
          settings={<BucketSettings buckets={buckets} onChange={setBuckets} />}
        >
          {(registerCanvas) => (
            <Bar
              ref={bind('depth-by-ld', registerCanvas)}
              data={{ labels: depthByLd.labels, datasets: barDatasets(depthByLd.series, depthByLd.bins) }}
              options={barOptions('Feature count', 'Log distance bin [m]')}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Clock orientation by log distance"
          subtitle="Feature position around the circumference"
          filename="FFS_orientation_by_LD"
          settings={<ScatterSettings style={orientStyle} onChange={setOrientStyle} />}
        >
          {(registerCanvas) => (
            <Scatter
              ref={bind('orientation', registerCanvas)}
              data={{ datasets: scatterDatasets(orientation, orientStyle) }}
              options={scatterOptions('Log distance [m]', 'Clock position [hours]', {
                scales: {
                  x: {
                    type: 'linear',
                    position: 'bottom',
                    title: { display: true, text: 'Log distance [m]', color: theme.tick, font: { size: 10 } },
                    ticks: { color: theme.tick, font: { size: 9 } },
                    grid: { color: theme.grid },
                  },
                  y: {
                    min: 0,
                    max: 12,
                    reverse: true,
                    title: { display: true, text: 'Clock position', color: theme.tick, font: { size: 10 } },
                    ticks: {
                      color: theme.tick,
                      font: { size: 9 },
                      stepSize: 1,
                      callback: (value) => `${String(value).padStart(2, '0')}:00`,
                    },
                    grid: { color: theme.grid },
                  },
                },
              }, true)}
            />
          )}
        </ChartCard>
      </div>

      {/* The same population as the stacked chart above, with the series
          separated onto their own row instead of stacked. Kept alongside it
          rather than replacing it: reading an exact count off a perspective
          projection is worse, which is why every bar prints its own count. */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartCard
          title="Corrosion features by surface location"
          subtitle="Feature count per log-distance bin, internal against external"
          filename="FFS_features_by_surface"
          binSize={depth3dBin}
          onBinSizeChange={setDepth3dBin}
          height={430}
        >
          {(registerCanvas) => (
            <FfsPerspectiveBars
              labels={surfaceByLd.labels}
              series={surfaceByLd.series}
              xAxisLabel="Log distance [m]"
              yAxisLabel="Number of metal-loss anomalies"
              isDark={theme.isDark}
              height={430}
              onCanvasReady={(canvas) => {
                rawCanvases.current['surface-perspective'] = canvas;
                registerCanvas(canvas);
              }}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Corrosion features by depth of metal loss"
          subtitle={`Feature count per log-distance bin and depth band · bands are lower-inclusive (${depthBandLabel(20, 30)} means 20% up to but not including 30%)`}
          filename="FFS_features_by_depth_band"
          binSize={depth3dBin}
          onBinSizeChange={setDepth3dBin}
          height={430}
          settings={
            <div className="space-y-3">
              <BucketSettings buckets={buckets} onChange={setBuckets} />
              <div>
                <SettingsSectionLabel>Surface location</SettingsSectionLabel>
                <div role="radiogroup" aria-label="Surface location" className="ds-segmented mt-1 w-max">
                  {([
                    { value: 'all', label: 'All' },
                    { value: 'internal', label: 'Internal' },
                    { value: 'external', label: 'External' },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={depth3dSurface === option.value}
                      className={`ds-segmented__option${depth3dSurface === option.value ? ' is-active' : ''}`}
                      onClick={() => setDepth3dSurface(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          }
        >
          {(registerCanvas) => (
            <FfsPerspectiveBars
              labels={bandByLd.labels}
              series={bandByLd.series}
              xAxisLabel="Log distance [m]"
              yAxisLabel="Number of defects"
              isDark={theme.isDark}
              height={430}
              onCanvasReady={(canvas) => {
                rawCanvases.current['band-perspective'] = canvas;
                registerCanvas(canvas);
              }}
            />
          )}
        </ChartCard>
      </div>

      {/* Row 2 — corrosion rates */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartCard
          title="Depth corrosion rate vs log distance"
          subtitle="Radial metal-loss rate per feature"
          filename="FFS_depth_CR_vs_LD"
          settings={<ScatterSettings style={crDepthStyle} onChange={setCrDepthStyle} />}
        >
          {(registerCanvas) => (
            <Scatter
              ref={bind('cr-depth', registerCanvas)}
              data={{ datasets: scatterDatasets(crDepth, crDepthStyle) }}
              options={scatterOptions('Log distance [m]', 'CR depth [mm/year]', undefined, true)}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Length corrosion rate vs log distance"
          subtitle="Axial growth rate per feature"
          filename="FFS_length_CR_vs_LD"
          settings={<ScatterSettings style={crLengthStyle} onChange={setCrLengthStyle} />}
        >
          {(registerCanvas) => (
            <Scatter
              ref={bind('cr-length', registerCanvas)}
              data={{ datasets: scatterDatasets(crLength, crLengthStyle) }}
              options={scatterOptions('Log distance [m]', 'CR length [mm/year]', undefined, true)}
            />
          )}
        </ChartCard>
      </div>

      {/* Row 3 — depth distribution split by surface */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartCard
          title="Internal corrosion depth distribution"
          subtitle="Internal features per bin, split by depth band"
          filename="FFS_internal_depth_distribution"
          binSize={internalBin}
          onBinSizeChange={setInternalBin}
          settings={<BucketSettings buckets={internalBuckets} onChange={setInternalBuckets} />}
        >
          {(registerCanvas) => (
            <Bar
              ref={bind('internal-depth', registerCanvas)}
              data={{ labels: internalDist.labels, datasets: barDatasets(internalDist.series, internalDist.bins) }}
              options={barOptions('Internal feature count', 'Log distance bin [m]')}
            />
          )}
        </ChartCard>

        <ChartCard
          title="External corrosion depth distribution"
          subtitle="External features per bin, split by depth band"
          filename="FFS_external_depth_distribution"
          binSize={externalBin}
          onBinSizeChange={setExternalBin}
          settings={<BucketSettings buckets={externalBuckets} onChange={setExternalBuckets} />}
        >
          {(registerCanvas) => (
            <Bar
              ref={bind('external-depth', registerCanvas)}
              data={{ labels: externalDist.labels, datasets: barDatasets(externalDist.series, externalDist.bins) }}
              options={barOptions('External feature count', 'Log distance bin [m]')}
            />
          )}
        </ChartCard>
      </div>

      {/* Row 4 — screening envelope and ERF profile */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartCard
          title={
            screenBasis === 'level-0'
              ? 'Anomaly screening — B31G Level 0'
              : 'Anomaly screening — at operating pressure'
          }
          subtitle={
            lengthUniformity.degenerate
              ? `Depth against axial length — every feature reports ${lengthUniformity.value} mm, so the length axis carries no information`
              : screenBasis === 'level-0'
                ? `Depth against axial length. The envelope is the section 3 screen — geometry and grade only, no operating pressure — flat along ${screening.depthRejectionPct}%WT until the Folias term takes hold`
                : `Depth against axial length. The envelope is the Level 1 acceptance limit at each line's own operating pressure and safety factor, capped at ${screening.depthRejectionPct}%WT`
          }
          filename="FFS_anomaly_screening"
          height={360}
          footer={
            screenOutcome.exceeded > 0 ? (
              <Callout tone="danger">
                <strong>
                  {screenOutcome.exceeded.toLocaleString()} feature
                  {screenOutcome.exceeded === 1 ? '' : 's'} exceed
                  {screenOutcome.exceeded === 1 ? 's' : ''} the{' '}
                  {screenBasis === 'level-0'
                    ? 'B31G Level 0 screening threshold'
                    : 'acceptance envelope at operating pressure'}
                </strong>{' '}
                ({(screenOutcome.fraction * 100).toFixed(1)}% of {screenOutcome.total.toLocaleString()}).
                {screenBasis === 'level-0'
                  ? ' Failing the screen is not a rejection: it means the anomaly cannot be dispositioned from its length and depth alone and needs the Level 1 result — the ERF chart beside this one — or a higher-level assessment.'
                  : ' These features have no remaining pressure margin as reported.'}
                {screenOutcome.indeterminate > 0 &&
                  ` ${screenOutcome.indeterminate.toLocaleString()} further feature(s) resolve no allowable depth at all and are not counted here.`}
              </Callout>
            ) : (
              <Callout tone="ok">
                All {screenOutcome.total.toLocaleString()} assessed features plot on or below the{' '}
                {screenBasis === 'level-0'
                  ? 'B31G Level 0 screening envelope'
                  : 'acceptance envelope at operating pressure'}
                .
                {screenOutcome.indeterminate > 0 &&
                  ` ${screenOutcome.indeterminate.toLocaleString()} feature(s) resolve no allowable depth at all and are not screened.`}
              </Callout>
            )
          }
          settings={
            <div className="space-y-3">
              <div>
                <SettingsSectionLabel>Screening basis</SettingsSectionLabel>
                <div role="radiogroup" aria-label="Screening basis" className="ds-segmented w-max">
                  {([
                    { value: 'level-0', label: 'Level 0 — geometry and grade' },
                    { value: 'operating-pressure', label: 'At operating pressure' },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={screenBasis === option.value}
                      className={`ds-segmented__option${screenBasis === option.value ? ' is-active' : ''}`}
                      onClick={() => setScreenBasis(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                  The Level 0 tables carry no pressure column: they are drawn for a line at its design
                  hoop stress with the matching safety factor, which puts the target failure stress at
                  SMYS. Switching to operating pressure solves the same equations at this line's own{' '}
                  <MathInline tex="\Pop" label="P zero" /> and <MathInline tex="\SFac" label="safety factor" />
                  {' '}— on a lightly loaded line that envelope sits far above the code's screen.
                </p>
              </div>
              <div>
                <SettingsSectionLabel>Envelope curves — wall thickness</SettingsSectionLabel>
                <div className="flex flex-wrap gap-1.5">
                  {envelopes.map((curve) => {
                    const hidden = hiddenWalls.has(curve.wall);
                    return (
                      <button
                        key={curve.wall}
                        type="button"
                        onClick={() =>
                          setHiddenWalls((prev) => {
                            const next = new Set(prev);
                            if (next.has(curve.wall)) next.delete(curve.wall);
                            else next.add(curve.wall);
                            return next;
                          })
                        }
                        aria-pressed={!hidden}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-opacity ${
                          hidden
                            ? 'border-slate-200 opacity-45 dark:border-slate-600'
                            : 'border-slate-300 dark:border-slate-500'
                        }`}
                      >
                        <span
                          className="h-0.5 w-4 rounded"
                          style={{ background: curve.color }}
                          aria-hidden="true"
                        />
                        {curve.wall.toFixed(2)} mm
                      </button>
                    );
                  })}
                </div>
              </div>
              <ScatterSettings style={screenStyle} onChange={setScreenStyle} />
            </div>
          }
        >
          {(registerCanvas) => (
            <Scatter
              ref={bind('screening', registerCanvas)}
              data={{
                datasets: [
                  ...envelopes
                    .filter((curve) => !hiddenWalls.has(curve.wall))
                    .map((curve) => ({
                      label: `Limit ${config.method === 'original' ? 'Orig.' : 'Mod.'} B31G — t=${curve.wall.toFixed(2)} mm`,
                      data: curve.points,
                      showLine: true,
                      borderColor: curve.color,
                      backgroundColor: curve.color,
                      borderWidth: 1.75,
                      pointRadius: 0,
                      // Straight segments, and it has to stay that way. This is
                      // a scatter dataset drawn with `showLine`, and
                      // `ScatterController` — unlike `LineController` — never
                      // calls `updateControlPoints` before drawing. Any non-zero
                      // tension therefore strokes a Bézier path whose control
                      // points are still undefined: the path silently comes out
                      // empty and the envelope disappears, legend entry and all,
                      // with nothing logged. The curve is sampled at 121 points
                      // across the domain anyway, so interpolation would buy no
                      // smoothness — and on an acceptance boundary a spline that
                      // overshoots between solved points draws a limit the
                      // equations never gave.
                      tension: 0,
                    })),
                  ...scatterDatasets(screeningScatter, screenStyle),
                ],
              }}
              options={scatterOptions('Axial length [mm]', 'Depth [% of wall thickness]', {
                scales: {
                  x: {
                    type: 'linear',
                    position: 'bottom',
                    min: 0,
                    title: { display: true, text: 'Axial length [mm]', color: theme.tick, font: { size: 10 } },
                    ticks: { color: theme.tick, font: { size: 9 } },
                    grid: { color: theme.grid },
                  },
                  y: {
                    min: 0,
                    max: 100,
                    title: {
                      display: true,
                      text: 'Depth [% of wall thickness]',
                      color: theme.tick,
                      font: { size: 10 },
                    },
                    ticks: { color: theme.tick, font: { size: 9 } },
                    grid: { color: theme.grid },
                  },
                },
              }, false, (item) => {
                const verdict = screenOutcome.byKey.get(item.key);
                if (!verdict) return null;
                if (verdict.allowablePct === null) return 'Allowable depth: not resolvable at this length';
                return `Allowable ${verdict.allowablePct.toFixed(1)}%WT at this length — ${
                  verdict.exceeds ? 'exceeds the screen' : 'within the screen'
                }`;
              })}
            />
          )}
        </ChartCard>

        <ChartCard
          title="ERF vs log distance — B31G Level 1"
          subtitle={`Nominal ERF with the review band at ${screening.reviewBandErf.toFixed(2)}`}
          filename="FFS_ERF_vs_LD"
          height={360}
          settings={<ScatterSettings style={erfStyle} onChange={setErfStyle} />}
        >
          {(registerCanvas) => (
            <Scatter
              ref={bind('erf-ld', registerCanvas)}
              data={{
                datasets: [
                  {
                    label: 'ERF 1.00 — safe pressure limit',
                    data: [
                      { x: 0, y: 1 },
                      { x: maxBy(items, (i) => Number(i.nominal.ld) || 0) * 1.02, y: 1 },
                    ],
                    showLine: true,
                    borderColor: '#ef4444',
                    borderDash: [6, 4],
                    borderWidth: 1.75,
                    pointRadius: 0,
                  },
                  {
                    label: `Review band ${screening.reviewBandErf.toFixed(2)}`,
                    data: [
                      { x: 0, y: screening.reviewBandErf },
                      {
                        x: maxBy(items, (i) => Number(i.nominal.ld) || 0) * 1.02,
                        y: screening.reviewBandErf,
                      },
                    ],
                    showLine: true,
                    borderColor: '#f59e0b',
                    borderDash: [5, 5],
                    borderWidth: 1.5,
                    pointRadius: 0,
                  },
                  ...scatterDatasets(erfScatter, erfStyle),
                ],
              }}
              options={scatterOptions('Log distance [m]', 'Estimated repair factor', undefined, true)}
            />
          )}
        </ChartCard>
      </div>
    </div>
  );
}
