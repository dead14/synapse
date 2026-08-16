/**
 * The 5×5 matrix, and the level tags that share its colours.
 *
 * §12.6.2 calls a matrix "a very effective way of communicating the distribution
 * of risks throughout a plant or process unit without numerical values", with
 * the highest risk toward the upper right. That is what this draws: probability
 * ascending upward, consequence ascending rightward, and the count of units in
 * each cell.
 *
 * Colour is never the only signal. Every cell carries its level in a title
 * attribute and the legend spells the four levels out, because a matrix read
 * only by hue is unreadable to a quarter of the engineers who will open it.
 */

import { RISK_LEVELS, RISK_MATRIX } from '../../lib/rbi/api580';
import type { RbiUnitResult, RiskLevel } from '../../lib/rbi/types';

const LEVEL_CLASS: Record<RiskLevel, string> = {
  Low: 'rbi-cell rbi-cell--low',
  Medium: 'rbi-cell rbi-cell--medium',
  'Medium high': 'rbi-cell rbi-cell--medium-high',
  High: 'rbi-cell rbi-cell--high',
};

export function RiskTag({ level }: { level: RiskLevel }) {
  return <span className={`${LEVEL_CLASS[level]} rbi-tag`}>{level}</span>;
}

export default function RiskMatrix({
  units,
  onSelect,
}: {
  units: readonly RbiUnitResult[];
  onSelect?: (unit: RbiUnitResult) => void;
}) {
  const byLevel: Record<RiskLevel, number> = { Low: 0, Medium: 0, 'Medium high': 0, High: 0 };
  for (const unit of units) byLevel[unit.riskLevel] += 1;

  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table className="rbi-matrix">
          <caption className="sr-only">
            API 580 five by five risk matrix. Probability of failure down the rows, consequence of failure
            across the columns.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="rbi-matrix__corner">P \ C</th>
              {[1, 2, 3, 4, 5].map((consequence) => (
                <th key={consequence} scope="col">{consequence}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[5, 4, 3, 2, 1].map((probability) => (
              <tr key={probability}>
                <th scope="row">{probability}</th>
                {[1, 2, 3, 4, 5].map((consequence) => {
                  const level = RISK_MATRIX[probability - 1][consequence - 1];
                  const occupants = units.filter((unit) => (
                    unit.probability.category === probability
                    && unit.consequence.category === consequence
                  ));
                  const label = `Probability ${probability}, consequence ${consequence}: ${level}`
                    + (occupants.length > 0
                      ? `. ${occupants.length} unit(s): ${occupants.map((unit) => unit.label).join(', ')}`
                      : '');
                  return (
                    <td
                      key={consequence}
                      className={LEVEL_CLASS[level]}
                      title={label}
                      onClick={occupants.length > 0 && onSelect
                        ? () => onSelect(occupants[0])
                        : undefined}
                      style={occupants.length > 0 && onSelect ? { cursor: 'pointer' } : undefined}
                    >
                      {occupants.length > 0 ? occupants.length : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ds-row" style={{ marginTop: '0.75rem' }}>
        {RISK_LEVELS.map((level) => (
          <span key={level} className="ds-row" style={{ gap: '0.375rem' }}>
            <span className={`${LEVEL_CLASS[level]} rbi-swatch`} aria-hidden="true" />
            <span className="rbi-checklist__src">{level} · {byLevel[level]}</span>
          </span>
        ))}
      </div>
    </>
  );
}
