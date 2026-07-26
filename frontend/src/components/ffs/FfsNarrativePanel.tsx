import { useMemo, useState } from 'react';
import { FiDownload, FiImage, FiRefreshCw } from 'react-icons/fi';
import { exportNarrativeDoc } from '../../lib/ffs/exports';
import {
  DEFAULT_NARRATIVE_OPTIONS,
  buildNarrative,
  type NarrativeBlock,
  type NarrativeOptions,
} from '../../lib/ffs/narrative';
import type { FfsConfig, FfsScreenedResult, FfsScreeningConfig } from '../../lib/ffs/types';
import SynButton from '../ui/SynButton';
import { Callout, Panel } from './FfsPrimitives';

/**
 * The auto-generated engineering narrative. Every figure quoted is derived from
 * the current results, so the prose stays in step with the parameters on screen.
 */
export default function FfsNarrativePanel({
  items,
  config,
  screening,
  chartImages,
  onOpenCharts,
}: {
  items: FfsScreenedResult[];
  config: FfsConfig;
  screening: FfsScreeningConfig;
  chartImages: Record<string, string>;
  /** Switches to the Charts tab, which snapshots the figures. */
  onOpenCharts: () => void;
}) {
  const [options, setOptions] = useState<NarrativeOptions>(DEFAULT_NARRATIVE_OPTIONS);
  const [draft, setDraft] = useState<NarrativeOptions>(DEFAULT_NARRATIVE_OPTIONS);

  const blocks = useMemo(
    () => buildNarrative(items, config, screening, options),
    [items, config, screening, options],
  );

  const capturedCount = Object.keys(chartImages).length;

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <Panel className="!p-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Table 3-1 rows
            </span>
            <input
              type="number"
              value={draft.erfTableRows}
              min={1}
              max={100}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, erfTableRows: parseInt(event.target.value, 10) || 1 }))
              }
              className="w-[64px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs tabular-nums text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
          </label>

          <label className="flex items-center gap-2">
            <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Table 3-2 rows
            </span>
            <input
              type="number"
              value={draft.lifeTableRows}
              min={1}
              max={100}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, lifeTableRows: parseInt(event.target.value, 10) || 1 }))
              }
              className="w-[64px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs tabular-nums text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            />
          </label>

          <button
            type="button"
            onClick={() => setOptions(draft)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 dark:border-indigo-800/60 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
          >
            <FiRefreshCw className="h-3 w-3" /> Rebuild text
          </button>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {capturedCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-400">
                <FiImage className="h-3 w-3" /> {capturedCount} figure
                {capturedCount === 1 ? '' : 's'} ready
              </span>
            ) : (
              <SynButton type="button" variant="outline" size="sm" onClick={onOpenCharts}>
                <span className="inline-flex items-center gap-2">
                  <FiImage /> Open Charts to add figures
                </span>
              </SynButton>
            )}
            <SynButton
              type="button"
              variant="lime"
              size="sm"
              onClick={() => exportNarrativeDoc(blocks, config, chartImages)}
            >
              <span className="inline-flex items-center gap-2">
                <FiDownload /> Download Word
              </span>
            </SynButton>
          </div>
        </div>
      </Panel>

      {!capturedCount && (
        <Callout tone="warn">
          Figures come from the Charts tab. Open <strong>Charts</strong> once and they are snapshotted
          automatically, so the document below and the Word export both embed them.
        </Callout>
      )}

      {/* Document */}
      <Panel className="!px-6 !py-8 sm:!px-10">
        <article className="mx-auto max-w-[62rem]">
          {/* Title block */}
          <header className="mb-8 border-b border-slate-200 pb-5 dark:border-slate-700">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-600 dark:text-indigo-400">
              Fitness-for-service assessment
            </p>
            <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              {config.lineName || 'Pipeline assessment'}
            </h1>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {config.method === 'original' ? 'Original' : 'Modified'} ASME B31G ·{' '}
              {items.length.toLocaleString()} features · ILI{' '}
              {config.iliDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} ·
              Generated {new Date().toLocaleDateString('en-GB')}
            </p>
          </header>

          {blocks.map((block, index) => (
            <NarrativeBlockView key={index} block={block} chartImages={chartImages} />
          ))}
        </article>
      </Panel>
    </div>
  );
}

function NarrativeBlockView({
  block,
  chartImages,
}: {
  block: NarrativeBlock;
  chartImages: Record<string, string>;
}) {
  switch (block.kind) {
    case 'heading': {
      if (block.level === 1) {
        return (
          <h2 className="mt-8 mb-3 border-b-2 border-indigo-500 pb-1.5 text-lg font-bold text-slate-900 first:mt-0 dark:text-slate-50">
            {block.text}
          </h2>
        );
      }
      if (block.level === 2) {
        return (
          <h3 className="mt-6 mb-2.5 border-b border-slate-200 pb-1 text-base font-bold text-slate-800 dark:border-slate-700 dark:text-slate-100">
            {block.text}
          </h3>
        );
      }
      return (
        <h4 className="mt-5 mb-2 text-sm font-semibold text-indigo-600 dark:text-indigo-400">{block.text}</h4>
      );
    }

    case 'paragraph':
      return (
        <p className="mb-3.5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{block.text}</p>
      );

    case 'list':
      return (
        <ul className="mb-4 list-disc space-y-1.5 pl-6 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );

    case 'formula':
      return (
        <pre className="mb-4 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-[11.5px] leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
          {block.lines.join('\n')}
        </pre>
      );

    case 'table':
      return (
        <figure className="mb-5">
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-900/70">
                  {block.table.columns.map((column) => (
                    <th
                      key={column.header}
                      scope="col"
                      className={`whitespace-nowrap border-b border-slate-200 px-3 py-2 text-${
                        column.align ?? 'left'
                      } text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:text-slate-300`}
                    >
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/70">
                {block.table.rows.map((row, rowIndex) => {
                  const critical = block.table.criticalRows?.includes(rowIndex);
                  return (
                    <tr
                      key={rowIndex}
                      className={
                        critical
                          ? 'bg-amber-50/70 font-semibold dark:bg-amber-950/25'
                          : rowIndex % 2
                            ? 'bg-slate-50/60 dark:bg-slate-900/25'
                            : ''
                      }
                    >
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          className={`whitespace-nowrap px-3 py-1.5 text-${
                            block.table.columns[cellIndex]?.align ?? 'left'
                          } ${
                            block.table.columns[cellIndex]?.align === 'right' ? 'tabular-nums' : ''
                          } text-slate-700 dark:text-slate-300`}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <figcaption className="mt-2 text-center text-[11px] font-medium italic text-slate-500 dark:text-slate-400">
            {block.table.caption}
          </figcaption>
        </figure>
      );

    case 'figure': {
      const image = chartImages[block.chartId];
      return (
        <figure className="mb-5">
          {image ? (
            <img
              src={image}
              alt={block.caption}
              className="w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700"
            />
          ) : (
            <div className="grid place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-xs text-slate-400 dark:border-slate-600 dark:bg-slate-900/40">
              Capture figures to embed this chart
            </div>
          )}
          <figcaption className="mt-2 text-center text-[11px] font-medium italic text-slate-500 dark:text-slate-400">
            {block.caption}
          </figcaption>
        </figure>
      );
    }
  }
}
