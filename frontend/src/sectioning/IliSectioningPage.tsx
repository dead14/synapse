import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiZoomIn, FiZoomOut, FiMaximize, FiX, FiDownload, FiTrash2 } from 'react-icons/fi';
import SectionModal from './SectionModal';
import SectioningSchematic from './SectioningSchematic';
import SectionList from './SectionList';
import SectionMap from './SectionMap';

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

export default function IliSectioningPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any[]>([]);
  const [sections, setSections] = useState<SectionDef[]>([]);
  
  // Interaction states
  const [viewMode, setViewMode] = useState<'schematic' | 'map'>('schematic');
  const [zoom, setZoom] = useState(1);
  const [selectedGWs, setSelectedGWs] = useState<any[]>([]); // stores up to 2 GW objects
  const [showModal, setShowModal] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const sessionId = urlParams.get('sessionId') || localStorage.getItem('synapse_last_session_id') || '';
        const token = localStorage.getItem('synapse_token') || '';
        
        // Fetch the same comparison data to get the GWs and features
        const response = await fetch(`http://localhost:8000/api/ili-results?sessionId=${sessionId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) throw new Error('Network response was not ok');
        const resData = await response.json();
        
        if (resData.comparison) {
          setData(resData.comparison);
        }
        
        // Also fetch from DB if there are saved sections
        try {
           const sessRes = await fetch(`http://localhost:8000/api/wizard/session/${sessionId}`, {
              headers: { 'Authorization': `Bearer ${token}` }
           });
           if (sessRes.ok) {
              const sessData = await sessRes.json();
              if (sessData.config && sessData.config.sections) {
                 setSections(sessData.config.sections);
              }
           }
        } catch(e) {
           console.warn("Could not fetch sections from DB");
        }
      } catch (error) {
        console.error("Failed to fetch ILI data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const saveSectionsToDb = async (newSections: SectionDef[]) => {
    const sessionId = localStorage.getItem('synapse_last_session_id');
    const token = localStorage.getItem('synapse_token') || '';
    if (!sessionId) return;
    try {
      await fetch('http://localhost:8000/api/wizard/save-sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
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
    // Basic CSV export for sections
    const header = "SECTION NAME,TYPE,START GW,END GW,START (M),END (M),LENGTH (M),NOTES\n";
    const rows = sections.map(s => 
      `"${s.name}","${s.type}","${s.startGw}","${s.endGw}",${s.startM},${s.endM},${s.length},"${s.notes || ''}"`
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

    data.forEach(row => {
      // Use OLD run as the reference for sectioning
      const dist = parseFloat(row['Log Dist OLD (m)']);
      if (isNaN(dist)) return;
      
      if (dist > maxDist) maxDist = dist;
      
      const type = (row['Feature Type OLD'] || '').toLowerCase();
      const identif = row['Identif. OLD'] || '';
      
      const feature = { id: identif, dist, type, rawData: row };
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
      allFeatures,
      stats: { totalLength: maxDist, gwCount: gws.length, bendCount }
    };
  }, [data]);

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-blue-600 font-medium">Loading Schematic...</div>;
  }

  return (
    <div className="min-h-screen bg-white font-sans text-gray-800 flex flex-col">
      {/* Header */}
      <header className="p-4 border-b border-gray-200 bg-white shadow-sm flex justify-between items-start z-10">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-blue-700 font-bold tracking-widest text-sm">
            <div className="w-2 h-2 bg-blue-600 rotate-45"></div>
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
            
            <button onClick={() => navigate('/ili-comparison')} className="px-4 py-1.5 ml-4 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-md text-xs font-bold transition-colors shadow-sm">
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
          <div className="h-4">
            {selectedGWs.length === 1 && (
              <span className="text-blue-600 font-medium">
                GW awal dipilih: <strong className="text-blue-800">{selectedGWs[0].id}</strong> ({selectedGWs[0].dist.toFixed(2)}m) - klik GW kedua untuk selesai.
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
          <SectionMap sections={sections} />
        )}
      </div>

      {/* Section List Table */}
      <div className="h-72 border-t border-[#1e293b] bg-[#1e293b]/30 flex flex-col">
        <SectionList sections={sections} totalLength={features.stats.totalLength} onDelete={handleDeleteSection} />
      </div>

      {/* Modal */}
      {showModal && selectedGWs.length === 2 && (
        <SectionModal 
          startGw={selectedGWs[0]} 
          endGw={selectedGWs[1]} 
          onClose={() => { setShowModal(false); setSelectedGWs([]); }}
          onSave={handleSaveSection}
        />
      )}
    </div>
  );
}
