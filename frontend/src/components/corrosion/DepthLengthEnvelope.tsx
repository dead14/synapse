import { useMemo } from 'react';

import { severityOf } from '../../lib/corrosion/analytics';
import type { CorrosionFeature } from '../../lib/corrosion/analysis';
import { isMetalLoss } from '../../lib/corrosion/analysis';
import { evaluateModifiedB31g } from '../../lib/ffs/remainingStrength';
import { SEVERITY_LABEL, SEVERITY_ORDER_VARS, VizFrame, useVizTooltip } from './vizPrimitives';

export interface PipeGeometry {
  outerDiameterMm: number;
  smysMpa: number;
  designFactor: number;
  operatingPressureMpa: number;
}

interface Props {
  features: CorrosionFeature[];
  /** When absent the envelope is omitted — a curve needs OD and SMYS, and
   *  guessing a diameter would draw an acceptance line that is not this pipe's. */
  geometry?: PipeGeometry | null;
}

const PLOT = { width: 640, height: 260, left: 44, right: 14, top: 12, bottom: 34 };
const MAX_DEPTH_PCT = 100;

/**
 * Depth against length — the pair B31G actually assesses.
 *
 * Depth alone does not decide acceptability: a shallow but long defect can fail
 * where a deeper short one passes. When pipe geometry is supplied the Modified
 * B31G acceptance curve is drawn, and everything above it is not acceptable at
 * the stated operating pressure.
 */
export default function DepthLengthEnvelope({ features, geometry }: Props) {
  const { frameRef, show, hide, node } = useVizTooltip();

  const points = useMemo(
    () => features
      .filter((feature) => isMetalLoss(feature) && feature.depthPct !== null && feature.lengthMm !== null && feature.lengthMm > 0)
      .map((feature) => ({ feature, depth: feature.depthPct as number, length: feature.lengthMm as number })),
    [features],
  );

  const maxLength = useMemo(
    () => Math.max(50, ...points.map((point) => point.length)),
    [points],
  );

  /** Acceptable depth at each length, from the same B31G code the FFS step runs. */
  const envelope = useMemo(() => {
    if (!geometry) return null;
    const wall = points.find((point) => point.feature.wallMm !== null)?.feature.wallMm ?? null;
    if (wall === null || wall <= 0) return null;
    if (geometry.outerDiameterMm <= 2 * wall) return null;

    const curve: Array<{ length: number; depthPct: number }> = [];
    const steps = 60;
    for (let index = 0; index <= steps; index += 1) {
      const length = Math.max(1, (index / steps) * maxLength);
      // Bisect on depth for the deepest defect whose ERF still sits at 1.
      let low = 0.5;
      let high = 80;
      for (let iteration = 0; iteration < 24; iteration += 1) {
        const mid = (low + high) / 2;
        let erf = Infinity;
        try {
          erf = evaluateModifiedB31g({
            depth: (mid / 100) * wall,
            length,
            wallThickness: wall,
            outerDiameter: geometry.outerDiameterMm,
            smysMpa: geometry.smysMpa,
            designFactor: geometry.designFactor,
            operatingPressureMpa: geometry.operatingPressureMpa,
          }, 'smys11').erf;
        } catch {
          erf = Infinity;
        }
        if (erf > 1) high = mid;
        else low = mid;
      }
      curve.push({ length, depthPct: low });
    }
    return { curve, wall };
  }, [geometry, maxLength, points]);

  if (points.length === 0) {
    return <p className="viz-note">No feature on this run reports both a depth and a length.</p>;
  }

  const plotWidth = PLOT.width - PLOT.left - PLOT.right;
  const plotHeight = PLOT.height - PLOT.top - PLOT.bottom;
  const xOf = (length: number) => PLOT.left + (length / maxLength) * plotWidth;
  const yOf = (depthPct: number) => PLOT.top + plotHeight - (depthPct / MAX_DEPTH_PCT) * plotHeight;

  const outside = envelope
    ? points.filter((point) => {
      const nearest = envelope.curve.reduce((best, entry) => (
        Math.abs(entry.length - point.length) < Math.abs(best.length - point.length) ? entry : best
      ), envelope.curve[0]);
      return point.depth > nearest.depthPct;
    }).length
    : 0;

  return (
    <VizFrame
      frameRef={frameRef}
      tooltip={node}
      legend={SEVERITY_ORDER_VARS.map(([severity, color]) => ({
        label: SEVERITY_LABEL[severity],
        color,
        shape: 'round' as const,
      }))}
      note={
        envelope ? (
          <>
            The curve is the Modified B31G acceptance limit at{' '}
            <strong>{geometry!.operatingPressureMpa.toFixed(1)} MPa</strong> on a{' '}
            {geometry!.outerDiameterMm.toFixed(0)} mm × {envelope.wall.toFixed(1)} mm wall.{' '}
            <strong>{outside.toLocaleString()}</strong> feature(s) plot above it and are not
            acceptable as reported.
          </>
        ) : (
          <>
            Depth alone does not decide acceptability — a shallow but long defect can fail where a
            deeper short one passes. Enter the pipe geometry above to overlay the Modified B31G
            acceptance curve on this population.
          </>
        )
      }
    >
      <svg
        className="viz-plot"
        viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
        role="img"
        aria-label="Metal loss depth against defect length"
        preserveAspectRatio="xMidYMid meet"
      >
        {[0, 20, 40, 60, 80, 100].map((depth) => (
          <g key={depth}>
            <line className="viz-grid-line" x1={PLOT.left} x2={PLOT.width - PLOT.right} y1={yOf(depth)} y2={yOf(depth)} />
            <text className="viz-tick" x={PLOT.left - 6} y={yOf(depth) + 3} textAnchor="end">{depth}</text>
          </g>
        ))}

        {envelope && (
          <>
            <polygon
              points={[
                `${xOf(0)},${yOf(MAX_DEPTH_PCT)}`,
                ...envelope.curve.map((entry) => `${xOf(entry.length)},${yOf(entry.depthPct)}`),
                `${xOf(maxLength)},${yOf(MAX_DEPTH_PCT)}`,
              ].join(' ')}
              fill="var(--viz-critical)"
              opacity={0.08}
            />
            <polyline
              points={envelope.curve.map((entry) => `${xOf(entry.length)},${yOf(entry.depthPct)}`).join(' ')}
              fill="none"
              stroke="var(--viz-critical)"
              strokeWidth={2}
            />
          </>
        )}

        {points.map((point) => {
          const severity = severityOf(point.feature);
          return (
            <circle
              key={point.feature.sourceKey}
              cx={xOf(point.length)}
              cy={yOf(point.depth)}
              r={3.5}
              fill={`var(--viz-${severity})`}
              fillOpacity={0.75}
              stroke="var(--viz-surface)"
              strokeWidth={1}
              onMouseMove={(event) => show(event, point.feature.featureId, [
                { label: 'Depth', value: `${point.depth.toFixed(1)} %WT` },
                { label: 'Length', value: `${point.length.toFixed(1)} mm` },
                { label: 'ERF', value: point.feature.erf === null ? '—' : point.feature.erf.toFixed(3) },
                { label: 'Severity', value: SEVERITY_LABEL[severity] },
              ])}
              onMouseLeave={hide}
            />
          );
        })}

        <line className="viz-axis-line" x1={PLOT.left} x2={PLOT.width - PLOT.right} y1={PLOT.top + plotHeight} y2={PLOT.top + plotHeight} />
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <text
            key={fraction}
            className="viz-tick"
            x={PLOT.left + fraction * plotWidth}
            y={PLOT.height - 14}
            textAnchor={fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}
          >
            {(maxLength * fraction).toFixed(0)}
          </text>
        ))}
        <text className="viz-axis-title" x={PLOT.left} y={PLOT.height - 1}>Length [mm]  ·  vertical: depth [%WT]</text>
      </svg>
    </VizFrame>
  );
}
