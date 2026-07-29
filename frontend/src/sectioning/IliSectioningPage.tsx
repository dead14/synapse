import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import SectionModal from './SectionModal';
import ConfirmDialog from '../components/common/ConfirmDialog';
import SectioningSchematic from './SectioningSchematic';
import SectionList from './SectionList';
import SectionMap from './SectionMap';
import { apiFetch } from '../utils/api';
import { fetchAlignmentComparison } from '../utils/alignment';
import { buildHistoricalLanes, parseWallThicknessMm } from './historicalLanes';
import { formatCoordinate, interpolateAlongRoute, parseCoordinate, routeLengthMeters } from './geo';
import { pairKey } from './pairing';
import { sectionColor } from './sectionColors';
import { countMissingInRange, coveragePercent, validateSectionRange } from './sectionRanges';
import { MAX_SCHEMATIC_ZOOM, clampSchematicZoom } from './viewOptions';
import type { SectionDef, SpatialFeature, SpatialFeatures } from './types';

type SaveState = { status: 'idle' | 'saving' | 'saved' | 'error'; message?: string };

export default function IliSectioningPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any[]>([]);
  const [comparisonRows, setComparisonRows] = useState<any[]>([]);
  const [sessionConfig, setSessionConfig] = useState<any>(null);
  const [sections, setSections] = useState<SectionDef[]>([]);
  const [sessionId, setSessionId] = useState('');
  
  // Interaction states
  const [viewMode, setViewMode] = useState<'schematic' | 'map'>('schematic');
  const [zoom, setZoom] = useState(1);
  const [selectedGWs, setSelectedGWs] = useState<any[]>([]); // stores up to 2 GW objects
  const [inspectedGw, setInspectedGw] = useState<any | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [pickingMode, setPickingMode] = useState<'start' | 'end' | 'route' | null>(null);
  const [routeForm, setRouteForm] = useState({ startLat: '', startLng: '', endLat: '', endLng: '' });
  
  const [drawnRoute, setDrawnRoute] = useState<[number, number][]>(() => {
    try {
      const saved = localStorage.getItem('synapse_drawn_route');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Free-hand route drawing fires one update per click; without this the page
  // would POST the whole route on every single point.
  const routeSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (routeSaveTimer.current) clearTimeout(routeSaveTimer.current); }, []);

  const updateDrawnRoute = (newRoute: [number, number][]) => {
    setDrawnRoute(newRoute);
    localStorage.setItem('synapse_drawn_route', JSON.stringify(newRoute));
    if (!sessionId) return;
    if (routeSaveTimer.current) clearTimeout(routeSaveTimer.current);
    routeSaveTimer.current = setTimeout(() => { void saveSpatialState(sections, newRoute); }, 800);
  };

  const mapDistanceMeters = useMemo(() => routeLengthMeters(drawnRoute), [drawnRoute]);

  // Sync routeForm with drawnRoute if it's exactly 2 points
  useEffect(() => {
    if (drawnRoute.length === 2) {
      setRouteForm({
        startLat: drawnRoute[0][0].toFixed(6),
        startLng: drawnRoute[0][1].toFixed(6),
        endLat: drawnRoute[1][0].toFixed(6),
        endLng: drawnRoute[1][1].toFixed(6),
      });
    } else if (drawnRoute.length === 0) {
      setRouteForm({ startLat: '', startLng: '', endLat: '', endLng: '' });
    }
  }, [drawnRoute]);

  useEffect(() => {
    const controller = new AbortController();
    const fetchData = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const resolvedSessionId = urlParams.get('sessionId') || localStorage.getItem('synapse_last_session_id') || '';
        if (!resolvedSessionId) throw new Error('Session ID not found.');
        setSessionId(resolvedSessionId);
        const sessData = await apiFetch<{ config?: any }>(`/api/wizard/session/${encodeURIComponent(resolvedSessionId)}`, { signal: controller.signal });
        const config = sessData.config || {};
        setSessionConfig(config);
        if (Array.isArray(config.sections)) setSections(config.sections);
        if (Array.isArray(config.pipelineRoute)) {
          setDrawnRoute(config.pipelineRoute);
          localStorage.setItem('synapse_drawn_route', JSON.stringify(config.pipelineRoute));
        }

        // NEW/latest is the spatial master.  Read it straight from the saved
        // upload so opening sectioning never triggers a second Hungarian run.
        const masterRun = config.summaryData?.masterRun || config.summaryData?.newRun;
        const masterFeatures = masterRun?.rawFeatures;
        const historicalRuns = Array.isArray(config.summaryData?.historicalRuns)
          ? config.summaryData.historicalRuns
          : config.summaryData?.oldRun ? [config.summaryData.oldRun] : [];
        const needsComparisonRows = !Array.isArray(masterFeatures)
          || masterFeatures.length === 0
          || historicalRuns.some((run: any) => !Array.isArray(run?.rawFeatures) || run.rawFeatures.length === 0);
        const comparison = needsComparisonRows
          ? await fetchAlignmentComparison(resolvedSessionId, undefined, controller.signal)
          : [];
        setComparisonRows(comparison);
        if (Array.isArray(masterFeatures) && masterFeatures.length > 0) {
          setData(masterFeatures);
        } else {
          // Backward-compatible fallback for sessions created before masterRun
          // was introduced.  Prefer NEW columns when the result is flattened.
          setData(comparison);
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') console.error('Failed to fetch ILI data:', error);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void fetchData();
    return () => controller.abort();
  }, []);

  const saveSpatialState = async (newSections: SectionDef[], pipelineRoute = drawnRoute) => {
    if (!sessionId) return;
    setSaveState({ status: 'saving' });
    try {
      await apiFetch('/api/wizard/save-sections', {
        method: 'POST',
        body: JSON.stringify({ sessionId, sections: newSections, pipelineRoute })
      });
      setSaveState({ status: 'saved' });
    } catch (e) {
      console.error("Failed to save sections", e);
      setSaveState({ status: 'error', message: (e as Error).message || 'Failed to save to the server.' });
    }
  };

  // Keeps unparseable text on screen so the operator can correct it instead of
  // silently turning "0 52.348 S" into a wrong number.
  const normalizeCoordinateField = (value: string) => {
    const parsed = parseCoordinate(value);
    return parsed === null ? value : formatCoordinate(parsed);
  };

  const handleCancelSelection = () => {
    setSelectedGWs([]);
    setSectionError(null);
  };

  const handleInspectGw = (gw: any) => {
    setInspectedGw(gw);
  };

  useEffect(() => {
    if (selectedGWs.length === 2) {
      setShowModal(true);
    }
  }, [selectedGWs]);

  const handleClearAll = () => {
    setShowClearAllConfirm(true);
  };

  const handleExport = () => {
    const protectSpreadsheetValue = (value: unknown) => {
      const text = String(value ?? '');
      return /^[=+\-@]/.test(text) ? `'${text}` : text;
    };
    const quote = (value: unknown) => `"${protectSpreadsheetValue(value).replaceAll('"', '""')}"`;
    const header = "SECTION NAME,TYPE,PHYSICAL TYPE,POLICY,START GW,END GW,START (M),END (M),LENGTH (M),NOTES\n";
    const rows = sections.map(s => [
      quote(s.name), quote(s.type), quote(s.physicalType ?? ''), quote(s.policy ?? ''),
      quote(s.startGw), quote(s.endGw), s.startM, s.endM, s.length, quote(s.notes),
    ].join(',')).join("\n");
    // BOM keeps Excel from mangling non-ASCII section names.
    const blob = new Blob(['﻿' + header + rows], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sections_export.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleGwClick = (gw: any) => {
    setInspectedGw(gw);
    setSelectedGWs((current) => {
      if (current.length === 0) {
        return [gw];
      }
      if (current.length === 1) {
        if (current[0].id === gw.id) return current;
        return [current[0], gw].sort((a, b) => a.dist - b.dist);
      }
      if (current.some((item) => item.id === gw.id)) return current;
      return [gw];
    });
  };

  const handleSaveSection = (section: Partial<SectionDef>) => {
    const [start, end] = [selectedGWs[0], selectedGWs[1]].sort((a, b) => a.dist - b.dist);
    const newSection: SectionDef = {
      id: `sec-${Date.now()}`,
      name: section.name || 'Unnamed',
      type: section.type || 'OTH',
      physicalType: section.physicalType,
      policy: section.policy,
      startGw: start.id,
      endGw: end.id,
      startM: start.dist,
      endM: end.dist,
      length: Math.abs(end.dist - start.dist),
      notes: section.notes || '',
      latStart: section.latStart,
      lngStart: section.lngStart,
      latEnd: section.latEnd,
      lngEnd: section.lngEnd
    };

    const problem = validateSectionRange(sections, newSection);
    if (problem) {
      setSectionError(problem);
      return;
    }

    const updated = [...sections, newSection].sort((a, b) => a.startM - b.startM);
    setSections(updated);
    setSectionError(null);
    saveSpatialState(updated);

    setShowModal(false);
    setSelectedGWs([]);
  };

  const handleDeleteSection = (id: string) => {
    const updated = sections.filter(s => s.id !== id);
    setSections(updated);
    saveSpatialState(updated);
  };

  // Extract features for the schematic
  const features = useMemo<SpatialFeatures>(() => {
    if (!data.length) return { gws: [], allFeatures: [], historicalLanes: [], stats: { totalLength: 0, gwCount: 0, bendCount: 0, missingGwCount: 0 } };
    
    const gws: any[] = [];
    const allFeatures: any[] = [];
    let maxDist = 0;
    let bendCount = 0;
    const matches = Array.isArray(sessionConfig?.gwMatchesFinal) ? sessionConfig.gwMatchesFinal : [];
    const masterId = (match: any) => String(match.new_id ?? match.newId ?? '');
    const masterDist = (match: any) => Number(match.new_odometer ?? match.newVal ?? match.newDist);
    const matchByMaster = new Map(matches.map((match: any) => [pairKey(masterId(match), masterDist(match)), match]));
    // The engine payload and the persisted rows round odometers differently, so
    // an exact key miss falls back to the id when it is unambiguous.  Without
    // this every GW renders as unresolved after a sub-millimetre drift.
    const matchesById = matches.reduce((index: Map<string, any[]>, match: any) => {
      const list = index.get(masterId(match)) ?? [];
      list.push(match);
      index.set(masterId(match), list);
      return index;
    }, new Map<string, any[]>());
    const findMatch = (id: string, distance: number) => {
      const exact = matchByMaster.get(pairKey(id, distance));
      if (exact) return exact;
      const candidates = matchesById.get(id) ?? [];
      return candidates.length === 1 ? candidates[0] : undefined;
    };


    // First pass to find maxDist
    data.forEach(row => {
      const dist = Number(
        row.dist ?? 
        row.abs_distance_m ?? 
        row.log_distance_m ??
        row.raw?.log_distance_m ?? 
        row['Log Dist NEW (m)'] ??
        row['Log Distance'] ??
        row['Odometer']
      );
      if (!isNaN(dist) && dist > maxDist) maxDist = dist;
    });

    data.forEach(row => {
      // The latest/NEW run is always the spatial master.
      const dist = Number(
        row.dist ?? 
        row.abs_distance_m ?? 
        row.log_distance_m ??
        row.raw?.log_distance_m ?? 
        row['Log Dist NEW (m)'] ??
        row['Log Distance'] ??
        row['Odometer']
      );
      if (isNaN(dist)) return;
      
      const type = String(
        row.type ?? 
        row.originalType ?? 
        row.feature_type ??
        row.feature_identification ??
        row['Feature Type NEW'] ?? 
        row['Feature Type'] ??
        row['Feature Identification'] ??
        ''
      ).toLowerCase();
      const identif = String(row.id ?? row['Identif. NEW'] ?? `NEW-${allFeatures.length + 1}`);
      const matched = findMatch(identif, dist) as any;
      
      // Try to get actual coordinates, or fake them based on dist for demo
      let lat = parseFloat(row.latitude ?? row.Latitude ?? row['Latitude NEW'] ?? row['Lat NEW']);
      let lng = parseFloat(row.longitude ?? row.Longitude ?? row['Longitude NEW'] ?? row['Long NEW']);
      
      if (isNaN(lat) || isNaN(lng)) {
         if (drawnRoute.length >= 2 && maxDist > 0) {
            // Interpolate from user-drawn route
            const pt = interpolateAlongRoute(drawnRoute, dist / maxDist);
            lat = pt.lat;
            lng = pt.lng;
         } else {
            // No custom route, and no GPS. Leave as NaN.
            lat = NaN;
            lng = NaN;
         }
      }
      
      const feature: SpatialFeature = {
        id: identif,
        dist,
        type,
        runRole: 'MASTER',
        runYear: String(sessionConfig?.summaryData?.masterRun?.year ?? sessionConfig?.summaryData?.newRun?.year ?? ''),
        status: matched ? 'MATCHED' : 'UNRESOLVED',
        wallThicknessMm: parseWallThicknessMm(row),
        rawData: {
          ...row,
          ...(matched ? {
            oldId: matched.old_id ?? matched.oldId,
            oldDistance: matched.old_odometer ?? matched.oldVal ?? matched.oldDist,
            masterDistance: dist,
          } : {}),
        },
        lat,
        lng,
      };
      allFeatures.push(feature);
      
      if (type.includes('weld')) {
        gws.push(feature);
      }
      if (type.includes('bend') || type.includes('elbow') || type.includes('jog')) {
        bendCount++;
      }
    });

    const historicalRuns = Array.isArray(sessionConfig?.summaryData?.historicalRuns)
      ? sessionConfig.summaryData.historicalRuns
      : sessionConfig?.summaryData?.oldRun ? [sessionConfig.summaryData.oldRun] : [];
    const historicalLanes = buildHistoricalLanes(historicalRuns, matches, comparisonRows);
    const missingGwCount = historicalLanes.reduce(
      (count, lane) => count + lane.gws.filter((gw) => gw.status === 'MISSING_IN_MASTER').length,
      0,
    );

    return { 
      gws: gws.sort((a,b) => a.dist - b.dist), 
      allFeatures: allFeatures.sort((a,b) => a.dist - b.dist),
      historicalLanes,
      stats: { totalLength: maxDist, gwCount: gws.length, bendCount, missingGwCount }
    };
  }, [comparisonRows, data, drawnRoute, sessionConfig]);

  const coverage = useMemo(
    () => coveragePercent(sections, features.stats.totalLength),
    [features.stats.totalLength, sections],
  );
  const selectedMissingCount = useMemo(() => {
    if (selectedGWs.length !== 2) return null;
    const historicalGws = features.historicalLanes.flatMap((lane) => lane.gws);
    return countMissingInRange(historicalGws, selectedGWs[0].dist, selectedGWs[1].dist);
  }, [features.historicalLanes, selectedGWs]);

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-blue-600 font-medium">Loading sectioning workspace...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans flex flex-col">
      {/* Top Header / Breadcrumbs */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2 text-sm text-gray-500 font-medium">
          <div className="w-8 h-8 rounded bg-blue-600 text-white flex items-center justify-center font-bold mr-4">S</div>
          <span className="hover:text-gray-700 cursor-pointer">workspace</span>
          <span>/</span>
          <span className="text-gray-900 font-bold">Alignment</span>
          <span className="w-2 h-2 rounded-full bg-green-500 mx-1"></span>
          <span className="text-green-600 text-xs uppercase tracking-wider">operational</span>
        </div>
        <div className="flex items-center gap-4" aria-live="polite">
          {saveState.status === 'saving' && <span className="text-xs font-semibold text-gray-500">Saving…</span>}
          {saveState.status === 'saved' && <span className="text-xs font-semibold text-green-600">Saved</span>}
          {saveState.status === 'error' && (
            <span className="text-xs font-semibold text-red-600" role="alert">Save failed: {saveState.message}</span>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-6 flex flex-col gap-6 max-w-[1920px] mx-auto w-full">
        
        {/* Title & Progress Stepper */}
        <div className="flex flex-col gap-6">
          <div className="flex justify-between items-end">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Sectioning</h1>
              <p className="text-sm text-gray-500 mt-1">Define reference. Verify the engineering evidence before continuing.</p>
            </div>
            <div className="text-right flex items-center gap-4">
              <span className="text-sm font-semibold text-gray-500">Stage 4 / 7</span>
              <span className="text-3xl font-bold text-gray-900">50%</span>
            </div>
          </div>
          
          {/* Stepper */}
          <div className="flex items-center w-full max-w-5xl">
            {/* Step 1 */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-green-500 text-green-500 flex items-center justify-center"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></div>
              <div className="text-xs font-semibold text-gray-800 whitespace-nowrap">Inspection data<br/><span className="text-gray-400 font-normal">Import & validate</span></div>
            </div>
            <div className="flex-1 h-px bg-gray-200 mx-4"></div>
            {/* Step 2 */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-green-500 text-green-500 flex items-center justify-center"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></div>
              <div className="text-xs font-semibold text-gray-800 whitespace-nowrap">Data review<br/><span className="text-gray-400 font-normal">Check extraction</span></div>
            </div>
            <div className="flex-1 h-px bg-gray-200 mx-4"></div>
            {/* Step 3 */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full border-2 border-green-500 text-green-500 flex items-center justify-center"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></div>
              <div className="text-xs font-semibold text-gray-800 whitespace-nowrap">GW matching<br/><span className="text-gray-400 font-normal">Review alignment</span></div>
            </div>
            <div className="flex-1 h-px bg-blue-500 mx-4"></div>
            {/* Step 4 (Current) */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">4</div>
              <div className="text-xs font-bold text-blue-700 whitespace-nowrap">Sectioning<br/><span className="text-blue-500 font-normal">Define reference</span></div>
            </div>
            <div className="flex-1 h-px bg-gray-200 mx-4"></div>
            {/* Step 5 */}
            <div className="flex items-center gap-3 opacity-50">
              <div className="w-8 h-8 rounded-full border-2 border-gray-300 text-gray-400 flex items-center justify-center font-bold">5</div>
              <div className="text-xs font-semibold text-gray-500 whitespace-nowrap">Feature rules<br/><span className="text-gray-400 font-normal">Set thresholds</span></div>
            </div>
            <div className="flex-1 h-px bg-gray-200 mx-4"></div>
            {/* Step 6 */}
            <div className="flex items-center gap-3 opacity-50">
              <div className="w-8 h-8 rounded-full border-2 border-gray-300 text-gray-400 flex items-center justify-center font-bold">6</div>
              <div className="text-xs font-semibold text-gray-500 whitespace-nowrap">Tolerances<br/><span className="text-gray-400 font-normal">Tune matcher</span></div>
            </div>
            <div className="flex-1 h-px bg-gray-200 mx-4"></div>
            {/* Step 7 */}
            <div className="flex items-center gap-3 opacity-50">
              <div className="w-8 h-8 rounded-full border-2 border-gray-300 text-gray-400 flex items-center justify-center font-bold">7</div>
              <div className="text-xs font-semibold text-gray-500 whitespace-nowrap">Execution<br/><span className="text-gray-400 font-normal">Run & report</span></div>
            </div>
          </div>
        </div>

        {/* Workspace Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex flex-col overflow-hidden flex-1 min-h-[600px]">
          {/* Card Header */}
          <div className="p-6 border-b border-gray-100 flex flex-col gap-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-[10px] font-bold text-blue-600 tracking-widest uppercase mb-1">NEW IS THE SPATIAL MASTER</div>
                <h2 className="text-xl font-bold text-gray-900">GW View & Sectioning</h2>
                <p className="text-sm text-gray-500">Click two GWs on the line. OLD is only a comparison lane; red means a legacy GW is missing from the NEW master.</p>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setViewMode('schematic')} className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 ${viewMode === 'schematic' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'} border transition-colors`}>GW View</button>
                <button type="button" onClick={() => setViewMode('map')} className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 ${viewMode === 'map' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'} border transition-colors`}><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg> Maps</button>
              </div>
            </div>
            
            {/* Stats row */}
            <div className="flex items-center text-sm font-medium border-t border-gray-100 pt-4 mt-2">
              <div className="flex-1 border-r border-gray-100 pr-4"><span className="text-gray-500 mr-2">Master NEW:</span><span className="text-green-600">{sessionConfig?.summaryData?.masterRun?.year ?? sessionConfig?.summaryData?.newRun?.year ?? '2026'}</span></div>
              <div className="flex-1 border-r border-gray-100 px-4"><span className="text-gray-500 mr-2">Locked GW:</span><span className="text-green-600">{features?.stats?.gwCount ?? 0}</span></div>
              <div className="flex-1 border-r border-gray-100 px-4"><span className="text-gray-500 mr-2">Bend inferred:</span><span className="text-orange-500">{features?.stats?.bendCount ?? 0}</span></div>
              <div className="flex-1 border-r border-gray-100 px-4"><span className="text-gray-500 mr-2">Missing in NEW:</span><span className={features?.stats?.missingGwCount > 0 ? 'text-red-500' : 'text-green-600'}>{features?.stats?.missingGwCount ?? 0}</span></div>
              <div className="flex-1 pl-4"><span className="text-gray-500 mr-2">Coverage:</span><span className={coverage > 0 ? 'text-green-600' : 'text-gray-500'}>{sections.length === 0 ? 'Optional · global' : `${coverage.toFixed(1)}%`}</span></div>
            </div>
          </div>

          {/* Canvas Toolbar */}
          {viewMode === 'schematic' && (
            <div className="bg-gray-50/50 px-6 py-3 border-b border-gray-200 flex items-center justify-between">
              <div className="text-sm font-medium text-gray-700">
                Longitudinal view
                <span className="ml-3 text-xs font-normal text-gray-500">
                  {zoom >= 6 ? 'Click a GW marker to pick section boundaries' : 'Zoom to at least 600% to select GWs precisely'}
                  <span className="ml-2 text-gray-400">· ctrl + scroll to zoom</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setZoom(1)} className="px-3 py-1.5 bg-white border border-gray-200 rounded-md text-sm text-gray-600 hover:bg-gray-50 flex items-center gap-2"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg> Fit</button>
                <div className="flex items-center border border-gray-200 rounded-md overflow-hidden bg-white ml-2">
                  <button type="button" aria-label="Zoom out" onClick={() => setZoom(clampSchematicZoom(zoom - 0.5))} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">−</button>
                  <div className="w-px h-4 bg-gray-200"></div>
                  <button type="button" onClick={() => setZoom(1)} className={`px-3 py-1.5 text-sm ${zoom === 1 ? 'bg-gray-100 text-gray-900 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}>100%</button>
                  <div className="w-px h-4 bg-gray-200"></div>
                  <button type="button" aria-label="Zoom in" onClick={() => setZoom(clampSchematicZoom(zoom + 0.5))} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">+</button>
                  <div className="w-px h-4 bg-gray-200"></div>
                  <button type="button" onClick={() => setZoom(MAX_SCHEMATIC_ZOOM)} className={`px-3 py-1.5 text-sm ${zoom === MAX_SCHEMATIC_ZOOM ? 'bg-gray-100 text-gray-900 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}>{MAX_SCHEMATIC_ZOOM * 100}%</button>
                </div>
                <input type="range" aria-label="Zoom level" min="0.5" max={MAX_SCHEMATIC_ZOOM} step="0.5" value={zoom} onChange={(e) => setZoom(clampSchematicZoom(Number(e.target.value)))} className="w-24 ml-2 accent-blue-600" />
              </div>
            </div>
          )}

          {/* Canvas & Sidebar Grid */}
          <div className="flex-1 flex overflow-hidden bg-white relative">
            <main className="flex-1 relative border-r border-gray-200 flex flex-col">
              {viewMode === 'schematic' ? (
                <>
                  <div className="flex-1 min-h-0 relative">
                    <SectioningSchematic
                      features={features}
                      sections={sections}
                      zoom={zoom}
                      onZoomChange={setZoom}
                      selectedGWs={selectedGWs}
                      onGwClick={handleGwClick}
                      inspectedGw={inspectedGw}
                      onInspectGw={handleInspectGw}
                    />
                  </div>
                  
                  {/* Bends Carousel (Bottom Panel 1) */}
                  <div className="h-44 border-t border-gray-200 bg-white p-4 flex flex-col shrink-0">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                        <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                        Bends & References
                      </h3>
                      <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-md">{features?.stats?.bendCount || 0} Total Bends</span>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar flex-1 items-start">
                      {features?.allFeatures?.filter(f => f.type.includes('bend')).map((bend, i) => (
                        <div key={i} className="min-w-[200px] border border-orange-100 rounded-lg p-3 bg-orange-50/30 hover:bg-orange-50 hover:border-orange-200 cursor-pointer transition-colors shadow-sm">
                          <div className="flex justify-between items-start mb-2">
                            <span className="text-xs font-bold text-orange-700 tracking-wide">BEND {String(i+1).padStart(2,'0')}</span>
                            <span className="text-[10px] font-bold bg-orange-100 text-orange-800 px-2 py-0.5 rounded-full">{bend.status}</span>
                          </div>
                          <div className="text-sm font-mono font-semibold text-gray-900 mb-1">{bend.dist.toFixed(3)} m</div>
                          <div className="flex items-center text-xs text-gray-500 gap-3 mt-2">
                            <span className="flex items-center gap-1" title="Angle"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg> {bend.rawData.angleDeg ? Number(bend.rawData.angleDeg).toFixed(1) : 'N/A'}°</span>
                            <span className="flex items-center gap-1" title="Clock Pos"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> {String(bend.rawData.clockPos || '-')}</span>
                          </div>
                        </div>
                      ))}
                      {(!features?.allFeatures?.some(f => f.type.includes('bend'))) && (
                        <div className="text-sm text-gray-400 italic flex items-center justify-center w-full h-full">No bends detected in this run.</div>
                      )}
                    </div>
                  </div>

                  {/* Minimap Overview (Bottom Panel 2) */}
                  <div className="h-14 border-t border-gray-200 bg-gray-50 flex items-center px-6 relative shrink-0">
                    <span className="text-xs font-bold text-gray-400 mr-4 tracking-wider">OVERVIEW</span>
                    <div className="flex-1 h-3 bg-gray-200 rounded-full relative overflow-hidden shadow-inner border border-gray-300">
                      {/* Sections overlay */}
                      {sections.map((s) => {
                        const total = features?.stats?.totalLength || 1;
                        const left = (Math.min(s.startM, s.endM) / total) * 100;
                        const width = (Math.abs(s.endM - s.startM) / total) * 100;
                        return (
                          <div
                            key={s.id}
                            className="absolute h-full opacity-80 border-r border-white/50"
                            style={{ left: `${left}%`, width: `${width}%`, backgroundColor: sectionColor(s.type) }}
                            title={`${s.name} · ${s.type}`}
                          />
                        );
                      })}
                    </div>
                    <span className="text-xs font-mono font-semibold text-gray-500 ml-4">{((features?.stats?.totalLength ?? 0) / 1000).toFixed(2)} km</span>
                  </div>
                </>
              ) : (
                <>
                  <SectionMap 
                    sections={sections}
                    features={features}
                    selectedGWs={selectedGWs}
                    onGwClick={handleGwClick}
                    pickingMode={pickingMode}
                    drawnRoute={drawnRoute}
                    onMapClickCoords={(lat, lng) => {
                      if (pickingMode === 'start') {
                        setRouteForm(f => ({ ...f, startLat: lat.toFixed(6), startLng: lng.toFixed(6) }));
                        setPickingMode(null);
                      } else if (pickingMode === 'end') {
                        setRouteForm(f => ({ ...f, endLat: lat.toFixed(6), endLng: lng.toFixed(6) }));
                        setPickingMode(null);
                      } else if (pickingMode === 'route') {
                        updateDrawnRoute([...drawnRoute, [lat, lng]]);
                      }
                    }}
                  />
                  {/* Route Setup Panel */}
                  <div className="absolute top-4 left-4 z-[1000] bg-white rounded-2xl border border-gray-200 shadow-xl w-[380px] p-6 text-gray-800 font-sans pointer-events-auto">
                    <div className="flex justify-between items-start mb-4">
                      <h2 className="text-xl font-bold text-gray-900">Pipeline Route Setup</h2>
                      <button 
                        onClick={() => { updateDrawnRoute([]); setPickingMode(null); }} 
                        className="text-xs font-bold text-red-500 hover:text-red-700 underline"
                      >
                        Reset
                      </button>
                    </div>

                    <div className="flex flex-col gap-5">
                      {/* START GW */}
                      <div>
                        <label className="block text-xs text-gray-700 mb-1 font-bold tracking-wider">START (FIRST WELD)</label>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <input 
                            type="text" 
                            placeholder="Lat (Decimal / DMS)" 
                            value={routeForm.startLat} 
                            onChange={e => setRouteForm(f => ({...f, startLat: e.target.value}))}
                            onBlur={e => setRouteForm(f => ({...f, startLat: normalizeCoordinateField(e.target.value)}))}
                            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-gray-900" 
                          />
                          <input 
                            type="text" 
                            placeholder="Lng (Decimal / DMS)" 
                            value={routeForm.startLng} 
                            onChange={e => setRouteForm(f => ({...f, startLng: e.target.value}))} 
                            onBlur={e => setRouteForm(f => ({...f, startLng: normalizeCoordinateField(e.target.value)}))}
                            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-gray-900" 
                          />
                        </div>
                        <button 
                          onClick={() => setPickingMode(pickingMode === 'start' ? null : 'start')} 
                          className={`w-full px-3 py-2 rounded-lg text-xs border font-medium transition-colors ${
                            pickingMode === 'start' 
                              ? 'bg-blue-50 border-blue-600 text-blue-700' 
                              : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
                          }`}
                        >
                          {pickingMode === 'start' ? 'Picking a point on the map...' : 'Pick on Map'}
                        </button>
                      </div>

                      {/* END GW */}
                      <div>
                        <label className="block text-xs text-gray-700 mb-1 font-bold tracking-wider">END (LAST WELD)</label>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <input 
                            type="text" 
                            placeholder="Lat (Decimal / DMS)" 
                            value={routeForm.endLat} 
                            onChange={e => setRouteForm(f => ({...f, endLat: e.target.value}))} 
                            onBlur={e => setRouteForm(f => ({...f, endLat: normalizeCoordinateField(e.target.value)}))}
                            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-gray-900" 
                          />
                          <input 
                            type="text" 
                            placeholder="Lng (Decimal / DMS)" 
                            value={routeForm.endLng} 
                            onChange={e => setRouteForm(f => ({...f, endLng: e.target.value}))} 
                            onBlur={e => setRouteForm(f => ({...f, endLng: normalizeCoordinateField(e.target.value)}))}
                            className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-gray-900" 
                          />
                        </div>
                        <button 
                          onClick={() => setPickingMode(pickingMode === 'end' ? null : 'end')} 
                          className={`w-full px-3 py-2 rounded-lg text-xs border font-medium transition-colors ${
                            pickingMode === 'end' 
                              ? 'bg-blue-50 border-blue-600 text-blue-700' 
                              : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
                          }`}
                        >
                          {pickingMode === 'end' ? 'Picking a point on the map...' : 'Pick on Map'}
                        </button>
                      </div>

                      {/* COMPARE LENGTHS */}
                      <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 font-mono text-sm">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-gray-500">Map distance:</span> 
                          <strong className="text-gray-900">{(mapDistanceMeters / 1000).toFixed(3)} km</strong>
                        </div>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-gray-500">ILI length:</span> 
                          <strong className="text-gray-900">{features?.stats ? (features.stats.totalLength / 1000).toFixed(3) : 0} km</strong>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                          <span className="text-gray-700 font-bold">Difference:</span> 
                          <strong className={`${features?.stats && Math.abs(mapDistanceMeters - features.stats.totalLength) > 1000 ? 'text-red-600' : 'text-blue-600'}`}>
                            {features?.stats ? Math.abs(mapDistanceMeters - features.stats.totalLength).toFixed(0) : 0} m
                          </strong>
                        </div>
                      </div>

                      {routeError && (
                        <p role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs font-medium text-red-700">{routeError}</p>
                      )}

                      {/* ACTIONS */}
                      <div className="flex flex-col gap-3 pt-2">
                        <button 
                          onClick={() => {
                            const lat1 = parseCoordinate(routeForm.startLat);
                            const lng1 = parseCoordinate(routeForm.startLng);
                            const lat2 = parseCoordinate(routeForm.endLat);
                            const lng2 = parseCoordinate(routeForm.endLng);

                            if (lat1 === null || lng1 === null || lat2 === null || lng2 === null) {
                              setRouteError('Start and End coordinates are missing or not in a recognized format (decimal, DDM, or DMS).');
                              return;
                            }
                            if (lat1 === lat2 && lng1 === lng2) {
                              setRouteError('Start and End points must not be identical; the distance would be 0 meters.');
                              return;
                            }
                            setRouteError(null);
                            updateDrawnRoute([[lat1, lng1], [lat2, lng2]]);
                            setRouteForm({
                              startLat: formatCoordinate(lat1),
                              startLng: formatCoordinate(lng1),
                              endLat: formatCoordinate(lat2),
                              endLng: formatCoordinate(lng2),
                            });
                          }}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-6 py-2.5 text-sm font-bold transition-colors shadow-sm"
                        >
                          Apply Straight Line (2 Points)
                        </button>
                        
                        <div className="flex items-center justify-center gap-2">
                          <div className="h-px bg-gray-200 flex-1"></div>
                          <span className="text-[10px] text-gray-400 font-bold tracking-widest">OR</span>
                          <div className="h-px bg-gray-200 flex-1"></div>
                        </div>
                        
                        <button 
                          onClick={() => setPickingMode(pickingMode === 'route' ? null : 'route')}
                          className={`w-full rounded-lg px-6 py-2.5 text-sm font-bold transition-colors shadow-sm border ${
                            pickingMode === 'route' 
                              ? 'bg-blue-50 border-blue-600 text-blue-700' 
                              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {pickingMode === 'route' ? 'Finish Drawing Route' : 'Draw Freehand Route'}
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </main>

            {/* Right Sidebar */}
            <aside className="w-80 bg-gray-50 flex flex-col h-full border-l border-gray-200 flex-shrink-0 z-10">
              <div className="p-6 flex-1 overflow-y-auto">
                {/* Selection */}
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      Selected section
                    </h3>
                  </div>
                  <div className="text-sm text-gray-600 flex flex-col gap-3 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                    <div className="flex justify-between items-center"><span className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Start KP</span><strong className="text-gray-900 font-mono bg-gray-100 px-2 py-1 rounded">{selectedGWs[0] ? (selectedGWs[0].dist / 1000).toFixed(3) : '-.---'} km</strong></div>
                    <div className="flex justify-between items-center"><span className="text-gray-500 text-xs font-semibold uppercase tracking-wider">End KP</span><strong className="text-gray-900 font-mono bg-gray-100 px-2 py-1 rounded">{selectedGWs[1] ? (selectedGWs[1].dist / 1000).toFixed(3) : '-.---'} km</strong></div>
                    <div className="w-full h-px bg-gray-100 my-1"></div>
                    <div className="flex justify-between items-center"><span className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Length</span><strong className="text-blue-700 font-mono font-bold text-base">{selectedGWs.length === 2 ? (Math.abs(selectedGWs[1].dist - selectedGWs[0].dist) / 1000).toFixed(3) : '-.---'} km</strong></div>
                    <div className="flex justify-between items-center"><span className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Missing in NEW</span><strong className={`px-2 py-1 rounded ${selectedMissingCount ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-900'}`}>{selectedMissingCount ?? '-'}</strong></div>
                  </div>

                  {selectedGWs.length > 0 && (
                    <button type="button" onClick={handleCancelSelection} className="mt-3 w-full px-4 py-2 bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900 rounded-lg text-sm font-semibold transition-colors shadow-sm">
                      Reset selection
                    </button>
                  )}
                  
                  {inspectedGw && (
                    <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4 shadow-sm relative">
                      <button onClick={() => setInspectedGw(null)} className="absolute top-2 right-2 text-blue-400 hover:text-blue-700">×</button>
                      <div className="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-1 flex items-center gap-1"><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> Selected feature</div>
                      <div className="text-base font-bold text-gray-900 mb-1">{inspectedGw.id}</div>
                      <div className="text-xs text-gray-700 mb-2 font-medium">{inspectedGw.runRole === 'MASTER' ? 'NEW' : 'OLD'} {inspectedGw.runYear || ''} · <span className={inspectedGw.status === 'MATCHED' ? 'text-green-600' : 'text-orange-600'}>{inspectedGw.status || 'UNRESOLVED'}</span></div>
                      <div className="text-xs font-mono bg-white border border-blue-100 px-2 py-1 rounded inline-block text-gray-800 shadow-sm">{inspectedGw.dist.toFixed(3)} m</div>
                      {Number.isFinite(inspectedGw.wallThicknessMm) && (
                        <div className="mt-2 text-xs font-semibold text-orange-700 bg-orange-50 inline-block px-2 py-1 rounded">Wall thickness {Number(inspectedGw.wallThicknessMm).toFixed(1)} mm</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Section Register */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-gray-900">Section register</h3>
                    <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">{sections.length}</span>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                    <SectionList sections={sections} totalLength={features?.stats?.totalLength ?? 0} onDelete={handleDeleteSection} />
                  </div>
                </div>
              </div>

              {/* Sidebar Footer Actions */}
              <div className="p-5 border-t border-gray-200 bg-white flex flex-col gap-3">
                {sectionError && (
                  <p role="alert" className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs font-medium text-red-700">{sectionError}</p>
                )}
                <button type="button" onClick={() => setShowModal(true)} disabled={selectedGWs.length !== 2} className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition-colors shadow-sm flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  Mark section
                </button>
                <div className="flex gap-2">
                  <button type="button" onClick={handleExport} className="flex-1 px-4 py-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg text-sm font-semibold transition-colors shadow-sm flex items-center justify-center gap-2"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg> Export</button>
                  <button type="button" onClick={handleClearAll} disabled={sections.length === 0} className="flex-1 px-4 py-2 bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-sm font-semibold transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> Clear</button>
                </div>
                <button type="button" onClick={() => navigate(`/ili-comparison${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`)} className="w-full mt-1 text-center text-sm text-gray-500 hover:text-gray-800 font-medium transition-colors">← Back to results</button>
              </div>
            </aside>
          </div>
        </div>
      </main>

      {/* Modal */}
      {showModal && selectedGWs.length === 2 && (() => {
        let autoStartCoords = undefined;
        let autoEndCoords = undefined;
        
        if (drawnRoute.length > 1 && features?.stats?.totalLength > 0) {
          autoStartCoords = interpolateAlongRoute(drawnRoute, selectedGWs[0].dist / features.stats.totalLength);
          autoEndCoords = interpolateAlongRoute(drawnRoute, selectedGWs[1].dist / features.stats.totalLength);
        }

        return (
          <SectionModal 
            startGw={selectedGWs[0]} 
            endGw={selectedGWs[1]}
            autoStartCoords={autoStartCoords}
            autoEndCoords={autoEndCoords}
            error={sectionError}
            onClose={() => { setShowModal(false); setSelectedGWs([]); setSectionError(null); }}
            onSave={handleSaveSection}
          />
        );
      })()}

      {showClearAllConfirm && (
        <ConfirmDialog
          title="Delete all sections?"
          message="This removes every section from this session. This action cannot be undone."
          confirmLabel="Delete All"
          danger
          onConfirm={() => {
            setSections([]);
            saveSpatialState([]);
            setShowClearAllConfirm(false);
          }}
          onCancel={() => setShowClearAllConfirm(false)}
        />
      )}
    </div>
  );
}
