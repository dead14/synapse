import { useMemo } from 'react';

import { SEVERITY_ORDER, severityBySection } from '../../lib/corrosion/analytics';
import type { CorrosionFeature } from '../../lib/corrosion/analysis';
import { SEVERITY_LABEL, SEVERITY_VAR, VizFrame, useVizTooltip } from './vizPrimitives';

interface Props {
  features: CorrosionFeature[];
  limit?: number;
}

/**
 * Severity mix per section, as proportional stacked bars.
 *
 * Only rendered once the engineer sectioned the line during alignment —
 * otherwise every feature lands in a single bucket and the chart says nothing.
 * A 2px surface gap separates the segments; no borders on the marks.
 */
export default function SegmentSeverity({ features, limit = 8 }: Props) {
  const rows = useMemo(() => severityBySection(features).slice(0, limit), [features, limit]);
  const { frameRef, show, hide, node } = useVizTooltip();

  if (rows.length === 0) {
    return <p className="viz-note">No sectioned features on this run.</p>;
  }

  const worst = rows.reduce((current, row) => (row.criticalDensity > current.criticalDensity ? row : current), rows[0]);
  const largest = rows.reduce((current, row) => (row.total > current.total ? row : current), rows[0]);

  return (
    <VizFrame
      frameRef={frameRef}
      tooltip={node}
      legend={SEVERITY_ORDER.map((severity) => ({
        label: SEVERITY_LABEL[severity],
        color: SEVERITY_VAR[severity],
        shape: 'square' as const,
      }))}
      note={
        worst.section === largest.section ? (
          <>
            <strong>{worst.section}</strong> is both the largest population (
            {largest.total.toLocaleString()}) and the most severe — {(worst.criticalDensity * 100).toFixed(0)}%
            of its features are high or critical. It is the clearest place to start.
          </>
        ) : (
          <>
            <strong>{worst.section}</strong> carries the highest share of high and critical features (
            {(worst.criticalDensity * 100).toFixed(0)}%), while <strong>{largest.section}</strong> holds
            the largest population ({largest.total.toLocaleString()}). Density matters more than count
            when deciding where to dig.
          </>
        )
      }
    >
      <div className="seg-bars">
        {rows.map((row) => (
          <div key={row.section} className="seg-bars__row">
            <span className="seg-bars__label" title={row.section}>{row.section}</span>
            <div className="seg-bars__track" role="img" aria-label={`${row.section}: ${SEVERITY_ORDER.map((s) => `${row.counts[s]} ${SEVERITY_LABEL[s].toLowerCase()}`).join(', ')}`}>
              {SEVERITY_ORDER.map((severity) => {
                const count = row.counts[severity];
                if (count === 0) return null;
                return (
                  <span
                    key={severity}
                    className="seg-bars__seg"
                    style={{
                      width: `${(count / row.total) * 100}%`,
                      background: SEVERITY_VAR[severity],
                    }}
                    onMouseMove={(event) => show(event, row.section, [
                      { label: SEVERITY_LABEL[severity], value: count.toLocaleString() },
                      { label: 'Share', value: `${((count / row.total) * 100).toFixed(1)}%` },
                      { label: 'Section total', value: row.total.toLocaleString() },
                    ])}
                    onMouseLeave={hide}
                  />
                );
              })}
            </div>
            <span className="seg-bars__total">{row.total.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </VizFrame>
  );
}
