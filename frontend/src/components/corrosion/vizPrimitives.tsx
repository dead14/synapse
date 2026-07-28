import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import type { Severity } from '../../lib/corrosion/analytics';

/**
 * Shared chart plumbing: a legend, a hover tooltip, and the severity chip.
 *
 * Colours come from the `--viz-*` tokens in ds.css, which were validated with
 * the palette validator against this app's own light and dark chart surfaces.
 * Nothing here hard-codes a hex.
 */

export const SEVERITY_LABEL: Record<Severity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const SEVERITY_VAR: Record<Severity, string> = {
  low: 'var(--viz-low)',
  medium: 'var(--viz-medium)',
  high: 'var(--viz-high)',
  critical: 'var(--viz-critical)',
};

/** Severity slots in fixed order, for legends that need both key and colour. */
export const SEVERITY_ORDER_VARS: Array<[Severity, string]> = [
  ['low', SEVERITY_VAR.low],
  ['medium', SEVERITY_VAR.medium],
  ['high', SEVERITY_VAR.high],
  ['critical', SEVERITY_VAR.critical],
];

/** Status colour never travels without its written label. */
export function SeverityChip({ severity }: { severity: Severity }) {
  return <span className={`viz-sev viz-sev--${severity}`}>{SEVERITY_LABEL[severity]}</span>;
}

export interface LegendEntry {
  label: string;
  color: string;
  shape?: 'square' | 'round' | 'hollow-square' | 'hollow-round';
}

export function Legend({ entries }: { entries: LegendEntry[] }) {
  return (
    <div className="viz-legend">
      {entries.map((entry) => {
        const hollow = entry.shape === 'hollow-square' || entry.shape === 'hollow-round';
        const round = entry.shape === 'round' || entry.shape === 'hollow-round';
        return (
          <span key={entry.label} className="viz-legend__item">
            <i
              className={`viz-legend__swatch${hollow ? ' viz-legend__swatch--hollow' : ''}${round ? ' viz-legend__swatch--round' : ''}`}
              style={{ ['--swatch' as string]: entry.color }}
            />
            {entry.label}
          </span>
        );
      })}
    </div>
  );
}

export interface TooltipPayload {
  x: number;
  y: number;
  title: string;
  rows: Array<{ label: string; value: string }>;
}

/**
 * Pointer-following tooltip confined to the chart frame. Tooltips enhance and
 * never gate: every chart that uses this also ships a table view.
 */
export function useVizTooltip() {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [tooltip, setTooltip] = useState<TooltipPayload | null>(null);

  const show = useCallback((event: { clientX: number; clientY: number }, title: string, rows: TooltipPayload['rows']) => {
    const frame = frameRef.current;
    if (!frame) return;
    const bounds = frame.getBoundingClientRect();
    setTooltip({
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
      title,
      rows,
    });
  }, []);

  const hide = useCallback(() => setTooltip(null), []);

  const node = tooltip ? (
    <div
      className="viz-tooltip"
      style={{
        // Flip before the frame edge so the tooltip never causes a scrollbar.
        left: Math.min(tooltip.x + 12, (frameRef.current?.clientWidth ?? 0) - 150),
        top: Math.max(0, tooltip.y - 12),
      }}
      role="status"
    >
      <p className="viz-tooltip__title">{tooltip.title}</p>
      {tooltip.rows.map((row) => (
        <p key={row.label} className="viz-tooltip__row">
          <span>{row.label}</span>
          <b>{row.value}</b>
        </p>
      ))}
    </div>
  ) : null;

  return { frameRef, show, hide, node };
}

/** Chart card body: legend on top, plot below, caption last. */
export function VizFrame({
  legend,
  note,
  children,
  frameRef,
  tooltip,
}: {
  legend?: LegendEntry[];
  note?: ReactNode;
  children: ReactNode;
  frameRef?: React.RefObject<HTMLDivElement | null>;
  tooltip?: ReactNode;
}) {
  return (
    <div className="viz-frame" ref={frameRef}>
      {legend && legend.length > 1 ? <Legend entries={legend} /> : null}
      {children}
      {note ? <p className="viz-note">{note}</p> : null}
      {tooltip}
    </div>
  );
}

/** Nice round axis ticks for a 0..max range. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((value) => value >= raw) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 0.001; value += step) ticks.push(Number(value.toFixed(6)));
  return ticks;
}

export function formatCompact(value: number): string {
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return String(Math.round(value * 100) / 100);
}
