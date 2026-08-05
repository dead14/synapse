import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiCrosshair, FiMaximize2, FiZoomIn, FiZoomOut } from 'react-icons/fi';
import {
  defaultComparisonAxis,
  featureAxisValue,
  isFittingKind,
  laneFeaturesInWindow,
  laneReadoutAt,
  lanesExtent,
  placeLane,
  type AxisMode,
  type ComparisonLane,
  type FeatureKind,
  type LaneFeature,
  type PlacedFeature,
} from '../../domain/comparisonLanes.ts';

export interface SpoolRange {
  startM: number;
  endM: number;
  laneLabel: string;
}

interface LaneTimelineProps {
  lanes: ComparisonLane[];
  unalignedRuns: string[];
  selectedRowIdx?: number | null;
  onFeatureClick: (
    feature: LaneFeature,
    lane: ComparisonLane,
    pointer: { clientX: number; clientY: number },
  ) => void;
  onSpoolRangeChange?: (range: SpoolRange | null) => void;
}

type ColorMode = 'status' | 'depth';
type FeatureFilter = 'all' | 'anomaly' | 'attention';

const GUTTER = 66;
const RIGHT_PAD = 14;
const LANE_HEAD = 26;
const GW_ROW = 20;
/** Row holding the pipe furniture markers and their type tags. */
const FIT_ROW = 15;
const CLOCK_TOP = LANE_HEAD + GW_ROW + FIT_ROW;
const CLOCK_H = 140;
/**
 * A separate strip under the clock band for vendor-merged corrosion groups.
 * A cluster box is a bounding box over several pits, so drawing it among the
 * individual anomalies would bury them; kept below, the reviewer sees both the
 * pits and the group that covers them at the same distance.
 */
const CLUSTER_H = 30;
const CLUSTER_TOP = CLOCK_TOP + CLOCK_H;
const NOCLOCK_H = 24;
const LANE_H = CLUSTER_TOP + CLUSTER_H + NOCLOCK_H + 2;
const LANE_GAP = 10;
const AXIS_H = 22;
const NAV_H = 32;
const MIN_SPAN_M = 0.5;
const MAX_LANES_ON_SCREEN = 3;
const MAX_MARKS_PER_LANE = 900;
const MAX_LINKS = 500;
const DRAG_THRESHOLD_PX = 3;

const MAJOR_HOURS = new Set([0, 3, 6, 9, 12]);

/** Smallest painted defect footprint, so a 2 mm pit stays clickable. */
const MIN_BOX_PX = 3;

/**
 * Each kind of pipe furniture gets its own colour and a short tag, because the
 * reviewer's question about them is "what is it", not "how deep is it".
 */
const FITTING_STYLE: Partial<Record<FeatureKind, { color: string; tag: string; label: string }>> = {
  valve: { color: '#7c3aed', tag: 'VLV', label: 'Valve' },
  tee: { color: '#0891b2', tag: 'TEE', label: 'Tee / offtake' },
  bend: { color: '#ea580c', tag: 'BEND', label: 'Bend' },
  flange: { color: '#4d7c0f', tag: 'FLG', label: 'Flange' },
  fitting: { color: '#be123c', tag: 'FIT', label: 'Other fitting' },
};

function fittingStyle(kind: FeatureKind) {
  return FITTING_STYLE[kind] ?? FITTING_STYLE.fitting!;
}

const STATUS_COLOR: Record<string, string> = {
  persistent: '#087443',
  new: '#155eef',
  lost: '#b45309',
  transient: '#7c3aed',
  single: '#475467',
};

const STATUS_LABEL: Record<string, string> = {
  persistent: 'Carried over',
  new: 'New vs previous run',
  lost: 'Gone in next run',
  transient: 'Appeared and gone',
  single: 'No neighbour run',
};

function depthColor(depthPct: number | null): string {
  if (depthPct === null) return '#94a3b8';
  if (depthPct > 50) return '#991b1b';
  if (depthPct > 25) return '#ef4444';
  if (depthPct > 10) return '#f97316';
  return '#eab308';
}

function clockToY(deg: number): number {
  return CLOCK_TOP + (deg / 360) * CLOCK_H;
}

/** The cluster strip carries the same 0–360° sweep, compressed. */
function clusterToY(deg: number): number {
  return CLUSTER_TOP + (deg / 360) * CLUSTER_H;
}

/**
 * The band is one full turn around the pipe read top to bottom, so it runs
 * 00:00 → 12:00. Labelling the first gridline 12:00 printed the same hour at
 * both ends and made the axis look like it wrapped twice.
 */
function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/**
 * Circumferential extent of a defect in degrees. Needs the outer diameter: an
 * alignment session does not carry one, so without an operator-supplied value
 * the width is drawn nominal rather than guessed into a false arc.
 */
function arcDegrees(widthMm: number | null, odMm: number | null): number | null {
  if (widthMm === null || odMm === null || !(widthMm > 0) || !(odMm > 0)) return null;
  return Math.min(360, (widthMm / (Math.PI * odMm)) * 360);
}

function formatMeters(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)} m`;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export default function LaneTimeline({
  lanes,
  unalignedRuns,
  selectedRowIdx,
  onFeatureClick,
  onSpoolRangeChange,
}: LaneTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const laneStackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  const [axis, setAxis] = useState<AxisMode>(() => defaultComparisonAxis(lanes));
  const [colorMode, setColorMode] = useState<ColorMode>('status');
  const [filter, setFilter] = useState<FeatureFilter>('all');
  const [showLinks, setShowLinks] = useState(true);
  // Off by default: the cluster strip already answers "where is the group".
  // Turning it on superimposes the same boxes on the individual anomalies, which
  // is what an engineer wants when judging whether the group covers them.
  const [overlayClusters, setOverlayClusters] = useState(false);
  const [odMm, setOdMm] = useState<number | null>(null);
  const [odText, setOdText] = useState('');
  const [view, setView] = useState<{ start: number; span: number } | null>(null);
  const [cursorM, setCursorM] = useState<number | null>(null);
  const [spool, setSpool] = useState<{ startKey: string; endKey: string | null; laneLabel: string } | null>(null);
  const [jumpValue, setJumpValue] = useState('');

  const dragRef = useRef<{ pointerId: number; clientX: number; startM: number; active: boolean } | null>(null);
  const navDragRef = useRef<{ pointerId: number; mode: 'move' | 'left' | 'right'; clientX: number; start: number; span: number } | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    // Measure once up front: the first observer callback can be a frame away,
    // and until it lands the lanes would be drawn at the fallback width and
    // overflow the panel.
    const initial = element.getBoundingClientRect().width;
    if (initial) setWidth(initial);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect?.width;
      if (measured) setWidth(measured);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const extent = useMemo(() => lanesExtent(lanes, axis), [lanes, axis]);
  const totalSpan = Math.max(MIN_SPAN_M, extent.max - extent.min);

  // Switching axis moves every feature, so the window is re-clamped instead of
  // being left pointing at a distance that does not exist on the new axis.
  useEffect(() => {
    setView((current) => {
      if (!current) return { start: extent.min, span: Math.min(totalSpan, 50) };
      const span = clamp(current.span, MIN_SPAN_M, totalSpan);
      return { start: clamp(current.start, extent.min, Math.max(extent.min, extent.max - span)), span };
    });
  }, [extent.min, extent.max, totalSpan]);

  const viewStart = view ? view.start : extent.min;
  const viewSpan = view ? view.span : Math.min(totalSpan, 50);
  const viewEnd = viewStart + viewSpan;
  const chartWidth = Math.max(120, width - GUTTER - RIGHT_PAD);

  const mToX = useCallback(
    (meters: number) => GUTTER + ((meters - viewStart) / viewSpan) * chartWidth,
    [viewStart, viewSpan, chartWidth],
  );
  const xToM = useCallback(
    (x: number) => viewStart + ((x - GUTTER) / chartWidth) * viewSpan,
    [viewStart, viewSpan, chartWidth],
  );
  const navMToX = useCallback(
    (meters: number) => GUTTER + ((meters - extent.min) / totalSpan) * chartWidth,
    [extent.min, totalSpan, chartWidth],
  );

  const setWindow = useCallback((start: number, span: number) => {
    const nextSpan = clamp(span, MIN_SPAN_M, totalSpan);
    setView({ start: clamp(start, extent.min, Math.max(extent.min, extent.max - nextSpan)), span: nextSpan });
  }, [extent.min, extent.max, totalSpan]);

  const panBy = useCallback(
    (meters: number) => setWindow(viewStart + meters, viewSpan),
    [setWindow, viewStart, viewSpan],
  );

  const zoomAround = useCallback((factor: number, anchorM: number) => {
    const nextSpan = clamp(viewSpan * factor, MIN_SPAN_M, totalSpan);
    const ratio = (anchorM - viewStart) / viewSpan;
    setWindow(anchorM - ratio * nextSpan, nextSpan);
  }, [setWindow, viewSpan, viewStart, totalSpan]);

  // Wheel must be non-passive or the page scrolls instead of the lanes when the
  // reviewer flicks sideways over the chart.
  useEffect(() => {
    const element = laneStackRef.current;
    if (!element) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        zoomAround(event.deltaY > 0 ? 1.2 : 1 / 1.2, xToM(event.clientX - rect.left));
        return;
      }
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      panBy((delta / chartWidth) * viewSpan);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [chartWidth, panBy, viewSpan, xToM, zoomAround]);

  // Panning only takes over once the pointer has actually travelled, so a click
  // on a defect still reaches the defect.
  const onLanePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, startM: viewStart, active: false };
  };

  const onLanePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      const travelled = event.clientX - drag.clientX;
      if (!drag.active && Math.abs(travelled) < DRAG_THRESHOLD_PX) return;
      if (!drag.active) {
        drag.active = true;
        // Capture keeps the pan alive when the pointer leaves the lanes, but a
        // pointer that has already been released must not abort the pan.
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
      }
      setWindow(drag.startM - (travelled / chartWidth) * viewSpan, viewSpan);
      return;
    }
    const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
    setCursorM(x < GUTTER ? null : xToM(x));
  };

  const endLaneDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    if (drag.active) {
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    }
    dragRef.current = null;
  };

  const onNavPointerDown = (mode: 'move' | 'left' | 'right') => (event: React.PointerEvent<SVGRectElement>) => {
    event.stopPropagation();
    navDragRef.current = { pointerId: event.pointerId, mode, clientX: event.clientX, start: viewStart, span: viewSpan };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onNavPointerMove = (event: React.PointerEvent<SVGRectElement>) => {
    const drag = navDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaM = ((event.clientX - drag.clientX) / chartWidth) * totalSpan;
    if (drag.mode === 'move') setWindow(drag.start + deltaM, drag.span);
    else if (drag.mode === 'left') {
      const nextStart = Math.min(drag.start + deltaM, drag.start + drag.span - MIN_SPAN_M);
      setWindow(nextStart, drag.start + drag.span - nextStart);
    } else setWindow(drag.start, drag.span + deltaM);
  };

  const endNavDrag = (event: React.PointerEvent<SVGRectElement>) => {
    if (navDragRef.current?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    navDragRef.current = null;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = viewSpan * 0.25;
    if (event.key === 'ArrowLeft') panBy(-step);
    else if (event.key === 'ArrowRight') panBy(step);
    else if (event.key === '+' || event.key === '=') zoomAround(1 / 1.4, viewStart + viewSpan / 2);
    else if (event.key === '-') zoomAround(1.4, viewStart + viewSpan / 2);
    else if (event.key === 'Home') setWindow(extent.min, viewSpan);
    else if (event.key === 'End') setWindow(extent.max - viewSpan, viewSpan);
    else return;
    event.preventDefault();
  };

  const keepFeature = useCallback((feature: LaneFeature) => {
    if (filter === 'anomaly') return feature.kind === 'anomaly';
    if (filter === 'attention') {
      return feature.status === 'new' || feature.status === 'lost' || feature.status === 'transient';
    }
    return true;
  }, [filter]);

  const isSelected = useCallback((feature: LaneFeature) => (
    selectedRowIdx !== null && selectedRowIdx !== undefined && (
      feature.rowIndex === selectedRowIdx
      || feature.backRowIndex === selectedRowIdx
      || feature.forwardRowIndex === selectedRowIdx
    )
  ), [selectedRowIdx]);

  /**
   * The painted footprint of one metal-loss record: reported length along the
   * pipe, reported width around it. Drawing a defect as a dot threw away the
   * two dimensions the assessment is actually made from, and made a 30 mm pit
   * and a 2 m long groove look identical.
   */
  const defectBox = useCallback((feature: PlacedFeature, bandTop: number, bandHeight: number) => {
    const lengthM = Math.max(0, (feature.lengthMm ?? 0) / 1000);
    const boxWidth = Math.max(MIN_BOX_PX, (lengthM / viewSpan) * chartWidth);
    const arcDeg = arcDegrees(feature.widthMm, odMm);
    const boxHeight = arcDeg === null
      // No diameter, no arc: a fixed nominal band that says "width unknown"
      // rather than a height that would read as a measurement.
      ? Math.max(MIN_BOX_PX, bandHeight * 0.05)
      : Math.max(MIN_BOX_PX, (arcDeg / 360) * bandHeight);
    const centreY = feature.clockDeg === null
      ? bandTop + bandHeight / 2
      : bandTop + (feature.clockDeg / 360) * bandHeight;
    return {
      x: mToX(feature.position) - boxWidth / 2,
      y: centreY - boxHeight / 2,
      width: boxWidth,
      height: boxHeight,
      widthIsNominal: arcDeg === null,
    };
  }, [chartWidth, mToX, odMm, viewSpan]);

  // Reverse lanes so master (newest) is at top, old at bottom. Sorting and projecting
  // is axis work, not viewport work: doing it here keeps panning, zooming and cursor
  // movement off the hot path.
  const reversedLanes = useMemo(() => [...lanes].reverse(), [lanes]);
  const placements = useMemo(() => reversedLanes.map((lane) => placeLane(lane, axis)), [reversedLanes, axis]);

  const laneViews = useMemo(() => placements.map((placement) => {
    const windowed = laneFeaturesInWindow(placement, viewStart, viewEnd, MAX_MARKS_PER_LANE, isSelected);
    // One pass, four destinations: welds and fittings are pipe furniture drawn
    // on the joint rows, anomalies are footprints in the clock band, and merged
    // corrosion groups get the strip of their own beneath it.
    const welds: PlacedFeature[] = [];
    const fittings: PlacedFeature[] = [];
    const marks: PlacedFeature[] = [];
    const clusters: PlacedFeature[] = [];
    for (const feature of windowed.features) {
      if (feature.kind === 'weld') welds.push(feature);
      else if (isFittingKind(feature.kind)) fittings.push(feature);
      else if (!keepFeature(feature)) continue;
      else if (feature.isCluster) clusters.push(feature);
      else marks.push(feature);
    }
    return {
      placement,
      lane: placement.lane,
      visibleJoints: placement.joints.filter((joint) => joint.endM >= viewStart && joint.startM <= viewEnd),
      marks,
      clusters,
      fittings,
      welds,
      hidden: windowed.total - windowed.features.length,
    };
  }), [placements, viewStart, viewEnd, isSelected, keepFeature]);

  const readouts = useMemo(
    () => (cursorM === null ? null : placements.map((placement) => laneReadoutAt(placement, cursorM))),
    [placements, cursorM],
  );

  // Connectors are what turn N lanes into one comparison: per feature they show
  // how far the same defect moved between two consecutive runs.  Lanes are
  // displayed newest-first, so the older lane sits at index+1 and holds the
  // features that carry `forwardRowIndex` pointing into the newer lane above.
  const links = useMemo(() => {
    if (!showLinks || laneViews.length < 2) return [];
    const result: Array<{ key: string; x1: number; y1: number; x2: number; y2: number; drift: number }> = [];
    for (let index = 0; index < laneViews.length - 1 && result.length < MAX_LINKS; index += 1) {
      const newerLane = laneViews[index];
      const olderLane = laneViews[index + 1];
      const newerByBackRow = new Map<number, PlacedFeature>();
      newerLane.marks.forEach((feature) => {
        if (feature.backRowIndex !== null) newerByBackRow.set(feature.backRowIndex, feature);
      });
      for (const feature of olderLane.marks) {
        if (result.length >= MAX_LINKS) break;
        if (feature.forwardRowIndex === null || !feature.matchedForward) continue;
        const partner = newerByBackRow.get(feature.forwardRowIndex);
        if (!partner) continue;
        result.push({
          key: `${index}-${feature.key}`,
          x1: mToX(partner.position),
          y1: index * (LANE_H + LANE_GAP) + clockToY(partner.clockDeg ?? 0),
          x2: mToX(feature.position),
          y2: (index + 1) * (LANE_H + LANE_GAP) + clockToY(feature.clockDeg ?? 0),
          drift: (feature.rawM ?? 0) - (partner.rawM ?? 0),
        });
      }
    }
    return result;
  }, [laneViews, mToX, showLinks]);

  // Two weld clicks pick a spool. The 3D pipe draws both runs on one body, so
  // the range it receives is always on the master odometer even when the lanes
  // are displayed at their reported log distances.
  // Two weld clicks pick a spool. The click handler only moves the selection —
  // reading `spool` from the closure would miss a second click that lands
  // before React re-renders — and the parent is told about the resulting range
  // from an effect, because notifying it from inside a state updater would
  // update one component while another is rendering.
  const handleWeldClick = (weld: LaneFeature, lane: ComparisonLane) => {
    setSpool((current) => (
      !current || current.endKey !== null || current.laneLabel !== lane.label
        ? { startKey: weld.key, endKey: null, laneLabel: lane.label }
        : { startKey: current.startKey, endKey: weld.key, laneLabel: lane.label }
    ));
  };

  // The 3D pipe draws both runs on one body, so the range it receives is always
  // on the master odometer even when the lanes show their reported distances.
  useEffect(() => {
    if (!onSpoolRangeChange) return;
    const lane = spool === null ? undefined : lanes.find((candidate) => candidate.label === spool.laneLabel);
    const first = lane?.gws.find((gw) => gw.key === spool?.startKey);
    const last = lane?.gws.find((gw) => gw.key === spool?.endKey);
    if (!first || !last || first.alignedM === null || last.alignedM === null) {
      onSpoolRangeChange(null);
      return;
    }
    const startM = Math.min(first.alignedM, last.alignedM);
    const endM = Math.max(first.alignedM, last.alignedM);
    onSpoolRangeChange(endM - startM < 0.01 ? null : { startM, endM, laneLabel: lane.label });
  }, [spool, lanes, onSpoolRangeChange]);

  const jumpTo = (event: React.FormEvent) => {
    event.preventDefault();
    const target = Number(jumpValue.replace(',', '.'));
    if (Number.isFinite(target)) setWindow(target - viewSpan / 2, viewSpan);
  };

  const axisTicks = useMemo(() => {
    const count = clamp(Math.floor(chartWidth / 90), 4, 16);
    const rough = viewSpan / count;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10]
      .map((factor) => factor * magnitude)
      .find((candidate) => candidate >= rough) ?? 10 * magnitude;
    const ticks: number[] = [];
    for (let value = Math.ceil(viewStart / step) * step; value <= viewEnd; value += step) ticks.push(value);
    return { ticks, decimals: step < 1 ? 2 : step < 10 ? 1 : 0 };
  }, [chartWidth, viewSpan, viewStart, viewEnd]);

  if (lanes.length === 0) {
    return (
      <div className="px-4 py-6 text-sm" style={{ color: 'var(--syn-muted)' }}>
        No inspection run could be read from this comparison.
      </div>
    );
  }

  const cursorVisible = cursorM !== null && cursorM >= viewStart && cursorM <= viewEnd;

  return (
    <div ref={containerRef} className="flex flex-col">
      {/* Controls */}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5"
        style={{ borderBottom: '1px solid var(--syn-line)', background: 'var(--syn-surface)' }}
      >
        {/* One click toggles between each run at its own reported log distance
            (honest, un-shifted) and every run projected onto the newest run's
            odometer so matched girth welds line up despite pipe growth/shrink. */}
        <div className="flex items-center gap-1.5">
          <span className="syn-kicker" style={{ fontSize: '0.58rem' }}>Position</span>
          <button
            type="button"
            aria-pressed={axis === 'aligned'}
            onClick={() => setAxis((current) => (current === 'aligned' ? 'raw' : 'aligned'))}
            className={`syn-btn syn-btn--sm ${axis === 'aligned' ? 'syn-btn--lime' : 'syn-btn--outline'}`}
            style={{ minHeight: '1.6rem', fontSize: '0.66rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
            title={axis === 'aligned'
              ? 'Matched girth welds and features are snapped onto the newest run so a matched pair sits at the same X. Click to return to each run’s own reported log distance.'
              : 'Each run sits at the log distance printed in its own tally. Click to snap matched girth welds and features onto the newest run so a matched pair sits at the same X.'}
          >
            <FiCrosshair size={12} />
            {axis === 'aligned' ? 'Matched GW snapped — click for real LD' : 'Snap matched GW positions'}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="syn-kicker" style={{ fontSize: '0.58rem' }}>Colour</span>
          {(['status', 'depth'] as ColorMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={colorMode === mode}
              onClick={() => setColorMode(mode)}
              className={`syn-btn syn-btn--sm ${colorMode === mode ? 'syn-btn--ink' : 'syn-btn--outline'}`}
              style={{ minHeight: '1.6rem', fontSize: '0.66rem' }}
            >
              {mode === 'status' ? 'Match status' : 'Depth %WT'}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="syn-kicker" style={{ fontSize: '0.58rem' }}>Show</span>
          {([['all', 'All'], ['anomaly', 'Anomalies'], ['attention', 'Needs attention']] as Array<[FeatureFilter, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={`syn-btn syn-btn--sm ${filter === value ? 'syn-btn--ink' : 'syn-btn--outline'}`}
              style={{ minHeight: '1.6rem', fontSize: '0.66rem' }}
            >
              {label}
            </button>
          ))}
        </div>

        {lanes.length > 1 && (
          <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--syn-ink-soft)' }}>
            <input type="checkbox" checked={showLinks} onChange={(event) => setShowLinks(event.target.checked)} />
            Match links
          </label>
        )}

        <label
          className="flex items-center gap-1.5 text-xs"
          style={{ color: 'var(--syn-ink-soft)' }}
          title="Also draw each merged corrosion group over the individual anomalies it covers, so the combined extent can be judged in one place."
        >
          <input type="checkbox" checked={overlayClusters} onChange={(event) => setOverlayClusters(event.target.checked)} />
          Overlay clusters
        </label>

        {/* An alignment session carries no outer diameter, so the width of a
            defect cannot become a real arc without one. Supplying it here turns
            the reported width into a circumferential extent; leaving it empty
            keeps the boxes at a nominal height that claims nothing. */}
        <label
          className="flex items-center gap-1.5 text-xs"
          style={{ color: 'var(--syn-ink-soft)' }}
          title="Outer diameter of the line. Without it the defect width is drawn nominal rather than as a measured arc."
        >
          OD
          <input
            value={odText}
            onChange={(event) => {
              setOdText(event.target.value);
              const parsed = Number(event.target.value.replace(',', '.'));
              setOdMm(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
            }}
            placeholder="mm"
            aria-label="Outer diameter in millimetres"
            className="syn-input"
            style={{ width: '4.5rem', minHeight: '1.6rem', fontSize: '0.68rem', padding: '0.15rem 0.4rem' }}
          />
        </label>

        <form onSubmit={jumpTo} className="flex items-center gap-1.5 ml-auto">
          <input
            value={jumpValue}
            onChange={(event) => setJumpValue(event.target.value)}
            placeholder="Go to LD"
            aria-label="Go to log distance in metres"
            className="syn-input"
            style={{ width: '5.5rem', minHeight: '1.6rem', fontSize: '0.68rem', padding: '0.15rem 0.45rem' }}
          />
          {/* An explicit submit button: a form whose other controls are all
              type=button cannot be relied on for implicit Enter submission. */}
          <button type="submit" className="syn-btn syn-btn--sm syn-btn--outline" style={{ minHeight: '1.6rem', fontSize: '0.66rem' }}>
            Go
          </button>
          <button type="button" onClick={() => zoomAround(1 / 1.5, viewStart + viewSpan / 2)} className="syn-btn syn-btn--sm syn-btn--outline" style={{ minHeight: '1.6rem' }} aria-label="Zoom in">
            <FiZoomIn size={13} />
          </button>
          <button type="button" onClick={() => zoomAround(1.5, viewStart + viewSpan / 2)} className="syn-btn syn-btn--sm syn-btn--outline" style={{ minHeight: '1.6rem' }} aria-label="Zoom out">
            <FiZoomOut size={13} />
          </button>
          <button type="button" onClick={() => setWindow(extent.min, totalSpan)} className="syn-btn syn-btn--sm syn-btn--outline" style={{ minHeight: '1.6rem' }} aria-label="Fit the whole pipeline">
            <FiMaximize2 size={13} />
          </button>
        </form>
      </div>

      {axis === 'aligned' && unalignedRuns.length > 0 && (
        <div className="px-3 py-1.5 text-xs" style={{ background: 'var(--syn-warning-soft)', color: 'var(--syn-warning)' }}>
          {unalignedRuns.join(', ')} carries no matched welds onto the newest odometer, so it stays empty while snapped. Click
          <strong> Matched GW snapped </strong> off to read it at its own reported log distance.
        </div>
      )}

      {/* Lanes */}
      <div
        ref={laneStackRef}
        className="relative select-none active:cursor-grabbing"
        style={{
          cursor: 'crosshair',
          touchAction: 'none',
          // Every run gets a full lane, but past three the stack would push the
          // results table off the page, so the extra lanes scroll instead.
          maxHeight: (LANE_H + LANE_GAP) * Math.min(lanes.length, MAX_LANES_ON_SCREEN),
          overflowY: lanes.length > MAX_LANES_ON_SCREEN ? 'auto' : 'visible',
        }}
        tabIndex={0}
        role="application"
        aria-label="Run comparison lanes. Arrow keys pan, plus and minus zoom."
        onPointerDown={onLanePointerDown}
        onPointerMove={onLanePointerMove}
        onPointerUp={endLaneDrag}
        onPointerCancel={endLaneDrag}
        onPointerLeave={() => setCursorM(null)}
        onKeyDown={onKeyDown}
      >
        {laneViews.map(({ lane, visibleJoints, marks, clusters, fittings, welds, hidden }, laneIndex) => {
          const emptyOnAxis = axis === 'aligned' && !lane.alignedAvailable;
          const readout = readouts?.[laneIndex] ?? null;
          return (
            <svg key={lane.runId} width={width} height={LANE_H} className="block" style={{ borderBottom: '1px solid var(--syn-line)', marginBottom: laneIndex < laneViews.length - 1 ? LANE_GAP : 0 }}>
              <rect x={GUTTER} y={LANE_HEAD} width={chartWidth} height={LANE_H - LANE_HEAD} fill="var(--syn-surface)" />

              {/* Joint bands: alternating shading makes the girth-weld pitch readable at a glance */}
              {visibleJoints.map((joint) => {
                const left = Math.max(GUTTER, mToX(joint.startM));
                const right = Math.min(GUTTER + chartWidth, mToX(joint.endM));
                if (joint.index % 2 !== 0 || right <= left) return null;
                return (
                  <rect key={`band-${joint.index}`} x={left} y={CLOCK_TOP} width={right - left} height={CLOCK_H + CLUSTER_H + NOCLOCK_H} fill="var(--syn-canvas)" opacity={0.5} />
                );
              })}

              {/* Clock grid — one line per hour, labelled 00:00 through 12:00 */}
              {Array.from({ length: 13 }, (_, hour) => hour).map((hour) => {
                const y = clockToY(hour * 30);
                const major = MAJOR_HOURS.has(hour);
                return (
                  <g key={`clock-${hour}`}>
                    <line x1={GUTTER} y1={y} x2={GUTTER + chartWidth} y2={y} stroke="var(--syn-line)" strokeWidth={major ? 0.8 : 0.4} strokeDasharray={major ? '4 4' : '2 6'} />
                    {major && (
                      <text x={GUTTER - 6} y={y} textAnchor="end" dominantBaseline="central" fontSize="10" fontWeight="700" fill="var(--syn-muted)">
                        {hourLabel(hour)}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Merged-corrosion strip: its own baseline so a group box never
                  hides the individual pits it was built from. */}
              <rect x={GUTTER} y={CLUSTER_TOP} width={chartWidth} height={CLUSTER_H} fill="var(--syn-canvas-strong)" opacity={0.35} />
              <line x1={GUTTER} y1={CLUSTER_TOP} x2={GUTTER + chartWidth} y2={CLUSTER_TOP} stroke="var(--syn-line-strong)" strokeWidth="0.8" />
              <text x={GUTTER - 6} y={CLUSTER_TOP + CLUSTER_H / 2} textAnchor="end" dominantBaseline="central" fontSize="8.5" fontWeight="700" fill="var(--syn-muted)">
                cluster
              </text>
              <text x={GUTTER - 6} y={CLUSTER_TOP + CLUSTER_H + NOCLOCK_H / 2} textAnchor="end" dominantBaseline="central" fontSize="9" fontWeight="700" fill="var(--syn-muted)">
                no clock
              </text>

              {/* This run own girth welds — the joint boundaries */}
              {welds.map((weld) => {
                const x = mToX(weld.position);
                if (x < GUTTER - 4 || x > GUTTER + chartWidth + 4) return null;
                const spoolEdge = spool !== null && spool.laneLabel === lane.label
                  && (spool.startKey === weld.key || spool.endKey === weld.key);
                const paired = weld.status === 'persistent' || weld.status === 'single';
                const weldColor = paired ? 'var(--syn-line-strong)' : STATUS_COLOR[weld.status];
                return (
                  <g key={`gw-${weld.key}`}>
                    <line x1={x} y1={CLOCK_TOP} x2={x} y2={LANE_H} stroke={weldColor} strokeWidth={spoolEdge ? 1.8 : 1} strokeDasharray={paired ? '' : '3 3'} />
                    <circle
                      cx={x} cy={LANE_HEAD + GW_ROW / 2} r={5.5}
                      fill={spoolEdge ? '#eab308' : 'var(--syn-surface-raised)'}
                      stroke={weldColor}
                      strokeWidth={spoolEdge ? 2 : 1.2}
                      style={{ cursor: onSpoolRangeChange ? 'pointer' : 'default' }}
                      role="button"
                      tabIndex={0}
                      aria-label={`Girth weld ${weld.id} of ${lane.label} at ${formatMeters(weld.rawM)}`}
                      onClick={(event) => { event.stopPropagation(); handleWeldClick(weld, lane); }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        handleWeldClick(weld, lane);
                      }}
                    />
                  </g>
                );
              })}

              {/* Pipe furniture — valves, tees, bends, flanges. Same full-height
                  rule and joint-row marker as a girth weld so it reads as part
                  of the skeleton, separated only by colour and its type tag. */}
              {fittings.map((fitting) => {
                const x = mToX(fitting.position);
                if (x < GUTTER - 6 || x > GUTTER + chartWidth + 6) return null;
                const style = fittingStyle(fitting.kind);
                const paired = fitting.status === 'persistent' || fitting.status === 'single';
                const markerY = LANE_HEAD + GW_ROW + FIT_ROW / 2;
                const selected = isSelected(fitting);
                return (
                  <g
                    key={`fit-${fitting.key}`}
                    role="button"
                    tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    aria-label={`${style.label} ${fitting.id} of ${lane.label} at ${formatMeters(fitting.rawM)}, ${paired ? 'matched to the neighbouring run' : 'unmatched'}`}
                    onClick={(event) => { event.stopPropagation(); onFeatureClick(fitting, lane, event); }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      const box = event.currentTarget.getBoundingClientRect();
                      onFeatureClick(fitting, lane, { clientX: box.left + box.width / 2, clientY: box.top });
                    }}
                  >
                    <line
                      x1={x} y1={markerY} x2={x} y2={LANE_H}
                      stroke={style.color} strokeWidth={selected ? 1.8 : 1.1}
                      strokeDasharray={paired ? '' : '3 3'} opacity={0.85}
                    />
                    <rect
                      x={x - 4.5} y={markerY - 4.5} width={9} height={9} rx={1.5}
                      fill={paired ? style.color : 'var(--syn-surface-raised)'}
                      stroke={style.color} strokeWidth={selected ? 2 : 1.2}
                    />
                    <text
                      x={x + 7} y={markerY} dominantBaseline="central"
                      fontSize="7.5" fontWeight="800" fill={style.color} letterSpacing="0.04em"
                    >
                      {style.tag}
                    </text>
                  </g>
                );
              })}

              {/* Real joint length, printed from this run own weld spacing */}
              {visibleJoints.map((joint) => {
                const left = mToX(joint.startM);
                const right = mToX(joint.endM);
                if (right - left < 46) return null;
                return (
                  <text
                    key={`joint-label-${joint.index}`}
                    x={(Math.max(GUTTER, left) + Math.min(GUTTER + chartWidth, right)) / 2}
                    y={LANE_HEAD + GW_ROW / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="9"
                    fontWeight="700"
                    fill="var(--syn-muted)"
                  >
                    {joint.trueLengthM.toFixed(2)} m
                  </text>
                );
              })}

              {/* Metal loss drawn at its reported extent: axial length across,
                  circumferential width down, positioned at its clock hour. */}
              {marks.map((feature) => {
                const hasClock = feature.clockDeg !== null;
                const box = hasClock
                  ? defectBox(feature, CLOCK_TOP, CLOCK_H)
                  : defectBox(feature, CLUSTER_TOP + CLUSTER_H, NOCLOCK_H);
                if (box.x + box.width < GUTTER - 6 || box.x > GUTTER + chartWidth + 6) return null;
                const selected = isSelected(feature);
                const color = colorMode === 'depth' ? depthColor(feature.depthPct) : STATUS_COLOR[feature.status];
                return (
                  <g
                    key={`mark-${feature.key}`}
                    role="button"
                    tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    aria-label={`${feature.featureType || 'Feature'} ${feature.id} of ${lane.label} at ${formatMeters(feature.rawM)}, clock ${feature.clockLabel}, ${feature.lengthMm ?? '?'} by ${feature.widthMm ?? '?'} millimetres`}
                    onClick={(event) => { event.stopPropagation(); onFeatureClick(feature, lane, event); }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      onFeatureClick(feature, lane, { clientX: rect.left + rect.width / 2, clientY: rect.top });
                    }}
                  >
                    {selected && (
                      <rect
                        x={box.x - 3} y={box.y - 3} width={box.width + 6} height={box.height + 6}
                        fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="2 2"
                      />
                    )}
                    <rect
                      x={box.x} y={box.y} width={box.width} height={box.height}
                      // An internal defect is hollow, as it was when these were
                      // dots: the fill means "you can see it from outside".
                      fill={feature.external === false ? 'var(--syn-surface-raised)' : color}
                      fillOpacity={feature.external === false ? 1 : 0.82}
                      stroke={color}
                      strokeWidth={feature.external === false ? 1.6 : 0.8}
                    />
                  </g>
                );
              })}

              {/* Vendor-merged corrosion groups. Faded and dashed everywhere they
                  appear, because the box is a bounding box over several pits and
                  never a single defect the assessment can act on. */}
              {clusters.map((feature) => {
                const strip = defectBox(feature, CLUSTER_TOP, CLUSTER_H);
                if (strip.x + strip.width < GUTTER - 6 || strip.x > GUTTER + chartWidth + 6) return null;
                const selected = isSelected(feature);
                const color = colorMode === 'depth' ? depthColor(feature.depthPct) : STATUS_COLOR[feature.status];
                const overlay = overlayClusters ? defectBox(feature, CLOCK_TOP, CLOCK_H) : null;
                return (
                  <g
                    key={`cluster-${feature.key}`}
                    role="button"
                    tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    aria-label={`Clustered metal loss ${feature.id} of ${lane.label} at ${formatMeters(feature.rawM)}, clock ${feature.clockLabel}, not aligned across runs`}
                    onClick={(event) => { event.stopPropagation(); onFeatureClick(feature, lane, event); }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      onFeatureClick(feature, lane, { clientX: rect.left + rect.width / 2, clientY: rect.top });
                    }}
                  >
                    {overlay && (
                      <rect
                        x={overlay.x} y={overlay.y} width={overlay.width} height={overlay.height}
                        fill={color} fillOpacity={0.14} stroke={color} strokeWidth="0.8"
                        strokeDasharray="3 2" opacity={0.9}
                      />
                    )}
                    <rect
                      x={strip.x} y={strip.y} width={strip.width} height={strip.height}
                      fill={color} fillOpacity={0.3}
                      stroke={color} strokeWidth={selected ? 1.6 : 0.9} strokeDasharray="3 2"
                    />
                    {strip.width >= 16 && (
                      <text
                        x={strip.x + strip.width / 2} y={strip.y + strip.height / 2}
                        textAnchor="middle" dominantBaseline="central"
                        fontSize="7" fontWeight="800" fill={color} opacity={0.95}
                      >
                        CL
                      </text>
                    )}
                  </g>
                );
              })}

              {cursorVisible && (
                <line x1={mToX(cursorM as number)} y1={CLOCK_TOP} x2={mToX(cursorM as number)} y2={LANE_H} stroke="var(--syn-info)" strokeWidth="0.8" strokeDasharray="3 2" opacity="0.75" />
              )}

              {/* Lane header: run identity plus a live readout in that run own odometer */}
              <rect x={0} y={0} width={width} height={LANE_HEAD} fill="var(--syn-surface-raised)" />
              <text x={6} y={LANE_HEAD / 2} dominantBaseline="central" fontSize="11.5" fontWeight="800" fill="var(--syn-ink)">
                {lane.label}
              </text>
              <text x={GUTTER + 4} y={LANE_HEAD / 2} dominantBaseline="central" fontSize="10" fontWeight="600" fill="var(--syn-muted)" fontFamily="var(--syn-font-data)">
                {emptyOnAxis
                  ? 'no alignment onto the newest run — switch to Reported LD'
                  : readout
                    ? `LD ${formatMeters(readout.trueLdM)}`
                      + (readout.usGwId ? ` · U/S GW ${readout.usGwId} +${formatMeters(readout.usGwM)} of ${readout.jointLengthM?.toFixed(2)} m` : ' · outside any joint')
                      + (axis === 'aligned' ? ' · interpolated' : '')
                    : `${lane.features.length.toLocaleString()} features · ${lane.gws.length.toLocaleString()} GW`
                      + (hidden > 0 ? ` · ${hidden.toLocaleString()} shallow marks hidden at this zoom` : '')}
              </text>
              <text x={width - RIGHT_PAD} y={LANE_HEAD / 2} textAnchor="end" dominantBaseline="central" fontSize="7.5" fontWeight="800" fill={lane.isMaster ? 'var(--syn-accent-strong)' : 'var(--syn-muted)'} letterSpacing="0.06em">
                {lane.isMaster ? 'MASTER' : (axis === 'aligned' && lane.alignedIsDerived ? 'projected via chain' : '')}
              </text>
            </svg>
          );
        })}

        {/* Connectors between runs, drawn over the lane stack */}
        {links.length > 0 && (
          <svg width={width} height={laneViews.length * (LANE_H + LANE_GAP)} className="absolute left-0 top-0" style={{ pointerEvents: 'none' }} aria-hidden="true">
            {links.map((link) => (
              <line
                key={link.key}
                x1={link.x1} y1={link.y1} x2={link.x2} y2={link.y2}
                stroke={Math.abs(link.drift) > 0.5 ? 'var(--syn-warning)' : 'var(--syn-success)'}
                strokeWidth="0.7"
                opacity="0.35"
              />
            ))}
          </svg>
        )}
      </div>

      {/* Shared distance axis */}
      <svg width={width} height={AXIS_H} className="block" style={{ background: 'var(--syn-surface)', borderBottom: '1px solid var(--syn-line)' }}>
        <text x={6} y={AXIS_H / 2} dominantBaseline="central" fontSize="8" fontWeight="700" fill="var(--syn-muted)">
          {axis === 'raw' ? 'LD (m)' : 'master (m)'}
        </text>
        {axisTicks.ticks.map((value) => {
          const x = mToX(value);
          if (x < GUTTER || x > GUTTER + chartWidth) return null;
          return (
            <g key={`tick-${value}`}>
              <line x1={x} y1={0} x2={x} y2={4} stroke="var(--syn-line-strong)" strokeWidth="1" />
              <text x={x} y={13} textAnchor="middle" fontSize="8" fontWeight="600" fill="var(--syn-muted)">
                {value.toFixed(axisTicks.decimals)}
              </text>
            </g>
          );
        })}
        {cursorVisible && (
          <g>
            <line x1={mToX(cursorM as number)} y1={0} x2={mToX(cursorM as number)} y2={AXIS_H} stroke="var(--syn-info)" strokeWidth="0.8" />
            <rect x={mToX(cursorM as number) - 26} y={3} width={52} height={13} rx={3} fill="var(--syn-info)" />
            <text x={mToX(cursorM as number)} y={10} textAnchor="middle" dominantBaseline="central" fontSize="8" fontWeight="700" fill="#fff">
              {(cursorM as number).toFixed(2)}
            </text>
          </g>
        )}
      </svg>

      {/* Navigator over the full pipeline */}
      <div className="relative" style={{ background: 'var(--syn-surface)' }}>
        <svg width={width} height={NAV_H} className="block">
          <rect x={GUTTER} y={9} width={chartWidth} height={12} rx={3} fill="var(--syn-canvas-strong)" />
          {laneViews.map(({ lane }, index) => {
            const bandHeight = 10 / laneViews.length;
            return (
              <g key={`nav-${lane.runId}`}>
                {lane.gws.map((gw) => {
                  const position = featureAxisValue(gw, axis);
                  if (position === null) return null;
                  const y = 10 + index * bandHeight;
                  return <line key={`nav-gw-${gw.key}`} x1={navMToX(position)} y1={y} x2={navMToX(position)} y2={y + bandHeight} stroke="var(--syn-line-strong)" strokeWidth="0.5" />;
                })}
              </g>
            );
          })}
          <rect
            x={navMToX(viewStart)} y={6}
            width={Math.max(6, (viewSpan / totalSpan) * chartWidth)} height={18} rx={3}
            fill="rgba(21, 94, 239, 0.16)" stroke="var(--syn-info)" strokeWidth="1.5"
            style={{ cursor: 'grab' }}
            onPointerDown={onNavPointerDown('move')}
            onPointerMove={onNavPointerMove}
            onPointerUp={endNavDrag}
            onPointerCancel={endNavDrag}
          />
          <rect
            x={navMToX(viewStart) - 3} y={6} width={6} height={18} rx={2} fill="var(--syn-info)"
            style={{ cursor: 'ew-resize' }}
            onPointerDown={onNavPointerDown('left')}
            onPointerMove={onNavPointerMove}
            onPointerUp={endNavDrag}
            onPointerCancel={endNavDrag}
          />
          <rect
            x={navMToX(viewEnd) - 3} y={6} width={6} height={18} rx={2} fill="var(--syn-info)"
            style={{ cursor: 'ew-resize' }}
            onPointerDown={onNavPointerDown('right')}
            onPointerMove={onNavPointerMove}
            onPointerUp={endNavDrag}
            onPointerCancel={endNavDrag}
          />
          <text x={6} y={NAV_H / 2} dominantBaseline="central" fontSize="7.5" fontWeight="700" fill="var(--syn-muted)">
            {extent.min.toFixed(0)}–{extent.max.toFixed(0)} m
          </text>
        </svg>
        <button type="button" onClick={() => panBy(-viewSpan * 0.5)} className="absolute left-0.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'var(--syn-surface-raised)', border: '1px solid var(--syn-line)' }} aria-label="Pan left">
          <FiChevronLeft size={11} />
        </button>
        <button type="button" onClick={() => panBy(viewSpan * 0.5)} className="absolute right-0.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: 'var(--syn-surface-raised)', border: '1px solid var(--syn-line)' }} aria-label="Pan right">
          <FiChevronRight size={11} />
        </button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-0.5 px-3 py-1" style={{ background: 'var(--syn-surface)', borderTop: '1px solid var(--syn-line)' }}>
        <span className="text-xs" style={{ color: 'var(--syn-muted)' }}>
          {viewStart.toFixed(2)}–{viewEnd.toFixed(2)} m of {totalSpan.toFixed(2)} m · drag or scroll to move · ctrl+scroll to zoom
        </span>
        {colorMode === 'status'
          ? (['persistent', 'new', 'lost', 'transient'] as const).map((status) => (
            <span key={status} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--syn-ink-soft)' }}>
              <svg width="12" height="9"><rect x="0" y="1.5" width="12" height="6" fill={STATUS_COLOR[status]} fillOpacity="0.82" stroke={STATUS_COLOR[status]} strokeWidth="0.8" /></svg>
              {STATUS_LABEL[status]}
            </span>
          ))
          : ([['≤10 %WT', 5], ['10–25 %WT', 20], ['25–50 %WT', 40], ['>50 %WT', 60]] as Array<[string, number]>).map(([label, depth]) => (
            <span key={label} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--syn-ink-soft)' }}>
              <svg width="12" height="9"><rect x="0" y="1.5" width="12" height="6" fill={depthColor(depth)} fillOpacity="0.82" stroke={depthColor(depth)} strokeWidth="0.8" /></svg>
              {label}
            </span>
          ))}
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--syn-ink-soft)' }}>
          <svg width="12" height="9"><rect x="0" y="1.5" width="12" height="6" fill="var(--syn-surface-raised)" stroke="var(--syn-muted)" strokeWidth="1.4" /></svg>
          Internal
        </span>
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--syn-ink-soft)' }}>
          <svg width="12" height="9"><rect x="0" y="1.5" width="12" height="6" fill="var(--syn-muted)" fillOpacity="0.3" stroke="var(--syn-muted)" strokeWidth="0.9" strokeDasharray="3 2" /></svg>
          Clustered metal loss (own strip, never aligned)
        </span>
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--syn-ink-soft)' }}>
          <svg width="12" height="9"><line x1="6" y1="0" x2="6" y2="9" stroke="var(--syn-line-strong)" strokeWidth="1.4" /></svg>
          Girth weld of that run
        </span>
        {(['valve', 'tee', 'bend', 'flange', 'fitting'] as FeatureKind[]).map((kind) => {
          const style = fittingStyle(kind);
          return (
            <span key={kind} className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--syn-ink-soft)' }}>
              <svg width="9" height="9"><rect x="0.5" y="0.5" width="8" height="8" rx="1.5" fill={style.color} stroke={style.color} /></svg>
              {style.label}
            </span>
          );
        })}
        {odMm === null && (
          <span className="text-xs" style={{ color: 'var(--syn-warning)' }}>
            No OD entered — defect width drawn nominal, not to scale
          </span>
        )}
      </div>
    </div>
  );
}
