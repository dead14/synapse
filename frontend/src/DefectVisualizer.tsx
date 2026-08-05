import { useState, useMemo, useEffect, lazy, Suspense } from 'react';
import { FiBox, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import LaneTimeline, { type SpoolRange } from './components/comparison/LaneTimeline';
import { apiFetch } from './utils/api';
import { clampTooltipPosition } from './utils/tooltipPosition';
import {
  buildComparisonLanes,
  type ComparisonLane,
  type LaneFeature,
} from './domain/comparisonLanes.ts';

/**
 * Lane timeline for a comparison result, plus the entry point into the Spool
 * Detail View.
 *
 * The lanes answer "where has this feature been across the runs"; picking two
 * girth welds on a lane hands that spool to the detail workspace, which answers
 * "what is on this piece of pipe and how did it change". The workspace owns all
 * of the 3D and unrolled rendering — this component only picks the spool.
 */

const SpoolDetailView = lazy(() => import('./components/spool/SpoolDetailView.tsx'));

interface DefectVisualizerProps {
  data: any[];
  selectedRowIdx?: number | null;
  onSelectRowIdx?: (idx: number | null) => void;
}

const STATUS_BADGE: Record<string, string> = {
  persistent: 'Carried over',
  new: 'New',
  lost: 'Gone next run',
  transient: 'One run only',
  single: 'Single run',
};

export default function DefectVisualizer({ data, selectedRowIdx, onSelectRowIdx }: DefectVisualizerProps) {
  const [isSpoolViewOpen, setIsSpoolViewOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [spoolRange, setSpoolRange] = useState<SpoolRange | null>(null);
  const [inspected, setInspected] = useState<{ feature: LaneFeature; lane: ComparisonLane } | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Opening the workspace is the heaviest thing this screen does, so the two
  // frames it takes to paint stay instrumented.
  useEffect(() => {
    if (!isSpoolViewOpen) return undefined;
    const startedAt = performance.now();
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const durationMs = performance.now() - startedAt;
        apiFetch('/api/metrics/browser', {
          method: 'POST',
          body: { name: 'render_3d_viewer', durationMs: Math.round(durationMs * 100) / 100 },
        }).catch(() => {});
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [isSpoolViewOpen]);

  // One lane per inspection run: two runs give two lanes, a three-run chain
  // gives three, each holding the distances that run actually reported.
  const { lanes, unalignedRuns } = useMemo(() => buildComparisonLanes(data), [data]);

  const openFeature = (
    feature: LaneFeature,
    lane: ComparisonLane,
    pointer: { clientX: number; clientY: number },
  ) => {
    onSelectRowIdx?.(feature.rowIndex);
    setInspected({ feature, lane });
    setTooltipPos({ x: pointer.clientX, y: pointer.clientY });
  };

  const featureRows = (feature: LaneFeature, lane: ComparisonLane): Array<[string, string]> => {
    const rows: Array<[string, string]> = [
      ['Run', lane.label],
      ['Reported LD', feature.rawM === null ? '—' : `${feature.rawM.toFixed(3)} m`],
    ];
    if (!lane.isMaster) {
      rows.push(['On master axis', feature.alignedM === null ? 'not aligned' : `${feature.alignedM.toFixed(3)} m`]);
    }
    rows.push(
      ['Dist U/S GW', feature.usGwM === null ? '—' : `${feature.usGwM.toFixed(3)} m`],
      ['Joint no.', feature.jointNo ?? '—'],
      ['Clock', feature.clockLabel],
      ['Surface', feature.external === null ? '—' : (feature.external ? 'External' : 'Internal')],
      ['Depth', feature.depthPct === null ? '—' : `${feature.depthPct} %WT`],
      ['Length', feature.lengthMm === null ? '—' : `${feature.lengthMm} mm`],
      ['Width', feature.widthMm === null ? '—' : `${feature.widthMm} mm`],
      ['Type', feature.featureType || '—'],
    );
    // Said outright, because the run-to-run columns above stay empty for these
    // rows by rule rather than because the runs disagreed.
    if (feature.isCluster) {
      rows.push(['Clustered', 'Merged group — not aligned across runs']);
    }
    return rows;
  };

  const tooltipBadge = inspected
    ? { label: STATUS_BADGE[inspected.feature.status] ?? inspected.feature.status, good: inspected.feature.status === 'persistent' }
    : null;
  const tooltipRows = inspected ? featureRows(inspected.feature, inspected.lane) : [];

  return (
    <div className="syn-panel flex flex-col overflow-hidden" style={{ padding: 0 }}>
      {/* Header bar */}
      <div className="flex items-center justify-between gap-4 px-4 py-2" style={{ borderBottom: '1px solid var(--syn-line, #d4d9d0)', background: 'var(--syn-surface, #fbfcf9)' }}>
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold" style={{ color: 'var(--syn-ink, #151711)', letterSpacing: '-0.02em' }}>
            Run comparison
          </h3>
          <span className="text-xs" style={{ color: 'var(--syn-muted, #727a6d)' }}>
            {lanes.length} inspection {lanes.length === 1 ? 'run' : 'runs'} · {data.filter((row) => row?.__excluded !== true).length.toLocaleString()} comparison rows
          </span>
          {!isCollapsed && (
            <span className="text-xs" style={{ color: 'var(--syn-muted, #727a6d)' }}>
              Click two girth welds on one lane to open that spool in the detail view
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {spoolRange && !isCollapsed && (
            <button onClick={() => setIsSpoolViewOpen(true)} className="syn-btn syn-btn--sm syn-btn--ink">
              <FiBox size={14} /> Spool detail ({(spoolRange.endM - spoolRange.startM).toFixed(1)} m)
            </button>
          )}
          {/* Reviewing rows sometimes needs the whole viewport for the table. */}
          <button
            type="button"
            onClick={() => setIsCollapsed((collapsed) => !collapsed)}
            className="syn-btn syn-btn--sm syn-btn--outline"
            style={{ minHeight: '1.6rem', fontSize: '0.66rem' }}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? <FiChevronDown size={13} /> : <FiChevronUp size={13} />}
            {isCollapsed ? 'Show lanes' : 'Hide lanes'}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <LaneTimeline
          lanes={lanes}
          unalignedRuns={unalignedRuns}
          selectedRowIdx={selectedRowIdx}
          onFeatureClick={openFeature}
          onSpoolRangeChange={setSpoolRange}
        />
      )}

      {isSpoolViewOpen && spoolRange && (
        <Suspense fallback={null}>
          <SpoolDetailView
            rows={data}
            range={spoolRange}
            onClose={() => setIsSpoolViewOpen(false)}
            onSelectRowIdx={(rowIndex) => onSelectRowIdx?.(rowIndex)}
          />
        </Suspense>
      )}

      {/* Feature detail from the lane timeline */}
      {inspected && tooltipBadge && (
        <>
          <div className="fixed inset-0 z-[1000000]" onClick={() => setInspected(null)} />
          <div
            className="fixed z-[1000001] rounded-lg p-3 text-xs w-64 pointer-events-auto"
            style={{
              background: 'var(--syn-surface-raised, #fff)',
              border: '1px solid var(--syn-line, #d4d9d0)',
              boxShadow: 'var(--syn-shadow)',
              ...(() => {
                const placement = clampTooltipPosition({
                  pointerX: tooltipPos.x, pointerY: tooltipPos.y,
                  tooltipWidth: 256, tooltipHeight: 360,
                  viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
                });
                return { left: placement.left, top: placement.top };
              })(),
            }}
          >
            <div className="font-bold pb-1 mb-2 flex justify-between items-center gap-2" style={{ borderBottom: '1px solid var(--syn-line, #d4d9d0)', color: 'var(--syn-ink, #151711)' }}>
              <span>ID: {inspected.feature.id}</span>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${tooltipBadge.good ? 'text-green-700' : 'text-red-700'}`}
                style={{ background: tooltipBadge.good ? 'var(--syn-success-soft, #e4f7ec)' : 'var(--syn-danger-soft, #fee9e6)' }}
              >
                {tooltipBadge.label}
              </span>
            </div>
            <div className="flex flex-col gap-1 mb-3">
              {tooltipRows.map(([label, value], i) => (
                <div key={label} className="flex justify-between gap-2 pb-1" style={{ borderBottom: i < tooltipRows.length - 1 ? '1px solid var(--syn-line, #d4d9d0)' : 'none' }}>
                  <span style={{ color: 'var(--syn-muted, #727a6d)' }} className="font-medium">{label}:</span>
                  <span className="font-bold text-right" style={{ color: 'var(--syn-ink, #151711)' }}>{value}</span>
                </div>
              ))}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelectRowIdx?.(inspected.feature.rowIndex);
                setInspected(null);
              }}
              className="syn-btn syn-btn--sm syn-btn--ink w-full"
            >
              Find &amp; Highlight in Table
            </button>
          </div>
        </>
      )}
    </div>
  );
}
