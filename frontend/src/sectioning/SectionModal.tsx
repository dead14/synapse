import React, { useState } from 'react';
import { SectionDef } from './IliSectioningPage';

interface SectionModalProps {
  startGw: any;
  endGw: any;
  onClose: () => void;
  onSave: (section: Partial<SectionDef>) => void;
}

const SECTION_TYPES = [
  { id: 'RL', label: 'RL - River Crossing' },
  { id: 'AL', label: 'AL - Aerial Crossing' },
  { id: 'RIS', label: 'RIS - Riser' },
  { id: 'ROC', label: 'ROC - Road Crossing' },
  { id: 'BUR', label: 'BUR - Buried Normal' },
  { id: 'CAS', label: 'CAS - Cased Section' },
  { id: 'OTH', label: 'OTH - Lainnya' }
];

export default function SectionModal({ startGw, endGw, onClose, onSave }: SectionModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState('RL');
  const [notes, setNotes] = useState('');
  
  const [latStart, setLatStart] = useState('');
  const [lngStart, setLngStart] = useState('');
  const [latEnd, setLatEnd] = useState('');
  const [lngEnd, setLngEnd] = useState('');

  const distance = Math.abs(endGw.dist - startGw.dist);
  const orderedGWs = [startGw, endGw].sort((a,b) => a.dist - b.dist);

  const handleSave = () => {
    onSave({
      name,
      type,
      notes,
      latStart: latStart ? parseFloat(latStart) : undefined,
      lngStart: lngStart ? parseFloat(lngStart) : undefined,
      latEnd: latEnd ? parseFloat(latEnd) : undefined,
      lngEnd: lngEnd ? parseFloat(lngEnd) : undefined,
    });
  };

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xl max-w-[500px] w-full p-6 text-gray-800 font-sans">
        
        <h2 className="text-xl font-bold text-gray-900 mb-2">Buat Section</h2>
        <p className="text-xs text-gray-500 mb-6 font-mono bg-gray-50 p-2 rounded-lg border border-gray-100">
          {orderedGWs[0].id} ({orderedGWs[0].dist.toFixed(2)}m) ➔ {orderedGWs[1].id} ({orderedGWs[1].dist.toFixed(2)}m) • panjang <strong className="text-blue-600">{distance.toFixed(2)} m</strong>
        </p>

        <div className="flex flex-col gap-5">
          {/* NAMA SECTION */}
          <div>
            <label className="block text-xs text-gray-700 mb-1 font-bold tracking-wider">NAMA SECTION</label>
            <input 
              type="text" 
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="cth: RC 192, AC 45, Riser Platform A"
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-gray-900 placeholder-gray-400"
            />
          </div>

          {/* TIPE SECTION */}
          <div>
            <label className="block text-xs text-gray-700 mb-1 font-bold tracking-wider">TIPE SECTION</label>
            <div className="flex flex-wrap gap-2">
              {SECTION_TYPES.map(t => (
                <button
                  key={t.id}
                  onClick={() => setType(t.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs border font-medium transition-colors ${
                    type === t.id 
                      ? 'bg-blue-50 border-blue-600 text-blue-700' 
                      : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* GIS COORDINATES */}
          <div>
            <label className="block text-xs text-gray-700 mb-1 font-bold tracking-wider">KOORDINAT (MANUAL UNTUK PETA)</label>
            <div className="grid grid-cols-2 gap-4">
               <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1">START GW (LAT / LNG)</label>
                  <div className="flex gap-2">
                     <input type="number" placeholder="Lat" value={latStart} onChange={e=>setLatStart(e.target.value)} className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
                     <input type="number" placeholder="Lng" value={lngStart} onChange={e=>setLngStart(e.target.value)} className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
                  </div>
               </div>
               <div>
                  <label className="block text-[10px] font-bold text-gray-500 mb-1">END GW (LAT / LNG)</label>
                  <div className="flex gap-2">
                     <input type="number" placeholder="Lat" value={latEnd} onChange={e=>setLatEnd(e.target.value)} className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
                     <input type="number" placeholder="Lng" value={lngEnd} onChange={e=>setLngEnd(e.target.value)} className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
                  </div>
               </div>
            </div>
          </div>

          {/* CATATAN */}
          <div>
            <label className="block text-xs text-gray-700 mb-1 font-bold tracking-wider">CATATAN (OPSIONAL)</label>
            <textarea 
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="cth: sungai Mahakam, kedalaman 8m, dekat KP 12.3"
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-gray-900 min-h-[80px] placeholder-gray-400"
            />
          </div>
        </div>

        {/* ACTIONS */}
        <div className="flex justify-end gap-3 mt-8 pt-4 border-t border-gray-100">
          <button 
            onClick={onClose}
            className="px-6 py-2 bg-white text-sm font-medium text-gray-600 hover:bg-gray-50 border border-gray-300 rounded-lg transition-colors"
          >
            batal
          </button>
          <button 
            onClick={handleSave}
            disabled={!name}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-colors disabled:opacity-50 disabled:bg-gray-400 shadow-sm"
          >
            simpan section
          </button>
        </div>

      </div>
    </div>
  );
}
