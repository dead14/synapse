/**
 * Pane sizes for the Spool Detail View, in pixels.
 *
 * The stage is the pane that has to grow — a reviewer reading metal wants the
 * pipe, not the chrome — so every other pane is drag-sized and can be dragged
 * shut entirely. Sizes are a reviewer preference rather than a per-spool
 * decision, so they are stored and outlive the session.
 */

export interface SpoolLayout {
  railW: number;
  detailW: number;
  lowerH: number;
}

export const DEFAULT_LAYOUT: SpoolLayout = { railW: 240, detailW: 336, lowerH: 272 };
export const COLLAPSED_LAYOUT: SpoolLayout = { railW: 0, detailW: 0, lowerH: 0 };

export const LAYOUT_LIMITS: Record<keyof SpoolLayout, { min: number; max: number }> = {
  railW: { min: 150, max: 420 },
  detailW: { min: 220, max: 520 },
  lowerH: { min: 130, max: 720 },
};

const LAYOUT_KEY = 'synapse.spool-view.layout';

/**
 * Snap to zero below the minimum rather than refusing to shrink: dragging a
 * pane shut is the quickest way to hand the whole window to the pipe, and the
 * handle stays put so the pane can be dragged back out.
 */
export function clampPane(key: keyof SpoolLayout, value: number): number {
  const { min, max } = LAYOUT_LIMITS[key];
  if (value < min * 0.62) return 0;
  return Math.round(Math.min(max, Math.max(min, value)));
}

export function isMaximised(layout: SpoolLayout): boolean {
  return layout.railW === 0 && layout.detailW === 0 && layout.lowerH === 0;
}

export function readLayout(): SpoolLayout {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT;
  try {
    const stored = window.localStorage.getItem(LAYOUT_KEY);
    if (!stored) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(stored) as Partial<SpoolLayout>;
    return {
      railW: typeof parsed.railW === 'number' ? parsed.railW : DEFAULT_LAYOUT.railW,
      detailW: typeof parsed.detailW === 'number' ? parsed.detailW : DEFAULT_LAYOUT.detailW,
      lowerH: typeof parsed.lowerH === 'number' ? parsed.lowerH : DEFAULT_LAYOUT.lowerH,
    };
  } catch {
    // Corrupt or blocked storage is not a reason to refuse to open.
    return DEFAULT_LAYOUT;
  }
}

export function writeLayout(layout: SpoolLayout): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // A browser refusing storage must not break the workspace.
  }
}
