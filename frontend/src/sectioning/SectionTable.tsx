import { FiEdit3, FiTrash2 } from 'react-icons/fi';
import { formatLogDistance } from './gwPosition';
import { resolveSectionDistances, type LockedGwPair, type MatchingSection } from '../wizard/matchingSections';

interface Props {
  sections: MatchingSection[];
  lockedGws: LockedGwPair[];
  sectionTypes: Array<[string, string]>;
  onEdit: (sectionId: string) => void;
  onDelete: (sectionId: string) => void;
}

const policyLabel: Record<MatchingSection['policy'], string> = {
  MATCH: 'Match',
  REVIEW: 'Review',
  BYPASS: 'Exclude',
};

export default function SectionTable({ sections, lockedGws, sectionTypes, onEdit, onDelete }: Props) {
  const typeLabel = new Map(sectionTypes);
  const pairByKey = new Map(lockedGws.map((pair) => [pair.key, pair]));

  return (
    <section className="sectioning-light-section-table" aria-labelledby="section-table-title">
      <header>
        <div>
          <p>SECTION REGISTER</p>
          <h3 id="section-table-title">Daftar section</h3>
        </div>
        <span>{sections.length} section</span>
      </header>

      {sections.length === 0 ? (
        <p className="sectioning-light-section-table__empty">Belum ada section. Klik dua marker GW NEW pada jalur untuk mulai.</p>
      ) : (
        <div className="sectioning-light-section-table__scroll">
          <table>
            <thead>
              <tr><th>Section</th><th>Batas GW NEW</th><th>Log distance NEW</th><th>Panjang</th><th>Jenis</th><th>Policy</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {sections.map((section) => {
                const resolved = resolveSectionDistances(section, lockedGws);
                const start = pairByKey.get(section.startGwKey);
                const end = pairByKey.get(section.endGwKey);
                const length = (resolved.newEndM ?? 0) - (resolved.newStartM ?? 0);
                return (
                  <tr key={section.id}>
                    <th scope="row" data-label="Section">{section.name}</th>
                    <td data-label="Batas GW NEW">{start?.newId ?? '-'} {'->'} {end?.newId ?? '-'}</td>
                    <td data-label="Log distance NEW" className="sectioning-light-section-table__number">{formatLogDistance(resolved.newStartM)} {'->'} {formatLogDistance(resolved.newEndM)}</td>
                    <td data-label="Panjang" className="sectioning-light-section-table__number">{length.toFixed(3)} m</td>
                    <td data-label="Jenis">{typeLabel.get(section.sectionType ?? 'UNCLASSIFIED') ?? 'Unclassified'}</td>
                    <td data-label="Policy"><span className={`sectioning-light-section-table__policy is-${section.policy.toLowerCase()}`}>{policyLabel[section.policy]}</span></td>
                    <td data-label="Aksi">
                      <div className="sectioning-light-section-table__actions">
                        <button type="button" onClick={() => onEdit(section.id)} aria-label={`Edit ${section.name}`}><FiEdit3 /> Edit</button>
                        <button type="button" className="is-danger" onClick={() => onDelete(section.id)} aria-label={`Hapus ${section.name}`}><FiTrash2 /> Hapus</button>
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
