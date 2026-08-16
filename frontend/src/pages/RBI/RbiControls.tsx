/**
 * Form primitives for the RBI screening.
 *
 * Thin wrappers over the design system, not a fourth design language: each one
 * renders `ds-field`, `ds-input`, `ds-select`, `ds-textarea`.
 *
 * The one behaviour worth naming: a numeric field reads and writes `number |
 * null`, and an empty box means null, not zero. A missing regulatory cap is a
 * documented absence; coercing it to 0 would silently answer a question nobody
 * asked.
 */

import type { ReactNode } from 'react';

import { Field, Input, Panel, PanelBody, PanelHeader, Select, Textarea } from '../../components/ds';
import type { Option } from '../../lib/rbi/catalogues';

export function StepPanel({
  title,
  blurb,
  actions,
  children,
}: {
  title: string;
  blurb?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel>
      <PanelHeader title={title} subtitle={blurb} actions={actions} />
      <PanelBody>{children}</PanelBody>
    </Panel>
  );
}

export function FieldGrid({ children, columns = 2 }: { children: ReactNode; columns?: 2 | 3 }) {
  return <div className={`rbi-grid rbi-grid--${columns}`}>{children}</div>;
}

export function FullWidth({ children }: { children: ReactNode }) {
  return <div className="rbi-grid__full">{children}</div>;
}

interface BaseFieldProps {
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}

export function TextField({
  label, hint, value, onChange, placeholder, disabled,
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
  label, hint, value, onChange,
}: BaseFieldProps & { value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label} hint={hint}>
      {(props) => (
        <Input {...props} type="date" value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </Field>
  );
}

export function NumberField({
  label, hint, value, onChange, unit, min,
}: BaseFieldProps & {
  value: number | null;
  onChange: (value: number | null) => void;
  unit?: string;
  min?: number;
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
          step="any"
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
  label, hint, value, onChange, options, placeholder, disabled,
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
  label, hint, value, onChange, placeholder, rows = 2,
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
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/** Shown where a list is empty, saying what the absence means rather than nothing. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rbi-empty">{children}</p>;
}

/**
 * A value that came from somewhere else in the system.
 *
 * Figures the product already holds are shown rather than asked for, and shown
 * with their source — a read-only number with no provenance is just a number the
 * engineer cannot correct or trust.
 */
export function DerivedValue({
  label, value, source,
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
