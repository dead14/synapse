import { useRef, useState, type ReactNode } from 'react';
import { FiDownload, FiRefreshCw, FiSettings } from 'react-icons/fi';
import { downloadCanvasPng } from '../../lib/ffs/exports';
import { Panel } from './FfsPrimitives';

/** Point shapes offered by the scatter customisers, mapped to Chart.js names. */
export const POINT_SHAPES = [
  { value: 'circle', label: 'Circle' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'rect', label: 'Square' },
  { value: 'rectRot', label: 'Diamond' },
] as const;

export type PointShape = (typeof POINT_SHAPES)[number]['value'];

/**
 * Chart shell providing the title bar, a collapsible settings drawer, a PNG
 * download, and an optional bin-size control. The chart itself is passed as a
 * render prop so it receives the canvas ref needed for export.
 */
export default function ChartCard({
  title,
  subtitle,
  settings,
  binSize,
  onBinSizeChange,
  onRedraw,
  filename,
  children,
  footer,
  height = 320,
}: {
  title: string;
  subtitle?: string;
  settings?: ReactNode;
  binSize?: number;
  onBinSizeChange?: (value: number) => void;
  onRedraw?: () => void;
  filename: string;
  children: (registerCanvas: (canvas: HTMLCanvasElement | null) => void) => ReactNode;
  /**
   * Read out under the plot. For what the chart says about the population —
   * a count, an exceedance — rather than for controls, which belong in the
   * settings drawer. Deliberately outside the canvas so it never lands in the
   * exported PNG twice.
   */
  footer?: ReactNode;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftBin, setDraftBin] = useState(binSize ?? 1000);

  const registerCanvas = (canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
  };

  return (
    <Panel>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold uppercase tracking-wide text-slate-800 dark:text-slate-100">
            {title}
          </h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onBinSizeChange && (
            <div className="flex items-center gap-1.5">
              <label className="whitespace-nowrap text-[10px] font-medium text-slate-500 dark:text-slate-400">
                Bin (m)
              </label>
              <input
                type="number"
                value={draftBin}
                min={10}
                step={50}
                onChange={(event) => setDraftBin(parseFloat(event.target.value) || 0)}
                className="w-[68px] rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs tabular-nums text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              />
              <button
                type="button"
                onClick={() => {
                  if (draftBin > 0) onBinSizeChange(draftBin);
                  onRedraw?.();
                }}
                className="inline-flex items-center gap-1 rounded-md border border-indigo-200 px-2 py-1 text-[11px] font-medium text-indigo-600 transition-colors hover:bg-indigo-50 dark:border-indigo-800/60 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
              >
                <FiRefreshCw className="h-3 w-3" /> Redraw
              </button>
            </div>
          )}

          {settings && (
            <button
              type="button"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-expanded={settingsOpen}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                settingsOpen
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-600 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400'
                  : 'border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-400'
              }`}
            >
              <FiSettings className="h-3 w-3" /> Customise
            </button>
          )}

          <button
            type="button"
            onClick={() => downloadCanvasPng(canvasRef.current, filename)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-400"
          >
            <FiDownload className="h-3 w-3" /> PNG
          </button>
        </div>
      </div>

      {settings && settingsOpen && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50">
          {settings}
        </div>
      )}

      <div className="relative w-full" style={{ height }}>
        {children(registerCanvas)}
      </div>

      {footer && <div className="mt-3">{footer}</div>}
    </Panel>
  );
}

/** Label + colour swatch pair used inside the chart settings drawers. */
export function ColorControl({
  label,
  color,
  onColorChange,
  shape,
  onShapeChange,
}: {
  label: string;
  color: string;
  onColorChange: (value: string) => void;
  shape?: PointShape;
  onShapeChange?: (value: PointShape) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-[56px] text-[11px] text-slate-600 dark:text-slate-300">{label}</span>
      <input
        type="color"
        value={color}
        onChange={(event) => onColorChange(event.target.value)}
        aria-label={`${label} colour`}
        className="h-6 w-8 cursor-pointer rounded border border-slate-300 bg-transparent p-0.5 dark:border-slate-600"
      />
      {shape && onShapeChange && (
        <select
          value={shape}
          onChange={(event) => onShapeChange(event.target.value as PointShape)}
          aria-label={`${label} marker shape`}
          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-700 focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          {POINT_SHAPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function SettingsSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
      {children}
    </p>
  );
}
