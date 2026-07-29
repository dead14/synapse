import React, { useState } from 'react';
import Modal from '../components/common/Modal';
import type { SectionDef } from './types';

interface SectionModalProps {
  startGw: any;
  endGw: any;
  autoStartCoords?: {lat: number, lng: number};
  autoEndCoords?: {lat: number, lng: number};
  error?: string | null;
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
  { id: 'BND', label: 'BND - Bend' },
  { id: 'OTH', label: 'OTH - Other' }
];

export default function SectionModal({ startGw, endGw, autoStartCoords, autoEndCoords, error, onClose, onSave }: SectionModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState('RL');
  const [physicalType, setPhysicalType] = useState('Buried');
  const [policy, setPolicy] = useState('Match');
  const [notes, setNotes] = useState('');
  
  const [latStart, setLatStart] = useState('');
  const [lngStart, setLngStart] = useState('');
  const [latEnd, setLatEnd] = useState('');
  const [lngEnd, setLngEnd] = useState('');

  React.useEffect(() => {
    if (autoStartCoords) {
      setLatStart(autoStartCoords.lat.toFixed(6));
      setLngStart(autoStartCoords.lng.toFixed(6));
    }
    if (autoEndCoords) {
      setLatEnd(autoEndCoords.lat.toFixed(6));
      setLngEnd(autoEndCoords.lng.toFixed(6));
    }
  }, [autoStartCoords, autoEndCoords]);

  const distance = Math.abs(endGw.dist - startGw.dist);
  const orderedGWs = [startGw, endGw].sort((a,b) => a.dist - b.dist);

  const handleSave = () => {
    onSave({
      name,
      type,
      physicalType,
      policy,
      notes,
      latStart: latStart ? parseFloat(latStart) : undefined,
      lngStart: lngStart ? parseFloat(lngStart) : undefined,
      latEnd: latEnd ? parseFloat(latEnd) : undefined,
      lngEnd: lngEnd ? parseFloat(lngEnd) : undefined,
    });
  };

  return (
    <Modal
      onClose={onClose}
      labelledBy="section-modal-title"
      overlayClassName="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[999999] flex items-center justify-center p-4"
      panelClassName="bg-white rounded-2xl border border-gray-200 shadow-xl max-w-[500px] w-full p-6 text-gray-800 font-sans"
    >

        <h2 id="section-modal-title" className="text-xl font-bold text-gray-900 mb-2">Create Section</h2>
        <p className="text-xs text-gray-500 mb-6 font-mono bg-gray-50 p-2 rounded-lg border border-gray-100">
          {orderedGWs[0].id} ({orderedGWs[0].dist.toFixed(2)}m) ➔ {orderedGWs[1].id} ({orderedGWs[1].dist.toFixed(2)}m) • length <strong className="text-blue-600">{distance.toFixed(2)} m</strong>
        </p>

        <div className="flex flex-col gap-5">
          {/* SECTION NAME */}
          <div>
            <label className="block text-xs text-gray-700 mb-1 font-bold tracking-wider">SECTION NAME</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. RC 192, AC 45, Riser Platform A"
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-gray-900 placeholder-gray-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-700 mb-1 font-bold tracking-wider">PHYSICAL TYPE</label>
              <select
                value={physicalType}
                onChange={(e) => setPhysicalType(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-gray-900"
              >
                <option value="Buried">Buried</option>
                <option value="Aerial">Aerial</option>
                <option value="Cased">Cased</option>
                <option value="Crossing">Crossing</option>
                <option value="Riser">Riser</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-700 mb-1 font-bold tracking-wider">POLICY</label>
              <select
                value={policy}
                onChange={(e) => setPolicy(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-gray-900"
              >
                <option value="Match">Match</option>
                <option value="Review">Review</option>
                <option value="Override">Override</option>
              </select>
            </div>
          </div>

          {/* SECTION TYPE */}
          <div>
            <label className="block text-xs text-gray-700 mb-1 font-bold tracking-wider">SECTION TYPE</label>
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
            <label className="block text-xs text-gray-700 mb-1 font-bold tracking-wider">COORDINATES (MANUAL, FOR THE MAP)</label>
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

          {/* NOTES */}
          <div>
            <label className="block text-xs text-gray-700 mb-1 font-bold tracking-wider">NOTES (OPTIONAL)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Mahakam river crossing, 8 m depth, near KP 12.3"
              className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-gray-900 min-h-[80px] placeholder-gray-400"
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>
        )}

        {/* ACTIONS */}
        <div className="flex justify-end gap-3 mt-8 pt-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-white text-sm font-medium text-gray-600 hover:bg-gray-50 border border-gray-300 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-colors disabled:opacity-50 disabled:bg-gray-400 shadow-sm"
          >
            Save section
          </button>
        </div>

    </Modal>
  );
}
