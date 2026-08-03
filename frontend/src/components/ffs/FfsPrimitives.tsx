import type { ReactNode } from 'react';
import type { FfsPriority, FfsSeverity } from '../../lib/ffs/types';

/** Panel surface used for every FFS card, matching the app's slate/indigo shell. */
export function Panel({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800${
        padded ? ' p-5' : ''
      }${className ? ` ${className}` : ''}`}
    >
      {children}
    </div>
  );
}

/** Section header used inside panels: uppercase title with an optional action slot. */
export function PanelHeader({
  title,
  subtitle,
  actions,
  headingLevel = 3,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <Heading className="text-[13px] font-bold uppercase tracking-wide text-slate-800 dark:text-slate-100">
          {title}
        </Heading>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const SEVERITY_STYLES: Record<FfsSeverity, { label: string; className: string }> = {
  pass: {
    label: 'Pass',
    className:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-900/25 dark:text-emerald-400',
  },
  review: {
    label: 'Review',
    className:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-900/25 dark:text-amber-400',
  },
  fail: {
    label: 'Not acceptable',
    className:
      'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800/60 dark:bg-rose-900/25 dark:text-rose-400',
  },
};

export function SeverityBadge({ severity, label }: { severity: FfsSeverity; label?: string }) {
  const style = SEVERITY_STYLES[severity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${style.className}`}
    >
      <i className="h-1.5 w-1.5 rounded-full bg-current" />
      {label ?? style.label}
    </span>
  );
}

const PRIORITY_STYLES: Record<FfsPriority, string> = {
  High: 'text-rose-600 dark:text-rose-400',
  Medium: 'text-amber-600 dark:text-amber-400',
  Routine: 'text-emerald-600 dark:text-emerald-400',
};

export function PriorityLabel({ priority }: { priority: FfsPriority }) {
  return <span className={`text-xs font-bold ${PRIORITY_STYLES[priority]}`}>{priority}</span>;
}

/** Small labelled numeric readout used across the KPI and detail views. */
export function Stat({
  label,
  value,
  unit,
  foot,
  tone = 'default',
}: {
  label: string;
  value: string;
  unit?: string;
  foot?: string;
  tone?: 'default' | 'accent' | 'good' | 'warn' | 'bad';
}) {
  const toneClass = {
    default: 'text-slate-900 dark:text-slate-50',
    accent: 'text-indigo-600 dark:text-indigo-400',
    good: 'text-emerald-600 dark:text-emerald-400',
    warn: 'text-amber-600 dark:text-amber-400',
    bad: 'text-rose-600 dark:text-rose-400',
  }[tone];

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className={`mt-1 text-base font-bold tabular-nums ${toneClass}`}>
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-slate-400">{unit}</span>}
      </p>
      {foot && <p className="mt-0.5 truncate text-[10px] text-slate-400">{foot}</p>}
    </div>
  );
}

/** Inline note used to flag screening limits and engineering caveats. */
export function Callout({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'danger';
  children: ReactNode;
}) {
  const toneClass = {
    info: 'border-l-indigo-500 bg-indigo-50/70 text-slate-700 dark:bg-indigo-950/25 dark:text-slate-300',
    warn: 'border-l-amber-500 bg-amber-50/70 text-amber-900 dark:bg-amber-950/25 dark:text-amber-200',
    danger: 'border-l-rose-500 bg-rose-50/70 text-rose-900 dark:bg-rose-950/25 dark:text-rose-200',
  }[tone];

  return (
    <div className={`rounded-r-lg border-l-[3px] px-3.5 py-2.5 text-xs leading-relaxed ${toneClass}`}>
      {children}
    </div>
  );
}

/** Compact numeric input used throughout the settings and parameter panels. */
export function NumberField({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  step = 1,
  hint,
  className = '',
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className="relative block">
        <input
          type="number"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            const parsed = parseFloat(event.target.value);
            onChange(Number.isFinite(parsed) ? parsed : 0);
          }}
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 pr-12 text-sm tabular-nums text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        />
        {unit && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">
            {unit}
          </span>
        )}
      </span>
      {hint && <span className="mt-1 block text-[10px] leading-snug text-slate-400">{hint}</span>}
    </label>
  );
}

export function formatErf(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : '∞';
}
