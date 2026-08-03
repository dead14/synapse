/**
 * Colour rules shared by the 3D pipe, the unrolled view, the legends and the
 * anomaly list, so the same defect is never two different colours in two panes.
 *
 * Depth uses the ILI convention engineers already read on vendor plots: cool
 * for shallow, hot for deep, saturating at 50 %WT because everything past that
 * is "deep" and a finer gradient there only invites false precision.
 */

import type { SpoolMatchStatus } from '../../domain/spoolFeatures.ts';

export type DepthPalette = 'ili' | 'viridis' | 'mono';

interface Stop {
  at: number;
  color: [number, number, number];
}

const PALETTES: Record<DepthPalette, Stop[]> = {
  ili: [
    { at: 0, color: [37, 99, 235] },
    { at: 10, color: [14, 165, 233] },
    { at: 20, color: [34, 197, 94] },
    { at: 30, color: [234, 179, 8] },
    { at: 40, color: [249, 115, 22] },
    { at: 50, color: [220, 38, 38] },
  ],
  viridis: [
    { at: 0, color: [68, 1, 84] },
    { at: 12, color: [59, 82, 139] },
    { at: 25, color: [33, 145, 140] },
    { at: 37, color: [94, 201, 98] },
    { at: 50, color: [253, 231, 37] },
  ],
  mono: [
    { at: 0, color: [226, 232, 240] },
    { at: 50, color: [15, 23, 42] },
  ],
};

export const DEPTH_PALETTE_LABEL: Record<DepthPalette, string> = {
  ili: 'ILI Standard',
  viridis: 'Viridis',
  mono: 'Mono',
};

/** Depth in %WT to an rgb triple in 0..255. Null depth renders as neutral grey. */
export function depthRgb(depthPct: number | null, palette: DepthPalette = 'ili'): [number, number, number] {
  if (depthPct === null || !Number.isFinite(depthPct)) return [148, 163, 184];
  const stops = PALETTES[palette];
  const value = Math.max(0, Math.min(stops[stops.length - 1].at, depthPct));
  for (let index = 1; index < stops.length; index += 1) {
    const low = stops[index - 1];
    const high = stops[index];
    if (value <= high.at) {
      const span = high.at - low.at || 1;
      const t = (value - low.at) / span;
      return [
        Math.round(low.color[0] + (high.color[0] - low.color[0]) * t),
        Math.round(low.color[1] + (high.color[1] - low.color[1]) * t),
        Math.round(low.color[2] + (high.color[2] - low.color[2]) * t),
      ];
    }
  }
  const last = stops[stops.length - 1].color;
  return [last[0], last[1], last[2]];
}

export function depthColor(depthPct: number | null, palette: DepthPalette = 'ili'): string {
  const [r, g, b] = depthRgb(depthPct, palette);
  return `rgb(${r}, ${g}, ${b})`;
}

/** CSS gradient for the depth legend bar, sampled off the same ramp. */
export function depthGradient(palette: DepthPalette = 'ili'): string {
  const steps = Array.from({ length: 11 }, (_unused, index) => {
    const depth = index * 5;
    return `${depthColor(depth, palette)} ${(index / 10) * 100}%`;
  });
  return `linear-gradient(90deg, ${steps.join(', ')})`;
}

export const STATUS_COLOR: Record<SpoolMatchStatus, string> = {
  'matched-no-growth': '#12b76a',
  'matched-growth': '#f97316',
  new: '#eab308',
  'prev-only': '#60a5fa',
  bypassed: '#94a3b8',
};

/** Severity band used for the badge in the inspector and the list. */
export function severityOf(depthPct: number | null): { label: string; color: string } {
  if (depthPct === null) return { label: 'Unknown', color: 'var(--ds-muted)' };
  if (depthPct >= 60) return { label: 'Critical', color: '#b42318' };
  if (depthPct >= 40) return { label: 'High', color: '#c4320a' };
  if (depthPct >= 20) return { label: 'Medium', color: '#b54708' };
  return { label: 'Low', color: '#027a48' };
}
