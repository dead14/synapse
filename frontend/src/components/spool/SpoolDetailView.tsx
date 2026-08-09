/**
 * Spool Detail View — the inspection workspace for one length of pipe.
 *
 * Four panes read one selection: the 3D shell, the unrolled surface, the
 * anomaly list and the detail rail. Picking a defect anywhere moves all four,
 * because the failure mode of a viewer like this is a reviewer holding two
 * different pictures of the same metal at once.
 *
 * The axial window (`filters.maStartM/maEndM`) is the single source of scale.
 * Narrowing it is how the workspace zooms: the 3D pipe, the ruler under it and
 * the unrolled plot all re-derive their scale from that one window, so they can
 * never drift apart.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FiCamera, FiCrosshair, FiDownload, FiEye, FiHome, FiLayers, FiMaximize2,
  FiMinimize2, FiRotateCcw, FiScissors, FiX, FiZoomIn, FiZoomOut,
} from 'react-icons/fi';

import Modal from '../common/Modal';
import {
  DEFAULT_LAYERS,
  buildSpoolModel,
  defaultFilters,
  filterSpoolFeatures,
  type ComparisonRow,
  type SpoolFeature,
  type SpoolFeatureClass,
  type SpoolFilters,
  type SpoolLayers,
} from '../../domain/spoolFeatures.ts';
import SpoolScene3D, { type CameraCommand, type CameraPreset } from './SpoolScene3D.tsx';
import SpoolFittingBar from './SpoolFittingBar.tsx';
import { collectSpoolFittings, type SpoolFittingOverride } from './spoolFittings.ts';
import SpoolUnrolled2D from './SpoolUnrolled2D.tsx';
import SpoolAnomalyList from './SpoolAnomalyList.tsx';
import SpoolInspector from './SpoolInspector.tsx';
import SpoolControlPanel from './SpoolControlPanel.tsx';
import SpoolResizer from './SpoolResizer.tsx';
import {
  COLLAPSED_LAYOUT,
  DEFAULT_LAYOUT,
  clampPane,
  isMaximised,
  readLayout,
  writeLayout,
  type SpoolLayout,
} from './spoolLayout.ts';
import { DEPTH_PALETTE_LABEL, depthGradient, type DepthPalette } from './spoolPalette.ts';
import { NOMINAL_OD_MM, sceneScale } from './spoolScale.ts';
import './spool.css';

interface SpoolDetailViewProps {
  rows: ComparisonRow[];
  range: { startM: number; endM: number; laneLabel: string };
  onClose: () => void;
  onSelectRowIdx?: (rowIndex: number) => void;
}

const CAMERA_BUTTONS: Array<[CameraPreset, string]> = [
  ['home', 'Home'],
  ['top', 'Top (12:00)'],
  ['bottom', 'Bottom (6:00)'],
  ['left', 'Left (9:00)'],
  ['right', 'Right (3:00)'],
  ['look-along', 'Look along'],
];

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function SpoolDetailView({ rows, range, onClose, onSelectRowIdx }: SpoolDetailViewProps) {
  const model = useMemo(() => buildSpoolModel(rows), [rows]);

  const [layers, setLayers] = useState<SpoolLayers>(DEFAULT_LAYERS);
  const [filters, setFilters] = useState<SpoolFilters>(() => defaultFilters(range.startM, range.endM));
  const [odMm, setOdMm] = useState<number | null>(null);
  const [palette, setPalette] = useState<DepthPalette>('ili');
  const [stage, setStage] = useState<'3D' | '2D'>('3D');
  const [compareRuns, setCompareRuns] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [hovered, setHovered] = useState<SpoolFeature | null>(null);
  const [command, setCommand] = useState<CameraCommand>({ preset: 'home', nonce: 0 });
  const [xray, setXray] = useState(false);
  const [cutaway, setCutaway] = useState(false);
  const [crossSection, setCrossSection] = useState(false);
  const [markerScale, setMarkerScale] = useState(3);
  const [showWelds, setShowWelds] = useState(true);
  const [showFittings, setShowFittings] = useState(true);
  // What the engineer corrected about the furniture in this window: an ILI run
  // reports that a bend is there far more reliably than it reports its angle.
  const [fittingOverrides, setFittingOverrides] = useState<Record<string, SpoolFittingOverride>>({});
  const [showAxialScale, setShowAxialScale] = useState(true);
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePicks, setMeasurePicks] = useState<SpoolFeature[]>([]);
  const [layout, setLayout] = useState<SpoolLayout>(readLayout);
  /** Sizes to come back to when the stage stops being maximised. */
  const [restoreLayout, setRestoreLayout] = useState<SpoolLayout | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => { writeLayout(layout); }, [layout]);

  const resizePane = (key: keyof SpoolLayout, delta: number) => {
    setRestoreLayout(null);
    setLayout((current) => ({ ...current, [key]: clampPane(key, current[key] + delta) }));
  };

  const togglePane = (key: keyof SpoolLayout) => {
    setRestoreLayout(null);
    setLayout((current) => ({ ...current, [key]: current[key] === 0 ? DEFAULT_LAYOUT[key] : 0 }));
  };

  const maximised = isMaximised(layout);

  /**
   * Maximise gives the whole window to the pipe; the same button gives it back.
   *
   * Restoring must never depend on remembering a previous layout. The layout is
   * persisted, so re-opening the workspace after maximising starts collapsed
   * with nothing remembered — and dragging a pane clears the memory too. Both
   * left the button re-collapsing an already-collapsed layout, which reads as a
   * button that does not respond. Falling back to the default sizes always
   * gives the panels back.
   */
  const toggleMaximise = () => {
    if (maximised) {
      setLayout(restoreLayout ?? DEFAULT_LAYOUT);
      setRestoreLayout(null);
    } else {
      setRestoreLayout(layout);
      setLayout(COLLAPSED_LAYOUT);
    }
    // The stage just changed shape, so reframe the pipe for the viewport it has.
    setCommand((current) => ({ preset: 'home', nonce: current.nonce + 1 }));
  };

  // A new spool selection resets the window; nothing else survives the change,
  // because a filter tuned to the previous spool means nothing on this one.
  useEffect(() => {
    setFilters(defaultFilters(range.startM, range.endM));
    setSelectedKey(null);
    setMeasurePicks([]);
    setFittingOverrides({});
  }, [range.startM, range.endM]);

  const inWindow = useMemo(
    () => model.features.filter((feature) => feature.maM >= filters.maStartM && feature.maM <= filters.maEndM),
    [model.features, filters.maStartM, filters.maEndM],
  );

  const visible = useMemo(
    () => filterSpoolFeatures(model.features, filters, { ...layers, previousRun: layers.previousRun && compareRuns }),
    [model.features, filters, layers, compareRuns],
  );

  const welds = useMemo(
    () => (layers.weld
      ? model.welds.filter((weld) => weld.maM >= filters.maStartM && weld.maM <= filters.maEndM)
      : []),
    [model.welds, layers.weld, filters.maStartM, filters.maEndM],
  );

  // The furniture between the two picked girth welds. A bend here is what makes
  // the 3D shell turn, so it is derived from every feature in the window rather
  // than from the filtered set — hiding a layer must not straighten the pipe.
  const fittings = useMemo(
    () => collectSpoolFittings(
      model.features,
      { startM: filters.maStartM, endM: filters.maEndM },
      fittingOverrides,
    ),
    [model.features, filters.maStartM, filters.maEndM, fittingOverrides],
  );
  const bendCount = fittings.filter((fitting) => fitting.kind === 'bend').length;

  const counts = useMemo(() => {
    const tally: Record<SpoolFeatureClass, number> = {
      weld: model.welds.filter((weld) => weld.maM >= filters.maStartM && weld.maM <= filters.maEndM).length,
      'metal-loss': 0,
      dent: 0,
      'crack-like': 0,
      other: 0,
    };
    inWindow.forEach((feature) => { tally[feature.featureClass] += 1; });
    return tally;
  }, [inWindow, model.welds, filters.maStartM, filters.maEndM]);

  const selected = visible.find((feature) => feature.key === selectedKey)
    ?? model.features.find((feature) => feature.key === selectedKey)
    ?? null;

  const wallMedian = useMemo(
    () => median(inWindow.map((feature) => feature.current.wtMm ?? feature.previous.wtMm)
      .filter((value): value is number => value !== null)),
    [inWindow],
  );

  const pick = (feature: SpoolFeature | null) => {
    if (feature && measureMode) {
      setMeasurePicks((picks) => (picks.length >= 2 ? [feature] : [...picks, feature]));
    }
    setSelectedKey(feature?.key ?? null);
  };

  const runCamera = (preset: CameraPreset) => setCommand((current) => ({ preset, nonce: current.nonce + 1 }));
  const runZoom = (zoom: number) => setCommand((current) => ({ ...current, nonce: current.nonce + 1, zoom }));

  const focusOn = (feature: SpoolFeature, halfWindowM: number) => {
    const start = Math.max(model.extentM?.startM ?? range.startM, feature.maM - halfWindowM);
    const end = Math.min(model.extentM?.endM ?? range.endM, feature.maM + halfWindowM);
    setFilters((current) => ({ ...current, maStartM: start, maEndM: end }));
    setSelectedKey(feature.key);
    runCamera('home');
  };

  const exportUnrolled = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const markup = new XMLSerializer().serializeToString(svg);
    downloadBlob(
      new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${markup}`], { type: 'image/svg+xml' }),
      `spool-unrolled-${filters.maStartM.toFixed(1)}-${filters.maEndM.toFixed(1)}m.svg`,
    );
  };

  const snapshot = () => {
    const canvas = stageRef.current?.querySelector('canvas');
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (blob) {
        downloadBlob(blob, `spool-3d-${filters.maStartM.toFixed(1)}-${filters.maEndM.toFixed(1)}m.png`);
      }
    }, 'image/png');
  };

  const measurement = useMemo(() => {
    if (measurePicks.length < 2) return null;
    const [first, second] = measurePicks;
    const axialM = Math.abs(second.maM - first.maM);
    let clockDeg = Math.abs(second.clockDeg - first.clockDeg);
    if (clockDeg > 180) clockDeg = 360 - clockDeg;
    const circM = odMm === null ? null : (clockDeg / 360) * Math.PI * (odMm / 1000);
    return {
      axialM,
      clockDeg,
      circM,
      surfaceM: circM === null ? null : Math.sqrt(axialM ** 2 + circM ** 2),
    };
  }, [measurePicks, odMm]);

  const stageStart = filters.maStartM;
  const stageEnd = Math.max(filters.maStartM + 0.01, filters.maEndM);
  // The same scale the 3D pane draws at, so the overlay quotes the factor
  // actually used rather than the unclamped constant.
  const stageScale = useMemo(
    () => sceneScale(stageEnd - stageStart, odMm, { hasBend: bendCount > 0 }),
    [stageEnd, stageStart, odMm, bendCount],
  );

  return (
    <Modal
      onClose={onClose}
      labelledBy="spool-detail-title"
      overlayClassName="fixed inset-0 z-[999999] bg-black/60 p-0"
      panelClassName="spool-view"
      closeOnBackdrop={false}
    >
      {/* Header */}
      <header className="spool-view__header">
        <div>
          <h2 id="spool-detail-title">Spool Detail View</h2>
          <p>
            Master axis {stageStart.toFixed(2)} m to {stageEnd.toFixed(2)} m · picked on {range.laneLabel}
          </p>
        </div>

        <div className="spool-view__header-controls">
          <div className="ds-segmented" role="group" aria-label="Stage view">
            <button
              type="button"
              className={`ds-segmented__option ${stage === '2D' ? 'is-active' : ''}`}
              onClick={() => setStage('2D')}
            >
              2D Unrolled
            </button>
            <button
              type="button"
              className={`ds-segmented__option ${stage === '3D' ? 'is-active' : ''}`}
              onClick={() => setStage('3D')}
            >
              3D Pipe
            </button>
          </div>

          {model.hasComparison && (
            <label className="spool-view__switch">
              <input type="checkbox" checked={compareRuns} onChange={() => setCompareRuns((on) => !on)} />
              <span>Run comparison</span>
              <em>{model.currentRun.label} vs {model.previousRun.label}</em>
            </label>
          )}

          <button type="button" className="ds-btn ds-btn--sm ds-btn--ghost ds-btn--icon" onClick={onClose} aria-label="Close spool detail view">
            <FiX />
          </button>
        </div>
      </header>

      {/* Toolbar */}
      <div className="spool-view__toolbar">
        <span className="spool-view__hint">Left drag rotate · right drag pan · scroll zoom</span>

        <div className="spool-view__tools">
          {CAMERA_BUTTONS.map(([preset, label]) => (
            <button
              key={preset}
              type="button"
              className="ds-btn ds-btn--xs ds-btn--ghost"
              onClick={() => runCamera(preset)}
              disabled={stage !== '3D'}
            >
              {preset === 'home' ? <FiHome /> : null}{label}
            </button>
          ))}
          <span className="spool-view__sep" />
          <button
            type="button"
            className={`ds-btn ds-btn--xs ${crossSection ? 'ds-btn--primary' : 'ds-btn--ghost'}`}
            onClick={() => setCrossSection((on) => !on)}
            disabled={stage !== '3D'}
            title="Cut the shell at the selected anomaly"
          >
            <FiScissors /> Cross-section
          </button>
          <button
            type="button"
            className={`ds-btn ds-btn--xs ${cutaway ? 'ds-btn--primary' : 'ds-btn--ghost'}`}
            onClick={() => setCutaway((on) => !on)}
            disabled={stage !== '3D'}
          >
            <FiLayers /> Cutaway
          </button>
          <button
            type="button"
            className={`ds-btn ds-btn--xs ${xray ? 'ds-btn--primary' : 'ds-btn--ghost'}`}
            onClick={() => setXray((on) => !on)}
            disabled={stage !== '3D'}
          >
            <FiEye /> X-ray
          </button>
          <button
            type="button"
            className={`ds-btn ds-btn--xs ${measureMode ? 'ds-btn--primary' : 'ds-btn--ghost'}`}
            onClick={() => { setMeasureMode((on) => !on); setMeasurePicks([]); }}
            title="Pick two anomalies to measure between them"
          >
            <FiCrosshair /> Measure
          </button>
          <span className="spool-view__sep" />
          <button
            type="button"
            className={`ds-btn ds-btn--xs ${maximised ? 'ds-btn--primary' : 'ds-btn--ghost'}`}
            onClick={toggleMaximise}
            title="Give the whole window to the pipe (the panels drag back out)"
          >
            {maximised ? <FiMinimize2 /> : <FiMaximize2 />} {maximised ? 'Restore panels' : 'Maximise view'}
          </button>
        </div>

        <div className="spool-view__legend">
          <span>Depth %</span>
          <i style={{ background: depthGradient(palette) }} />
          <span>0</span><span>25</span><span>50+</span>
          <select
            className="ds-select ds-select--sm"
            aria-label="Depth palette"
            value={palette}
            onChange={(event) => setPalette(event.target.value as DepthPalette)}
          >
            {(Object.keys(DEPTH_PALETTE_LABEL) as DepthPalette[]).map((key) => (
              <option key={key} value={key}>{DEPTH_PALETTE_LABEL[key]}</option>
            ))}
          </select>
        </div>
      </div>

      {fittings.length > 0 && (
        <SpoolFittingBar
          fittings={fittings}
          showFittings={showFittings}
          onToggleFittings={() => setShowFittings((on) => !on)}
          onChange={(key, override) => setFittingOverrides((current) => ({
            ...current,
            [key]: { ...current[key], ...override },
          }))}
          onReset={(key) => setFittingOverrides((current) => {
            if (!(key in current)) return current;
            const next = { ...current };
            delete next[key];
            return next;
          })}
          onFocus={(fitting) => {
            const feature = model.features.find((item) => item.key === fitting.key);
            if (feature) setSelectedKey(feature.key);
          }}
        />
      )}

      {/* Body. Every pane is drag-sized: the stage is the one that has to grow
          when a reviewer is actually reading metal, so nothing here is fixed. */}
      <div
        className="spool-view__body"
        style={{ gridTemplateColumns: `${layout.railW}px 0.375rem minmax(0, 1fr) 0.375rem ${layout.detailW}px` }}
      >
        {layout.railW > 0 && (
          <SpoolControlPanel
            layers={layers}
            onLayersChange={setLayers}
            filters={filters}
            onFiltersChange={setFilters}
            onReset={() => setFilters(defaultFilters(range.startM, range.endM))}
            counts={counts}
            extent={{ startM: model.extentM?.startM ?? range.startM, endM: model.extentM?.endM ?? range.endM }}
            visibleCount={visible.length}
            totalCount={model.features.length}
            odMm={odMm}
            onOdChange={setOdMm}
            hasComparison={model.hasComparison}
          />
        )}
        {layout.railW === 0 && <div className="spool-view__stub" />}

        <SpoolResizer
          axis="x"
          label="Resize the layers and filters panel"
          onResize={(delta) => resizePane('railW', delta)}
          onToggle={() => togglePane('railW')}
        />

        <div
          className="spool-view__centre"
          style={{ gridTemplateRows: `minmax(0, 1fr) 0.375rem ${layout.lowerH}px` }}
        >
          <div className="spool-view__stage" ref={stageRef}>
            {stage === '3D' ? (
              <>
                <SpoolScene3D
                  features={visible}
                  welds={welds}
                  startM={stageStart}
                  endM={stageEnd}
                  odMm={odMm}
                  palette={palette}
                  selectedKey={selectedKey}
                  onSelect={pick}
                  onHover={setHovered}
                  hovered={hovered}
                  fittings={fittings}
                  view={{ xray, cutaway, crossSection, markerScale, showPrevious: compareRuns && layers.previousRun, showFittings }}
                  command={command}
                  measureMode={measureMode}
                  measurePicks={measurePicks}
                />
                <div className="spool-view__stage-tools">
                  <button type="button" className="ds-btn ds-btn--xs ds-btn--ghost ds-btn--icon" onClick={() => runZoom(1)} aria-label="Zoom in"><FiZoomIn /></button>
                  <button type="button" className="ds-btn ds-btn--xs ds-btn--ghost ds-btn--icon" onClick={() => runZoom(-1)} aria-label="Zoom out"><FiZoomOut /></button>
                  <button type="button" className="ds-btn ds-btn--xs ds-btn--ghost ds-btn--icon" onClick={() => runCamera('home')} aria-label="Reset camera"><FiRotateCcw /></button>
                  <button type="button" className="ds-btn ds-btn--xs ds-btn--ghost ds-btn--icon" onClick={snapshot} aria-label="Download snapshot"><FiCamera /></button>
                </div>
                <div className="spool-view__stage-scale">
                  <label>
                    Marker scale ×{markerScale}
                    <input
                      type="range"
                      min={1}
                      max={12}
                      step={1}
                      value={markerScale}
                      onChange={(event) => setMarkerScale(Number(event.target.value))}
                      aria-label="Marker scale multiplier"
                    />
                  </label>
                  <span>
                    {markerScale === 1 ? 'True to scale' : 'Visual exaggeration — dimensions in the panels stay as reported'}
                  </span>
                  {/* Length is never exaggerated, girth always is. Say which is
                      which, so nobody reads a proportion off the picture that
                      the pipe does not have. */}
                  <span className="spool-view__stage-truth">
                    Length 1:1 · {(stageEnd - stageStart).toFixed(2)} m of pipe · girth ×
                    {Number(stageScale.girth.toFixed(1))} to read
                    {bendCount > 0 && ' (limited by the bend)'} ·{' '}
                    {odMm === null ? `${NOMINAL_OD_MM} mm OD (nominal)` : `${odMm.toFixed(1)} mm OD`}
                  </span>
                  {odMm === null && <span className="is-warn">Diameter and widths are nominal — set an outside diameter for true geometry</span>}
                </div>
              </>
            ) : (
              <div className="spool-view__stage-2d">
                <SpoolUnrolled2D
                  features={visible}
                  welds={welds}
                  startM={stageStart}
                  endM={stageEnd}
                  odMm={odMm}
                  palette={palette}
                  markerScale={markerScale}
                  showWelds={showWelds}
                  showAxialScale={showAxialScale}
                  showPrevious={compareRuns && layers.previousRun}
                  selectedKey={selectedKey}
                  onSelect={(feature) => pick(feature)}
                  onHover={setHovered}
                  svgRef={svgRef}
                />
              </div>
            )}

            {measureMode && (
              <div className="spool-view__measure">
                <strong>Measure</strong>
                {measurePicks.length < 2 ? (
                  <span>Pick {2 - measurePicks.length} more anomal{measurePicks.length === 1 ? 'y' : 'ies'}.</span>
                ) : (
                  <span>
                    Δ axial {measurement?.axialM.toFixed(3)} m · Δ clock {measurement?.clockDeg.toFixed(0)}°
                    {measurement?.circM !== null && measurement !== null
                      ? ` · circumferential ${measurement.circM!.toFixed(3)} m · surface ${measurement.surfaceM!.toFixed(3)} m`
                      : ' · set an outside diameter for the circumferential distance'}
                  </span>
                )}
                <button type="button" className="ds-btn ds-btn--xs ds-btn--ghost" onClick={() => setMeasurePicks([])}>Clear</button>
              </div>
            )}
          </div>

          <SpoolResizer
            axis="y"
            label="Resize the unrolled view and anomaly list"
            onResize={(delta) => resizePane('lowerH', -delta)}
            onToggle={() => togglePane('lowerH')}
          />

          <div className="spool-view__lower" hidden={layout.lowerH === 0}>
            {stage === '3D' && (
              <section className="spool-view__unrolled">
                <div className="spool-view__unrolled-head">
                  <h3>2D unrolled view <span>(synced)</span></h3>
                  <div>
                    <label><input type="checkbox" checked={showWelds} onChange={() => setShowWelds((on) => !on)} /> Show welds</label>
                    <label><input type="checkbox" checked={showAxialScale} onChange={() => setShowAxialScale((on) => !on)} /> Axial scale</label>
                    <button type="button" className="ds-btn ds-btn--xs ds-btn--secondary" onClick={exportUnrolled}>
                      <FiDownload /> Export 2D
                    </button>
                  </div>
                </div>
                <SpoolUnrolled2D
                  features={visible}
                  welds={welds}
                  startM={stageStart}
                  endM={stageEnd}
                  odMm={odMm}
                  palette={palette}
                  markerScale={markerScale}
                  showWelds={showWelds}
                  showAxialScale={showAxialScale}
                  showPrevious={compareRuns && layers.previousRun}
                  selectedKey={selectedKey}
                  onSelect={(feature) => pick(feature)}
                  onHover={setHovered}
                  svgRef={svgRef}
                />
              </section>
            )}

            <SpoolAnomalyList
              features={visible}
              selectedKey={selectedKey}
              onSelect={pick}
              onHover={setHovered}
              palette={palette}
            />
          </div>
        </div>

        <SpoolResizer
          axis="x"
          label="Resize the anomaly details panel"
          onResize={(delta) => resizePane('detailW', -delta)}
          onToggle={() => togglePane('detailW')}
        />

        {layout.detailW > 0 ? (
          <SpoolInspector
            feature={selected}
            currentRunLabel={model.currentRun.label}
            previousRunLabel={model.previousRun.label}
            onFocusInView={(feature) => focusOn(feature, Math.max(0.75, (stageEnd - stageStart) * 0.08))}
            onShowNeighbours={(feature) => focusOn(feature, 3)}
            onOpenInTable={(feature) => { onSelectRowIdx?.(feature.rowIndex); onClose(); }}
          />
        ) : <div className="spool-view__stub" />}
      </div>

      {/* Footer */}
      <footer className="spool-view__footer">
        <span><strong>Window</strong> {stageStart.toFixed(2)} – {stageEnd.toFixed(2)} m</span>
        <span><strong>Anomalies</strong> {visible.length.toLocaleString()} shown / {inWindow.length.toLocaleString()} in window</span>
        <span><strong>Girth welds</strong> {welds.length}</span>
        <span>
          <strong>Fittings</strong> {fittings.length === 0 ? 'none in window' : `${fittings.length}${bendCount > 0 ? ` · ${bendCount} bend${bendCount === 1 ? '' : 's'}` : ''}`}
        </span>
        <span><strong>Wall (median)</strong> {wallMedian === null ? 'not in tally' : `${wallMedian.toFixed(1)} mm`}</span>
        <span><strong>Diameter</strong> {odMm === null ? 'not set' : `${odMm.toFixed(0)} mm`}</span>
        <span><strong>Runs</strong> {model.hasComparison ? `${model.currentRun.label} vs ${model.previousRun.label}` : model.currentRun.label}</span>
        <button type="button" className="ds-btn ds-btn--xs ds-btn--ghost" onClick={() => runCamera('home')} disabled={stage !== '3D'}>
          <FiMaximize2 /> Fit view
        </button>
      </footer>
    </Modal>
  );
}
