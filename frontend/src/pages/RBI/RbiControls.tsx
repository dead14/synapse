/**
 * Form primitives for the API 580 wizard.
 *
 * Thin wrappers over the design system, not a fourth design language: every one
 * of them renders `ds-field`, `ds-input`, `ds-select`, `ds-textarea`. They exist
 * because a ten-step document has several hundred fields, and repeating the
 * label/hint/parse wiring at each call site is how a wizard drifts into looking
 * like six different products.
 *
 * The one behaviour worth naming: a numeric field reads and writes `number |
 * null`, and an empty box means null, not zero. Across this record a missing
 * number is a documented absence — §16.7 turns on the difference — and coercing
 * it to 0 would silently answer a question nobody asked.
 */

import type { ReactNode } from 'react';
import { FiTrash2 } from 'react-icons/fi';

import { Badge, Button, Field, Input, Panel, PanelBody, PanelHeader, Select, Textarea } from '../../components/ds';
import type { Option } from '../../lib/rbi/catalogues';

/* ── Panels ────────────────────────────────────────────────────────────────── */

export function StepPanel({
  title,
  section,
  blurb,
  actions,
  children,
}: {
  title: string;
  section: string;
  blurb?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel>
      <PanelHeader eyebrow={`API 580 ${section}`} title={title} subtitle={blurb} actions={actions} />
      <PanelBody>{children}</PanelBody>
    </Panel>
  );
}

/** Two-column field grid. Collapses to one column below the tablet break. */
export function FieldGrid({ children, columns = 2 }: { children: ReactNode; columns?: 2 | 3 }) {
  return <div className={`rbi-grid rbi-grid--${columns}`}>{children}</div>;
}

/** A field that should run the full width of the grid it sits in. */
export function FullWidth({ children }: { children: ReactNode }) {
  return <div className="rbi-grid__full">{children}</div>;
}

/* ── Fields ────────────────────────────────────────────────────────────────── */

interface BaseFieldProps {
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  disabled,
}: BaseFieldProps & {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {(props) => (
        <Input
          {...props}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

export function DateField({
  label,
  hint,
  value,
  onChange,
  disabled,
}: BaseFieldProps & { value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label} hint={hint}>
      {(props) => (
        <Input
          {...props}
          type="date"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * A number, or nothing.
 *
 * Empty is `null` and stays `null`. Everywhere in this record that matters: a
 * blank corrosion allowance changes which wall the rate screen measures against,
 * a blank outage cost changes what the production consequence is scored from,
 * and both of those facts are reported. Zero would say something different and
 * would say it silently.
 */
export function NumberField({
  label,
  hint,
  value,
  onChange,
  unit,
  min,
  step = 'any',
  disabled,
}: BaseFieldProps & {
  value: number | null;
  onChange: (value: number | null) => void;
  unit?: string;
  min?: number;
  step?: number | 'any';
}) {
  return (
    <Field label={unit ? <>{label} <span className="rbi-unit">{unit}</span></> : label} hint={hint}>
      {(props) => (
        <Input
          {...props}
          data
          type="number"
          inputMode="decimal"
          min={min}
          step={step}
          disabled={disabled}
          value={value === null ? '' : String(value)}
          onChange={(event) => {
            const raw = event.target.value.trim();
            if (raw === '') return onChange(null);
            const parsed = Number(raw);
            return onChange(Number.isFinite(parsed) ? parsed : null);
          }}
        />
      )}
    </Field>
  );
}

export function PickField<T extends string>({
  label,
  hint,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: BaseFieldProps & {
  value: T | '';
  onChange: (value: T) => void;
  options: readonly Option<T>[];
  placeholder?: string;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <Field label={label} hint={selected?.hint ?? hint}>
      {(props) => (
        <Select
          {...props}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as T)}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Select>
      )}
    </Field>
  );
}

export function NoteField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  rows = 3,
  disabled,
}: BaseFieldProps & {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <Field label={label} hint={hint}>
      {(props) => (
        <Textarea
          {...props}
          rows={rows}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * A multi-select over a catalogue.
 *
 * Rendered as checkboxes rather than a multi-select box because the whole point
 * of the catalogues is that the reader can see the options they did *not* pick —
 * §16.4's "equipment not covered" is only meaningful if the full list was in
 * front of whoever chose.
 */
export function CheckGrid({
  label,
  hint,
  options,
  selected,
  onChange,
  columns = 2,
}: {
  label: ReactNode;
  hint?: ReactNode;
  options: readonly Option[];
  selected: readonly string[];
  onChange: (values: string[]) => void;
  columns?: 1 | 2 | 3;
}) {
  const toggle = (value: string) => {
    onChange(selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value]);
  };

  return (
    <div className="ds-field">
      <span className="ds-field__label">{label}</span>
      <div className={`rbi-checkgrid rbi-checkgrid--${columns}`}>
        {options.map((option) => (
          <label key={option.value} className="rbi-check">
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={() => toggle(option.value)}
            />
            <span>
              <span className="rbi-check__label">{option.label}</span>
              {option.hint && <span className="rbi-check__hint">{option.hint}</span>}
            </span>
          </label>
        ))}
      </div>
      {hint && <span className="ds-field__hint">{hint}</span>}
    </div>
  );
}

/**
 * A "considered / not considered" question with its finding.
 *
 * §6.4.2 and §6.4.3 do not ask whether start-up conditions are severe; they ask
 * that they be considered. So the control records the act of considering, and
 * demands the conclusion in the same breath — including "not applicable, and
 * here is why", which is a perfectly good answer and an unrecorded one is not.
 */
export function ConsideredField({
  label,
  hint,
  checked,
  onCheckedChange,
  note,
  onNoteChange,
  placeholder,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  note: string;
  onNoteChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="rbi-considered">
      <label className="rbi-check">
        <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} />
        <span>
          <span className="rbi-check__label">{label}</span>
          {hint && <span className="rbi-check__hint">{hint}</span>}
        </span>
      </label>
      <Textarea
        rows={2}
        value={note}
        placeholder={placeholder ?? 'What was concluded?'}
        onChange={(event) => onNoteChange(event.target.value)}
      />
    </div>
  );
}

/* ── Repeatable rows ───────────────────────────────────────────────────────── */

export function RowCard({
  title,
  meta,
  onRemove,
  removeLabel,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="rbi-row-card">
      <div className="rbi-row-card__head">
        <div className="rbi-row-card__title">{title}</div>
        {meta}
        {onRemove && (
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-label={removeLabel ?? 'Remove this row'}
            onClick={onRemove}
          >
            <FiTrash2 />
          </Button>
        )}
      </div>
      <div className="rbi-row-card__body">{children}</div>
    </div>
  );
}

/** Shown where a list is empty, saying what the absence means rather than nothing. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rbi-empty">{children}</p>;
}

/**
 * A value that came from somewhere else in the system.
 *
 * §8.3 lists transcription as a named cause of poor data quality, so figures the
 * product already holds are shown rather than asked for — and shown with their
 * source, because a read-only number with no provenance is just a number the
 * engineer cannot correct or trust.
 */
export function DerivedValue({
  label,
  value,
  source,
}: {
  label: ReactNode;
  value: ReactNode;
  source: ReactNode;
}) {
  return (
    <div className="rbi-derived">
      <span className="rbi-derived__label">{label}</span>
      <span className="rbi-derived__value">{value}</span>
      <span className="rbi-derived__source">{source}</span>
    </div>
  );
}

/** Marks a field the practice makes a "shall". */
export function ShallBadge() {
  return <Badge tone="warning" pill>shall</Badge>;
}
