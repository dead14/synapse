import { useMemo } from 'react';

import { clockRose, orientationVerdict } from '../../lib/corrosion/analytics';
import type { CorrosionFeature } from '../../lib/corrosion/analysis';
import { VizFrame, useVizTooltip } from './vizPrimitives';

interface Props {
  features: CorrosionFeature[];
}

const SIZE = 260;
const CENTRE = SIZE / 2;
const INNER = 34;
const OUTER = 112;

/** Clock hour → angle, with 12 o'clock at the top and hours running clockwise. */
function angleOf(hour: number): number {
  return (hour / 12) * Math.PI * 2 - Math.PI / 2;
}

function sectorPath(hour: number, innerR: number, outerR: number): string {
  // A 2px gap between sectors, expressed as a small angular inset.
  const gap = 0.02;
  const start = angleOf(hour) + gap;
  const end = angleOf(hour + 1) - gap;
  const x1 = CENTRE + innerR * Math.cos(start);
  const y1 = CENTRE + innerR * Math.sin(start);
  const x2 = CENTRE + outerR * Math.cos(start);
  const y2 = CENTRE + outerR * Math.sin(start);
  const x3 = CENTRE + outerR * Math.cos(end);
  const y3 = CENTRE + outerR * Math.sin(end);
  const x4 = CENTRE + innerR * Math.cos(end);
  const y4 = CENTRE + innerR * Math.sin(end);
  return [
    `M ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${outerR} ${outerR} 0 0 1 ${x3} ${y3}`,
    `L ${x4} ${y4}`,
    `A ${innerR} ${innerR} 0 0 0 ${x1} ${y1}`,
    'Z',
  ].join(' ');
}

const VERDICT_COPY: Record<ReturnType<typeof orientationVerdict>['dominant'], (v: ReturnType<typeof orientationVerdict>) => React.ReactNode> = {
  'internal-invert': (v) => (
    <>
      <strong>Internal loss concentrated along the invert.</strong>{' '}
      {(v.invertShare * 100).toFixed(0)}% of internal metal loss sits between 4 and 8 o&apos;clock —
      the signature of water dropout and under-deposit corrosion in the low part of the bore.
      Worth checking the dewatering and inhibitor regime rather than the coating.
    </>
  ),
  'external-crown': (v) => (
    <>
      <strong>External loss concentrated on the crown.</strong>{' '}
      {(v.crownShare * 100).toFixed(0)}% of external metal loss sits between 10 and 2 o&apos;clock,
      which points at coating disbondment or CP shielding on the upper surface rather than at
      anything happening inside the pipe.
    </>
  ),
  mixed: (v) => (
    <>
      <strong>No single orientation dominates.</strong> Internal{' '}
      {(v.internalShare * 100).toFixed(0)}% / external {(v.externalShare * 100).toFixed(0)}%, spread
      around the circumference — read the density and section profiles for where to look instead.
    </>
  ),
  insufficient: () => (
    <>
      <strong>Too few oriented features to draw a conclusion.</strong> At least 20 metal-loss
      features with both a clock position and a surface are needed before the orientation says
      anything.
    </>
  ),
};

/**
 * Metal loss by clock position, split internal versus external.
 *
 * This is the chart that tells an engineer *which mechanism* is running. Two
 * series only, so hue stays inside the validated pair, and each ring is labelled
 * in the legend rather than relying on colour alone.
 */
export default function ClockRose({ features }: Props) {
  const sectors = useMemo(() => clockRose(features), [features]);
  const verdict = useMemo(() => orientationVerdict(features), [features]);
  const { frameRef, show, hide, node } = useVizTooltip();

  const max = Math.max(1, ...sectors.map((sector) => sector.total));
  const oriented = sectors.reduce((sum, sector) => sum + sector.total, 0);

  if (oriented === 0) {
    return <p className="viz-note">No clock positions were reported on this run.</p>;
  }

  return (
    <VizFrame
      frameRef={frameRef}
      tooltip={node}
      legend={[
        { label: 'Internal', color: 'var(--viz-series-1)', shape: 'square' },
        { label: 'External', color: 'var(--viz-series-2)', shape: 'square' },
      ]}
      note={VERDICT_COPY[verdict.dominant](verdict)}
    >
      <svg
        className="viz-plot"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label="Metal loss count by clock position, split internal versus external"
        style={{ maxHeight: '17rem' }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Reference rings so sector length is readable without a value on each */}
        {[0.5, 1].map((fraction) => (
          <circle
            key={fraction}
            className="viz-grid-line"
            cx={CENTRE}
            cy={CENTRE}
            r={INNER + (OUTER - INNER) * fraction}
            fill="none"
          />
        ))}

        {sectors.map((sector) => {
          const totalR = INNER + ((OUTER - INNER) * sector.total) / max;
          const internalShare = sector.total > 0 ? sector.internal / sector.total : 0;
          const internalR = INNER + (totalR - INNER) * internalShare;
          return (
            <g key={sector.hour}>
              {sector.external > 0 && (
                <path d={sectorPath(sector.hour, internalR, totalR)} fill="var(--viz-series-2)" />
              )}
              {sector.internal > 0 && (
                <path d={sectorPath(sector.hour, INNER, internalR)} fill="var(--viz-series-1)" />
              )}
              {/* Hit area spans the full radius so the target is never pinpoint */}
              <path
                className="viz-hit"
                d={sectorPath(sector.hour, INNER, OUTER + 14)}
                onMouseMove={(event) => show(event, `${sector.hour === 0 ? 12 : sector.hour} o'clock`, [
                  { label: 'Internal', value: sector.internal.toLocaleString() },
                  { label: 'External', value: sector.external.toLocaleString() },
                  { label: 'Total', value: sector.total.toLocaleString() },
                ])}
                onMouseLeave={hide}
              />
            </g>
          );
        })}

        {[0, 3, 6, 9].map((hour) => {
          const angle = angleOf(hour + 0.5);
          return (
            <text
              key={hour}
              className="viz-tick"
              x={CENTRE + (OUTER + 16) * Math.cos(angle)}
              y={CENTRE + (OUTER + 16) * Math.sin(angle) + 3}
              textAnchor="middle"
            >
              {hour === 0 ? '12' : hour}
            </text>
          );
        })}

        <text className="viz-tick" x={CENTRE} y={CENTRE + 3} textAnchor="middle">
          {oriented.toLocaleString()}
        </text>
      </svg>
    </VizFrame>
  );
}
