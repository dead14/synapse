import { useMemo } from 'react';

import { depthHistogram, type Severity } from '../../lib/corrosion/analytics';
import type { CorrosionFeature } from '../../lib/corrosion/analysis';
import { SEVERITY_LABEL, SEVERITY_ORDER_VARS, SEVERITY_VAR, VizFrame, niceTicks, useVizTooltip } from './vizPrimitives';

interface Props {
  features: CorrosionFeature[];
  binPct?: number;
}

/** Which severity band a depth bin sits in, so the bar carries the same meaning as the chips. */
function bandOf(from: number): Severity {
  if (from >= 60) return 'critical';
  if (from >= 40) return 'high';
  if (from >= 20) return 'medium';
  return 'low';
}

const PLOT = { width: 640, height: 200, left: 40, right: 12, top: 10, bottom: 30 };

/**
 * Wall-loss population in %WT bands.
 *
 * Bars are coloured by severity band rather than by magnitude, so the colour
 * says the same thing here as it does in the queue and the section profile.
 * The 80 %WT line marks where B31G stops being applicable.
 */
export default function DepthHistogram({ features, binPct = 10 }: Props) {
  const bins = useMemo(() => depthHistogram(features, binPct), [features, binPct]);
  const { frameRef, show, hide, node } = useVizTooltip();

  const total = bins.reduce((sum, bin) => sum + bin.count, 0);
  const max = Math.max(1, ...bins.map((bin) => bin.count));
  const ticks = niceTicks(max);
  const axisMax = Math.max(max, ticks[ticks.length - 1]);

  const plotWidth = PLOT.width - PLOT.left - PLOT.right;
  const plotHeight = PLOT.height - PLOT.top - PLOT.bottom;
  const slot = plotWidth / Math.max(1, bins.length);
  // A 2px surface gap separates adjacent bars — no borders on the marks.
  const barWidth = Math.max(2, slot - 2);

  const yOf = (value: number) => PLOT.top + plotHeight - (value / axisMax) * plotHeight;
  const limitX = PLOT.left + (80 / 100) * plotWidth;

  if (total === 0) {
    return <p className="viz-note">No depth values were reported on this run.</p>;
  }

  return (
    <VizFrame
      frameRef={frameRef}
      tooltip={node}
      /* Bars carry status colour, so the band always has a written label too. */
      legend={SEVERITY_ORDER_VARS.map(([severity, color]) => ({
        label: SEVERITY_LABEL[severity],
        color,
        shape: 'square' as const,
      }))}
      note={
        <>
          {total.toLocaleString()} metal-loss features with a reported depth. Beyond{' '}
          <strong>80 %WT</strong> the B31G method no longer applies, so anything to the right of that
          line needs a different assessment route.
        </>
      }
    >
      <svg
        className="viz-plot"
        viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
        role="img"
        aria-label="Metal loss count by wall-loss depth band"
        preserveAspectRatio="xMidYMid meet"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="viz-grid-line" x1={PLOT.left} x2={PLOT.width - PLOT.right} y1={yOf(tick)} y2={yOf(tick)} />
            <text className="viz-tick" x={PLOT.left - 6} y={yOf(tick) + 3} textAnchor="end">{tick}</text>
          </g>
        ))}

        {bins.map((bin, index) => {
          const height = (bin.count / axisMax) * plotHeight;
          const x = PLOT.left + index * slot + (slot - barWidth) / 2;
          const band = bandOf(bin.from);
          return (
            <g key={bin.label}>
              <rect
                className="viz-bar"
                x={x}
                y={yOf(bin.count)}
                width={barWidth}
                height={Math.max(bin.count > 0 ? 2 : 0, height)}
                rx={3}
                fill={SEVERITY_VAR[band]}
              />
              <rect
                className="viz-hit"
                x={PLOT.left + index * slot}
                y={PLOT.top}
                width={slot}
                height={plotHeight}
                onMouseMove={(event) => show(event, `${bin.label} %WT`, [
                  { label: 'Features', value: bin.count.toLocaleString() },
                  { label: 'Share', value: `${((bin.count / total) * 100).toFixed(1)}%` },
                  { label: 'Band', value: SEVERITY_LABEL[band] },
                ])}
                onMouseLeave={hide}
              />
              {index % 2 === 0 && (
                <text className="viz-tick" x={PLOT.left + index * slot + slot / 2} y={PLOT.height - 12} textAnchor="middle">
                  {bin.from}
                </text>
              )}
            </g>
          );
        })}

        <line className="viz-threshold" x1={limitX} x2={limitX} y1={PLOT.top} y2={PLOT.top + plotHeight} />
        <text className="viz-threshold-label" x={limitX - 4} y={PLOT.top + 10} textAnchor="end">80 %WT</text>

        <line className="viz-axis-line" x1={PLOT.left} x2={PLOT.width - PLOT.right} y1={PLOT.top + plotHeight} y2={PLOT.top + plotHeight} />
        <text className="viz-axis-title" x={PLOT.left} y={PLOT.height - 1}>Depth [%WT]</text>
      </svg>
    </VizFrame>
  );
}
