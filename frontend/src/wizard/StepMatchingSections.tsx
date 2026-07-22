import { useEffect, useMemo, useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiMap, FiTarget } from 'react-icons/fi';
import SectionComposer, { type SectionDraft } from '../sectioning/SectionComposer';
import GwPositionCard from '../sectioning/GwPositionCard';
import SectioningSchematic from '../sectioning/SectioningSchematic';
import { bendAngleDeg } from '../sectioning/bendGeometry';
import SectionMap from '../sectioning/SectionMap';
import SectionTable from '../sectioning/SectionTable';
import { buildMatchingSpatialFeatures } from '../sectioning/matchingSpatialFeatures';
import { MAX_SCHEMATIC_ZOOM, canInspectGwPrecisely, clampSchematicZoom } from '../sectioning/viewOptions';
import { coveragePercent } from '../sectioning/sectionRanges';
import type { SectionDef, SpatialFeature } from '../sectioning/types';
import { apiFetch } from '../utils/api';
import {
  type MatchingSection,
  deleteMatchingSection,
  normalizeLockedGws,
  resolveSectionDistances,
  saveSectionRange,
  validateSectionOrder,
} from './matchingSections';
import { fetchSectioningAnchors } from './sectioningEvidence';

interface Props {
  config: any;
  onBack: () => void;
  onNext: (data: { matchingSections: MatchingSection[] }) => void;
}

const SECTION_TYPES: Array<[string, string]> = [
  ['UNCLASSIFIED', 'Unclassified'], ['BUR', 'Buried'], ['AL', 'Aerial'],
  ['RL', 'River Crossing'], ['ROC', 'Road Crossing'], ['RIS', 'Riser'],
  ['CAS', 'Cased'], ['OTH', 'Other'],
];
const EMPTY_RUN: Record<string, unknown> = {};

const lockedKey = (feature: SpatialFeature) => String(feature.rawData.lockedKey ?? '');

export default function StepMatchingSections({ config, onBack, onNext }: Props) {
  const masterRun = useMemo(
    () => config?.summaryData?.masterRun || config?.summaryData?.newRun || EMPTY_RUN,
    [config?.summaryData?.masterRun, config?.summaryData?.newRun],
  );
  const masterRunId = Number(masterRun.runId);
  const rawMasterRows = useMemo(
    () => Array.isArray(masterRun.rawFeatures) ? masterRun.rawFeatures : [],
    [masterRun.rawFeatures],
  );
  const [persistedMasterRows, setPersistedMasterRows] = useState<any[]>([]);
  const [isLoadingMasterEvidence, setIsLoadingMasterEvidence] = useState(false);
  const lockedGws = useMemo(() => normalizeLockedGws(config?.gwMatchesFinal || []), [config?.gwMatchesFinal]);

  useEffect(() => {
    if (!Number.isSafeInteger(masterRunId) || masterRunId < 1) {
      setPersistedMasterRows([]);
      return;
    }
    const controller = new AbortController();
    setIsLoadingMasterEvidence(true);
    void fetchSectioningAnchors(
      masterRunId,
      controller.signal,
      (path, signal) => apiFetch(path, { signal }),
    )
      .then((rows) => {
        if (!controller.signal.aborted) setPersistedMasterRows(rows);
      })
      .catch((error) => {
        if ((error as Error).name !== 'AbortError') console.error('Failed to load master feature evidence for sectioning:', error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingMasterEvidence(false);
      });
    return () => controller.abort();
  }, [masterRunId]);

  const features = useMemo(() => buildMatchingSpatialFeatures({
    masterRun,
    historicalRuns: Array.isArray(config?.summaryData?.historicalRuns)
      ? config.summaryData.historicalRuns
      : config?.summaryData?.oldRun ? [config.summaryData.oldRun] : [],
    masterRows: persistedMasterRows.length > 0 ? persistedMasterRows : rawMasterRows,
    lockedGws,
    gwOrphans: config?.gwOrphans,
    route: Array.isArray(config?.pipelineRoute) ? config.pipelineRoute : [],
  }), [config?.gwOrphans, config?.pipelineRoute, config?.summaryData?.historicalRuns, config?.summaryData?.oldRun, lockedGws, masterRun, persistedMasterRows, rawMasterRows]);
  const initialSections = useMemo<MatchingSection[]>(() => {
    if (Array.isArray(config?.matchingSections) && config.matchingSections.length > 0) return config.matchingSections;
    return [];
  }, [config?.matchingSections]);
  const [sections, setSections] = useState<MatchingSection[]>(initialSections);
  const [selectedGws, setSelectedGws] = useState<SpatialFeature[]>([]);
  const [inspectedGw, setInspectedGw] = useState<SpatialFeature | null>(null);
  const [viewMode, setViewMode] = useState<'schematic' | 'map'>('schematic');
  const [zoom, setZoom] = useState(1);
  const [draft, setDraft] = useState<SectionDraft>({ name: 'Section 1', sectionType: 'BUR', policy: 'MATCH' });
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const validationError = validateSectionOrder(sections, lockedGws);

  const displaySections = useMemo<SectionDef[]>(() => sections.map((section) => {
    const resolved = resolveSectionDistances(section, lockedGws);
    const startFeature = features.gws.find((gw) => lockedKey(gw) === section.startGwKey);
    const endFeature = features.gws.find((gw) => lockedKey(gw) === section.endGwKey);
    return {
      id: section.id,
      name: section.name,
      type: section.sectionType || 'UNCLASSIFIED',
      startGw: startFeature?.id || '', endGw: endFeature?.id || '',
      startM: resolved.newStartM!, endM: resolved.newEndM!,
      length: resolved.newEndM! - resolved.newStartM!, notes: '',
      latStart: startFeature?.lat, lngStart: startFeature?.lng,
      latEnd: endFeature?.lat, lngEnd: endFeature?.lng,
    };
  }), [features.gws, lockedGws, sections]);

  const coverage = useMemo(
    () => coveragePercent(displaySections, features.stats.totalLength),
    [displaySections, features.stats.totalLength],
  );

  const bendFeatures = useMemo(
    () => features.allFeatures.filter((feature) => feature.type.toLowerCase().includes('bend')).sort((left, right) => left.dist - right.dist),
    [features.allFeatures],
  );

  const handleGwClick = (gw: SpatialFeature) => {
    if (gw.runRole !== 'MASTER' || !lockedKey(gw)) return;
    setSelectedGws((current) => {
      if (current.some((selected) => lockedKey(selected) === lockedKey(gw))) return current;
      if (current.length >= 2) return [gw];
      return [...current, gw].sort((left, right) => left.dist - right.dist);
    });
  };

  const closeComposer = () => {
    setSelectedGws([]);
    setEditingSectionId(null);
    setDraft({ name: `Section ${sections.length + 1}`, sectionType: 'BUR', policy: 'MATCH' });
  };

  const applySelectedSection = () => {
    if (selectedGws.length !== 2 || !draft.name.trim()) return;
    const existing = editingSectionId ? sections.find((section) => section.id === editingSectionId) : undefined;
    const sectionId = editingSectionId ?? `section-${Date.now()}`;
    const nextSection: MatchingSection = {
      ...existing,
      id: sectionId,
      name: draft.name.trim(),
      sectionType: draft.sectionType,
      policy: draft.policy,
      startGwKey: lockedKey(selectedGws[0]),
      endGwKey: lockedKey(selectedGws[1]),
    };
    setSections((current) => saveSectionRange(current, nextSection, lockedGws));
    setSelectedGws([]);
    setEditingSectionId(null);
    setDraft({ name: `Section ${sections.length + (editingSectionId ? 1 : 2)}`, sectionType: 'BUR', policy: 'MATCH' });
  };

  const editSection = (sectionId: string) => {
    const section = sections.find((item) => item.id === sectionId);
    const start = section && features.gws.find((gw) => lockedKey(gw) === section.startGwKey);
    const end = section && features.gws.find((gw) => lockedKey(gw) === section.endGwKey);
    if (!section || !start || !end) return;
    setDraft({ name: section.name, sectionType: section.sectionType ?? 'UNCLASSIFIED', policy: section.policy });
    setSelectedGws([start, end].sort((left, right) => left.dist - right.dist));
    setEditingSectionId(section.id);
  };

  const deleteSection = (sectionId: string) => {
    setSections((current) => deleteMatchingSection(current, sectionId));
    if (editingSectionId === sectionId) closeComposer();
  };

  return (
    <div className="sectioning-light-shell">
      <div className="sectioning-light-header">
        <div>
          <p className="sectioning-light-eyebrow">NEW ADALAH MASTER SPATIAL</p>
          <h2>GW View &amp; Sectioning</h2>
          <p>Klik dua GW pada jalur. OLD hanya menjadi lane pembanding; merah berarti GW lama missing di master NEW.</p>
        </div>
        <div className="sectioning-light-actions">
          <button type="button" onClick={() => setViewMode('schematic')} className={viewMode === 'schematic' ? 'is-active' : ''}><FiTarget /> GW View</button>
          <button type="button" onClick={() => setViewMode('map')} className={viewMode === 'map' ? 'is-active' : ''}><FiMap /> Maps</button>
        </div>
      </div>

      <div className="sectioning-light-stats">
        <span>Master NEW: <strong>{config?.summaryData?.masterRun?.year || config?.summaryData?.newRun?.year || '-'}</strong></span>
        <span>Locked GW: <strong>{lockedGws.length}</strong></span>
        <span>Bend inferred: <strong className="is-warning">{features.stats.bendCount}</strong></span>
        <span>Missing di NEW: <strong className="is-danger">{features.stats.missingGwCount}</strong></span>
        <span>Coverage: <strong className={validationError ? 'is-danger' : 'is-success'}>{validationError ? 'Perlu diperbaiki' : sections.length ? `${coverage.toFixed(1)}%` : 'Optional · global'}</strong></span>
      </div>

      <div className="sectioning-light-layout">
        <div className="sectioning-light-main">
          <div className="sectioning-light-toolbar">
            <span>View mode</span>
            <button type="button" onClick={() => setViewMode('schematic')} className={viewMode === 'schematic' ? 'is-selected' : ''}><FiTarget /> Longitudinal</button>
            <span className="sectioning-light-toolbar__hint" style={{flex: 1}}>{canInspectGwPrecisely(zoom) ? 'Klik marker GW untuk memilih batas section' : 'Zoom minimal 600% untuk memilih GW dengan presisi'}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setZoom(1)} className="px-3 py-1 bg-white border border-gray-200 rounded text-xs text-gray-600 hover:bg-gray-50 font-bold">Fit</button>
              <div className="flex items-center border border-gray-200 rounded overflow-hidden bg-white ml-2">
              <button type="button" onClick={() => setZoom(clampSchematicZoom(zoom - 0.5))} className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">−</button>
                <div className="w-px h-4 bg-gray-200"></div>
                <button type="button" onClick={() => setZoom(1)} className={`px-2 py-1 text-xs ${zoom === 1 ? 'bg-gray-100 text-gray-900 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}>100%</button>
                <div className="w-px h-4 bg-gray-200"></div>
              <button type="button" onClick={() => setZoom(clampSchematicZoom(zoom + 0.5))} className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">+</button>
                <div className="w-px h-4 bg-gray-200"></div>
              <button type="button" onClick={() => setZoom(MAX_SCHEMATIC_ZOOM)} className={`px-2 py-1 text-xs ${zoom === MAX_SCHEMATIC_ZOOM ? 'bg-gray-100 text-gray-900 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}>{MAX_SCHEMATIC_ZOOM * 100}%</button>
              </div>
              <input type="range" min="0.5" max={MAX_SCHEMATIC_ZOOM} step="0.5" value={zoom} onChange={(e) => setZoom(clampSchematicZoom(Number(e.target.value)))} className="w-24 ml-2 accent-blue-600" />
            </div>
          </div>
          <div className="sectioning-light-viewer">
            {viewMode === 'schematic' ? (
              <SectioningSchematic features={features} sections={displaySections} zoom={zoom} onZoomChange={setZoom} selectedGWs={selectedGws} onGwClick={handleGwClick} onInspectGw={setInspectedGw} />
            ) : Array.isArray(config?.pipelineRoute) && config.pipelineRoute.length >= 2 ? (
              <SectionMap sections={displaySections} features={features} selectedGWs={selectedGws} onGwClick={handleGwClick} drawnRoute={config.pipelineRoute} />
            ) : (
              <div className="sectioning-light-empty"><FiMap size={30} /><strong>Koordinat rute belum diisi</strong><span>GW View tetap dapat dipakai; peta bersifat optional.</span></div>
            )}
          </div>
          {inspectedGw && <GwPositionCard feature={inspectedGw} onDismiss={() => setInspectedGw(null)} />}
          <div className="sectioning-light-bends">
            <div className="sectioning-light-subhead"><strong>Bends ({bendFeatures.length})</strong><span>Inferred physical features</span></div>
            <div className="sectioning-light-bend-grid">
              {isLoadingMasterEvidence && <span className="sectioning-light-muted">Memuat lokasi bend dari data master…</span>}
              {bendFeatures.map((bend, index) => <div key={bend.id}><span>◆</span><strong>BEND {String(index + 1).padStart(2, '0')}</strong><small>{(bend.dist / 1000).toFixed(2)} km / {bendAngleDeg(bend).toFixed(0)}°</small></div>)}
              {!isLoadingMasterEvidence && bendFeatures.length === 0 && <span className="sectioning-light-muted">Belum ada bend terdeteksi dari data master.</span>}
            </div>
          </div>
          <div className="sectioning-light-overview">
            <strong>Overview</strong>
            <span>{(features.stats.totalLength / 1000).toFixed(1)} km · {coverage.toFixed(1)}% tercakup section</span>
            <div><i style={{ width: `${Math.min(100, Math.max(1, coverage))}%` }} /></div>
          </div>
        </div>
      </div>

      {selectedGws.length > 0 && (
        <SectionComposer
          draft={draft}
          selectedGws={selectedGws}
          sectionTypes={SECTION_TYPES}
          isEditing={editingSectionId !== null}
          onDraftChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          onSave={applySelectedSection}
          onCancel={closeComposer}
        />
      )}

      <SectionTable sections={sections} lockedGws={lockedGws} sectionTypes={SECTION_TYPES} onEdit={editSection} onDelete={deleteSection} />

      {validationError && <p role="alert" className="mx-5 mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{validationError}</p>}
      <div className="sectioning-light-footer">
        <button onClick={onBack} className="flex items-center gap-2 rounded-xl px-5 py-3 font-medium text-gray-600 hover:bg-gray-50"><FiChevronLeft /> GW Matching</button>
        <button disabled={Boolean(validationError)} onClick={() => onNext({ matchingSections: sections.map((section) => resolveSectionDistances(section, lockedGws)) })} className="flex items-center gap-2 rounded-xl bg-gray-900 px-6 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">Simpan & Lanjut <FiChevronRight /></button>
      </div>
    </div>
  );
}
