import { useMemo, useState } from 'react';
import { FiChevronDown } from 'react-icons/fi';

import { riskRanking } from '../../lib/corrosion/analytics';
import type { CorrosionFeature } from '../../lib/corrosion/analysis';
import { Badge, Button } from '../ds';
import { SeverityChip } from './vizPrimitives';

interface Props {
  features: CorrosionFeature[];
  pageSize?: number;
}

function fixed(value: number | null, digits = 2): string {
  return value === null ? '—' : value.toFixed(digits);
}

/**
 * Features ordered worst-first.
 *
 * The composite score orders the queue but is deliberately not shown as a
 * number — a made-up index invites being quoted. Each row carries the plain
 * drivers that pushed it up instead, so the ranking can be argued with.
 */
export default function ReviewQueue({ features, pageSize = 25 }: Props) {
  const ranking = useMemo(() => riskRanking(features), [features]);
  const [visible, setVisible] = useState(pageSize);

  const criticalCount = ranking.filter((entry) => entry.severity === 'critical').length;

  if (ranking.length === 0) {
    return <p className="viz-note">No metal loss on this run.</p>;
  }

  return (
    <div className="ds-stack ds-stack--sm">
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <p className="viz-note">
          Ranked by depth, ERF, measured growth, and projected remaining life. The order is a
          starting point for review, not a decision.
        </p>
        {criticalCount > 0 && <Badge tone="danger">{criticalCount.toLocaleString()} critical</Badge>}
      </div>

      <div className="ds-table-wrap" style={{ maxHeight: '32rem' }}>
        <table className="ds-table">
          <thead>
            <tr>
              <th style={{ width: '2.5rem' }}>#</th>
              <th>Feature</th>
              <th className="ds-table__num">KP</th>
              <th className="ds-table__num">Depth</th>
              <th className="ds-table__num">Growth</th>
              <th className="ds-table__num">ERF</th>
              <th className="ds-table__num">Life</th>
              <th>Severity</th>
              <th>Why it is here</th>
            </tr>
          </thead>
          <tbody>
            {ranking.slice(0, visible).map((entry, index) => (
              <tr key={entry.feature.sourceKey} className={entry.severity === 'critical' ? 'is-danger' : undefined}>
                <td className="ds-table__num">{index + 1}</td>
                <th scope="row">
                  {entry.feature.featureId}
                  <span style={{ display: 'block', color: 'var(--viz-muted)', fontWeight: 400 }}>
                    {entry.feature.section !== '-' ? entry.feature.section : entry.feature.featureType}
                  </span>
                </th>
                <td className="ds-table__num">
                  {entry.feature.distanceM === null ? '—' : (entry.feature.distanceM / 1000).toFixed(3)}
                </td>
                <td className="ds-table__num">{fixed(entry.feature.depthPct, 1)}</td>
                <td className="ds-table__num">{fixed(entry.feature.depthGrowthPctWtPerYear, 3)}</td>
                <td className="ds-table__num">{fixed(entry.feature.erf, 3)}</td>
                <td className="ds-table__num">
                  {entry.remainingLife === null ? '—' : entry.remainingLife < 1 ? '<1' : entry.remainingLife.toFixed(1)}
                </td>
                <td><SeverityChip severity={entry.severity} /></td>
                <td>{entry.drivers.length > 0 ? entry.drivers.join(' · ') : 'Depth ranking only'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ranking.length > visible && (
        <div style={{ textAlign: 'center' }}>
          <Button
            size="sm"
            variant="secondary"
            startIcon={<FiChevronDown aria-hidden="true" />}
            onClick={() => setVisible((count) => count + pageSize)}
          >
            Show {Math.min(pageSize, ranking.length - visible).toLocaleString()} more of {ranking.length.toLocaleString()}
          </Button>
        </div>
      )}
    </div>
  );
}
