import { useMemo, useState } from 'react';

import { bandLengthM, formatBandRange, type SectionBand } from '../../lib/sections/bands';

/**
 * The clickable list of sections sitting above a distance chart.
 *
 * The ribbon drawn on the canvas answers "where is RC#86"; this answers "which
 * sections are there at all", and gives the selection a keyboard-reachable
 * control, since a canvas click target is not one. Both drive the same held
 * band, so clicking either place highlights the same stretch everywhere.
 */
export default function SectionBandLegend({
  bands,
  selectedId,
  onSelect,
  collapseAfter = 12,
}: {
  bands: SectionBand[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Long lines carry hundreds of sections; show a slice until asked for the rest. */
  collapseAfter?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  const visible = useMemo(
    () => (expanded ? bands : bands.slice(0, collapseAfter)),
    [bands, collapseAfter, expanded],
  );

  if (bands.length === 0) return null;

  const selected = bands.find((band) => band.id === selectedId) ?? null;

  return (
    <div className="section-band-legend">
      <div className="section-band-legend__row" role="group" aria-label="Sections along this chart">
        <span className="section-band-legend__title">Sections</span>
        {visible.map((band) => {
          const held = band.id === selectedId;
          return (
            <button
              key={band.id}
              type="button"
              aria-pressed={held}
              onClick={() => onSelect(held ? null : band.id)}
              className={`section-band-legend__chip${held ? ' is-held' : ''}`}
              title={`${band.name} · ${formatBandRange(band)} · ${band.count.toLocaleString()} feature(s)`}
            >
              <span className="section-band-legend__swatch" style={{ background: band.color }} aria-hidden="true" />
              {band.name}
            </button>
          );
        })}

        {bands.length > collapseAfter && (
          <button
            type="button"
            className="section-band-legend__more"
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? 'Show fewer' : `+${bands.length - collapseAfter} more`}
          </button>
        )}

        {selected && (
          <button type="button" className="section-band-legend__more" onClick={() => onSelect(null)}>
            Clear highlight
          </button>
        )}
      </div>

      {selected && (
        <p className="section-band-legend__detail">
          <strong>{selected.name}</strong> spans {formatBandRange(selected)}
          {bandLengthM(selected) > 0 && ` (${bandLengthM(selected).toLocaleString(undefined, { maximumFractionDigits: 0 })} m of reported extent)`}
          {' '}and holds {selected.count.toLocaleString()} feature(s). Click the band again to release it.
        </p>
      )}
    </div>
  );
}
