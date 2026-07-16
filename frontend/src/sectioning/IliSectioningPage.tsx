import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import SectionModal from './SectionModal';
import SectioningSchematic from './SectioningSchematic';
import SectionList from './SectionList';
import SectionMap from './SectionMap';
import { apiFetch } from '../utils/api';
import { fetchAlignmentComparison } from '../utils/alignment';

export interface SectionDef {
  id: string;
  name: string;
  type: string;
  startGw: string;
  endGw: string;
  startM: number;
  endM: number;
  length: number;
  notes: string;
  latStart?: number;
  lngStart?: number;
  latEnd?: number;
  lngEnd?: number;
}

function getDistanceFromLatLonInM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const dLat = (lat2-lat1) * (Math.PI/180);
  const dLon = (lon2-lon1) * (Math.PI/180); 
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c;
}

function interpolatePoint(routeCoords: [number, number][], targetRatio: number) {
  if (routeCoords.length === 0) return { lat: NaN, lng: NaN };
  if (routeCoords.length === 1) return { lat: routeCoords[0][0], lng: routeCoords[0][1] };
  if (targetRatio <= 0) return { lat: routeCoords[0][0], lng: routeCoords[0][1] };
  if (targetRatio >= 1) return { lat: routeCoords[routeCoords.length - 1][0], lng: routeCoords[routeCoords.length - 1][1] };

  let totalLength = 0;
  const segments = [];
  for (let i = 0; i < routeCoords.length - 1; i++) {
    const p1 = routeCoords[i];
    const p2 = routeCoords[i+1];
    const d = getDistanceFromLatLonInM(p1[0], p1[1], p2[0], p2[1]);
    segments.push({ p1, p2, d });
    totalLength += d;
  }

  const targetLength = targetRatio * totalLength;
  let accumulated = 0;

  for (const seg of segments) {
    if (accumulated + seg.d >= targetLength) {
      const remaining = targetLength - accumulated;
      const segRatio = seg.d === 0 ? 0 : remaining / seg.d;
      const lat = seg.p1[0] + (seg.p2[0] - seg.p1[0]) * segRatio;
      const lng = seg.p1[1] + (seg.p2[1] - seg.p1[1]) * segRatio;
      return { lat, lng };
    }
    accumulated += seg.d;
  }
  return { lat: routeCoords[routeCoords.length - 1][0], lng: routeCoords[routeCoords.length - 1][1] };
}

function parseCoordinate(val: string): string {
  if (!val) return '';
  val = val.trim();
  
  // Sangat kebal/robust: Cari 3 kelompok angka yang dipisah oleh simbol apapun (derajat, menit, detik)
  // Contoh: "0° 52' 20.9270\" S" atau "117 15 59.6039 E"
  const dmsRegex = /^(-?\d+)[^\d]+([\d]+)[^\d]+([\d.]+)[^\d]*([NSEWnsew])?/;
  const match = val.match(dmsRegex);
  
  if (match) {
    const d = parseFloat(match[1]);
    const m = parseFloat(match[2]);
    const s = parseFloat(match[3]);
    let dir = match[4] ? match[4].toUpperCase() : '';
    
    let decimal = Math.abs(d) + (m / 60) + (s / 3600);
    // Kalau aslinya minus, atau huruf S/W, jadikan minus
    if (d < 0 || dir === 'S' || dir === 'W') {
      decimal = decimal * -1;
    }
    return decimal.toFixed(6);
  }
  
  // Fallback: Parsing desimal standar
  val = val.replace(',', '.');
  const num = parseFloat(val);
  return isNaN(num) ? val : num.toString();
}

export default function IliSectioningPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any[]>([]);
  const [sections, setSections] = useState<SectionDef[]>([]);
  const [sessionId, setSessionId] = useState('');
  
  // Interaction states
  const [viewMode, setViewMode] = useState<'schematic' | 'map'>('schematic');
  const [zoom, setZoom] = useState(1);
  const [selectedGWs, setSelectedGWs] = useState<any[]>([]); // stores up to 2 GW objects
  const [showModal, setShowModal] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
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

  const updateDrawnRoute = (newRoute: [number, number][]) => {
    setDrawnRoute(newRoute);
    localStorage.setItem('synapse_drawn_route', JSON.stringify(newRoute));
  };
  
  const mapDistanceMeters = useMemo(() => {
    let dist = 0;
    for (let i = 0; i < drawnRoute.length - 1; i++) {
      dist += getDistanceFromLatLonInM(drawnRoute[i][0], drawnRoute[i][1], drawnRoute[i+1][0], drawnRoute[i+1][1]);
    }
    return dist;
  }, [drawnRoute]);

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
        if (!resolvedSessionId) throw new Error('ID sesi tidak ditemukan.');
        setSessionId(resolvedSessionId);
        setData(await fetchAlignmentComparison(resolvedSessionId, undefined, controller.signal));
        
        try {
           const sessData = await apiFetch<{ config?: { sections?: SectionDef[] } }>(`/api/wizard/session/${encodeURIComponent(resolvedSessionId)}`, { signal: controller.signal });
           if (sessData.config?.sections) setSections(sessData.config.sections);
        } catch {
           // A missing saved configuration must not prevent sectioning of valid data.
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

  const saveSectionsToDb = async (newSections: SectionDef[]) => {
    if (!sessionId) return;
    try {
      await apiFetch('/api/wizard/save-sections', {
        method: 'POST',
        body: JSON.stringify({ sessionId, sections: newSections })
      });
    } catch (e) {
      console.error("Failed to save sections", e);
    }
  };

  const handleZoomIn = () => setZoom(z => Math.min(z + 0.5, 10));
  const handleZoomOut = () => setZoom(z => Math.max(z - 0.5, 0.5));
  const handleFitWidth = () => setZoom(1);

  const handleCancelSelection = () => {
    setSelectedGWs([]);
  };

  const handleClearAll = () => {
    if (window.confirm("Are you sure you want to delete ALL sections?")) {
      setSections([]);
      saveSectionsToDb([]);
    }
  };

  const handleExport = () => {
    const protectSpreadsheetValue = (value: unknown) => {
      const text = String(value ?? '');
      return /^[=+\-@]/.test(text) ? `'${text}` : text;
    };
    const header = "SECTION NAME,TYPE,START GW,END GW,START (M),END (M),LENGTH (M),NOTES\n";
    const rows = sections.map(s => 
      `"${protectSpreadsheetValue(s.name).replaceAll('"', '""')}","${protectSpreadsheetValue(s.type).replaceAll('"', '""')}","${protectSpreadsheetValue(s.startGw).replaceAll('"', '""')}","${protectSpreadsheetValue(s.endGw).replaceAll('"', '""')}",${s.startM},${s.endM},${s.length},"${protectSpreadsheetValue(s.notes).replaceAll('"', '""')}"`
    ).join("\n");
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sections_export.csv';
    a.click();
  };

  const handleGwClick = (gw: any) => {
    if (selectedGWs.length === 0) {
      setSelectedGWs([gw]);
    } else if (selectedGWs.length === 1) {
      // Don't select the same GW twice
      if (gw.id === selectedGWs[0].id) return;
      
      const newSelection = [selectedGWs[0], gw].sort((a, b) => a.dist - b.dist);
      setSelectedGWs(newSelection);
      setShowModal(true);
    }
  };

  const handleSaveSection = (section: Partial<SectionDef>) => {
    const newId = `sec-${Date.now()}`;
    const newSection: SectionDef = {
      id: newId,
      name: section.name || 'Unnamed',
      type: section.type || 'OTH',
      startGw: selectedGWs[0].id,
      endGw: selectedGWs[1].id,
      startM: selectedGWs[0].dist,
      endM: selectedGWs[1].dist,
      length: Math.abs(selectedGWs[1].dist - selectedGWs[0].dist),
      notes: section.notes || '',
      latStart: section.latStart,
      lngStart: section.lngStart,
      latEnd: section.latEnd,
      lngEnd: section.lngEnd
    };
    
    const updated = [...sections, newSection];
    setSections(updated);
    saveSectionsToDb(updated);
    
    setShowModal(false);
    setSelectedGWs([]);
  };

  const handleDeleteSection = (id: string) => {
    const updated = sections.filter(s => s.id !== id);
    setSections(updated);
    saveSectionsToDb(updated);
  };

  // Extract features for the schematic
  const features = useMemo(() => {
    if (!data.length) return { gws: [], allFeatures: [], stats: { totalLength: 0, gwCount: 0, bendCount: 0 } };
    
    const gws: any[] = [];
    const allFeatures: any[] = [];
    let maxDist = 0;
    let bendCount = 0;
    
    // First pass to find maxDist
    data.forEach(row => {
      const dist = parseFloat(row['Log Dist OLD (m)']);
      if (!isNaN(dist) && dist > maxDist) maxDist = dist;
    });

    data.forEach(row => {
      // Use OLD run as the reference for sectioning
      const dist = parseFloat(row['Log Dist OLD (m)']);
      if (isNaN(dist)) return;
      
      const type = (row['Feature Type OLD'] || '').toLowerCase();
      const identif = row['Identif. OLD'] || '';
      
      // Try to get actual coordinates, or fake them based on dist for demo
      let lat = parseFloat(row['Latitude OLD'] || row['Latitude'] || row['Lat OLD']);
      let lng = parseFloat(row['Longitude OLD'] || row['Longitude'] || row['Long OLD']);
      
      if (isNaN(lat) || isNaN(lng)) {
         if (drawnRoute.length >= 2 && maxDist > 0) {
            // Interpolate from user-drawn route
            const ratio = dist / maxDist;
            const pt = interpolatePoint(drawnRoute, ratio);
            lat = pt.lat;
            lng = pt.lng;
         } else {
            // No custom route, and no GPS. Leave as NaN.
            lat = NaN;
            lng = NaN;
         }
      }
      
      const feature = { id: identif, dist, type, rawData: row, lat, lng };
      allFeatures.push(feature);
      
      if (type.includes('weld')) {
        gws.push(feature);
      }
      if (type.includes('bend')) {
        bendCount++;
      }
    });

    return { 
      gws: gws.sort((a,b) => a.dist - b.dist), 
      allFeatures: allFeatures.sort((a,b) => a.dist - b.dist),
      stats: { totalLength: maxDist, gwCount: gws.length, bendCount }
    };
  }, [data, drawnRoute]);

  if (loading) {
    return <div className="sectioning-workspace flex items-center justify-center text-brand-600 font-medium">Loading Schematic...</div>;
  }

  return (
    <div className="sectioning-workspace font-outfit flex flex-col">
      {/* Header */}
      <header className="p-5 bg-white flex justify-between items-start z-10">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-brand-700 font-bold tracking-widest text-sm">
            <div className="w-2 h-2 bg-brand-500 rotate-45"></div>
            ILI SECTIONING <span className="text-gray-500 font-medium">JOINT & FEATURE SCHEMATIC</span>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={handleZoomOut} className="px-3 py-1.5 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 rounded-md text-xs font-medium transition-colors shadow-sm flex items-center gap-1">
              - zoom
            </button>
            <button onClick={handleZoomIn} className="px-3 py-1.5 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 rounded-md text-xs font-medium transition-colors shadow-sm flex items-center gap-1">
              + zoom
            </button>
            <button onClick={handleFitWidth} className="px-3 py-1.5 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 rounded-md text-xs font-medium transition-colors shadow-sm flex items-center gap-1">
              fit width
            </button>
            <button onClick={handleCancelSelection} disabled={selectedGWs.length === 0} className="px-3 py-1.5 ml-2 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 disabled:opacity-50 disabled:bg-gray-100 rounded-md text-xs font-medium transition-colors shadow-sm">
              batal pilih GW
            </button>
            <button onClick={handleClearAll} className="px-3 py-1.5 bg-white hover:bg-red-50 border border-red-200 text-red-600 rounded-md text-xs font-medium transition-colors shadow-sm">
              hapus semua section
            </button>
            <button onClick={handleExport} className="px-4 py-1.5 ml-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-bold transition-colors shadow-sm flex items-center gap-2">
              export ke Excel
            </button>
            
            <button onClick={() => navigate(`/ili-comparison${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`)} className="px-4 py-1.5 ml-4 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-md text-xs font-bold transition-colors shadow-sm">
              Tutup & Kembali ke Results
            </button>
            
            <button onClick={() => setViewMode(v => v === 'schematic' ? 'map' : 'schematic')} className="px-4 py-1.5 ml-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-bold transition-colors shadow-sm flex items-center gap-2">
              {viewMode === 'schematic' ? 'Buka Peta GIS' : 'Kembali ke Skema'}
            </button>
          </div>
        </div>

        <div className="flex flex-col items-end gap-3 text-xs text-gray-600">
          <div className="flex gap-4 bg-gray-50 px-4 py-2 rounded-lg border border-gray-200">
            <span>Total: <strong className="text-gray-900">{features.stats.totalLength.toFixed(3)} m</strong></span>
            <span>Girth Weld: <strong className="text-gray-900">{features.stats.gwCount}</strong></span>
            <span>Bend: <strong className="text-gray-900">{features.stats.bendCount}</strong></span>
          </div>
          <div className="h-4 flex flex-col items-end">
            {selectedGWs.length === 1 && (
              <span className="text-blue-600 font-medium">
                GW awal dipilih: <strong className="text-blue-800">{selectedGWs[0].id}</strong> ({selectedGWs[0].dist.toFixed(2)}m) - klik GW kedua untuk selesai.
              </span>
            )}
            {viewMode === 'map' && pickingMode === 'route' && (
              <span className="text-orange-600 font-bold mt-1">
                Mode Gambar Aktif: Klik peta untuk menggambar jalur pipa. ({drawnRoute.length} titik)
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Legend */}
      <div className="px-6 py-2 bg-gray-50 border-b border-gray-200 flex gap-6 text-xs text-gray-600 font-medium">
        <div className="flex items-center gap-2"><div className="w-3 h-3 bg-teal-500"></div> Girth Weld (klik untuk section)</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 bg-amber-500"></div> Bend tunggal</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 bg-yellow-400"></div> Jog (2 bend)</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 bg-purple-500"></div> Crossing (3+ bend)</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 bg-red-500"></div> Riser (dekat platform)</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 bg-blue-500"></div> Valve</div>
        <div className="flex items-center gap-2"><div className="w-3 h-3 bg-slate-400"></div> Casing</div>
      </div>

      {/* Schematic / Map Area */}
      <div className="flex-1 relative overflow-hidden flex flex-col bg-gray-50/50" ref={containerRef}>
        {viewMode === 'schematic' ? (
          <SectioningSchematic 
            features={features} 
            sections={sections} 
            zoom={zoom} 
            selectedGWs={selectedGWs} 
            onGwClick={handleGwClick} 
          />
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
            {/* Route Setup Panel (Synapse Standard UI) */}
            <div className="absolute top-4 left-4 z-[1000] bg-white rounded-2xl border border-gray-200 shadow-xl w-[380px] p-6 text-gray-800 font-sans pointer-events-auto">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-xl font-bold text-gray-900">Pengaturan Jalur Pipa</h2>
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
                  <label className="block text-xs text-gray-700 mb-1 font-bold tracking-wider">START (WELD PERTAMA)</label>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <input 
                      type="text" 
                      placeholder="Lat (Desimal / DMS)" 
                      value={routeForm.startLat} 
                      onChange={e => setRouteForm(f => ({...f, startLat: e.target.value}))}
                      onBlur={e => setRouteForm(f => ({...f, startLat: parseCoordinate(e.target.value)}))} 
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-gray-900" 
                    />
                    <input 
                      type="text" 
                      placeholder="Lng (Desimal / DMS)" 
                      value={routeForm.startLng} 
                      onChange={e => setRouteForm(f => ({...f, startLng: e.target.value}))} 
                      onBlur={e => setRouteForm(f => ({...f, startLng: parseCoordinate(e.target.value)}))}
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
                    {pickingMode === 'start' ? 'Pilih Titik di Peta...' : 'Pilih di Peta'}
                  </button>
                </div>

                {/* END GW */}
                <div>
                  <label className="block text-xs text-gray-700 mb-1 font-bold tracking-wider">END (WELD TERAKHIR)</label>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <input 
                      type="text" 
                      placeholder="Lat (Desimal / DMS)" 
                      value={routeForm.endLat} 
                      onChange={e => setRouteForm(f => ({...f, endLat: e.target.value}))} 
                      onBlur={e => setRouteForm(f => ({...f, endLat: parseCoordinate(e.target.value)}))}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-gray-900" 
                    />
                    <input 
                      type="text" 
                      placeholder="Lng (Desimal / DMS)" 
                      value={routeForm.endLng} 
                      onChange={e => setRouteForm(f => ({...f, endLng: e.target.value}))} 
                      onBlur={e => setRouteForm(f => ({...f, endLng: parseCoordinate(e.target.value)}))}
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
                    {pickingMode === 'end' ? 'Pilih Titik di Peta...' : 'Pilih di Peta'}
                  </button>
                </div>

                {/* COMPARE LENGTHS */}
                <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 font-mono text-sm">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-gray-500">Jarak Peta:</span> 
                    <strong className="text-gray-900">{(mapDistanceMeters / 1000).toFixed(3)} km</strong>
                  </div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-gray-500">Panjang ILI:</span> 
                    <strong className="text-gray-900">{(features.stats.totalLength / 1000).toFixed(3)} km</strong>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                    <span className="text-gray-700 font-bold">Selisih:</span> 
                    <strong className={`${Math.abs(mapDistanceMeters - features.stats.totalLength) > 1000 ? 'text-red-600' : 'text-blue-600'}`}>
                      {Math.abs(mapDistanceMeters - features.stats.totalLength).toFixed(0)} m
                    </strong>
                  </div>
                </div>

                {/* ACTIONS */}
                <div className="flex flex-col gap-3 pt-2">
                  <button 
                    onClick={() => {
                      const lat1 = parseFloat(parseCoordinate(routeForm.startLat));
                      const lng1 = parseFloat(parseCoordinate(routeForm.startLng));
                      const lat2 = parseFloat(parseCoordinate(routeForm.endLat));
                      const lng2 = parseFloat(parseCoordinate(routeForm.endLng));
                      
                      if (!isNaN(lat1) && !isNaN(lng1) && !isNaN(lat2) && !isNaN(lng2)) {
                        if (lat1 === lat2 && lng1 === lng2) {
                          alert("Titik Start dan End tidak boleh sama, karena jaraknya akan jadi 0 meter.");
                          return;
                        }
                        updateDrawnRoute([[lat1, lng1], [lat2, lng2]]);
                        // Update form so it shows standard decimals if they typed DMS and just clicked apply directly
                        setRouteForm({
                          startLat: lat1.toFixed(6),
                          startLng: lng1.toFixed(6),
                          endLat: lat2.toFixed(6),
                          endLng: lng2.toFixed(6)
                        });
                      } else {
                        alert("Isi format koordinat Start dan End terlebih dahulu dengan benar.");
                      }
                    }}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-6 py-2.5 text-sm font-bold transition-colors shadow-sm"
                  >
                    Terapkan Garis Lurus (2 Titik)
                  </button>
                  
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-px bg-gray-200 flex-1"></div>
                    <span className="text-[10px] text-gray-400 font-bold tracking-widest">ATAU</span>
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
                    {pickingMode === 'route' ? 'Selesai Gambar Rute' : 'Gambar Rute Bebas'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Section List Table */}
      <div className="h-72 border-t border-[#1e293b] bg-[#1e293b]/30 flex flex-col">
        <SectionList sections={sections} totalLength={features.stats.totalLength} onDelete={handleDeleteSection} />
      </div>

      {/* Modal */}
      {showModal && selectedGWs.length === 2 && (() => {
        let autoStartCoords = undefined;
        let autoEndCoords = undefined;
        
        if (drawnRoute.length > 1 && features.stats.totalLength > 0) {
          const scalingFactor = mapDistanceMeters / features.stats.totalLength;
          autoStartCoords = interpolatePoint(drawnRoute, selectedGWs[0].dist * scalingFactor);
          autoEndCoords = interpolatePoint(drawnRoute, selectedGWs[1].dist * scalingFactor);
        }

        return (
          <SectionModal 
            startGw={selectedGWs[0]} 
            endGw={selectedGWs[1]}
            autoStartCoords={autoStartCoords}
            autoEndCoords={autoEndCoords}
            onClose={() => { setShowModal(false); setSelectedGWs([]); }}
            onSave={handleSaveSection}
          />
        );
      })()}
    </div>
  );
}
