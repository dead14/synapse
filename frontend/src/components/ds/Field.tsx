import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  /** Receives the generated id so the control stays labelled. */
  children: (props: { id: string; 'aria-describedby'?: string }) => ReactNode;
}

/** Label + control + hint, with the wiring done once instead of per call site. */
export default function Field({ label, hint, error, className = '', children }: FieldProps) {
  const id = useId();
  const describedBy = error || hint ? `${id}-hint` : undefined;
  return (
    <div className={`ds-field${className ? ` ${className}` : ''}`}>
      <label className="ds-field__label" htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': describedBy })}
      {(error || hint) && (
        <span id={describedBy} className={`ds-field__hint${error ? ' ds-field__hint--error' : ''}`}>
          {error || hint}
        </span>
      )}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { data?: boolean; invalid?: boolean; small?: boolean };

export function Input({ data, invalid, small, className = '', ...rest }: InputProps) {
  return (
    <input
      className={`ds-input${data ? ' ds-input--data' : ''}${invalid ? ' ds-input--invalid' : ''}${small ? ' ds-input--sm' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    />
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { small?: boolean };

export function Select({ small, className = '', children, ...rest }: SelectProps) {
  return (
    <select className={`ds-select${small ? ' ds-select--sm' : ''}${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`ds-textarea${className ? ` ${className}` : ''}`} {...rest} />;
}

type RangeProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export function Range({ className = '', ...rest }: RangeProps) {
  return <input type="range" className={`ds-range${className ? ` ${className}` : ''}`} {...rest} />;
}

/** Monospace value chip that pairs with a slider or a stat row. */
export function Readout({ children, muted, className = '' }: { children: ReactNode; muted?: boolean; className?: string }) {
  return <span className={`ds-readout${muted ? ' ds-readout--muted' : ''}${className ? ` ${className}` : ''}`}>{children}</span>;
}

interface SliderFieldProps {
  label: ReactNode;
  value: number;
  display?: ReactNode;
  hint?: ReactNode;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  children?: ReactNode;
}

/**
 * Label, readout chip, track and hint in the arrangement used by every
 * threshold control in the wizard.
 */
export function SliderField({ label, value, display, hint, min, max, step, disabled, onChange, children }: SliderFieldProps) {
  const id = useId();
  return (
    <div className="ds-field">
      <div className="ds-row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <label className="ds-field__label" htmlFor={id}>{label}</label>
        <Readout muted={disabled}>{display ?? value}</Readout>
      </div>
      {children}
      <input
        id={id}
        type="range"
        className="ds-range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {hint ? <span id={`${id}-hint`} className="ds-field__hint">{hint}</span> : null}
    </div>
  );
}
