/**
 * Layers and filters rail for the Spool Detail View.
 *
 * Filtering is applied live rather than behind an Apply button: every pane in
 * the workspace reads the same filtered set, so a deferred apply would leave
 * the 3D pipe, the unrolled view and the list disagreeing until the click.
 * The count chip at the bottom carries the same information the Apply button
 * would have — how much of the spool is currently on screen.
 */

import type { ReactNode } from 'react';

import type {
  SpoolFeatureClass,
  SpoolFilters,
  SpoolLayers,
  SpoolMatchStatus,
} from '../../domain/spoolFeatures.ts';
import { STATUS_LABEL } from '../../domain/spoolFeatures.ts';
import { STATUS_COLOR } from './spoolPalette.ts';

interface SpoolControlPanelProps {
  layers: SpoolLayers;
  onLayersChange: (layers: SpoolLayers) => void;
  filters: SpoolFilters;
  onFiltersChange: (filters: SpoolFilters) => void;
  onReset: () => void;
  counts: Record<SpoolFeatureClass, number>;
  extent: { startM: number; endM: number };
  visibleCount: number;
  totalCount: number;
  odMm: number | null;
  onOdChange: (odMm: number | null) => void;
  hasComparison: boolean;
}

const CLASS_LABEL: Record<SpoolFeatureClass, string> = {
  weld: 'Girth Welds',
  'metal-loss': 'Metal Loss',
  dent: 'Dents',
  'crack-like': 'Crack-like Features',
  other: 'Other Features',
};

const CLASS_ORDER: SpoolFeatureClass[] = ['weld', 'metal-loss', 'dent', 'crack-like', 'other'];
const STATUS_ORDER: SpoolMatchStatus[] = ['matched-no-growth', 'matched-growth', 'new', 'prev-only', 'bypassed'];

function ClockDial({ fromDeg, toDeg }: { fromDeg: number; toDeg: number }) {
  const size = 78;
  const centre = size / 2;
  const radius = size / 2 - 8;
  const full = toDeg - fromDeg >= 360 || (fromDeg === 0 && toDeg === 360);

  // SVG y grows downward, and 12:00 must sit at the top: x = sin, y = −cos.
  const point = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return [centre + Math.sin(rad) * radius, centre - Math.cos(rad) * radius];
  };
  const [x1, y1] = point(fromDeg);
  const [x2, y2] = point(toDeg);
  const sweep = ((toDeg - fromDeg) % 360 + 360) % 360;
  const largeArc = sweep > 180 ? 1 : 0;

  return (
    <svg width={size} height={size} aria-hidden="true" className="spool-dial">
      <circle cx={centre} cy={centre} r={radius} fill="var(--ds-surface-inset)" stroke="var(--ds-line-strong)" />
      {full ? (
        <circle cx={centre} cy={centre} r={radius} fill="var(--ds-primary-soft)" opacity={0.9} />
      ) : (
        <path
          d={`M ${centre} ${centre} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`}
          fill="var(--ds-primary)"
          opacity={0.28}
          stroke="var(--ds-primary)"
          strokeWidth={1}
        />
      )}
      {[0, 3, 6, 9].map((hour) => {
        const [tx, ty] = point(hour * 30);
        return (
          <text
            key={hour}
            x={centre + (tx - centre) * 1.24}
            y={centre + (ty - centre) * 1.24 + 3}
            textAnchor="middle"
            fontSize={8}
            fill="var(--ds-muted)"
          >
            {hour === 0 ? 12 : hour}
          </text>
        );
      })}
    </svg>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="spool-rail__row">
      <span>{label}</span>
      {children}
    </label>
  );
}

export default function SpoolControlPanel({
  layers,
  onLayersChange,
  filters,
  onFiltersChange,
  onReset,
  counts,
  extent,
  visibleCount,
  totalCount,
  odMm,
  onOdChange,
  hasComparison,
}: SpoolControlPanelProps) {
  const setFilter = <K extends keyof SpoolFilters>(key: K, value: SpoolFilters[K]) => {
    onFiltersChange({ ...filters, [key]: value });
  };
  const toggleLayer = (key: keyof SpoolLayers) => {
    onLayersChange({ ...layers, [key]: !layers[key] });
  };

  return (
    <aside className="spool-rail">
      <section>
        <h3 className="spool-rail__title">Layers</h3>
        {CLASS_ORDER.map((key) => (
          <label key={key} className="spool-rail__check">
            <input type="checkbox" checked={layers[key]} onChange={() => toggleLayer(key)} />
            <span>{CLASS_LABEL[key]}</span>
            <em>{counts[key] ?? 0}</em>
          </label>
        ))}

        {hasComparison && (
          <>
            <div className="spool-rail__divider" />
            <label className="spool-rail__check">
              <input type="checkbox" checked={layers.currentRun} onChange={() => toggleLayer('currentRun')} />
              <span>Current run</span>
            </label>
            <label className="spool-rail__check">
              <input type="checkbox" checked={layers.previousRun} onChange={() => toggleLayer('previousRun')} />
              <span>Previous run (ghost)</span>
            </label>
          </>
        )}
      </section>

      <section>
        <h3 className="spool-rail__title">Filters</h3>

        <Row label="Anomaly type">
          <select
            className="ds-select ds-select--sm"
            value={filters.featureClass}
            onChange={(event) => setFilter('featureClass', event.target.value as SpoolFilters['featureClass'])}
          >
            <option value="all">All</option>
            {CLASS_ORDER.filter((key) => key !== 'weld').map((key) => (
              <option key={key} value={key}>{CLASS_LABEL[key]}</option>
            ))}
          </select>
        </Row>

        <Row label="Internal / External">
          <select
            className="ds-select ds-select--sm"
            value={filters.surface}
            onChange={(event) => setFilter('surface', event.target.value as SpoolFilters['surface'])}
          >
            <option value="all">All</option>
            <option value="internal">Internal</option>
            <option value="external">External</option>
          </select>
        </Row>

        <Row label="Depth / severity">
          <select
            className="ds-select ds-select--sm"
            value={filters.depthBand}
            onChange={(event) => setFilter('depthBand', event.target.value as SpoolFilters['depthBand'])}
          >
            <option value="all">All</option>
            <option value="lt20">Below 20 %WT</option>
            <option value="20-40">20 – 40 %WT</option>
            <option value="40-60">40 – 60 %WT</option>
            <option value="gte60">60 %WT and above</option>
          </select>
        </Row>

        <Row label="Match status">
          <select
            className="ds-select ds-select--sm"
            value={filters.status}
            onChange={(event) => setFilter('status', event.target.value as SpoolFilters['status'])}
          >
            <option value="all">All</option>
            {STATUS_ORDER.map((status) => (
              <option key={status} value={status}>{STATUS_LABEL[status]}</option>
            ))}
          </select>
        </Row>

        <Row label="Growth">
          <select
            className="ds-select ds-select--sm"
            value={filters.growth}
            onChange={(event) => setFilter('growth', event.target.value as SpoolFilters['growth'])}
          >
            <option value="all">All</option>
            <option value="growing">Growing only</option>
            <option value="stable">Stable only</option>
          </select>
        </Row>

        <div className="spool-rail__clock">
          <div className="spool-rail__clock-fields">
            <span className="spool-rail__label">Clock position</span>
            <div className="spool-rail__clock-pair">
              <select
                className="ds-select ds-select--sm"
                aria-label="Clock window start"
                value={filters.clockFromDeg}
                onChange={(event) => setFilter('clockFromDeg', Number(event.target.value))}
              >
                {Array.from({ length: 12 }, (_unused, hour) => (
                  <option key={hour} value={hour * 30}>{`${hour === 0 ? 12 : hour}:00`}</option>
                ))}
              </select>
              <span>to</span>
              <select
                className="ds-select ds-select--sm"
                aria-label="Clock window end"
                value={filters.clockToDeg}
                onChange={(event) => setFilter('clockToDeg', Number(event.target.value))}
              >
                {Array.from({ length: 12 }, (_unused, hour) => (
                  <option key={hour} value={hour * 30}>{`${hour === 0 ? 12 : hour}:00`}</option>
                ))}
                <option value={360}>12:00 (full)</option>
              </select>
            </div>
          </div>
          <ClockDial fromDeg={filters.clockFromDeg} toDeg={filters.clockToDeg} />
        </div>

        <div className="spool-rail__range">
          <span className="spool-rail__label">Master axis (m)</span>
          <div className="spool-rail__range-pair">
            <input
              className="ds-input ds-input--sm"
              type="number"
              step="0.01"
              aria-label="Master axis window start"
              value={filters.maStartM}
              min={extent.startM}
              max={filters.maEndM}
              onChange={(event) => setFilter('maStartM', Number(event.target.value))}
            />
            <span>to</span>
            <input
              className="ds-input ds-input--sm"
              type="number"
              step="0.01"
              aria-label="Master axis window end"
              value={filters.maEndM}
              min={filters.maStartM}
              max={extent.endM}
              onChange={(event) => setFilter('maEndM', Number(event.target.value))}
            />
          </div>
          <input
            className="spool-rail__slider"
            type="range"
            aria-label="Master axis window end slider"
            min={extent.startM}
            max={extent.endM}
            step={(extent.endM - extent.startM) / 200 || 0.01}
            value={filters.maEndM}
            onChange={(event) => setFilter('maEndM', Number(event.target.value))}
          />
        </div>
      </section>

      <section>
        <h3 className="spool-rail__title">Pipe geometry</h3>
        <Row label="Outside diameter (mm)">
          <input
            className="ds-input ds-input--sm"
            type="number"
            step="1"
            placeholder="unset"
            value={odMm ?? ''}
            onChange={(event) => {
              const value = Number(event.target.value);
              onOdChange(event.target.value === '' || !Number.isFinite(value) || value <= 0 ? null : value);
            }}
          />
        </Row>
        <p className="spool-rail__hint">
          {odMm === null
            ? 'Without a diameter, defect widths are drawn at a nominal arc — the axial length stays true to scale.'
            : 'Widths are drawn as true arcs on this diameter.'}
        </p>
      </section>

      <section>
        <h3 className="spool-rail__title">Legend</h3>
        {STATUS_ORDER.map((status) => (
          <div key={status} className="spool-rail__legend">
            <i style={{ background: STATUS_COLOR[status] }} />
            <span>{STATUS_LABEL[status]}</span>
          </div>
        ))}
      </section>

      <div className="spool-rail__footer">
        <span>{visibleCount.toLocaleString()} of {totalCount.toLocaleString()} shown</span>
        <button type="button" className="ds-btn ds-btn--sm ds-btn--secondary" onClick={onReset}>
          Reset filters
        </button>
      </div>
    </aside>
  );
}
