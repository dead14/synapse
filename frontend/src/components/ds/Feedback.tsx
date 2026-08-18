import type { HTMLAttributes, ReactNode } from 'react';

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  pill?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', pill, icon, className = '', children, ...rest }: BadgeProps) {
  return (
    <span className={`ds-badge ds-badge--${tone}${pill ? ' ds-badge--pill' : ''}${className ? ` ${className}` : ''}`} {...rest}>
      {icon}
      {children}
    </span>
  );
}

interface CalloutProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: Exclude<Tone, 'neutral'> | 'neutral' | 'info';
  icon?: ReactNode;
  title?: ReactNode;
  /** Right-aligned metric, e.g. "24 joints flagged". */
  meta?: ReactNode;
  children?: ReactNode;
}

/** Inline explanation / warning block. One shape for all severities. */
export function Callout({ tone = 'neutral', icon, title, meta, className = '', children, ...rest }: CalloutProps) {
  const toneClass = tone === 'neutral' ? '' : ` ds-callout--${tone === 'primary' ? 'info' : tone}`;
  return (
    <div className={`ds-callout${toneClass}${className ? ` ${className}` : ''}`} {...rest}>
      {icon}
      <div className="ds-callout__body">
        {title ? <strong className="ds-callout__title">{title}</strong> : null}
        {children ? <p>{children}</p> : null}
      </div>
      {meta ? <span className="ds-data" style={{ flex: '0 0 auto', fontSize: 'var(--ds-t-xs)' }}>{meta}</span> : null}
    </div>
  );
}

interface StatProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  compact?: boolean;
  className?: string;
}

export function Stat({ label, value, hint, tone = 'neutral', compact, className = '' }: StatProps) {
  const toneClass = tone === 'neutral' || tone === 'primary' ? '' : ` ds-stat--${tone}`;
  return (
    <div className={`ds-stat${toneClass}${className ? ` ${className}` : ''}`}>
      <span className="ds-stat__label">{label}</span>
      <span className={`ds-stat__value${compact ? ' ds-stat__value--sm' : ''}`}>{value}</span>
      {hint ? <span className="ds-stat__hint">{hint}</span> : null}
    </div>
  );
}

export function StatGrid({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ds-stat-grid${className ? ` ${className}` : ''}`} {...rest}>{children}</div>;
}
