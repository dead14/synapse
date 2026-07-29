import { useEffect } from 'react';
import { FiX } from 'react-icons/fi';
import { formatLife } from '../../lib/ffs/screening';
import type { FfsConfig, FfsScreenedResult, FfsScreeningConfig } from '../../lib/ffs/types';
import { Callout, PriorityLabel, SeverityBadge, formatErf } from './FfsPrimitives';

function fmt(value: number | null, digits = 4): string {
  if (value === null) return 'n/a';
  return Number.isFinite(value) ? value.toFixed(digits) : '∞';
}

function InputCard({
  label,
  symbol,
  value,
  unit,
  description,
}: {
  label: string;
  symbol: string;
  value: string;
  unit?: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/40">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-1.5 text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50">
        {value}
        {unit && <span className="ml-1 text-[11px] font-normal text-slate-400">{unit}</span>}
      </p>
      <p className="mt-1 text-[10px] text-slate-400">
        <span className="font-mono text-indigo-500 dark:text-indigo-400">{symbol}</span>
        {' = '}
        {description}
      </p>
    </div>
  );
}

function CalcStep({
  name,
  formula,
  substitution,
  result,
  unit,
  note,
  tone = 'default',
  sideBySide,
}: {
  name: string;
  formula: string;
  substitution: string;
  result: string;
  unit?: string;
  note?: string;
  tone?: 'default' | 'accent' | 'good' | 'warn' | 'bad';
  sideBySide?: {
    name: string;
    formula: string;
    substitution: string;
    result: string;
    unit?: string;
  };
}) {
  const toneText = {
    default: 'text-slate-900 dark:text-slate-50',
    accent: 'text-indigo-600 dark:text-indigo-400',
    good: 'text-emerald-600 dark:text-emerald-400',
    warn: 'text-amber-600 dark:text-amber-400',
    bad: 'text-rose-600 dark:text-rose-400',
  }[tone];

  const toneBorder = {
    default: 'border-slate-200 dark:border-slate-700',
    accent: 'border-indigo-200 dark:border-indigo-800/60',
    good: 'border-emerald-200 dark:border-emerald-800/60',
    warn: 'border-amber-200 dark:border-amber-800/60',
    bad: 'border-rose-200 dark:border-rose-800/60',
  }[tone];

  if (sideBySide) {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className={`rounded-lg border ${toneBorder} bg-slate-50/70 p-3 dark:bg-slate-900/40`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {name}
              </p>
              <p className="mt-1.5 break-words font-mono text-[11px] leading-relaxed text-indigo-600 dark:text-indigo-400">
                {formula}
              </p>
              <p className="mt-0.5 break-words font-mono text-[10px] leading-relaxed text-slate-400">
                = {substitution}
              </p>
            </div>
            <p className={`shrink-0 text-right text-lg font-bold tabular-nums ${toneText}`}>
              {result}
              {unit && <span className="ml-1 text-[10px] font-normal text-slate-400">{unit}</span>}
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-800/60 dark:bg-indigo-950/20">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {sideBySide.name}
              </p>
              <p className="mt-1.5 break-words font-mono text-[11px] leading-relaxed text-indigo-600 dark:text-indigo-400">
                {sideBySide.formula}
              </p>
              <p className="mt-0.5 break-words font-mono text-[10px] leading-relaxed text-slate-400">
                = {sideBySide.substitution}
              </p>
            </div>
            <p className="shrink-0 text-right text-lg font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
              {sideBySide.result}
              {sideBySide.unit && (
                <span className="ml-1 text-[10px] font-normal text-slate-400">{sideBySide.unit}</span>
              )}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border ${toneBorder} bg-slate-50/70 p-3 dark:bg-slate-900/40`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {name}
            {note && (
              <span className="ml-2 rounded border border-slate-300 px-1.5 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-slate-500 dark:border-slate-600 dark:text-slate-400">
                {note}
              </span>
            )}
          </p>
          <p className="mt-1.5 break-words font-mono text-[11px] leading-relaxed text-indigo-600 dark:text-indigo-400">
            {formula}
          </p>
          <p className="mt-0.5 break-words font-mono text-[10px] leading-relaxed text-slate-400">
            = {substitution}
          </p>
        </div>
        <p className={`shrink-0 text-right text-lg font-bold tabular-nums ${toneText}`}>
          {result}
          {unit && <span className="ml-1 text-[10px] font-normal text-slate-400">{unit}</span>}
        </p>
      </div>
    </div>
  );
}

function LifeCard({
  label,
  value,
  unit,
  description,
  tone = 'default',
}: {
  label: string;
  value: string;
  unit?: string;
  description: string;
  tone?: 'default' | 'accent' | 'warn' | 'bad';
}) {
  const toneText = {
    default: 'text-slate-900 dark:text-slate-50',
    accent: 'text-indigo-600 dark:text-indigo-400',
    warn: 'text-amber-600 dark:text-amber-400',
    bad: 'text-rose-600 dark:text-rose-400',
  }[tone];

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-900/40">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className={`mt-1 text-base font-bold tabular-nums ${toneText}`}>
        {value}
        {unit && <span className="ml-1 text-[10px] font-normal text-slate-400">{unit}</span>}
      </p>
      <p className="mt-0.5 text-[10px] text-slate-400">{description}</p>
    </div>
  );
}

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
  const isOriginal = config.method === 'original';
  const kLabel = isOriginal ? '2/3' : '0.85';
  const k = isOriginal ? 2 / 3 : 0.85;
  const methodLabel = isOriginal ? 'Original B31G' : 'Modified B31G';
  const areaLabel = isOriginal ? '⅔dL' : '0.85dL';

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
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">
                DEFECT @ LD {Number(n.ld).toLocaleString()} m
              </h2>
              <span className="rounded-full border border-indigo-300 bg-indigo-50 px-2.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                {methodLabel} · {areaLabel}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {n.section} · {n.surface} · {n.acceptance}
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
          {/* Input Parameters */}
          <section className="mb-6">
            <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Input parameters
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <InputCard
                label="Max Depth"
                symbol={'dₘₑₐₛ'}
                value={`${n.maxDepthPct.toFixed(2)}%`}
                description={`${n.maxDepthPct.toFixed(0)}% of wall`}
              />
              <InputCard
                label="Wall Thickness (t)"
                symbol="t"
                value={n.wall.toFixed(2)}
                unit="mm"
                description="Nominal"
              />
              <InputCard
                label={`Outer Diameter (D)`}
                symbol={'Dₛ'}
                value={n.od.toFixed(1)}
                unit="mm"
                description="Nominal"
              />
              <InputCard
                label="SMYS"
                symbol="SMYS"
                value={n.smys.toFixed(1)}
                unit="MPa"
                description="Specified"
              />
              <InputCard
                label={'Op. Pressure P₀'}
                symbol={'P₀'}
                value={n.p0.toFixed(3)}
                unit="MPa"
                description="Operating"
              />
              <InputCard
                label="Design Factor"
                symbol="DF"
                value={n.df.toFixed(3)}
                description="Code value"
              />
              <InputCard
                label="Defect Length"
                symbol="L"
                value={n.length.toFixed(0)}
                unit="mm"
                description="ILI measured"
              />
              <InputCard
                label="CR Depth"
                symbol={'ṙᵈ'}
                value={n.crDepth.toFixed(4)}
                unit="mm/y"
                description="Growth rate"
              />
              <InputCard
                label="CR Length"
                symbol={'ṙₗ'}
                value={n.crLength.toFixed(4)}
                unit="mm/y"
                description="Growth rate"
              />
            </div>
          </section>

          {/* Step-by-step Calculation */}
          <section className="mb-6">
            <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Step-by-step calculation (at ILI date)
            </h3>
            <div className="space-y-2">
              {/* Safety Factor */}
              <CalcStep
                name="Safety Factor (SF)"
                formula="SF = 1 / DF"
                substitution={`1 / ${n.df.toFixed(3)}`}
                result={fmt(n.SF)}
              />

              {/* Defect Depth */}
              <CalcStep
                name="Defect Depth (d)"
                formula="d = (Depth% / 100) × t"
                substitution={`(${n.maxDepthPct.toFixed(2)} / 100) × ${n.wall.toFixed(2)}`}
                result={fmt(n.d, 4)}
                unit="mm"
              />

              {/* D/T Ratio */}
              <CalcStep
                name="D/T Ratio"
                formula="d/t = d / t"
                substitution={`${fmt(n.d, 4)} / ${n.wall.toFixed(2)}`}
                result={fmt(n.dt)}
              />

              {/* Z Factor */}
              <CalcStep
                name="Z Factor"
                formula={'z = L² / (D × t)'}
                substitution={`${n.length.toFixed(0)}² / (${n.od.toFixed(1)} × ${n.wall.toFixed(2)})`}
                result={fmt(n.z)}
              />

              {/* Folias Factor */}
              {isOriginal ? (
                n.M !== null ? (
                  <CalcStep
                    name="M Factor (Folias)"
                    formula={'M = √(1 + 0.8z)'}
                    substitution={`√(1 + 0.8 × ${fmt(n.z)})`}
                    result={fmt(n.M)}
                    note={`z≤20`}
                    tone="accent"
                  />
                ) : (
                  <CalcStep
                    name="M Factor (Folias)"
                    formula="M not used for z > 20"
                    substitution="Long-anomaly branch selected"
                    result="n/a"
                    note="z>20"
                  />
                )
              ) : (
                <CalcStep
                  name="M Factor (Folias)"
                  formula={
                    n.z <= 50
                      ? 'M = √(1 + 0.6275z − 0.003375z²)'
                      : 'M = 0.032z + 3.3'
                  }
                  substitution={
                    n.z <= 50
                      ? `√(1 + 0.6275×${fmt(n.z)} − 0.003375×${fmt(n.z)}²)`
                      : `0.032×${fmt(n.z)} + 3.3`
                  }
                  result={fmt(n.M)}
                  note={n.z <= 50 ? 'z≤50' : 'z>50'}
                  tone="accent"
                />
              )}

              {/* Flow Stress */}
              <CalcStep
                name={'Flow Stress (Sᶠₗₒᵂ)'}
                formula={
                  isOriginal || config.modifiedSa === 'smys11'
                    ? 'Sᶠₗₒᵂ = 1.1 × SMYS'
                    : 'Sᶠₗₒᵂ = SMYS + 69'
                }
                substitution={
                  isOriginal || config.modifiedSa === 'smys11'
                    ? `1.1 × ${n.smys.toFixed(1)}`
                    : `${n.smys.toFixed(1)} + 69`
                }
                result={fmt(n.sflow, 4)}
                unit="MPa"
              />

              {/* Remaining Strength */}
              <CalcStep
                name={'Flow Stress Sᶠ'}
                formula={
                  isOriginal && n.M === null
                    ? 'Sᶠ = Sᶠₗₒᵂ × (1 − d/t)'
                    : `Sᶠ = Sᶠₗₒᵂ × (1 − ${kLabel}·d/t) / (1 − ${kLabel}·d/t/M)`
                }
                substitution={
                  isOriginal && n.M === null
                    ? `${fmt(n.sflow, 4)} × (1 − ${fmt(n.dt)})`
                    : `${fmt(n.sflow, 4)} × (1 − ${k.toFixed(2)}×${fmt(n.dt)}) / (1 − ${k.toFixed(2)}×${fmt(n.dt)}/${fmt(n.M)})`
                }
                result={fmt(n.Sf, 4)}
                unit="MPa"
                tone="accent"
              />

              {/* Failure Pressure */}
              <CalcStep
                name={'Failure Pressure Pᶠ'}
                formula={'Pᶠ = 2 × Sᶠ × t / D'}
                substitution={`2 × ${fmt(n.Sf, 4)} × ${n.wall.toFixed(2)} / ${n.od.toFixed(1)}`}
                result={fmt(n.Pf, 4)}
                unit="MPa"
              />

              {/* Hoop Stress + Safe Pressure (side by side) */}
              <CalcStep
                name={'Hoop Stress S₀'}
                formula={'S₀ = P₀ × D / (2t)'}
                substitution={`${n.p0.toFixed(3)} × ${n.od.toFixed(1)} / (2 × ${n.wall.toFixed(2)})`}
                result={fmt(n.So, 4)}
                unit="MPa"
                sideBySide={{
                  name: 'Safe Operating Pressure',
                  formula: 'Pₛₐᶠₑ = Pᶠ × DF',
                  substitution: `${fmt(n.Pf, 4)} × ${n.df.toFixed(3)}`,
                  result: fmt(n.safePressure, 4),
                  unit: 'MPa',
                }}
              />

              {/* ERF */}
              <CalcStep
                name={'ERF — Estimated Repair Factor'}
                formula={'ERF = S₀ / (Sᶠ × DF)'}
                substitution={`${fmt(n.So, 4)} / (${fmt(n.Sf, 4)} × ${n.df.toFixed(3)})`}
                result={formatErf(n.ERF)}
                tone={n.ERF > 1 ? 'bad' : n.ERF >= screening.reviewBandErf ? 'warn' : 'good'}
              />

              {/* Acceptance Level */}
              <div
                className={`rounded-lg border p-3 ${
                  n.acceptance === 'Acceptable'
                    ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800/60 dark:bg-emerald-950/20'
                    : 'border-rose-200 bg-rose-50/50 dark:border-rose-800/60 dark:bg-rose-950/20'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Acceptance Level
                    </p>
                    <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-indigo-600 dark:text-indigo-400">
                      ERF {'<'} 1 AND Depth {'<'} 80%
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                      = ERF={formatErf(n.ERF)} {n.ERF < 1 ? '✓' : '✗'} & Depth=
                      {n.maxDepthPct.toFixed(2)}% {n.maxDepthPct < 80 ? '✓' : '✗'}
                    </p>
                  </div>
                  <p
                    className={`shrink-0 text-right text-lg font-bold ${
                      n.acceptance === 'Acceptable'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {n.acceptance === 'Acceptable' ? 'Acceptable' : 'Not Acceptable'}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Screening Tiers */}
          <section className="mb-6">
            <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Screening tiers
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-[10px] leading-tight">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-900/60">
                    <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Tier
                    </th>
                    <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Depth [%]
                    </th>
                    <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Length [mm]
                    </th>
                    <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      P_safe [MPa]
                    </th>
                    <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      ERF
                    </th>
                    <th className="px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-slate-500">
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
                      severity: n.acceptance === 'Acceptable' ? ('pass' as const) : ('fail' as const),
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
                      <td className="px-2 py-2 font-medium">{tier.label}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{tier.depth.toFixed(1)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{tier.length.toFixed(0)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmt(tier.safe, 3)}</td>
                      <td className="px-2 py-2 text-right font-bold tabular-nums">{formatErf(tier.erf)}</td>
                      <td className="px-2 py-2 text-center">
                        <SeverityBadge severity={tier.severity} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Expected Life Projection */}
          <section className="mb-5">
            <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Expected life projection
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <LifeCard
                label="Expected Life"
                value={n.expectedLife >= 200 ? '>200' : n.expectedLife.toFixed(2)}
                unit="yrs"
                description={`tₗᶠᶠₑ = min(tₑʀᶠ, t₈₀%)`}
                tone={n.expectedLife < config.highlightYears ? 'warn' : 'default'}
              />
              <LifeCard
                label="Year Service"
                value={n.yearService}
                description={`ILI Date + tₗᶠᶠₑ`}
              />
              <LifeCard
                label="Failure Criteria"
                value={n.failureCriteria.startsWith('N/A') ? 'N/A' : n.failureCriteria}
                description="First condition hit"
                tone={n.failureCriteria === 'ERF = 1' ? 'bad' : 'default'}
              />
              <LifeCard
                label="ERF at Failure"
                value={fmt(n.atFailure_ERF, 4)}
                description={`ERF @ tₗᶠᶠₑ`}
              />
              <LifeCard
                label="Depth % at Failure"
                value={`${n.atFailure_depth.toFixed(2)}`}
                unit="%"
                description={`d/t × 100 @ tₗᶠᶠₑ`}
              />
              <LifeCard
                label={'Sᶠ at Failure'}
                value={fmt(n.atFailure_Sf, 4)}
                unit="MPa"
                description={`Sᶠ @ tₗᶠᶠₑ`}
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
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

          {/* Final callout */}
          {n.failureCriteria.startsWith('N/A') ? (
            <Callout>
              Neither the depth limit nor ERF 1.0 is reached within the 200-year search horizon at the
              supplied growth rates. This is a screening calculation — final disposition requires an
              approved procedure and independent checking.
            </Callout>
          ) : (
            <Callout
              tone={
                n.acceptance === 'Un-Acceptable'
                  ? 'danger'
                  : n.expectedLife < config.highlightYears
                    ? 'warn'
                    : 'info'
              }
            >
              <strong>
                {n.failureCriteria === 'ERF = 1'
                  ? `ERF reached 1.0 at ${n.expectedLife.toFixed(2)} years`
                  : `Depth limit reached at ${n.expectedLife.toFixed(2)} years`}
                {' — '}
                Year Service: {n.yearService}
              </strong>
            </Callout>
          )}
        </div>
      </div>
    </div>
  );
}
