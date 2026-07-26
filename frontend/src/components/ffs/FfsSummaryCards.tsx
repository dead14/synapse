import { FiAlertTriangle, FiCheckCircle, FiClock, FiLayers, FiXCircle } from 'react-icons/fi';
import type { FfsConfig, FfsScreenedResult, FfsScreeningConfig } from '../../lib/ffs/types';

interface SummaryCard {
  label: string;
  value: string;
  foot: string;
  icon: typeof FiLayers;
  tone: 'neutral' | 'good' | 'bad' | 'warn' | 'accent';
}

const TONE_STYLES = {
  neutral: {
    value: 'text-slate-900 dark:text-slate-50',
    icon: 'bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300',
  },
  good: {
    value: 'text-emerald-600 dark:text-emerald-400',
    icon: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  },
  bad: {
    value: 'text-rose-600 dark:text-rose-400',
    icon: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
  },
  warn: {
    value: 'text-amber-600 dark:text-amber-400',
    icon: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  },
  accent: {
    value: 'text-indigo-600 dark:text-indigo-400',
    icon: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
  },
} as const;

/**
 * Headline counts for the assessment. Always visible above the tabs so the
 * population summary stays in view while the engineer moves between views.
 */
export default function FfsSummaryCards({
  items,
  config,
  screening,
}: {
  items: FfsScreenedResult[];
  config: FfsConfig;
  screening: FfsScreeningConfig;
}) {
  const total = items.length;
  const acceptable = items.filter((item) => item.nominal.acceptance === 'Acceptable').length;
  const unacceptable = total - acceptable;
  const belowThreshold = items.filter((item) => item.nominal.expectedLife < config.highlightYears).length;
  const escalated = items.filter((item) => item.conservative.severity !== 'pass').length;

  const cards: SummaryCard[] = [
    {
      label: 'Total features',
      value: total.toLocaleString(),
      foot: 'ILI metal-loss records',
      icon: FiLayers,
      tone: 'neutral',
    },
    {
      label: 'Acceptable',
      value: acceptable.toLocaleString(),
      foot: `ERF < 1 and depth < ${screening.depthRejectionPct}%`,
      icon: FiCheckCircle,
      tone: 'good',
    },
    {
      label: 'Not acceptable',
      value: unacceptable.toLocaleString(),
      foot: unacceptable > 0 ? 'Pressure control or repair required' : 'None at current pressure',
      icon: FiXCircle,
      tone: unacceptable > 0 ? 'bad' : 'good',
    },
    {
      label: `Life under ${config.highlightYears} y`,
      value: belowThreshold.toLocaleString(),
      foot: 'Below the review threshold',
      icon: FiClock,
      tone: belowThreshold > 0 ? 'warn' : 'good',
    },
    {
      label: 'In review band',
      value: escalated.toLocaleString(),
      foot: `Conservative ERF ≥ ${screening.reviewBandErf.toFixed(2)}`,
      icon: FiAlertTriangle,
      tone: escalated > 0 ? 'accent' : 'good',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => {
        const tone = TONE_STYLES[card.tone];
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-slate-500 dark:text-slate-400">
                {card.label}
              </p>
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${tone.icon}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
            </div>
            <p className={`text-2xl font-bold tabular-nums leading-none ${tone.value}`}>{card.value}</p>
            <p className="mt-1.5 text-[10px] leading-snug text-slate-400 dark:text-slate-500">{card.foot}</p>
          </div>
        );
      })}
    </div>
  );
}
