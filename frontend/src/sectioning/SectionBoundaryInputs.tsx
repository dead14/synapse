import { useMemo, useState } from 'react';
import { FiCornerDownLeft, FiCornerDownRight, FiSearch } from 'react-icons/fi';

import { Button, Input, Segmented } from '../components/ds';
import type { SectionBoundary } from '../wizard/matchingSections';
import { formatKm, parsePosition, snapToLockedGw, type SnapResult } from './sectionBuilder';

export type BoundaryEdge = 'start' | 'end';

interface Props {
  boundaries: SectionBoundary[];
  startIndex: number | null;
  endIndex: number | null;
  onSetBoundary: (edge: BoundaryEdge, index: number) => void;
}

type Mode = 'kp' | 'weld';

/** Typed KP with a live readout of what it will snap to. */
function KpEntry({ boundaries, onSetBoundary }: Pick<Props, 'boundaries' | 'onSetBoundary'>) {
  const [unit, setUnit] = useState<'km' | 'm'>('km');
  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');

  const startSnap = useMemo(() => {
    const metres = parsePosition(startText, unit);
    return metres === null ? null : snapToLockedGw(boundaries, metres);
  }, [boundaries, startText, unit]);

  const endSnap = useMemo(() => {
    const metres = parsePosition(endText, unit);
    return metres === null ? null : snapToLockedGw(boundaries, metres);
  }, [boundaries, endText, unit]);

  const apply = () => {
    if (startSnap) onSetBoundary('start', startSnap.index);
    if (endSnap) onSetBoundary('end', endSnap.index);
  };

  const deviationLabel = (snap: SnapResult<SectionBoundary> | null) => {
    if (!snap) return 'Enter a position';
    const sign = snap.deviationM >= 0 ? '−' : '+';
    return `${snap.pair.label} · ${formatKm(snap.pair.newDistance)} (${sign}${Math.abs(snap.deviationM).toFixed(2)} m)`;
  };

  return (
    <div className="sec-kp">
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <span className="ds-panel__eyebrow">Type a position on the NEW axis</span>
        <Segmented<'km' | 'm'>
          ariaLabel="Position unit"
          value={unit}
          onChange={setUnit}
          options={[
            { value: 'km', label: 'km' },
            { value: 'm', label: 'm' },
          ]}
        />
      </div>

      <div className="sec-kp__grid">
        <div className="ds-field">
          <label className="ds-field__label" htmlFor="sec-kp-start">Start</label>
          <Input
            id="sec-kp-start"
            data
            inputMode="decimal"
            placeholder={unit === 'km' ? 'e.g. 2.400' : 'e.g. 2400'}
            value={startText}
            onChange={(event) => setStartText(event.target.value)}
          />
          <span className={`ds-field__hint${startText && !startSnap ? ' ds-field__hint--error' : ''}`}>
            {startText && !startSnap ? 'Not a valid position' : deviationLabel(startSnap)}
          </span>
        </div>

        <div className="ds-field">
          <label className="ds-field__label" htmlFor="sec-kp-end">End</label>
          <Input
            id="sec-kp-end"
            data
            inputMode="decimal"
            placeholder={unit === 'km' ? 'e.g. 5.100' : 'e.g. 5100'}
            value={endText}
            onChange={(event) => setEndText(event.target.value)}
          />
          <span className={`ds-field__hint${endText && !endSnap ? ' ds-field__hint--error' : ''}`}>
            {endText && !endSnap ? 'Not a valid position' : deviationLabel(endSnap)}
          </span>
        </div>

        <Button variant="secondary" disabled={!startSnap && !endSnap} onClick={apply}>
          Snap to GW
        </Button>
      </div>
    </div>
  );
}

/** Searchable locked-GW list — set either boundary straight from the row. */
function WeldPicker({ boundaries, startIndex, endIndex, onSetBoundary }: Props) {
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const indexed = boundaries.map((pair, index) => ({ pair, index }));
    if (!needle) return indexed.slice(0, 200);
    return indexed
      .filter(({ pair }) =>
        pair.label.toLowerCase().includes(needle)
        || pair.newId?.toLowerCase().includes(needle)
        || pair.oldId?.toLowerCase().includes(needle)
        || pair.newDistance.toFixed(3).includes(needle)
        || (pair.newDistance / 1000).toFixed(3).includes(needle))
      .slice(0, 200);
  }, [boundaries, query]);

  return (
    <div className="sec-weld">
      <div className="ds-row" style={{ flexWrap: 'nowrap' }}>
        <FiSearch aria-hidden="true" style={{ color: 'var(--ds-muted)', flex: '0 0 auto' }} />
        <Input
          small
          type="search"
          aria-label="Search locked girth welds"
          placeholder="Search weld ID or distance…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="ds-toolbar__hint" style={{ flex: '0 0 auto' }}>
          {rows.length.toLocaleString()} of {boundaries.length.toLocaleString()}
        </span>
      </div>

      <div className="ds-table-wrap sec-weld__scroll">
        <table className="ds-table">
          <thead>
            <tr>
              <th>NEW weld</th>
              <th className="ds-table__num">NEW (m)</th>
              <th>OLD weld</th>
              <th className="ds-table__num">OLD (m)</th>
              <th style={{ textAlign: 'right' }}>Use as</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ pair, index }) => {
              const isStart = index === startIndex;
              const isEnd = index === endIndex;
              return (
                <tr key={pair.key} className={isStart || isEnd ? 'is-selected' : undefined}>
                  <th scope="row">{pair.newId ?? '—'}{pair.side === 'NEW' ? ' (unpaired)' : ''}</th>
                  <td className="ds-table__num">{pair.newDistance.toFixed(3)}</td>
                  <td>{pair.oldId ?? '—'}{pair.side === 'OLD' ? ' (unpaired)' : ''}</td>
                  <td className="ds-table__num">{pair.oldDistance.toFixed(3)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="ds-table__actions">
                      <Button
                        size="xs"
                        variant={isStart ? 'primary' : 'secondary'}
                        startIcon={<FiCornerDownRight aria-hidden="true" />}
                        aria-label={`Set ${pair.label} as section start`}
                        onClick={() => onSetBoundary('start', index)}
                      >
                        Start
                      </Button>
                      <Button
                        size="xs"
                        variant={isEnd ? 'primary' : 'secondary'}
                        startIcon={<FiCornerDownLeft aria-hidden="true" />}
                        aria-label={`Set ${pair.label} as section end`}
                        onClick={() => onSetBoundary('end', index)}
                      >
                        End
                      </Button>
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--ds-muted)', textAlign: 'center' }}>
                  No locked GW matches “{query}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Alternative ways to set a boundary when dragging the rail is not precise enough. */
export default function SectionBoundaryInputs(props: Props) {
  const [mode, setMode] = useState<Mode>('kp');

  return (
    <div className="sec-inputs">
      <Segmented<Mode>
        ariaLabel="Boundary entry method"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'kp', label: 'Type KP' },
          { value: 'weld', label: 'Pick weld' },
        ]}
      />
      {mode === 'kp' ? <KpEntry {...props} /> : <WeldPicker {...props} />}
    </div>
  );
}
