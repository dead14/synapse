import { useMemo, useState } from 'react';

import { densityByKp } from '../../lib/corrosion/analytics';
import type { CorrosionFeature } from '../../lib/corrosion/analysis';
import { buildSectionBands, formatBandRange } from '../../lib/sections/bands';
import SectionBandLegend from '../sections/SectionBandLegend';
import { Stat, StatGrid } from '../ds';
import { VizFrame, niceTicks, useVizTooltip } from './vizPrimitives';

interface Props {
  features: CorrosionFeature[];
  windowM?: number;
}

// A deliberately wide profile: it should read as a pipeline strip, not a tall chart.
const PLOT = { width: 960, height: 200, left: 40, right: 12, top: 12, bottom: 30 };
/** Ribbon naming the sections, drawn above the plot so it covers no data. */
const RIBBON = { height: 13, gap: 3 };

/**
 * Anomaly concentration along the line, with the worst contiguous stretch called
 * out. A single measure over one axis, so it is one hue — the hotspot is marked
 * by a shaded band and a label, not by a second colour.
 */
export default function KpDensity({ features, windowM = 500 }: Props) {
  const profile = useMemo(() => densityByKp(features, windowM), [features, windowM]);
  const bands = useMemo(
    () => buildSectionBands(features.map((feature) => ({
      distanceM: feature.distanceM,
      section: feature.section,
    }))),
    [features],
  );
  const [heldBandId, setHeldBandId] = useState<string | null>(null);
  const { frameRef, show, hide, node } = useVizTooltip();

  if (profile.windows.length === 0) {
    return <p className="viz-note">No log distances were reported, so density along the line cannot be built.</p>;
  }

  const max = Math.max(1, ...profile.windows.map((window) => window.perKm));
  const ticks = niceTicks(max);
  const axisMax = Math.max(max, ticks[ticks.length - 1]);
  const lineEnd = profile.windows[profile.windows.length - 1].endM;

  const ribbonSpace = bands.length > 0 ? RIBBON.height + RIBBON.gap : 0;
  const plotTop = PLOT.top + ribbonSpace;
  const plotWidth = PLOT.width - PLOT.left - PLOT.right;
  const plotHeight = PLOT.height + ribbonSpace - plotTop - PLOT.bottom;
  const svgHeight = PLOT.height + ribbonSpace;

  const xOf = (metres: number) => PLOT.left + (metres / lineEnd) * plotWidth;
  const yOf = (perKm: number) => plotTop + plotHeight - (perKm / axisMax) * plotHeight;
  const heldBand = bands.find((band) => band.id === heldBandId) ?? null;

  const points = profile.windows.map((window) => `${xOf((window.startM + window.endM) / 2)},${yOf(window.perKm)}`);
  const area = [
    `${xOf(profile.windows[0].startM)},${plotTop + plotHeight}`,
    ...points,
    `${xOf(lineEnd)},${plotTop + plotHeight}`,
  ].join(' ');

  return (
    <VizFrame
      frameRef={frameRef}
      tooltip={node}
      note={
        <>
          {profile.hotspot ? (
            <>
              Densest stretch is <strong>KP {(profile.hotspot.startM / 1000).toFixed(2)}–{(profile.hotspot.endM / 1000).toFixed(2)}</strong>,
              holding {profile.hotspot.count.toLocaleString()} features over{' '}
              {((profile.hotspot.endM - profile.hotspot.startM) / 1000).toFixed(1)} km. A cluster this
              tight usually means one cause — a coating failure, a CP shadow, or a low point holding water.
            </>
          ) : (
            <>Corrosion is spread evenly along the line; no window stands out against the mean of{' '}
              <strong>{profile.meanPerKm.toFixed(1)} per km</strong>.</>
          )}
          {heldBand && (
            <>
              {' '}Holding <strong>{heldBand.name}</strong> ({formatBandRange(heldBand)}).
            </>
          )}
        </>
      }
    >
      {bands.length > 0 && (
        <SectionBandLegend bands={bands} selectedId={heldBandId} onSelect={setHeldBandId} />
      )}

      <svg
        className="viz-plot"
        viewBox={`0 0 ${PLOT.width} ${svgHeight}`}
        role="img"
        aria-label="Anomaly density along the pipeline"
        preserveAspectRatio="xMidYMid meet"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="viz-grid-line" x1={PLOT.left} x2={PLOT.width - PLOT.right} y1={yOf(tick)} y2={yOf(tick)} />
            <text className="viz-tick" x={PLOT.left - 6} y={yOf(tick) + 3} textAnchor="end">{tick}</text>
          </g>
        ))}

        {/* Section ribbon: names each stretch above the profile, and clicking a
            segment holds it highlighted through the plot. */}
        {bands.map((band) => {
          const left = xOf(band.startM);
          const width = Math.max(2, xOf(band.endM) - left);
          const held = band.id === heldBandId;
          return (
            <g key={band.id}>
              {held && (
                <rect x={left} y={plotTop} width={width} height={plotHeight} fill={band.color} opacity={0.14} />
              )}
              <rect
                className="viz-hit"
                x={left}
                y={PLOT.top}
                width={width}
                height={RIBBON.height}
                fill={band.color}
                opacity={held ? 1 : heldBandId === null ? 0.75 : 0.3}
                onClick={() => setHeldBandId(held ? null : band.id)}
                onMouseMove={(event) => show(event, band.name, [
                  { label: 'Extent', value: formatBandRange(band) },
                  { label: 'Features', value: band.count.toLocaleString() },
                ])}
                onMouseLeave={hide}
              />
              {width > 34 && (
                <text
                  x={left + width / 2}
                  y={PLOT.top + RIBBON.height / 2 + 3}
                  textAnchor="middle"
                  fill="#ffffff"
                  style={{ fontSize: 9, fontWeight: 600, pointerEvents: 'none' }}
                >
                  {band.name.length > 10 ? `${band.name.slice(0, 9)}…` : band.name}
                </text>
              )}
            </g>
          );
        })}

        {profile.hotspot && (
          <rect
            x={xOf(profile.hotspot.startM)}
            y={plotTop}
            width={Math.max(2, xOf(profile.hotspot.endM) - xOf(profile.hotspot.startM))}
            height={plotHeight}
            fill="var(--viz-critical)"
            opacity={0.1}
          />
        )}

        <polygon points={area} fill="var(--viz-seq-450)" opacity={0.18} />
        <polyline points={points.join(' ')} fill="none" stroke="var(--viz-seq-450)" strokeWidth={2} strokeLinejoin="round" />

        <line
          className="viz-grid-line"
          x1={PLOT.left}
          x2={PLOT.width - PLOT.right}
          y1={yOf(profile.meanPerKm)}
          y2={yOf(profile.meanPerKm)}
          strokeDasharray="0"
          stroke="var(--viz-axis)"
        />

        {profile.windows.map((window) => (
          <rect
            key={window.startM}
            className="viz-hit"
            x={xOf(window.startM)}
            y={plotTop}
            width={Math.max(2, xOf(window.endM) - xOf(window.startM))}
            height={plotHeight}
            onMouseMove={(event) => {
              const inside = bands.filter((band) => band.endM >= window.startM && band.startM <= window.endM);
              show(event, `KP ${(window.startM / 1000).toFixed(2)}–${(window.endM / 1000).toFixed(2)}`, [
                { label: 'Features', value: window.count.toLocaleString() },
                { label: 'Per km', value: window.perKm.toFixed(1) },
                ...(inside.length > 0
                  ? [{ label: inside.length === 1 ? 'Section' : 'Sections', value: inside.map((band) => band.name).join(', ') }]
                  : []),
              ]);
            }}
            onMouseLeave={hide}
          />
        ))}

        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <text
            key={fraction}
            className="viz-tick"
            x={PLOT.left + fraction * plotWidth}
            y={svgHeight - 12}
            textAnchor={fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}
          >
            KP {((lineEnd * fraction) / 1000).toFixed(1)}
          </text>
        ))}

        <line className="viz-axis-line" x1={PLOT.left} x2={PLOT.width - PLOT.right} y1={plotTop + plotHeight} y2={plotTop + plotHeight} />
        <text className="viz-axis-title" x={PLOT.left} y={svgHeight - 1}>Features per km</text>
      </svg>

      <StatGrid>
        <Stat
          compact
          label="Primary hotspot"
          value={profile.hotspot ? `KP ${(profile.hotspot.startM / 1000).toFixed(1)}–${(profile.hotspot.endM / 1000).toFixed(1)}` : 'None'}
          hint={profile.hotspot ? `${profile.hotspot.count.toLocaleString()} features` : 'Evenly distributed'}
        />
        <Stat compact label="Peak density" value={profile.peak ? `${profile.peak.perKm.toFixed(0)} / km` : '—'} hint="Worst window" />
        <Stat compact label="Line mean" value={`${profile.meanPerKm.toFixed(1)} / km`} hint={`${(windowM / 1000).toFixed(1)} km windows`} />
      </StatGrid>
    </VizFrame>
  );
}
