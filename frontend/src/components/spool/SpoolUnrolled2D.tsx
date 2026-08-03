/**
 * The unrolled (developed) view of the same spool: the shell cut along 12:00
 * and laid flat, master axis left to right, clock top to bottom.
 *
 * It shares the 3D pane's axial scale and selection, so a defect picked in one
 * lands under the crosshair in the other. Defect footprints use the same depth
 * palette and the same marker exaggeration factor as the 3D patches — two panes
 * showing the same metal must not disagree about how big it is.
 */

import { useMemo, type RefObject } from 'react';

import type { SpoolFeature } from '../../domain/spoolFeatures.ts';
import { arcWidthDeg } from '../../domain/spoolFeatures.ts';
import { depthColor, STATUS_COLOR, type DepthPalette } from './spoolPalette.ts';
import { axialTicks } from './spoolScale.ts';

interface SpoolUnrolled2DProps {
  features: SpoolFeature[];
  welds: Array<{ id: string; maM: number }>;
  startM: number;
  endM: number;
  odMm: number | null;
  palette: DepthPalette;
  markerScale: number;
  showWelds: boolean;
  showAxialScale: boolean;
  showPrevious: boolean;
  selectedKey: string | null;
  onSelect: (feature: SpoolFeature, event: { clientX: number; clientY: number }) => void;
  onHover: (feature: SpoolFeature | null) => void;
  svgRef?: RefObject<SVGSVGElement | null>;
}

const PAD_LEFT = 46;
const PAD_RIGHT = 44;
const PAD_TOP = 18;
const AXIS_HEIGHT = 26;
const WELD_ROW = 16;
const PLOT_HEIGHT = 150;
const MIN_BOX = 3;

/** Clock hours from degrees, on the 12-at-top convention the plot draws. */
function hoursOf(clockDeg: number): number {
  return (((clockDeg % 360) + 360) % 360) / 30;
}

export default function SpoolUnrolled2D({
  features,
  welds,
  startM,
  endM,
  odMm,
  palette,
  markerScale,
  showWelds,
  showAxialScale,
  showPrevious,
  selectedKey,
  onSelect,
  onHover,
  svgRef,
}: SpoolUnrolled2DProps) {
  const spanM = Math.max(0.01, endM - startM);
  const width = 760;
  const plotWidth = width - PAD_LEFT - PAD_RIGHT;
  const plotTop = PAD_TOP + (showWelds ? WELD_ROW : 0);
  const height = plotTop + PLOT_HEIGHT + (showAxialScale ? AXIS_HEIGHT : 8);

  const toX = (m: number) => PAD_LEFT + ((m - startM) / spanM) * plotWidth;
  const toY = (clockDeg: number) => plotTop + ((12 - hoursOf(clockDeg)) / 12) * PLOT_HEIGHT;

  const axisTicks = useMemo(() => axialTicks(startM, endM), [startM, endM]);

  const boxOf = (feature: SpoolFeature, side: 'current' | 'previous') => {
    const data = feature[side];
    const maM = data.maM ?? feature.maM;
    const clockDeg = data.clockDeg ?? feature.clockDeg;
    const axialM = ((data.lengthMm ?? 0) / 1000) * markerScale;
    const boxWidth = Math.max(MIN_BOX, (axialM / spanM) * plotWidth);
    // Same rule as the 3D patches: only a true arc gets the exaggeration.
    const trueArc = arcWidthDeg(data.widthMm, odMm);
    const arcDeg = trueArc === null ? 8 : trueArc * markerScale;
    const boxHeight = Math.max(MIN_BOX, (arcDeg / 360) * PLOT_HEIGHT);
    return {
      x: toX(maM) - boxWidth / 2,
      y: toY(clockDeg) - boxHeight / 2,
      width: boxWidth,
      height: boxHeight,
      depthPct: data.depthPct,
    };
  };

  const selected = features.find((feature) => feature.key === selectedKey) ?? null;

  return (
    <div className="spool-unrolled">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Unrolled pipe surface with anomaly footprints"
      >
        <rect x={PAD_LEFT} y={plotTop} width={plotWidth} height={PLOT_HEIGHT} fill="#0f2740" />

        {/* Clock grid */}
        {[12, 9, 6, 3, 0].map((hour) => {
          const y = plotTop + ((12 - hour) / 12) * PLOT_HEIGHT;
          return (
            <g key={`clock-${hour}`}>
              <line
                x1={PAD_LEFT} y1={y} x2={PAD_LEFT + plotWidth} y2={y}
                stroke="#1e4468" strokeWidth={1} strokeDasharray={hour === 12 || hour === 0 ? '0' : '3 3'}
              />
              <text x={PAD_LEFT - 6} y={y + 3} textAnchor="end" fontSize={9} fill="var(--ds-faint, #98a2b3)">
                {`${hour === 0 ? 0 : hour}:00`}
              </text>
            </g>
          );
        })}

        {/* Girth welds */}
        {showWelds && welds.map((weld) => {
          const x = toX(weld.maM);
          if (x < PAD_LEFT - 1 || x > PAD_LEFT + plotWidth + 1) return null;
          return (
            <g key={weld.id}>
              <line x1={x} y1={plotTop} x2={x} y2={plotTop + PLOT_HEIGHT} stroke="#64748b" strokeWidth={1.5} opacity={0.75} />
              <text x={x} y={plotTop - 6} textAnchor="middle" fontSize={8.5} fill="var(--ds-faint, #98a2b3)">
                {weld.id}
              </text>
              <polygon points={`${x - 3},${plotTop - 4} ${x + 3},${plotTop - 4} ${x},${plotTop}`} fill="#64748b" />
            </g>
          );
        })}

        {/* Previous-run footprints, drawn under the current ones as outlines */}
        {showPrevious && features.filter((feature) => feature.previous.present).map((feature) => {
          const box = boxOf(feature, 'previous');
          return (
            <rect
              key={`prev-${feature.key}`}
              x={box.x} y={box.y} width={box.width} height={box.height}
              fill="none" stroke="#94a3b8" strokeWidth={1} strokeDasharray="2 2" opacity={0.8}
            />
          );
        })}

        {/* Current-run footprints */}
        {features.filter((feature) => feature.current.present).map((feature) => {
          const box = boxOf(feature, 'current');
          const isSelected = feature.key === selectedKey;
          return (
            <rect
              key={feature.key}
              x={box.x} y={box.y} width={box.width} height={box.height}
              fill={depthColor(box.depthPct, palette)}
              stroke={isSelected ? '#ffffff' : STATUS_COLOR[feature.status]}
              strokeWidth={isSelected ? 1.6 : 0.8}
              className="spool-unrolled__box"
              tabIndex={0}
              role="button"
              aria-label={`${feature.id} at ${feature.maM.toFixed(2)} metres, ${feature.clockLabel}`}
              onClick={(event) => onSelect(feature, { clientX: event.clientX, clientY: event.clientY })}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                onSelect(feature, { clientX: rect.left + rect.width / 2, clientY: rect.top });
              }}
              onMouseEnter={() => onHover(feature)}
              onMouseLeave={() => onHover(null)}
            />
          );
        })}

        {/* Selection crosshair, the link back to the 3D pane */}
        {selected && (
          <g>
            <line
              x1={toX(selected.maM)} y1={plotTop - (showWelds ? WELD_ROW - 4 : 6)}
              x2={toX(selected.maM)} y2={plotTop + PLOT_HEIGHT + 4}
              stroke="#f04438" strokeWidth={1.2}
            />
            <rect
              x={toX(selected.maM) - 27} y={plotTop + PLOT_HEIGHT + 5}
              width={54} height={14} rx={3} fill="#f04438"
            />
            <text
              x={toX(selected.maM)} y={plotTop + PLOT_HEIGHT + 15}
              textAnchor="middle" fontSize={9} fill="#ffffff" fontWeight={600}
            >
              {`${selected.maM.toFixed(2)} m`}
            </text>
          </g>
        )}

        {/* Axial scale */}
        {showAxialScale && axisTicks.map((tick) => (
          <g key={`tick-${tick}`}>
            <line
              x1={toX(tick)} y1={plotTop + PLOT_HEIGHT} x2={toX(tick)} y2={plotTop + PLOT_HEIGHT + 4}
              stroke="var(--ds-line-strong, #d0d5dd)" strokeWidth={1}
            />
            <text
              x={toX(tick)} y={plotTop + PLOT_HEIGHT + AXIS_HEIGHT - 4}
              textAnchor="middle" fontSize={9} fill="var(--ds-muted, #667085)"
            >
              {`${Number.isInteger(tick) ? tick : tick.toFixed(1)} m`}
            </text>
          </g>
        ))}

        {/* Depth legend */}
        <g>
          <defs>
            <linearGradient id="spool-depth-legend" x1="0" y1="1" x2="0" y2="0">
              {Array.from({ length: 11 }, (_unused, index) => (
                <stop
                  key={index}
                  offset={`${index * 10}%`}
                  stopColor={depthColor(index * 5, palette)}
                />
              ))}
            </linearGradient>
          </defs>
          <rect x={width - PAD_RIGHT + 10} y={plotTop} width={10} height={PLOT_HEIGHT} fill="url(#spool-depth-legend)" />
          <text x={width - PAD_RIGHT + 10} y={plotTop - 5} fontSize={8.5} fill="var(--ds-muted, #667085)">Depth %</text>
          {[0, 10, 20, 30, 40, 50].map((depth) => (
            <text
              key={depth}
              x={width - PAD_RIGHT + 23}
              y={plotTop + PLOT_HEIGHT - (depth / 50) * PLOT_HEIGHT + 3}
              fontSize={8}
              fill="var(--ds-muted, #667085)"
            >
              {depth === 50 ? '50+' : depth}
            </text>
          ))}
        </g>
      </svg>
    </div>
  );
}
