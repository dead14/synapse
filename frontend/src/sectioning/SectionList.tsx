import React from 'react';
import type { SectionDef } from './types';
import { FiX } from 'react-icons/fi';

interface SectionListProps {
  sections: SectionDef[];
  totalLength: number;
  onDelete: (id: string) => void;
}

export default function SectionList({ sections, totalLength, onDelete }: SectionListProps) {
  return (
    <div className="section-register-list">
      <div className="section-register-list__summary">{sections.length} section <span>of {totalLength.toFixed(0)} m pipeline</span></div>
      <div className="section-register-list__items">
        {sections.map(sec => (
          <article key={sec.id} className="section-register-item">
            <div className="section-register-item__marker" style={{ backgroundColor: getSectionColor(sec.type) }} />
            <div className="section-register-item__body">
              <div className="section-register-item__title"><strong>{sec.name}</strong><span>{sec.type}</span></div>
              <div className="section-register-item__range">
                <span>{sec.physicalType || 'Buried'}</span>
                <span className="sectioning-register-item__arrow">·</span>
                <span>{sec.policy || 'Match'}</span>
              </div>
              <div className="section-register-item__range"><span>{sec.startGw}</span><span className="section-register-item__arrow">to</span><span>{sec.endGw}</span></div>
              <div className="section-register-item__meta">{sec.startM.toFixed(2)} - {sec.endM.toFixed(2)} m <b>{sec.length.toFixed(2)} m</b></div>
              {sec.notes && <p title={sec.notes}>{sec.notes}</p>}
            </div>
            <button type="button" aria-label={`Delete ${sec.name}`} onClick={() => onDelete(sec.id)} className="section-register-item__delete"><FiX size={14} /></button>
          </article>
        ))}
        {sections.length === 0 && <div className="section-register-list__empty"><strong>No sections yet</strong><span>Click two GW markers on the master line to begin.</span></div>}
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
