import { FiCheck, FiEdit3, FiX } from 'react-icons/fi';
import { formatLogDistance } from './gwPosition';
import type { SpatialFeature } from './types';
import type { MatchingSection } from '../wizard/matchingSections';

export interface SectionDraft {
  name: string;
  sectionType: string;
  policy: MatchingSection['policy'];
}

interface Props {
  draft: SectionDraft;
  selectedGws: SpatialFeature[];
  sectionTypes: Array<[string, string]>;
  isEditing: boolean;
  onDraftChange: (patch: Partial<SectionDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
}

function boundarySummary(selectedGws: SpatialFeature[]) {
  if (selectedGws.length === 0) return 'Click the first NEW GW on the line.';
  if (selectedGws.length === 1) return `Start: ${selectedGws[0].id}. Select the end GW.`;
  const [start, end] = selectedGws;
  return `${start.id} -> ${end.id}. Length ${(end.dist - start.dist).toFixed(3)} m`;
}

export default function SectionComposer({
  draft,
  selectedGws,
  sectionTypes,
  isEditing,
  onDraftChange,
  onSave,
  onCancel,
}: Props) {
  const readyToSave = selectedGws.length === 2 && draft.name.trim().length > 0;

  return (
    <section className="sectioning-light-composer" aria-labelledby="section-composer-title">
      <header>
        <div>
          <p>{isEditing ? 'EDIT SECTION' : 'NEW SECTION'}</p>
          <h3 id="section-composer-title">{isEditing ? 'Update the section from the selected welds' : 'Select two NEW GWs to create a section'}</h3>
        </div>
        <button type="button" className="sectioning-light-composer__dismiss" onClick={onCancel} aria-label="Cancel section entry">
          <FiX /> Cancel
        </button>
      </header>

      <div className="sectioning-light-composer__boundary" role="status">{boundarySummary(selectedGws)}</div>
      {selectedGws.length > 0 && (
        <div className="sectioning-light-composer__log-distance" aria-label="Section boundary log distances">
          {selectedGws.map((gw) => <span key={`${gw.id}-${gw.dist}`}><b>{gw.id}</b> · Log distance NEW <strong>{formatLogDistance(gw.dist)}</strong></span>)}
        </div>
      )}

      <div className="sectioning-light-composer__fields">
        <label>
          Section name
          <input value={draft.name} onChange={(event) => onDraftChange({ name: event.target.value })} />
        </label>
        <label>
          Physical type
          <select value={draft.sectionType} onChange={(event) => onDraftChange({ sectionType: event.target.value })}>
            {sectionTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          Policy
          <select value={draft.policy} onChange={(event) => onDraftChange({ policy: event.target.value as MatchingSection['policy'] })}>
            <option value="MATCH">Match</option>
            <option value="REVIEW">Review</option>
            <option value="BYPASS">Exclude</option>
          </select>
        </label>
        <button type="button" className="sectioning-light-composer__save" disabled={!readyToSave} onClick={onSave}>
          {isEditing ? <FiEdit3 /> : <FiCheck />}
          {isEditing ? 'Save changes' : 'Create section'}
        </button>
      </div>
    </section>
  );
}
