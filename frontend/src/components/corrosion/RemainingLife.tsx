import { useMemo } from 'react';

import { remainingLifeRanking } from '../../lib/corrosion/analytics';
import type { CorrosionFeature } from '../../lib/corrosion/analysis';
import { Callout, MathInline } from '../ds';
import { SEVERITY_VAR, SeverityChip, VizFrame, useVizTooltip } from './vizPrimitives';
import { maxBy } from '../../utils/numericRange.ts';

interface Props {
  features: CorrosionFeature[];
  limitPct?: number;
  limit?: number;
}

/**
 * Growing features ranked by how soon they reach the wall-loss limit.
 *
 * Only features with a measurable positive growth rate appear — extrapolating a
 * flat or negative rate would invent a date, so those are excluded and counted
 * instead.
 */
export default function RemainingLife({ features, limitPct = 80, limit = 12 }: Props) {
  const ranking = useMemo(() => remainingLifeRanking(features, limitPct), [features, limitPct]);
  const { frameRef, show, hide, node } = useVizTooltip();

  const rows = ranking.slice(0, limit);
  const nonGrowing = features.length - ranking.length;

  if (rows.length === 0) {
    return (
      <Callout tone="neutral">
        No feature has a positive measured growth rate, so no remaining life can be projected.
        Either the runs are too close together to resolve growth, or the reported depths did not
        increase.
      </Callout>
    );
  }

  const worstYears = maxBy(rows, (entry) => entry.years, 1);

  return (
    <VizFrame
      frameRef={frameRef}
      tooltip={node}
      note={
        <>
          Projected at each feature&apos;s own measured rate to <strong>{limitPct} %WT</strong>:{' '}
          {/* The straight line the caption describes, written as the straight
              line it is. The denominator is what makes the caveat below it
              matter — a rate measured across two runs, divided into a distance
              to a limit, and nothing in that quotient is a corrosion model. */}
          <MathInline
            tex={`t = \\frac{${limitPct}\\,\\%\\mathrm{WT} - d_{\\%}}{\\dot{d}_{\\%}}`}
            label="remaining years is the distance to the limit over the measured depth growth rate"
          />
          . This is a straight-line extrapolation of two runs, not a corrosion model —{' '}
          {nonGrowing.toLocaleString()} feature(s) are excluded because they are not measurably growing.
        </>
      }
    >
      <div className="life-rows">
        {rows.map((entry) => {
          const label = entry.years < 1 ? '< 1 yr' : `${entry.years.toFixed(1)} yr`;
          return (
            <div key={entry.feature.sourceKey} className="life-rows__row">
              <span className="life-rows__id" title={entry.feature.featureId}>{entry.feature.featureId}</span>
              <span className="life-rows__kp">
                {entry.feature.distanceM === null ? '—' : `KP ${(entry.feature.distanceM / 1000).toFixed(3)}`}
              </span>
              <div className="life-rows__track">
                <span
                  className="life-rows__bar"
                  style={{
                    width: `${Math.max(2, (entry.years / worstYears) * 100)}%`,
                    background: SEVERITY_VAR[entry.severity],
                  }}
                  onMouseMove={(event) => show(event, entry.feature.featureId, [
                    { label: 'Remaining life', value: label },
                    { label: 'Depth now', value: entry.feature.depthPct === null ? '—' : `${entry.feature.depthPct.toFixed(1)} %WT` },
                    { label: 'Growth', value: entry.feature.depthGrowthPctWtPerYear === null ? '—' : `${entry.feature.depthGrowthPctWtPerYear.toFixed(3)} %WT/yr` },
                    { label: 'ERF', value: entry.feature.erf === null ? '—' : entry.feature.erf.toFixed(3) },
                  ])}
                  onMouseLeave={hide}
                />
              </div>
              <span className="life-rows__years">{label}</span>
              <SeverityChip severity={entry.severity} />
            </div>
          );
        })}
      </div>
    </VizFrame>
  );
}
