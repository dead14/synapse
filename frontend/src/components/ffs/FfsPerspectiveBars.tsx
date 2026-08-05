import { useEffect, useMemo, useRef } from 'react';

/**
 * Feature counts drawn as a receding field of bars.
 *
 * This replaces a real WebGL scene. The previous view was genuinely
 * three-dimensional — orbit controls, a perspective camera, a lit mesh per bar
 * — which is a great deal of machinery for a chart nobody wanted to fly
 * around. What the reference reports actually use is a flat drawing with the
 * bars given depth: rows step back and to the right, each bar gets a top and a
 * side face, and the reader takes in which bands run the length of the line and
 * which pile up in one stretch. That is a projection, not a scene, so it is
 * drawn here in two dimensions.
 *
 * Canvas rather than SVG, because the panel exports every figure by reading a
 * canvas — an SVG would have to be rasterised on the way out, and the export
 * path is the reason these figures exist.
 *
 * Every bar carries its own count. A perspective projection is the wrong tool
 * for reading an exact number off a height, so the number is written on the
 * bar instead of leaving the reader to judge it against a gridline it does not
 * line up with.
 */

export interface PerspectiveSeries {
  label: string;
  color: string;
  /** One count per category, in category order. */
  data: number[];
}

/** How far each row steps back, in pixels. */
const ROW_STEP_X = 26;
const ROW_STEP_Y = 18;
/** The depth of a single bar's top and side faces. */
const BAR_DEPTH_X = 14;
const BAR_DEPTH_Y = 10;

const PADDING = { top: 28, right: 28, bottom: 62, left: 62 };

function shade(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const num = Number.parseInt(full, 16);
  if (!Number.isFinite(num)) return hex;
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const r = clamp(((num >> 16) & 255) * amount);
  const g = clamp(((num >> 8) & 255) * amount);
  const b = clamp((num & 255) * amount);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Rounds an axis maximum up to something a reader expects to see on a tick. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

export default function FfsPerspectiveBars({
  labels,
  series,
  xAxisLabel,
  yAxisLabel,
  isDark,
  height = 420,
  showValues = true,
  onCanvasReady,
}: {
  labels: string[];
  series: PerspectiveSeries[];
  xAxisLabel: string;
  yAxisLabel: string;
  isDark: boolean;
  height?: number;
  showValues?: boolean;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const theme = useMemo(
    () => ({
      grid: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(100,116,139,0.20)',
      floor: isDark ? 'rgba(148,163,184,0.07)' : 'rgba(100,116,139,0.06)',
      tick: isDark ? '#94a3b8' : '#64748b',
      text: isDark ? '#e2e8f0' : '#334155',
    }),
    [isDark],
  );

  const maxValue = useMemo(
    () => niceMax(series.reduce((max, s) => Math.max(max, ...s.data, 0), 0)),
    [series],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const draw = () => {
      const cssWidth = wrap.clientWidth;
      if (!cssWidth) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(cssWidth * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, cssWidth, height);
      ctx.textBaseline = 'middle';

      const rows = series.length;
      // The whole field of rows leans back by this much, so the plot has to
      // reserve it before deciding how wide a single bar can be.
      const leanX = (rows - 1) * ROW_STEP_X + BAR_DEPTH_X;
      const leanY = (rows - 1) * ROW_STEP_Y + BAR_DEPTH_Y;

      // Each row's label sits beside the row it names, at the far right of the
      // lean — so the gutter has to hold the widest of them or the legend is
      // simply cut off the edge of the canvas.
      ctx.font = '10px system-ui, sans-serif';
      const legendWidth = series.reduce(
        (widest, entry) => Math.max(widest, ctx.measureText(entry.label).width),
        0,
      ) + 22;

      const plotLeft = PADDING.left;
      const plotRight = cssWidth - PADDING.right - leanX - legendWidth;
      const baseY = height - PADDING.bottom;
      const plotTop = PADDING.top + leanY;
      const plotHeight = baseY - plotTop;
      const plotWidth = plotRight - plotLeft;
      if (plotWidth <= 20 || plotHeight <= 20) return;

      const columns = labels.length || 1;
      const pitch = plotWidth / columns;
      const barWidth = Math.max(4, Math.min(pitch * 0.62, 46));
      const scale = plotHeight / maxValue;

      // ── Back wall gridlines and value ticks ──────────────────────────────
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillStyle = theme.tick;
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      const tickCount = 5;
      for (let t = 0; t <= tickCount; t++) {
        const value = (maxValue * t) / tickCount;
        const y = baseY - value * scale;
        ctx.beginPath();
        ctx.moveTo(plotLeft, y);
        ctx.lineTo(plotLeft + leanX, y - leanY);
        ctx.lineTo(plotRight + leanX, y - leanY);
        ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillText(String(Math.round(value)), plotLeft - 8, y);
      }

      // ── Floor ────────────────────────────────────────────────────────────
      ctx.fillStyle = theme.floor;
      ctx.beginPath();
      ctx.moveTo(plotLeft, baseY);
      ctx.lineTo(plotLeft + leanX, baseY - leanY);
      ctx.lineTo(plotRight + leanX, baseY - leanY);
      ctx.lineTo(plotRight, baseY);
      ctx.closePath();
      ctx.fill();

      // ── Bars, back row first so nearer rows overlap correctly ────────────
      for (let row = rows - 1; row >= 0; row--) {
        const entry = series[row];
        const offsetX = row * ROW_STEP_X;
        const offsetY = row * ROW_STEP_Y;

        for (let column = 0; column < columns; column++) {
          const value = entry.data[column] ?? 0;
          if (value <= 0) continue;

          const x = plotLeft + column * pitch + (pitch - barWidth) / 2 + offsetX;
          const y = baseY - offsetY;
          const barHeight = value * scale;
          const topY = y - barHeight;

          // Front face
          ctx.fillStyle = entry.color;
          ctx.fillRect(x, topY, barWidth, barHeight);

          // Top face
          ctx.fillStyle = shade(entry.color, 1.22);
          ctx.beginPath();
          ctx.moveTo(x, topY);
          ctx.lineTo(x + BAR_DEPTH_X, topY - BAR_DEPTH_Y);
          ctx.lineTo(x + barWidth + BAR_DEPTH_X, topY - BAR_DEPTH_Y);
          ctx.lineTo(x + barWidth, topY);
          ctx.closePath();
          ctx.fill();

          // Right side face
          ctx.fillStyle = shade(entry.color, 0.72);
          ctx.beginPath();
          ctx.moveTo(x + barWidth, topY);
          ctx.lineTo(x + barWidth + BAR_DEPTH_X, topY - BAR_DEPTH_Y);
          ctx.lineTo(x + barWidth + BAR_DEPTH_X, y - BAR_DEPTH_Y);
          ctx.lineTo(x + barWidth, y);
          ctx.closePath();
          ctx.fill();

          // Below this the numbers collide into an unreadable smear and the
          // reader is better served by the axis alone. Widening the bin brings
          // them back, which is the control the reader already has.
          if (showValues && barWidth >= 9) {
            ctx.fillStyle = theme.text;
            ctx.font = '9px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(
              String(value),
              x + barWidth / 2 + BAR_DEPTH_X / 2,
              topY - BAR_DEPTH_Y - 7,
            );
          }
        }
      }

      // ── Category labels along the front edge ─────────────────────────────
      ctx.fillStyle = theme.tick;
      ctx.font = '9px system-ui, sans-serif';
      ctx.textAlign = 'right';
      const stride = Math.ceil((labels.length * 46) / Math.max(plotWidth, 1));
      labels.forEach((label, index) => {
        if (index % stride !== 0) return;
        const x = plotLeft + index * pitch + pitch / 2;
        ctx.save();
        ctx.translate(x, baseY + 10);
        ctx.rotate(-Math.PI / 4);
        ctx.fillText(label, 0, 0);
        ctx.restore();
      });

      // ── Axis titles ──────────────────────────────────────────────────────
      ctx.fillStyle = theme.tick;
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(xAxisLabel, plotLeft + plotWidth / 2, height - 10);
      ctx.save();
      ctx.translate(14, plotTop + plotHeight / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(yAxisLabel, 0, 0);
      ctx.restore();

      // ── Row legend, drawn beside the row it belongs to ───────────────────
      ctx.textAlign = 'left';
      ctx.font = '10px system-ui, sans-serif';
      for (let row = 0; row < rows; row++) {
        const entry = series[row];
        const x = plotRight + row * ROW_STEP_X + 6;
        const y = baseY - row * ROW_STEP_Y - 6;
        ctx.fillStyle = entry.color;
        ctx.fillRect(x, y - 4, 8, 8);
        ctx.fillStyle = theme.tick;
        ctx.fillText(entry.label, x + 12, y);
      }
    };

    draw();
    onCanvasReady?.(canvas);

    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [labels, series, maxValue, theme, height, xAxisLabel, yAxisLabel, showValues, onCanvasReady]);

  return (
    <div ref={wrapRef} className="relative h-full w-full">
      <canvas ref={canvasRef} role="img" aria-label={`${yAxisLabel} by ${xAxisLabel}`} />
    </div>
  );
}
