/**
 * The two pictures of one spool: the shell unrolled flat, and the same pipe
 * drawn in projection.
 *
 * Both answer the question a number cannot — "why is this spool's result what
 * it is" — by showing where the metal loss actually sits. A joint whose worst
 * ERF comes from one isolated pit is a different repair from a joint carrying a
 * line of pits along the 6 o'clock generatrix, and the two look identical in a
 * results table.
 *
 * The projection is drawn, not rendered: the same decision as FfsPerspectiveBars
 * took. Orbit controls and a lit mesh are a lot of machinery for a picture the
 * reader wants to glance at and put in a report, so the pipe is a cylinder in
 * SVG with a rotation control for reaching the far side.
 *
 * Unlike the alignment viewer, an FFS row carries its own outer diameter, so
 * the circumferential extent here is a real arc rather than a nominal band.
 */

import { useId, useMemo, useState } from 'react';
import type { FfsScreenedResult } from '../../lib/ffs/types';
import type { FfsSpool } from '../../lib/ffs/spoolReview';

/** Depth bands, matching the ones the charts and the results table use. */
const DEPTH_STOPS: Array<[number, string]> = [
  [10, '#eab308'],
  [25, '#f97316'],
  [50, '#ef4444'],
  [Infinity, '#991b1b'],
];

export function depthColor(depthPct: number): string {
  for (const [limit, color] of DEPTH_STOPS) {
    if (depthPct <= limit) return color;
  }
  return '#991b1b';
}

function numericLd(item: FfsScreenedResult): number {
  const value = Number(item.nominal.ld);
  return Number.isFinite(value) ? value : 0;
}

/** Clock hour 0–12 measured from the top of the pipe. */
function clockHourOf(item: FfsScreenedResult): number | null {
  return item.clockHour;
}

/** Circumferential extent of the reported width, in radians. */
function arcRadians(item: FfsScreenedResult): number {
  const { width, od } = item.nominal;
  if (!(width > 0) || !(od > 0)) return 0;
  return Math.min(2 * Math.PI, (width / (Math.PI * od)) * 2 * Math.PI);
}

/**
 * The stretch of line the drawing covers. The girth welds bound it when the run
 * reported them; otherwise the features do, with a margin so a defect at the
 * edge is not clipped in half.
 */
export function spoolExtent(spool: FfsSpool): { startM: number; endM: number; bounded: boolean } {
  if (spool.usGwLdM !== null && spool.dsGwLdM !== null && spool.dsGwLdM > spool.usGwLdM) {
    return { startM: spool.usGwLdM, endM: spool.dsGwLdM, bounded: true };
  }
  const margin = Math.max(0.5, (spool.lastFeatureLdM - spool.firstFeatureLdM) * 0.1);
  return {
    startM: spool.firstFeatureLdM - margin,
    endM: spool.lastFeatureLdM + margin,
    bounded: false,
  };
}

interface ViewProps {
  spool: FfsSpool;
  selectedIndex: number | null;
  /** Features the engineer has ticked for the disposition, drawn ringed. */
  markedIndexes?: ReadonlySet<number>;
  onSelect?: (item: FfsScreenedResult) => void;
}

const PAD_LEFT = 54;
const PAD_RIGHT = 58;
const PAD_TOP = 16;
const AXIS_H = 28;
const PLOT_H = 190;
const VIEW_W = 820;
const MIN_BOX = 3;

/** SVG y for a clock hour, 00:00 at the top of the band. */
function unrolledY(hour: number): number {
  return PAD_TOP + (hour / 12) * PLOT_H;
}

function DepthLegend({ x, top, height }: { x: number; top: number; height: number }) {
  const gradientId = useId();
  return (
    <g>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
          {Array.from({ length: 11 }, (_unused, index) => (
            <stop key={index} offset={`${index * 10}%`} stopColor={depthColor(index * 6)} />
          ))}
        </linearGradient>
      </defs>
      <rect x={x} y={top} width={10} height={height} fill={`url(#${gradientId})`} rx={2} />
      <text x={x} y={top - 5} fontSize={8.5} fill="currentColor" opacity={0.7}>Depth %WT</text>
      {[0, 20, 40, 60].map((depth) => (
        <text
          key={depth}
          x={x + 14}
          y={top + height - (depth / 60) * height + 3}
          fontSize={8}
          fill="currentColor"
          opacity={0.7}
        >
          {depth === 60 ? '60+' : depth}
        </text>
      ))}
    </g>
  );
}

/**
 * The developed (unrolled) shell: distance across, clock down. This is the view
 * that shows a corrosion band following one generatrix, which is what separates
 * a drainage or a coating-disbondment story from scattered pitting.
 */
export function FfsSpoolUnrolledView({ spool, selectedIndex, markedIndexes, onSelect }: ViewProps) {
  const { startM, endM, bounded } = useMemo(() => spoolExtent(spool), [spool]);
  const spanM = Math.max(0.01, endM - startM);
  const plotWidth = VIEW_W - PAD_LEFT - PAD_RIGHT;
  const height = PAD_TOP + PLOT_H + AXIS_H;
  const toX = (metres: number) => PAD_LEFT + ((metres - startM) / spanM) * plotWidth;

  const ticks = useMemo(() => {
    const count = 6;
    const step = spanM / count;
    return Array.from({ length: count + 1 }, (_unused, index) => startM + index * step);
  }, [startM, spanM]);

  const noClock = spool.members.filter((member) => clockHourOf(member) === null);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${VIEW_W} ${height}`}
        width="100%"
        height={height}
        role="img"
        className="text-slate-500 dark:text-slate-400"
        aria-label={`Unrolled shell of ${spool.label} with ${spool.featureCount} metal-loss footprints`}
      >
        <rect x={PAD_LEFT} y={PAD_TOP} width={plotWidth} height={PLOT_H} fill="#0f2740" rx={3} />

        {/* Clock grid, 00:00 at the top of the pipe through to 12:00 */}
        {[0, 3, 6, 9, 12].map((hour) => (
          <g key={hour}>
            <line
              x1={PAD_LEFT} y1={unrolledY(hour)} x2={PAD_LEFT + plotWidth} y2={unrolledY(hour)}
              stroke="#1e4468" strokeWidth={1} strokeDasharray={hour === 0 || hour === 12 ? '0' : '3 3'}
            />
            <text x={PAD_LEFT - 6} y={unrolledY(hour) + 3} textAnchor="end" fontSize={9} fill="currentColor">
              {`${String(hour).padStart(2, '0')}:00`}
            </text>
          </g>
        ))}

        {/* Girth welds, when the run gave their position */}
        {bounded && [startM, endM].map((weldM, index) => (
          <g key={`gw-${index}`}>
            <line
              x1={toX(weldM)} y1={PAD_TOP} x2={toX(weldM)} y2={PAD_TOP + PLOT_H}
              stroke="#94a3b8" strokeWidth={2}
            />
            <text x={toX(weldM)} y={PAD_TOP - 5} textAnchor="middle" fontSize={8.5} fill="currentColor">
              GW
            </text>
          </g>
        ))}

        {/* Metal-loss footprints at their reported length and width */}
        {spool.members.map((member) => {
          const hour = clockHourOf(member);
          if (hour === null) return null;
          const boxWidth = Math.max(MIN_BOX, ((member.nominal.length / 1000) / spanM) * plotWidth);
          const boxHeight = Math.max(MIN_BOX, (arcRadians(member) / (2 * Math.PI)) * PLOT_H);
          const x = toX(numericLd(member)) - boxWidth / 2;
          const y = unrolledY(hour) - boxHeight / 2;
          const selected = member.index === selectedIndex;
          const marked = markedIndexes?.has(member.index) === true;
          return (
            <g key={member.key}>
              {marked && (
                <rect
                  x={x - 3} y={y - 3} width={boxWidth + 6} height={boxHeight + 6}
                  fill="none" stroke="#22d3ee" strokeWidth={1.2} strokeDasharray="3 2" rx={2}
                />
              )}
              <rect
                x={x} y={y} width={boxWidth} height={boxHeight}
                fill={depthColor(member.nominal.maxDepthPct)}
                fillOpacity={member.nominal.isClusteredMetalLoss ? 0.4 : 0.88}
                stroke={selected ? '#ffffff' : depthColor(member.nominal.maxDepthPct)}
                strokeWidth={selected ? 1.8 : 0.7}
                strokeDasharray={member.nominal.isClusteredMetalLoss ? '3 2' : undefined}
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
                role={onSelect ? 'button' : undefined}
                tabIndex={onSelect ? 0 : undefined}
                aria-label={`${member.nominal.featureId ?? `LD ${numericLd(member).toFixed(2)} m`}, ${member.nominal.maxDepthPct.toFixed(1)} %WT`}
                onClick={() => onSelect?.(member)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onSelect?.(member);
                }}
              />
            </g>
          );
        })}

        {/* Distance scale */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={toX(tick)} y1={PAD_TOP + PLOT_H} x2={toX(tick)} y2={PAD_TOP + PLOT_H + 4}
              stroke="currentColor" strokeWidth={1} opacity={0.5}
            />
            <text x={toX(tick)} y={PAD_TOP + PLOT_H + 16} textAnchor="middle" fontSize={9} fill="currentColor">
              {tick.toFixed(1)}
            </text>
          </g>
        ))}
        <text x={PAD_LEFT} y={PAD_TOP + PLOT_H + AXIS_H - 2} fontSize={8.5} fill="currentColor" opacity={0.75}>
          Log distance [m]
        </text>

        <DepthLegend x={VIEW_W - PAD_RIGHT + 12} top={PAD_TOP} height={PLOT_H} />
      </svg>
      {noClock.length > 0 && (
        <figcaption className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
          {noClock.length} feature{noClock.length === 1 ? '' : 's'} carry no readable clock position and are not drawn.
        </figcaption>
      )}
      {!bounded && (
        <figcaption className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
          The run reported no girth-weld position for this group, so the extent shown is the span of the
          features themselves, not the true spool.
        </figcaption>
      )}
    </figure>
  );
}

const PIPE_RX = 20;
const PIPE_RY = 58;

/**
 * The same spool drawn as a pipe.
 *
 * The cross-section is an ellipse, so a defect near 3 or 9 o'clock is seen
 * edge-on and foreshortens to nothing — which is honest, and why the rotation
 * control exists: turning the pipe brings the far side round rather than
 * pretending both halves are visible at once.
 */
export function FfsSpoolProjectionView({ spool, selectedIndex, markedIndexes, onSelect }: ViewProps) {
  const [rotationHours, setRotationHours] = useState(0);
  const gradientId = useId();
  const { startM, endM } = useMemo(() => spoolExtent(spool), [spool]);
  const spanM = Math.max(0.01, endM - startM);

  const width = VIEW_W;
  const height = 210;
  const left = 70;
  const right = width - 70;
  const centreY = height / 2 - 6;
  const bodyWidth = right - left;
  const toX = (metres: number) => left + ((metres - startM) / spanM) * bodyWidth;

  /** Angle from the top of the pipe, after the view rotation. */
  const angleOf = (hour: number) => (((hour + rotationHours) % 12) / 12) * 2 * Math.PI;

  const drawn = spool.members
    .map((member) => {
      const hour = clockHourOf(member);
      if (hour === null) return null;
      const theta = angleOf(hour);
      const halfArc = arcRadians(member) / 2;
      // Vertical extent of the arc segment on the projected ellipse. It goes to
      // zero at 12 and 6 o'clock, where the surface faces the viewer edge-on.
      const projectedHeight = Math.abs(2 * PIPE_RY * Math.sin(theta) * Math.sin(Math.max(halfArc, 0.02)));
      return {
        member,
        theta,
        // sin(theta) > 0 is the half of the circumference facing the viewer.
        front: Math.sin(theta) > 0,
        y: centreY - PIPE_RY * Math.cos(theta),
        boxWidth: Math.max(MIN_BOX, ((member.nominal.length / 1000) / spanM) * bodyWidth),
        boxHeight: Math.max(2.5, projectedHeight),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    // Back half first so the near side paints over it.
    .sort((a, b) => Number(a.front) - Number(b.front));

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        className="text-slate-500 dark:text-slate-400"
        aria-label={`Projected pipe view of ${spool.label}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1b3a57" />
            <stop offset="38%" stopColor="#2b587f" />
            <stop offset="100%" stopColor="#12293e" />
          </linearGradient>
        </defs>

        {/* Body and the two girth-weld faces */}
        <rect x={left} y={centreY - PIPE_RY} width={bodyWidth} height={PIPE_RY * 2} fill={`url(#${gradientId})`} />
        <ellipse cx={right} cy={centreY} rx={PIPE_RX} ry={PIPE_RY} fill="#2b587f" stroke="#8fb3d0" strokeWidth={1.2} />
        <ellipse cx={left} cy={centreY} rx={PIPE_RX} ry={PIPE_RY} fill="#0e2338" stroke="#8fb3d0" strokeWidth={1.2} />

        {/* Clock reference generatrices, so the rotation is readable */}
        {[0, 3, 6, 9].map((hour) => {
          const theta = angleOf(hour);
          const y = centreY - PIPE_RY * Math.cos(theta);
          const visible = Math.sin(theta) >= 0;
          return (
            <g key={hour} opacity={visible ? 0.8 : 0.25}>
              <line x1={left} y1={y} x2={right} y2={y} stroke="#8fb3d0" strokeWidth={0.7} strokeDasharray="4 4" />
              <text x={left - 8} y={y + 3} textAnchor="end" fontSize={8.5} fill="currentColor">
                {`${String(hour).padStart(2, '0')}:00`}
              </text>
            </g>
          );
        })}

        {drawn.map(({ member, front, y, boxWidth, boxHeight }) => {
          const x = toX(numericLd(member)) - boxWidth / 2;
          const selected = member.index === selectedIndex;
          const marked = markedIndexes?.has(member.index) === true;
          return (
            <g key={member.key} opacity={front ? 1 : 0.22}>
              {marked && front && (
                <rect
                  x={x - 3} y={y - boxHeight / 2 - 3} width={boxWidth + 6} height={boxHeight + 6}
                  fill="none" stroke="#22d3ee" strokeWidth={1.2} strokeDasharray="3 2" rx={2}
                />
              )}
              <rect
                x={x} y={y - boxHeight / 2} width={boxWidth} height={boxHeight} rx={1.5}
                fill={depthColor(member.nominal.maxDepthPct)}
                fillOpacity={member.nominal.isClusteredMetalLoss ? 0.45 : 0.92}
                stroke={selected ? '#ffffff' : 'rgba(0,0,0,0.35)'}
                strokeWidth={selected ? 1.8 : 0.5}
                strokeDasharray={member.nominal.isClusteredMetalLoss ? '3 2' : undefined}
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
                role={onSelect ? 'button' : undefined}
                tabIndex={onSelect && front ? 0 : undefined}
                aria-label={`${member.nominal.featureId ?? `LD ${numericLd(member).toFixed(2)} m`}, ${member.nominal.maxDepthPct.toFixed(1)} %WT, ${front ? 'near side' : 'far side'}`}
                onClick={() => onSelect?.(member)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onSelect?.(member);
                }}
              />
            </g>
          );
        })}

        <text x={left} y={height - 6} fontSize={9} fill="currentColor">
          {startM.toFixed(1)} m
        </text>
        <text x={right} y={height - 6} textAnchor="end" fontSize={9} fill="currentColor">
          {endM.toFixed(1)} m
        </text>
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
        <label className="flex items-center gap-2">
          Rotate
          <input
            type="range"
            min={0}
            max={11}
            step={1}
            value={rotationHours}
            onChange={(event) => setRotationHours(Number(event.target.value))}
            aria-label="Rotate the pipe, in clock hours"
            className="w-40"
          />
          <span className="tabular-nums">{String(rotationHours).padStart(2, '0')}:00 to the top</span>
        </label>
        <span>Features on the far side are dimmed; rotate to bring them round.</span>
      </div>
    </figure>
  );
}
