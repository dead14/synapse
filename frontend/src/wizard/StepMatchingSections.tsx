import { useMemo, useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiMap, FiPlus, FiTarget } from 'react-icons/fi';
import SectioningSchematic from '../sectioning/SectioningSchematic';
import SectionMap from '../sectioning/SectionMap';
import type { HistoricalGwLane, SectionDef, SpatialFeature, SpatialFeatures } from '../sectioning/types';
import {
  type LockedGwPair,
  type MatchingSection,
  type SectionTolerances,
  normalizeLockedGws,
  resolveSectionDistances,
  validateSectionOrder,
} from './matchingSections';

interface Props {
  config: any;
  onBack: () => void;
  onNext: (data: { matchingSections: MatchingSection[] }) => void;
}

interface SectionDraft {
  name: string;
  sectionType: string;
  policy: MatchingSection['policy'];
}

const SECTION_TYPES = [
  ['UNCLASSIFIED', 'Unclassified'], ['BUR', 'Buried'], ['AL', 'Aerial'],
  ['RL', 'River Crossing'], ['ROC', 'Road Crossing'], ['RIS', 'Riser'],
  ['CAS', 'Cased'], ['OTH', 'Other'],
];

const defaultTolerances = (config: any): SectionTolerances => ({
  clock_tolerance: Number(config?.ToleranceConfig?.clock_tolerance ?? 15),
  us_gw_distance_tolerance: Number(config?.ToleranceConfig?.us_gw_distance_tolerance ?? 0.2),
  ds_gw_distance_tolerance: Number(config?.ToleranceConfig?.ds_gw_distance_tolerance ?? 0.2),
  length_tolerance: Number(config?.ToleranceConfig?.length_tolerance ?? 50),
});

const lockedKey = (feature: SpatialFeature) => String(feature.rawData.lockedKey ?? '');

function interpolateRoute(route: [number, number][], ratio: number): { lat: number; lng: number } {
  if (route.length === 0) return { lat: NaN, lng: NaN };
  if (route.length === 1) return { lat: route[0][0], lng: route[0][1] };
  const clamped = Math.max(0, Math.min(1, ratio));
  const scaled = clamped * (route.length - 1);
  const index = Math.min(Math.floor(scaled), route.length - 2);
  const local = scaled - index;
  return {
    lat: route[index][0] + (route[index + 1][0] - route[index][0]) * local,
    lng: route[index][1] + (route[index + 1][1] - route[index][1]) * local,
  };
}

function makeSpatialFeatures(config: any, lockedGws: LockedGwPair[]): SpatialFeatures {
  const masterRun = config?.summaryData?.masterRun || config?.summaryData?.newRun || {};
  const masterRows = Array.isArray(masterRun.rawFeatures) ? masterRun.rawFeatures : [];
  const route: [number, number][] = Array.isArray(config?.pipelineRoute) ? config.pipelineRoute : [];
  const maxMasterDistance = Math.max(
    0,
    ...masterRows.map((row: any) => Number(row.dist ?? row.odometer ?? row.distance ?? row.val)).filter(Number.isFinite),
    ...lockedGws.map((gw) => gw.newDistance),
  );

  const masterPairKey = (id: string, distance: number) => `${id}::${distance.toFixed(6)}`;
  const pairByMaster = new Map(lockedGws.map((gw) => [masterPairKey(gw.newId, gw.newDistance), gw]));
  const masterWelds: SpatialFeature[] = masterRows
    .filter((row: any) => /weld|girth|seam|gw/.test(String(row.type ?? row.originalType ?? '').toLowerCase()))
    .map((row: any, index: number): SpatialFeature | null => {
      const dist = Number(row.dist ?? row.odometer ?? row.distance ?? row.val);
      if (!Number.isFinite(dist)) return null;
      const id = String(row.id ?? `NEW-GW-${index + 1}`);
      const pair = pairByMaster.get(masterPairKey(id, dist));
      const coordinate = interpolateRoute(route, maxMasterDistance > 0 ? dist / maxMasterDistance : 0);
      return {
        id,
        dist,
        type: String(row.type ?? row.originalType ?? 'weld').toLowerCase(),
        runRole: 'MASTER',
        runYear: String(masterRun.year ?? ''),
        status: pair ? 'MATCHED' : 'UNRESOLVED',
        rawData: {
          ...row,
          ...(pair ? {
            lockedKey: pair.key,
            oldId: pair.oldId,
            oldDistance: pair.oldDistance,
            masterDistance: pair.newDistance,
          } : {}),
        },
        ...coordinate,
      };
    })
    .filter((feature: SpatialFeature | null): feature is SpatialFeature => feature !== null);

  // Backward compatibility for sessions whose saved master rows contain only
  // hidden anomalies and no explicit weld records.
  const lockedFeatures: SpatialFeature[] = masterWelds.length > 0 ? masterWelds : lockedGws.map((gw) => {
    const coordinate = interpolateRoute(route, maxMasterDistance > 0 ? gw.newDistance / maxMasterDistance : 0);
    return {
      id: gw.newId, dist: gw.newDistance, type: 'weld', runRole: 'MASTER',
      runYear: String(masterRun.year ?? ''), status: 'MATCHED',
      rawData: { lockedKey: gw.key, oldId: gw.oldId, oldDistance: gw.oldDistance, masterDistance: gw.newDistance },
      ...coordinate,
    };
  });

  const physicalFeatures: SpatialFeature[] = masterRows
    .map((row: any, index: number): SpatialFeature | null => {
      const dist = Number(row.dist ?? row.odometer ?? row.distance ?? row.val);
      if (!Number.isFinite(dist)) return null;
      const type = String(row.type ?? row.originalType ?? 'other').toLowerCase();
      if (/weld|girth|seam|gw/.test(type)) return null;
      const coordinate = interpolateRoute(route, maxMasterDistance > 0 ? dist / maxMasterDistance : 0);
      return {
        id: String(row.id ?? `MASTER-${index + 1}`),
        dist,
        type,
        runRole: 'MASTER',
        runYear: String(masterRun.year ?? ''),
        status: 'MASTER',
        rawData: row,
        ...coordinate,
      };
    })
    .filter((feature: SpatialFeature | null): feature is SpatialFeature => feature !== null);

  const matchedByOld = new Map(lockedGws.map((gw) => [masterPairKey(gw.oldId, gw.oldDistance), gw]));
  const historicalRuns = Array.isArray(config?.summaryData?.historicalRuns)
    ? config.summaryData.historicalRuns
    : config?.summaryData?.oldRun ? [config.summaryData.oldRun] : [];
  const historicalLanes: HistoricalGwLane[] = historicalRuns.map((run: any, runIndex: number) => {
    const rows = Array.isArray(run.rawFeatures) ? run.rawFeatures : [];
    const gws = rows
      .filter((row: any) => /weld|girth|seam|gw/.test(String(row.type ?? row.originalType ?? '').toLowerCase()))
      .map((row: any, index: number): SpatialFeature | null => {
        const oldDistance = Number(row.dist ?? row.odometer ?? row.distance ?? row.val);
        if (!Number.isFinite(oldDistance)) return null;
        const id = String(row.id ?? `OLD-${runIndex + 1}-${index + 1}`);
        const pair = runIndex === 0 ? matchedByOld.get(masterPairKey(id, oldDistance)) : undefined;
        return {
          id,
          dist: oldDistance,
          type: 'weld',
          runRole: 'HISTORICAL',
          runYear: String(run.year ?? ''),
          status: runIndex === 0 ? (pair ? 'MATCHED' : 'MISSING_IN_MASTER') : 'UNRESOLVED',
          rawData: {
            ...row,
            sourceDistance: oldDistance,
            masterDistance: pair?.newDistance,
            matchedMasterId: pair?.newId,
          },
          lat: NaN,
          lng: NaN,
        };
      })
      .filter((feature: SpatialFeature | null): feature is SpatialFeature => feature !== null)
      .sort((left: SpatialFeature, right: SpatialFeature) => left.dist - right.dist);
    return { id: `historical-${runIndex}`, label: run.name || `Historical ${runIndex + 1}`, year: String(run.year ?? ''), gws };
  });

  return {
    gws: lockedFeatures,
    allFeatures: [...physicalFeatures, ...lockedFeatures].sort((left, right) => left.dist - right.dist),
    historicalLanes,
    stats: {
      totalLength: maxMasterDistance,
      gwCount: lockedFeatures.length,
      bendCount: physicalFeatures.filter((feature) => feature.type.includes('bend')).length,
      missingGwCount: historicalLanes.reduce((count, lane) => count + lane.gws.filter((gw) => gw.status === 'MISSING_IN_MASTER').length, 0),
    },
  };
}

function overlaySection(
  current: MatchingSection[],
  startKey: string,
  endKey: string,
  draft: SectionDraft,
  lockedGws: LockedGwPair[],
): MatchingSection[] {
  const indexByKey = new Map(lockedGws.map((gw, index) => [gw.key, index]));
  const first = indexByKey.get(startKey)!;
  const second = indexByKey.get(endKey)!;
  const start = Math.min(first, second);
  const end = Math.max(first, second);
  const next: MatchingSection[] = [];

  for (const section of current) {
    const sectionStart = indexByKey.get(section.startGwKey)!;
    const sectionEnd = indexByKey.get(section.endGwKey)!;
    if (sectionEnd <= start || sectionStart >= end) {
      next.push(section);
      continue;
    }
    if (sectionStart < start) {
      next.push({ ...section, id: `${section.id}-left-${Date.now()}`, endGwKey: lockedGws[start].key });
    }
    if (sectionEnd > end) {
      next.push({ ...section, id: `${section.id}-right-${Date.now()}`, startGwKey: lockedGws[end].key });
    }
  }

  next.push({
    id: `section-${Date.now()}`,
    name: draft.name,
    sectionType: draft.sectionType,
    policy: draft.policy,
    startGwKey: lockedGws[start].key,
    endGwKey: lockedGws[end].key,
  });
  return next.sort((left, right) => indexByKey.get(left.startGwKey)! - indexByKey.get(right.startGwKey)!);
}

export default function StepMatchingSections({ config, onBack, onNext }: Props) {
  const lockedGws = useMemo(() => normalizeLockedGws(config?.gwMatchesFinal || []), [config?.gwMatchesFinal]);
  const features = useMemo(() => makeSpatialFeatures(config, lockedGws), [config, lockedGws]);
  const initialSections = useMemo<MatchingSection[]>(() => {
    if (Array.isArray(config?.matchingSections) && config.matchingSections.length > 0) return config.matchingSections;
    return [];
  }, [config?.matchingSections]);
  const [sections, setSections] = useState<MatchingSection[]>(initialSections);
  const [selectedGws, setSelectedGws] = useState<SpatialFeature[]>([]);
  const [viewMode, setViewMode] = useState<'schematic' | 'map'>('schematic');
  const [zoom, setZoom] = useState(1);
  const [draft, setDraft] = useState<SectionDraft>({ name: 'Section 1', sectionType: 'BUR', policy: 'MATCH' });
  const [isSelecting, setIsSelecting] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(initialSections[0]?.id ?? null);
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

  const bendFeatures = useMemo(
    () => features.allFeatures.filter((feature) => feature.type.toLowerCase().includes('bend')).sort((left, right) => left.dist - right.dist),
    [features.allFeatures],
  );
  const activeSection = displaySections.find((section) => section.id === activeSectionId) ?? displaySections[0] ?? null;

  const handleGwClick = (gw: SpatialFeature) => {
    if (!isSelecting) setIsSelecting(true);
    setSelectedGws((current) => {
      if (current.some((selected) => lockedKey(selected) === lockedKey(gw))) return current;
      if (current.length >= 2) return [gw];
      return [...current, gw].sort((left, right) => left.dist - right.dist);
    });
  };

  const applySelectedSection = () => {
    if (selectedGws.length !== 2 || !draft.name.trim()) return;
    setSections((current) => overlaySection(current, lockedKey(selectedGws[0]), lockedKey(selectedGws[1]), { ...draft, name: draft.name.trim() }, lockedGws));
    setActiveSectionId(`section-${Date.now()}`);
    setSelectedGws([]);
    setIsSelecting(false);
    setDraft((current) => ({ ...current, name: `Section ${sections.length + 1}` }));
  };

  const updateSection = (id: string, patch: Partial<MatchingSection>) => {
    setSections((current) => current.map((section) => section.id === id ? { ...section, ...patch } : section));
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
          <button type="button" disabled={lockedGws.length < 2} onClick={() => { setIsSelecting(true); setSelectedGws([]); }} className="is-primary"><FiPlus /> Tandai Section</button>
        </div>
      </div>

      <div className="sectioning-light-stats">
        <span>Master NEW: <strong>{config?.summaryData?.masterRun?.year || config?.summaryData?.newRun?.year || '-'}</strong></span>
        <span>Locked GW: <strong>{lockedGws.length}</strong></span>
        <span>Bend inferred: <strong className="is-warning">{features.stats.bendCount}</strong></span>
        <span>Missing di NEW: <strong className="is-danger">{features.stats.missingGwCount}</strong></span>
        <span>Coverage: <strong className={validationError ? 'is-danger' : 'is-success'}>{validationError ? 'Perlu diperbaiki' : sections.length ? '100%' : 'Optional · global'}</strong></span>
      </div>

      <div className="sectioning-light-layout">
        <div className="sectioning-light-main">
          <div className="sectioning-light-toolbar">
            <span>View mode</span>
            <button type="button" onClick={() => setViewMode('schematic')} className={viewMode === 'schematic' ? 'is-selected' : ''}><FiTarget /> Longitudinal</button>
            <span className="sectioning-light-toolbar__hint" style={{flex: 1}}>Klik marker GW untuk memilih batas section</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setZoom(1)} className="px-3 py-1 bg-white border border-gray-200 rounded text-xs text-gray-600 hover:bg-gray-50 font-bold">Fit</button>
              <div className="flex items-center border border-gray-200 rounded overflow-hidden bg-white ml-2">
                <button type="button" onClick={() => setZoom(Math.max(0.5, zoom - 0.5))} className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">−</button>
                <div className="w-px h-4 bg-gray-200"></div>
                <button type="button" onClick={() => setZoom(1)} className={`px-2 py-1 text-xs ${zoom === 1 ? 'bg-gray-100 text-gray-900 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}>100%</button>
                <div className="w-px h-4 bg-gray-200"></div>
                <button type="button" onClick={() => setZoom(Math.min(1000, zoom + 0.5))} className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">+</button>
                <div className="w-px h-4 bg-gray-200"></div>
                <button type="button" onClick={() => setZoom(1000)} className={`px-2 py-1 text-xs ${zoom === 1000 ? 'bg-gray-100 text-gray-900 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}>100000%</button>
              </div>
              <input type="range" min="0.5" max="1000" step="0.5" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-24 ml-2 accent-blue-600" />
            </div>
          </div>
          <div className="sectioning-light-viewer">
            {viewMode === 'schematic' ? (
              <SectioningSchematic features={features} sections={displaySections} zoom={zoom} onZoomChange={setZoom} selectionEnabled={isSelecting} selectedGWs={selectedGws} onGwClick={handleGwClick} />
            ) : Array.isArray(config?.pipelineRoute) && config.pipelineRoute.length >= 2 ? (
              <SectionMap sections={displaySections} features={features} selectedGWs={selectedGws} onGwClick={handleGwClick} drawnRoute={config.pipelineRoute} />
            ) : (
              <div className="sectioning-light-empty"><FiMap size={30} /><strong>Koordinat rute belum diisi</strong><span>GW View tetap dapat dipakai; peta bersifat optional.</span></div>
            )}
          </div>
          <div className="sectioning-light-bends">
            <div className="sectioning-light-subhead"><strong>Bends ({bendFeatures.length})</strong><span>Inferred physical features</span></div>
            <div className="sectioning-light-bend-grid">
              {bendFeatures.map((bend, index) => <div key={bend.id}><span>◆</span><strong>BEND {String(index + 1).padStart(2, '0')}</strong><small>{(bend.dist / 1000).toFixed(2)} km / 90°</small></div>)}
              {bendFeatures.length === 0 && <span className="sectioning-light-muted">Belum ada bend terdeteksi dari data master.</span>}
            </div>
          </div>
          <div className="sectioning-light-overview"><strong>Overview</strong><span>{(features.stats.totalLength / 1000).toFixed(1)}+ km interactive alignment map</span><div><i style={{ width: `${Math.min(100, Math.max(4, (sections.length ? 65 : 32)))}%` }} /></div></div>
        </div>
        <aside className="sectioning-light-sidebar">
          <button type="button" className="sectioning-light-sidebar__primary" onClick={() => { setIsSelecting(true); setSelectedGws([]); }} disabled={lockedGws.length < 2}><FiPlus /> Mark section</button>
          <div className="sectioning-light-sidebar__heading"><strong>Selected section</strong><span>ⓘ</span></div>
          {activeSection ? <dl>
            <div><dt>Start KP</dt><dd>{(activeSection.startM / 1000).toFixed(2)} km</dd></div>
            <div><dt>End KP</dt><dd>{(activeSection.endM / 1000).toFixed(2)} km</dd></div>
            <div><dt>Length</dt><dd>{(activeSection.length / 1000).toFixed(2)} km</dd></div>
            <div><dt>Section type</dt><dd>{activeSection.type}</dd></div>
          </dl> : <p className="sectioning-light-muted">Belum ada section. Pilih dua GW untuk mulai.</p>}
          <div className="sectioning-light-sidebar__divider" />
          <strong className="sectioning-light-sidebar__label">Actions</strong>
          <button type="button" className="sectioning-light-sidebar__action" onClick={() => setIsSelecting(true)} disabled={!activeSection}>Review in queue <FiChevronRight /></button>
          <button type="button" className="sectioning-light-sidebar__action" onClick={() => setIsSelecting(true)}>Add review note <FiChevronRight /></button>
          <button type="button" className="sectioning-light-sidebar__danger" disabled={!activeSection}>Mark as missing</button>
        </aside>
      </div>

      {(isSelecting || selectedGws.length > 0) && (
        <div className="border-b border-blue-100 bg-blue-50/70 p-4">
          <div className="grid items-end gap-3 lg:grid-cols-[1fr_180px_150px_1fr_auto]">
            <label className="text-xs font-semibold text-gray-600">Nama section
              <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-semibold text-gray-600">Jenis fisik
              <select value={draft.sectionType} onChange={(event) => setDraft((current) => ({ ...current, sectionType: event.target.value }))} className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm">
                {SECTION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-gray-600">Policy
              <select value={draft.policy} onChange={(event) => setDraft((current) => ({ ...current, policy: event.target.value as MatchingSection['policy'] }))} className="mt-1 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm">
                <option value="MATCH">Match</option><option value="REVIEW">Review</option><option value="BYPASS">Exclude</option>
              </select>
            </label>
            <div className="rounded-lg bg-white px-3 py-2 text-xs text-gray-600">
              {selectedGws.length === 0 && 'Klik GW awal pada viewer.'}
              {selectedGws.length === 1 && <>Awal: <strong>{selectedGws[0].id} · {selectedGws[0].dist.toFixed(3)} m</strong>. Klik GW akhir.</>}
              {selectedGws.length === 2 && <><strong>{selectedGws[0].id}</strong> → <strong>{selectedGws[1].id}</strong> ({(selectedGws[1].dist - selectedGws[0].dist).toFixed(3)} m)</>}
            </div>
            <button disabled={selectedGws.length !== 2 || !draft.name.trim()} onClick={applySelectedSection} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40">Terapkan</button>
          </div>
        </div>
      )}

      <div className="sectioning-light-register">
        {sections.map((section) => {
          const resolved = resolveSectionDistances(section, lockedGws);
          return (
            <section key={section.id} onClick={() => setActiveSectionId(section.id)} className={`sectioning-light-register__item ${activeSection?.id === section.id ? 'is-active' : ''}`}>
              <div className="grid items-end gap-3 lg:grid-cols-[1fr_180px_140px_220px]">
                <label className="text-xs font-semibold text-gray-600">Nama
                  <input value={section.name} onChange={(event) => updateSection(section.id, { name: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" />
                </label>
                <label className="text-xs font-semibold text-gray-600">Jenis fisik
                  <select value={section.sectionType || 'UNCLASSIFIED'} onChange={(event) => updateSection(section.id, { sectionType: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                    {SECTION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-gray-600">Policy
                  <select value={section.policy} onChange={(event) => updateSection(section.id, { policy: event.target.value as MatchingSection['policy'] })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                    <option value="MATCH">Match</option><option value="REVIEW">Review</option><option value="BYPASS">Exclude</option>
                  </select>
                </label>
                <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 text-xs text-gray-600">
                  {resolved.newStartM?.toFixed(3)} → {resolved.newEndM?.toFixed(3)} m
                  <span className="ml-2 font-semibold">({((resolved.newEndM || 0) - (resolved.newStartM || 0)).toFixed(3)} m)</span>
                </div>
              </div>
              <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-gray-600">
                <input type="checkbox" checked={Boolean(section.tolerances)} onChange={(event) => updateSection(section.id, { tolerances: event.target.checked ? defaultTolerances(config) : undefined })} /> Tolerance khusus section
              </label>
              {section.tolerances && (
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
                  {Object.entries(section.tolerances).filter(([key]) => key !== 'depth_tolerance').map(([key, value]) => (
                    <label key={key} className="text-[11px] font-medium text-gray-500">{key.replaceAll('_', ' ')}
                      <input type="number" min="0" step="0.05" value={value} onChange={(event) => updateSection(section.id, { tolerances: { ...section.tolerances!, [key]: Number(event.target.value) } })} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm" />
                    </label>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {validationError && <p role="alert" className="mx-5 mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{validationError}</p>}
      <div className="sectioning-light-footer">
        <button onClick={onBack} className="flex items-center gap-2 rounded-xl px-5 py-3 font-medium text-gray-600 hover:bg-gray-50"><FiChevronLeft /> GW Matching</button>
        <button disabled={Boolean(validationError)} onClick={() => onNext({ matchingSections: sections.map((section) => resolveSectionDistances(section, lockedGws)) })} className="flex items-center gap-2 rounded-xl bg-gray-900 px-6 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">Simpan & Lanjut <FiChevronRight /></button>
      </div>
    </div>
  );
}
