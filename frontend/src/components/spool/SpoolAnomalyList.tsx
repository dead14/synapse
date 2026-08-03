/**
 * The anomaly table of the Spool Detail View: the same filtered set the 3D and
 * unrolled panes draw, in the order an engineer reads a tally — along the pipe.
 *
 * Columns only exist when the data behind them does. ERF is shown because the
 * engine carries the vendor's ERF when the tally had one, and blank when it did
 * not. There is no match-confidence column: the alignment engine emits no such
 * score, and a number invented here would be read as one that came out of the
 * matching.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { FiSearch } from 'react-icons/fi';

import { STATUS_LABEL, type SpoolFeature } from '../../domain/spoolFeatures.ts';
import { STATUS_COLOR, depthColor, type DepthPalette } from './spoolPalette.ts';

interface SpoolAnomalyListProps {
  features: SpoolFeature[];
  selectedKey: string | null;
  onSelect: (feature: SpoolFeature) => void;
  onHover: (feature: SpoolFeature | null) => void;
  palette: DepthPalette;
}

type SortKey = 'maM' | 'depth' | 'growth' | 'erf';

const PAGE_SIZE = 9;

function fmt(value: number | null, digits = 0, suffix = ''): string {
  return value === null ? '–' : `${value.toFixed(digits)}${suffix}`;
}

function signed(value: number | null, digits = 1): string {
  if (value === null) return '–';
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(digits)}`;
}

export default function SpoolAnomalyList({
  features,
  selectedKey,
  onSelect,
  onHover,
  palette,
}: SpoolAnomalyListProps) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'maM', desc: false });
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? features.filter((feature) => (
        feature.id.toLowerCase().includes(needle)
        || feature.current.featureType.toLowerCase().includes(needle)
        || feature.previous.featureType.toLowerCase().includes(needle)
        || (feature.section ?? '').toLowerCase().includes(needle)
      ))
      : features;

    const value = (feature: SpoolFeature): number => {
      if (sort.key === 'maM') return feature.maM;
      if (sort.key === 'depth') return feature.current.depthPct ?? feature.previous.depthPct ?? -1;
      if (sort.key === 'growth') return feature.depthDeltaPct ?? Number.NEGATIVE_INFINITY;
      return feature.current.erf ?? -1;
    };
    return [...matched].sort((left, right) => (sort.desc ? -1 : 1) * (value(left) - value(right)));
  }, [features, query, sort]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => { setPage(0); }, [query, features]);

  // Selecting from another pane must bring the row into view, not leave the
  // reviewer hunting for it three pages away.
  useEffect(() => {
    if (!selectedKey) return;
    const index = rows.findIndex((feature) => feature.key === selectedKey);
    if (index < 0) return;
    const target = Math.floor(index / PAGE_SIZE);
    setPage((current) => (current === target ? current : target));
  }, [selectedKey, rows]);

  useEffect(() => {
    bodyRef.current?.querySelector('tr.is-selected')?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey, safePage]);

  const header = (key: SortKey, label: string, numeric = true) => (
    <th
      scope="col"
      className={numeric ? 'ds-table__num' : undefined}
      aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        className="spool-list__sort"
        onClick={() => setSort((current) => ({ key, desc: current.key === key ? !current.desc : false }))}
      >
        {label}{sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );

  return (
    <div className="spool-list">
      <div className="spool-list__head">
        <h3>Anomaly list <span>({rows.length.toLocaleString()})</span></h3>
        <label className="spool-list__search">
          <FiSearch aria-hidden="true" />
          <input
            className="ds-input ds-input--sm"
            type="search"
            placeholder="Search anomaly…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search anomalies"
          />
        </label>
      </div>

      <div className="spool-list__scroll">
        <table className="ds-table ds-table--clickable">
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Type</th>
              {header('maM', 'MA (m)')}
              <th scope="col">Clock</th>
              <th scope="col" className="ds-table__num">Length (mm)</th>
              {header('depth', 'Max depth (%WT)')}
              {header('erf', 'ERF')}
              <th scope="col">Match status</th>
              {header('growth', 'Growth (Δ%WT)')}
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {pageRows.map((feature) => {
              const depth = feature.current.depthPct ?? feature.previous.depthPct;
              return (
                <tr
                  key={feature.key}
                  className={feature.key === selectedKey ? 'is-selected' : undefined}
                  onClick={() => onSelect(feature)}
                  onMouseEnter={() => onHover(feature)}
                  onMouseLeave={() => onHover(null)}
                >
                  <th scope="row">{feature.id}</th>
                  <td>{feature.current.featureType || feature.previous.featureType || '–'}</td>
                  <td className="ds-table__num">{feature.maM.toFixed(2)}</td>
                  <td>{feature.clockLabel}</td>
                  <td className="ds-table__num">{fmt(feature.current.lengthMm ?? feature.previous.lengthMm, 0)}</td>
                  <td className="ds-table__num">
                    <span className="spool-list__depth">
                      <i style={{ background: depthColor(depth, palette) }} />
                      {fmt(depth, 0)}
                    </span>
                  </td>
                  <td className="ds-table__num">{fmt(feature.current.erf ?? feature.previous.erf, 2)}</td>
                  <td>
                    <span className="spool-list__status">
                      <i style={{ background: STATUS_COLOR[feature.status] }} />
                      {STATUS_LABEL[feature.status]}
                    </span>
                  </td>
                  <td className="ds-table__num">{signed(feature.depthDeltaPct)}</td>
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={9} className="spool-list__empty">
                  No anomaly matches the current layers and filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="spool-list__pager">
        <button
          type="button"
          className="ds-btn ds-btn--xs ds-btn--ghost"
          disabled={safePage === 0}
          onClick={() => setPage(safePage - 1)}
        >
          Previous
        </button>
        <span>Page {safePage + 1} of {pageCount}</span>
        <button
          type="button"
          className="ds-btn ds-btn--xs ds-btn--ghost"
          disabled={safePage >= pageCount - 1}
          onClick={() => setPage(safePage + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
