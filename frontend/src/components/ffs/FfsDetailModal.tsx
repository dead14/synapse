import { useEffect } from 'react';
import { FiX } from 'react-icons/fi';
import { formatLife } from '../../lib/ffs/screening';
import type { FfsConfig, FfsScreenedResult, FfsScreeningConfig } from '../../lib/ffs/types';
import { Callout, PriorityLabel, SeverityBadge, Stat, formatErf } from './FfsPrimitives';

/** One calculation step: the symbolic form, the substituted values, the result. */
interface Step {
  name: string;
  formula: string;
  substitution: string;
  result: string;
  note?: string;
  tone?: 'default' | 'accent' | 'good' | 'warn' | 'bad';
}

function fmt(value: number | null, digits = 4): string {
  if (value === null) return 'n/a';
  return Number.isFinite(value) ? value.toFixed(digits) : '∞';
}

function buildSteps(
  item: FfsScreenedResult,
  config: FfsConfig,
  screening: FfsScreeningConfig,
): Step[] {
  const n = item.nominal;
  const isOriginal = config.method === 'original';
  const kLabel = isOriginal ? '⅔' : '0.85';
  const k = isOriginal ? 2 / 3 : 0.85;
  const steps: Step[] = [];

  steps.push({
    name: 'Metal-loss depth',
    formula: 'd = (depth% / 100) × t',
    substitution: `(${n.maxDepthPct.toFixed(2)} / 100) × ${n.wall.toFixed(2)}`,
    result: `${fmt(n.d, 3)} mm`,
    note: `d/t = ${fmt(n.dt)}`,
  });

  steps.push({
    name: 'Hoop stress at operating pressure',
    formula: 'S₀ = P₀ · D / (2t)',
    substitution: `${n.p0.toFixed(3)} × ${n.od.toFixed(1)} / (2 × ${n.wall.toFixed(2)})`,
    result: `${fmt(n.So, 3)} MPa`,
  });

  steps.push({
    name: 'Shell parameter',
    formula: 'z = L² / (D · t)',
    substitution: `${n.length.toFixed(1)}² / (${n.od.toFixed(1)} × ${n.wall.toFixed(2)})`,
    result: fmt(n.z),
    note: `Branch: ${n.branch}`,
  });

  if (isOriginal) {
    steps.push(
      n.M !== null
        ? {
            name: 'Folias bulging factor',
            formula: 'M = √(1 + 0.8 z)',
            substitution: `√(1 + 0.8 × ${fmt(n.z)})`,
            result: fmt(n.M),
            note: 'z ≤ 20 — parabolic area form applies',
          }
        : {
            name: 'Folias bulging factor',
            formula: 'M not used for z > 20',
            substitution: 'Long-anomaly branch selected',
            result: 'n/a',
            note: 'z > 20 — the flow-stress form drops the bulging term',
          },
    );
  } else {
    steps.push({
      name: 'Modified Folias factor',
      formula: n.z <= 50 ? 'M = √(1 + 0.6275 z − 0.003375 z²)' : 'M = 0.032 z + 3.3',
      substitution:
        n.z <= 50
          ? `√(1 + 0.6275 × ${fmt(n.z)} − 0.003375 × ${fmt(n.z)}²)`
          : `0.032 × ${fmt(n.z)} + 3.3`,
      result: fmt(n.M),
      note: n.z <= 50 ? 'z ≤ 50' : 'z > 50 — linear extension',
    });
  }

  steps.push({
    name: 'Flow stress',
    formula: isOriginal
      ? 'S_flow = 1.1 × SMYS'
      : config.modifiedSa === 'smys11'
        ? 'S_flow = 1.1 × SMYS'
        : 'S_flow = SMYS + 69 MPa',
    substitution:
      isOriginal || config.modifiedSa === 'smys11'
        ? `1.1 × ${n.smys.toFixed(1)}`
        : `${n.smys.toFixed(1)} + 69`,
    result: `${fmt(n.sflow, 2)} MPa`,
  });

  steps.push({
    name: 'Remaining strength',
    formula:
      isOriginal && n.M === null
        ? 'Sf = S_flow · (1 − d/t)'
        : `Sf = S_flow · (1 − ${kLabel}·d/t) / (1 − ${kLabel}·(d/t)/M)`,
    substitution:
      isOriginal && n.M === null
        ? `${fmt(n.sflow, 2)} × (1 − ${fmt(n.dt)})`
        : `${fmt(n.sflow, 2)} × (1 − ${k.toFixed(3)}×${fmt(n.dt)}) / (1 − ${k.toFixed(3)}×${fmt(n.dt)}/${fmt(n.M)})`,
    result: `${fmt(n.Sf, 3)} MPa`,
    tone: 'accent',
  });

  steps.push({
    name: 'Failure and safe pressure',
    formula: 'P_f = 2·Sf·t / D      P_safe = P_f × F',
    substitution: `2 × ${fmt(n.Sf, 3)} × ${n.wall.toFixed(2)} / ${n.od.toFixed(1)}   ·   × ${n.df.toFixed(3)}`,
    result: `P_f ${fmt(n.Pf, 3)} MPa · P_safe ${fmt(n.safePressure, 3)} MPa`,
    note: `Pressure margin ${fmt(n.safePressure - n.p0, 3)} MPa against P₀ ${n.p0.toFixed(3)} MPa`,
  });

  steps.push({
    name: 'Estimated repair factor',
    formula: 'ERF = S₀ / (Sf × F)',
    substitution: `${fmt(n.So, 3)} / (${fmt(n.Sf, 3)} × ${n.df.toFixed(3)})`,
    result: formatErf(n.ERF),
    tone: n.ERF > 1 ? 'bad' : n.ERF >= screening.reviewBandErf ? 'warn' : 'good',
    note:
      n.ERF > 1
        ? 'Operating pressure exceeds the calculated safe pressure'
        : n.ERF >= screening.reviewBandErf
          ? 'Within the engineering review band'
          : 'Below the review band',
  });

  return steps;
}

const TONE_TEXT = {
  default: 'text-slate-900 dark:text-slate-100',
  accent: 'text-indigo-600 dark:text-indigo-400',
  good: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-rose-600 dark:text-rose-400',
} as const;

/**
 * Full calculation trace for a single feature: inputs, every B31G step with the
 * substituted values, the three screening tiers, and the governing criterion.
 */
export default function FfsDetailModal({
  item,
  config,
  screening,
  onClose,
}: {
  item: FfsScreenedResult | null;
  config: FfsConfig;
  screening: FfsScreeningConfig;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!item) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;

  const n = item.nominal;
  const steps = buildSteps(item, config, screening);
  const criterionIsDepth = n.failureCriteria.includes('Depth');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Calculation breakdown for the feature at log distance ${n.ld}`}
      className="fixed inset-0 z-[999] flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
              Calculation breakdown
            </p>
            <h2 className="mt-0.5 truncate text-lg font-bold text-slate-900 dark:text-slate-50">
              LD {Number(n.ld).toLocaleString()} m · {n.section}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {n.surface} · {n.maxDepthPct.toFixed(1)}% depth · {n.length.toFixed(0)} × {n.width.toFixed(0)} mm
              {n.orient ? ` · ${n.orient}` : ''} ·{' '}
              {config.method === 'original' ? 'Original' : 'Modified'} B31G
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <SeverityBadge severity={item.conservative.severity} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close calculation breakdown"
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            >
              <FiX className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Inputs */}
          <section className="mb-6">
            <h3 className="mb-3 border-b border-slate-200 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Input parameters
            </h3>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Stat label="Outer diameter" value={n.od.toFixed(1)} unit="mm" />
              <Stat label="Wall thickness" value={n.wall.toFixed(2)} unit="mm" />
              <Stat label="SMYS" value={n.smys.toFixed(1)} unit="MPa" />
              <Stat label="Design factor" value={n.df.toFixed(3)} />
              <Stat label="Operating pressure" value={n.p0.toFixed(3)} unit="MPa" />
              <Stat label="Depth" value={`${n.maxDepthPct.toFixed(1)}%`} foot={`${n.d.toFixed(3)} mm`} />
              <Stat label="CR depth" value={n.crDepth.toFixed(4)} unit="mm/y" />
              <Stat label="CR length" value={n.crLength.toFixed(4)} unit="mm/y" />
            </div>
          </section>

          {/* Calculation steps */}
          <section className="mb-6">
            <h3 className="mb-3 border-b border-slate-200 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {config.method === 'original' ? 'Original' : 'Modified'} B31G calculation
            </h3>
            <ol className="space-y-2">
              {steps.map((step, i) => (
                <li
                  key={step.name}
                  className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded bg-indigo-600 text-[10px] font-bold text-white">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                          {step.name}
                        </p>
                        <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-indigo-600 dark:text-indigo-400">
                          {step.formula}
                        </p>
                        <p className="mt-0.5 break-words font-mono text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                          = {step.substitution}
                        </p>
                        {step.note && (
                          <p className="mt-1 text-[10px] italic text-slate-400 dark:text-slate-500">{step.note}</p>
                        )}
                      </div>
                    </div>
                    <p
                      className={`shrink-0 text-right font-mono text-sm font-bold tabular-nums ${
                        TONE_TEXT[step.tone ?? 'default']
                      }`}
                    >
                      {step.result}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* Screening tiers */}
          <section className="mb-6">
            <h3 className="mb-3 border-b border-slate-200 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Screening tiers
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-900/60">
                    <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Tier
                    </th>
                    <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Depth [%]
                    </th>
                    <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Length [mm]
                    </th>
                    <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      P_safe [MPa]
                    </th>
                    <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      ERF
                    </th>
                    <th className="px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {[
                    {
                      label: 'Nominal — as reported',
                      depth: n.maxDepthPct,
                      length: n.length,
                      safe: n.safePressure,
                      erf: n.ERF,
                      severity: item.nominal.acceptance === 'Acceptable' ? ('pass' as const) : ('fail' as const),
                    },
                    {
                      label: `Conservative — +${screening.depthTolerancePct}% WT, +${2 * screening.lengthToleranceMm} mm`,
                      depth: item.conservative.depthPct,
                      length: item.conservative.lengthMm,
                      safe: item.conservative.safePressure,
                      erf: item.conservative.ERF,
                      severity: item.conservative.severity,
                    },
                    {
                      label: `Forecast — ${screening.forecastYears} y at ${screening.growthRateMmPerYear.toFixed(2)} mm/y`,
                      depth: item.forecast.depthPct,
                      length: item.forecast.lengthMm,
                      safe: item.forecast.safePressure,
                      erf: item.forecast.ERF,
                      severity: item.forecast.severity,
                    },
                  ].map((tier) => (
                    <tr key={tier.label} className="text-slate-700 dark:text-slate-300">
                      <td className="px-3 py-2 font-medium">{tier.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{tier.depth.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{tier.length.toFixed(0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(tier.safe, 3)}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{formatErf(tier.erf)}</td>
                      <td className="px-3 py-2 text-center">
                        <SeverityBadge severity={tier.severity} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Remaining life */}
          <section className="mb-5">
            <h3 className="mb-3 border-b border-slate-200 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Remaining life
            </h3>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Stat
                label="Expected life"
                value={n.expectedLife >= 200 ? '>200' : n.expectedLife.toFixed(1)}
                unit="years"
                tone={n.expectedLife < config.highlightYears ? 'warn' : 'good'}
              />
              <Stat label="Year of service limit" value={n.yearService} foot="From the ILI date" />
              <Stat
                label="Life to ERF 1"
                value={formatLife(item.lifeToErf1)}
                foot="Conservative basis"
                tone={item.lifeToErf1 < 10 ? 'warn' : 'good'}
              />
              <Stat
                label="Depth at limit"
                value={`${n.atFailure_depth.toFixed(1)}%`}
                foot={`ERF ${formatErf(n.atFailure_ERF)}`}
              />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Engineering priority:</span>
              <PriorityLabel priority={item.priority} />
              {item.clockHour !== null && (
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Clock {n.orient}
                  {item.bottomQuadrant && ' · bottom quadrant'}
                </span>
              )}
            </div>
          </section>

          {/* Governing criterion */}
          <Callout tone={n.acceptance === 'Un-Acceptable' ? 'danger' : n.expectedLife < config.highlightYears ? 'warn' : 'info'}>
            <strong>Governing criterion: {n.failureCriteria}.</strong>{' '}
            {n.failureCriteria.startsWith('N/A')
              ? 'Neither the depth limit nor ERF 1.0 is reached within the 200-year search horizon at the supplied growth rates.'
              : criterionIsDepth
                ? `The ${screening.depthRejectionPct}% wall-thickness depth limit is reached before ERF reaches 1.0, at ` +
                  `${n.expectedLife.toFixed(1)} years (${n.yearService}).`
                : `ERF reaches 1.0 before the ${screening.depthRejectionPct}% depth limit, at ` +
                  `${n.expectedLife.toFixed(1)} years (${n.yearService}).`}{' '}
            This is a screening calculation — final disposition requires an approved procedure and independent
            checking.
          </Callout>
        </div>
      </div>
    </div>
  );
}
