import React from 'react';
import { SectionDef } from './IliSectioningPage';
import { FiX } from 'react-icons/fi';

interface SectionListProps {
  sections: SectionDef[];
  totalLength: number;
  onDelete: (id: string) => void;
}

export default function SectionList({ sections, totalLength, onDelete }: SectionListProps) {
  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">
      <div className="px-6 py-3 border-b border-gray-200 flex justify-between items-center text-xs text-gray-500 font-bold tracking-widest bg-gray-50">
        <span>SECTION LIST ({sections.length})</span>
        <span className="normal-case font-mono">Total pipeline: <strong className="text-gray-800">{totalLength.toFixed(3)} m</strong></span>
      </div>
      
      <div className="flex-1 overflow-auto custom-scrollbar">
        <table className="w-full text-left text-xs font-mono">
          <thead className="sticky top-0 bg-gray-50 text-gray-500 border-b border-gray-200 uppercase tracking-wider shadow-sm z-10">
            <tr>
              <th className="px-6 py-3 font-semibold text-gray-700">Section Name</th>
              <th className="px-4 py-3 font-semibold text-gray-700">Type</th>
              <th className="px-4 py-3 font-semibold text-gray-700">Start GW</th>
              <th className="px-4 py-3 font-semibold text-gray-700">End GW</th>
              <th className="px-4 py-3 font-semibold text-gray-700">Start (M)</th>
              <th className="px-4 py-3 font-semibold text-gray-700">End (M)</th>
              <th className="px-4 py-3 font-semibold text-gray-700">Length (M)</th>
              <th className="px-4 py-3 font-semibold text-gray-700">Notes</th>
              <th className="px-4 py-3 font-semibold text-gray-700 text-center">Act</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sections.map(sec => (
              <tr key={sec.id} className="hover:bg-blue-50/50 text-gray-700 transition-colors">
                <td className="px-6 py-3 font-bold text-gray-900 flex items-center gap-2 uppercase">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getSectionColor(sec.type) }}></div>
                  {sec.name}
                </td>
                <td className="px-4 py-3">{sec.type}</td>
                <td className="px-4 py-3 font-medium text-gray-600">{sec.startGw}</td>
                <td className="px-4 py-3 font-medium text-gray-600">{sec.endGw}</td>
                <td className="px-4 py-3">{sec.startM.toFixed(2)}</td>
                <td className="px-4 py-3">{sec.endM.toFixed(2)}</td>
                <td className="px-4 py-3 font-medium text-blue-600">{sec.length.toFixed(2)}</td>
                <td className="px-4 py-3 text-gray-500 font-sans truncate max-w-[200px]" title={sec.notes}>
                  {sec.notes || '-'}
                </td>
                <td className="px-4 py-3 text-center">
                  <button 
                    onClick={() => onDelete(sec.id)}
                    className="text-gray-400 hover:text-red-500 p-1 rounded hover:bg-red-50 transition-colors"
                  >
                    <FiX size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {sections.length === 0 && (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-gray-600 font-sans italic">
                  Belum ada section. Klik dua GW di skema untuk mulai.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Helper (duplicated from Schematic for simplicity, usually put in a shared utils file)
function getSectionColor(type: string) {
  switch (type) {
    case 'RL': return '#2dd4bf';
    case 'AL': return '#60a5fa';
    case 'RIS': return '#ef4444';
    case 'ROC': return '#fb923c';
    case 'BUR': return '#a3e635';
    case 'CAS': return '#94a3b8';
    default: return '#c084fc';
  }
}
