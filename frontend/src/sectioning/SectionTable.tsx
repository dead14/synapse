import { FiEdit3, FiTrash2 } from 'react-icons/fi';
import { formatLogDistance } from './gwPosition';
import { resolveSectionDistances, type MatchingSection, type SectionBoundary } from '../wizard/matchingSections';

interface Props {
  sections: MatchingSection[];
  boundaries: SectionBoundary[];
  sectionTypes: Array<[string, string]>;
  onEdit: (sectionId: string) => void;
  onDelete: (sectionId: string) => void;
}

const policyLabel: Record<MatchingSection['policy'], string> = {
  MATCH: 'Match',
  REVIEW: 'Review',
  BYPASS: 'Exclude',
};

export default function SectionTable({ sections, boundaries, sectionTypes, onEdit, onDelete }: Props) {
  const typeLabel = new Map(sectionTypes);
  const boundaryByKey = new Map(boundaries.map((boundary) => [boundary.key, boundary]));

  return (
    <section className="sectioning-light-section-table" aria-labelledby="section-table-title">
      <header>
        <div>
          <p>SECTION REGISTER</p>
          <h3 id="section-table-title">Section list</h3>
        </div>
        <span>{sections.length} section</span>
      </header>

      {sections.length === 0 ? (
        <p className="sectioning-light-section-table__empty">No sections yet. Click two NEW GW markers on the line to begin.</p>
      ) : (
        <div className="sectioning-light-section-table__scroll">
          <table>
            <thead>
              <tr><th>Section</th><th>GW bounds</th><th>Log distance NEW</th><th>Length</th><th>Type</th><th>Policy</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {sections.map((section) => {
                const resolved = resolveSectionDistances(section, boundaries);
                // Derived first, same as resolveSectionDistances: a boundary the
                // current locks produce supersedes whatever the section stored.
                const start = boundaryByKey.get(section.startGwKey) ?? section.startBoundary;
                const end = boundaryByKey.get(section.endGwKey) ?? section.endBoundary;
                const length = (resolved.newEndM ?? 0) - (resolved.newStartM ?? 0);
                return (
                  <tr key={section.id}>
                    <th scope="row" data-label="Section">{section.name}</th>
                    <td data-label="GW bounds">
                      {start ? `${start.side} ${start.label}` : '-'} {'->'} {end ? `${end.side} ${end.label}` : '-'}
                    </td>
                    <td data-label="Log distance NEW" className="sectioning-light-section-table__number">{formatLogDistance(resolved.newStartM)} {'->'} {formatLogDistance(resolved.newEndM)}</td>
                    <td data-label="Length" className="sectioning-light-section-table__number">{length.toFixed(3)} m</td>
                    <td data-label="Type">{typeLabel.get(section.sectionType ?? 'UNCLASSIFIED') ?? 'Unclassified'}</td>
                    <td data-label="Policy"><span className={`sectioning-light-section-table__policy is-${section.policy.toLowerCase()}`}>{policyLabel[section.policy]}</span></td>
                    <td data-label="Actions">
                      <div className="sectioning-light-section-table__actions">
                        <button type="button" onClick={() => onEdit(section.id)} aria-label={`Edit ${section.name}`}><FiEdit3 /> Edit</button>
                        <button type="button" className="is-danger" onClick={() => onDelete(section.id)} aria-label={`Delete ${section.name}`}><FiTrash2 /> Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
