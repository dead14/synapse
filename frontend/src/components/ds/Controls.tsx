import type { HTMLAttributes, ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  title?: string;
}

interface SegmentedProps<T extends string> {
  /** `NoInfer` keeps the union coming from `value`, not from the array literal. */
  options: ReadonlyArray<SegmentedOption<NoInfer<T>>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

/** Replaces the ad-hoc "two buttons, one highlighted" pairs across the wizard. */
export function Segmented<T extends string>({ options, value, onChange, ariaLabel, className = '' }: SegmentedProps<T>) {
  return (
    <div className={`ds-segmented${className ? ` ${className}` : ''}`} role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          title={option.title}
          aria-selected={option.value === value}
          className={`ds-segmented__option${option.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}

export function Switch({ checked, onChange, label, disabled, id }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="ds-switch"
      onClick={() => onChange(!checked)}
    />
  );
}

export function Toolbar({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ds-toolbar${className ? ` ${className}` : ''}`} {...rest}>{children}</div>;
}

export function ToolbarSpacer() {
  return <span className="ds-toolbar__spacer" />;
}

interface ActionBarProps {
  back?: ReactNode;
  center?: ReactNode;
  next?: ReactNode;
  /** Shown right-aligned under the bar, e.g. why Next is disabled. */
  help?: ReactNode;
  className?: string;
}

/** The Back / … / Next footer. Same order and spacing on every step. */
export function ActionBar({ back, center, next, help, className = '' }: ActionBarProps) {
  return (
    <div className={`ds-actionbar${className ? ` ${className}` : ''}`}>
      {back ?? <span />}
      {center ? <div className="ds-actionbar__center">{center}</div> : null}
      {next ? <div className="ds-actionbar__end">{next}</div> : null}
      {help ? <p className="ds-actionbar__help">{help}</p> : null}
    </div>
  );
}
