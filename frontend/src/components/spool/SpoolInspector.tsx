/**
 * The detail rail: everything the engine knows about one anomaly, with the
 * previous run kept beside the current one so the change is read off directly
 * rather than worked out.
 *
 * Two tabs in the reference layout have no data behind them in this product and
 * are rendered disabled with the reason rather than filled with placeholders:
 *
 * - Signal — raw ILI sensor traces are never ingested; only vendor tallies are.
 * - Notes  — there is no annotation store, so a note typed here would vanish on
 *            close, which is worse than not offering the field.
 */

import { useState, type ReactNode } from 'react';
import { FiChevronRight, FiCrosshair, FiUsers } from 'react-icons/fi';

import { STATUS_LABEL, type SpoolFeature, type SpoolSide } from '../../domain/spoolFeatures.ts';
import { STATUS_COLOR, severityOf } from './spoolPalette.ts';

interface SpoolInspectorProps {
  feature: SpoolFeature | null;
  currentRunLabel: string;
  previousRunLabel: string;
  onFocusInView: (feature: SpoolFeature) => void;
  onShowNeighbours: (feature: SpoolFeature) => void;
  onOpenInTable: (feature: SpoolFeature) => void;
}

type Tab = 'details' | 'history' | 'signal' | 'notes';

function num(value: number | null, digits = 2, suffix = ''): string {
  return value === null ? '–' : `${value.toFixed(digits)}${suffix}`;
}

function DeltaChip({ value, digits = 1, suffix = '' }: { value: number | null; digits?: number; suffix?: string }) {
  if (value === null) return null;
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return <em className="spool-detail__delta is-flat">no change</em>;
  return (
    <em className={`spool-detail__delta ${rounded > 0 ? 'is-up' : 'is-down'}`}>
      {rounded > 0 ? '+' : ''}{rounded.toFixed(digits)}{suffix}
    </em>
  );
}

function Field({
  label,
  value,
  delta,
  tone,
}: {
  label: string;
  value: string;
  delta?: ReactNode;
  tone?: string;
}) {
  return (
    <div className="spool-detail__field">
      <dt>{label}</dt>
      <dd style={tone ? { color: tone } : undefined}>
        <span>{value}</span>
        {delta}
      </dd>
    </div>
  );
}

function RunColumn({ label, side }: { label: string; side: SpoolSide }) {
  if (!side.present) {
    return (
      <div className="spool-detail__run is-absent">
        <h4>{label}</h4>
        <p>Not reported in this run.</p>
      </div>
    );
  }
  return (
    <div className="spool-detail__run">
      <h4>{label}</h4>
      <dl>
        <div><dt>ID</dt><dd>{side.id ?? '–'}</dd></div>
        <div><dt>Reported LD</dt><dd>{num(side.reportedM, 3, ' m')}</dd></div>
        <div><dt>Master axis</dt><dd>{num(side.maM, 3, ' m')}</dd></div>
        <div><dt>Clock</dt><dd>{side.clockLabel}</dd></div>
        <div><dt>Depth</dt><dd>{num(side.depthPct, 1, ' %WT')}</dd></div>
        <div><dt>Length</dt><dd>{num(side.lengthMm, 0, ' mm')}</dd></div>
        <div><dt>Width</dt><dd>{num(side.widthMm, 0, ' mm')}</dd></div>
        <div><dt>Wall</dt><dd>{num(side.wtMm, 1, ' mm')}</dd></div>
        <div><dt>Remaining WT</dt><dd>{num(side.remainingWtMm, 2, ' mm')}</dd></div>
        <div><dt>ERF</dt><dd>{num(side.erf, 2)}</dd></div>
      </dl>
    </div>
  );
}

export default function SpoolInspector({
  feature,
  currentRunLabel,
  previousRunLabel,
  onFocusInView,
  onShowNeighbours,
  onOpenInTable,
}: SpoolInspectorProps) {
  const [tab, setTab] = useState<Tab>('details');

  if (!feature) {
    return (
      <aside className="spool-detail spool-detail--empty">
        <h3 className="spool-detail__title">Anomaly details</h3>
        <p>Pick an anomaly on the pipe, in the unrolled view, or in the list.</p>
      </aside>
    );
  }

  const current = feature.current;
  const previous = feature.previous;
  const depth = current.depthPct ?? previous.depthPct;
  const severity = severityOf(depth);
  const source = current.present ? current : previous;

  return (
    <aside className="spool-detail">
      <div className="spool-detail__head">
        <h3 className="spool-detail__title">Anomaly details</h3>
        <div className="spool-detail__id">
          <strong>{feature.id}</strong>
          <span className="ds-badge ds-badge--neutral ds-badge--pill">
            {source.featureType || feature.featureClass.replace('-', ' ')}
          </span>
        </div>
      </div>

      <div className="spool-detail__tabs" role="tablist">
        {([
          ['details', 'Details', null],
          ['history', 'History', null],
          ['signal', 'Signal', 'Raw ILI signal traces are not ingested by Synapse — only vendor tallies.'],
          ['notes', 'Notes', 'No annotation store exists yet, so a note here could not be saved.'],
        ] as Array<[Tab, string, string | null]>).map(([key, label, disabledReason]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            disabled={Boolean(disabledReason)}
            title={disabledReason ?? undefined}
            className={`spool-detail__tab ${tab === key ? 'is-active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <dl className="spool-detail__fields">
          <Field label="Run (current)" value={currentRunLabel} />
          <Field label="Run (previous)" value={previousRunLabel} />
          <Field
            label="Match status"
            value={STATUS_LABEL[feature.status]}
            tone={STATUS_COLOR[feature.status]}
          />
          <Field label="Master axis" value={`${feature.maM.toFixed(3)} m`} delta={<DeltaChip value={feature.maShiftM} digits={3} suffix=" m" />} />
          <Field label="Clock position" value={feature.clockLabel} />
          <Field label="Length (axial)" value={num(current.lengthMm ?? previous.lengthMm, 0, ' mm')} delta={<DeltaChip value={feature.lengthDeltaMm} digits={0} suffix=" mm" />} />
          <Field label="Width (circ.)" value={num(current.widthMm ?? previous.widthMm, 0, ' mm')} delta={<DeltaChip value={feature.widthDeltaMm} digits={0} suffix=" mm" />} />
          <Field label="Max depth" value={num(depth, 1, ' %WT')} delta={<DeltaChip value={feature.depthDeltaPct} digits={1} suffix=" %WT" />} />
          <Field label="Wall thickness" value={num(current.wtMm ?? previous.wtMm, 1, ' mm')} />
          <Field label="Remaining WT" value={num(current.remainingWtMm ?? previous.remainingWtMm, 2, ' mm')} delta={<DeltaChip value={feature.remainingWtDeltaMm} digits={2} suffix=" mm" />} />
          <Field label="ERF (vendor)" value={num(current.erf ?? previous.erf, 2)} delta={<DeltaChip value={feature.erfDelta} digits={2} />} />
          <Field label="Safe pressure (vendor)" value={num(current.psafeBar ?? previous.psafeBar, 1, ' bar')} />
          <Field
            label="Depth growth"
            value={feature.depthGrowthPctPerYear === null ? '–' : `${feature.depthGrowthPctPerYear.toFixed(2)} %WT/yr`}
          />
          <Field
            label="Length growth"
            value={feature.lengthGrowthMmPerYear === null ? '–' : `${feature.lengthGrowthMmPerYear.toFixed(1)} mm/yr`}
          />
          <Field label="Interval" value={feature.intervalYears === null ? '–' : `${feature.intervalYears} yr`} />
          <Field label="Internal / External" value={(current.external ?? previous.external) === null ? '–' : ((current.external ?? previous.external) ? 'External' : 'Internal')} />
          <Field label="Joint no." value={source.jointNo ?? '–'} />
          <Field label="Distance from U/S GW" value={num(source.distGwM, 3, ' m')} />
          <Field label="Section" value={feature.section ?? '–'} />
          <Field label="Severity" value={severity.label} tone={severity.color} />
          {feature.bypassReason && <Field label="Bypass reason" value={feature.bypassReason} tone="var(--ds-warning)" />}
          {feature.physicsWarning && <Field label="Physics warning" value={feature.physicsWarning} tone="var(--ds-danger)" />}
          {feature.comment && <Field label="Vendor comment" value={feature.comment} />}
        </dl>
      )}

      {tab === 'history' && (
        <div className="spool-detail__history">
          <RunColumn label={previousRunLabel} side={previous} />
          <RunColumn label={currentRunLabel} side={current} />
          <p className="spool-detail__note">
            This pane reads the pair this row belongs to. For a chain of three or more
            inspections, the lane timeline behind the workspace carries every run.
          </p>
        </div>
      )}

      <div className="spool-detail__actions">
        <button type="button" className="ds-btn ds-btn--sm ds-btn--primary" onClick={() => onFocusInView(feature)}>
          <FiCrosshair /> Focus view
        </button>
        <button type="button" className="ds-btn ds-btn--sm ds-btn--secondary" onClick={() => onShowNeighbours(feature)}>
          <FiUsers /> Show neighbours
        </button>
        <button type="button" className="ds-btn ds-btn--sm ds-btn--ghost" onClick={() => onOpenInTable(feature)}>
          Open in results table <FiChevronRight />
        </button>
      </div>
    </aside>
  );
}
