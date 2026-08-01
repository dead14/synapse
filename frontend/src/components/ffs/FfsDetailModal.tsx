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
    <div className="ffs-detail__input-card">
      <p className="ffs-detail__input-label">{label}</p>
      <p className="ffs-detail__input-value">
        {value}
        {unit && <span className="ffs-detail__input-unit">{unit}</span>}
      </p>
      <p className="ffs-detail__input-desc">
        <span className="ffs-detail__input-symbol">{symbol}</span>
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
  step,
  tone = 'default',
  sideBySide,
}: {
  name: string;
  formula: string;
  substitution: string;
  result: string;
  unit?: string;
  note?: string;
  step?: number;
  tone?: 'default' | 'accent' | 'good' | 'warn' | 'bad';
  sideBySide?: {
    name: string;
    formula: string;
    substitution: string;
    result: string;
    unit?: string;
  };
}) {
  const toneClass = `ffs-detail__calc-step--${tone}`;

  if (sideBySide) {
    return (
      <div className="ffs-detail__calc-pair">
        <div className={`ffs-detail__calc-step ${toneClass}`}>
          <div className="ffs-detail__calc-body">
            <div className="ffs-detail__calc-info">
              {step && <span className="ffs-detail__calc-num">{step}</span>}
              <div>
                <p className="ffs-detail__calc-name">{name}</p>
                <p className="ffs-detail__calc-formula">{formula}</p>
                <p className="ffs-detail__calc-sub">= {substitution}</p>
              </div>
            </div>
            <p className="ffs-detail__calc-result">
              {result}
              {unit && <span className="ffs-detail__calc-unit">{unit}</span>}
            </p>
          </div>
        </div>
        <div className="ffs-detail__calc-step ffs-detail__calc-step--accent">
          <div className="ffs-detail__calc-body">
            <div className="ffs-detail__calc-info">
              <div>
                <p className="ffs-detail__calc-name">{sideBySide.name}</p>
                <p className="ffs-detail__calc-formula">{sideBySide.formula}</p>
                <p className="ffs-detail__calc-sub">= {sideBySide.substitution}</p>
              </div>
            </div>
            <p className="ffs-detail__calc-result ffs-detail__calc-result--accent">
              {sideBySide.result}
              {sideBySide.unit && <span className="ffs-detail__calc-unit">{sideBySide.unit}</span>}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`ffs-detail__calc-step ${toneClass}`}>
      <div className="ffs-detail__calc-body">
        <div className="ffs-detail__calc-info">
          {step && <span className="ffs-detail__calc-num">{step}</span>}
          <div>
            <p className="ffs-detail__calc-name">
              {name}
              {note && <span className="ffs-detail__calc-note">{note}</span>}
            </p>
            <p className="ffs-detail__calc-formula">{formula}</p>
            <p className="ffs-detail__calc-sub">= {substitution}</p>
          </div>
        </div>
        <p className="ffs-detail__calc-result">
          {result}
          {unit && <span className="ffs-detail__calc-unit">{unit}</span>}
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
  return (
    <div className={`ffs-detail__life-card ffs-detail__life-card--${tone}`}>
      <p className="ffs-detail__life-label">{label}</p>
      <p className="ffs-detail__life-value">
        {value}
        {unit && <span className="ffs-detail__life-unit">{unit}</span>}
      </p>
      <p className="ffs-detail__life-desc">{description}</p>
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
  const failed = n.acceptance === 'Un-Acceptable';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Calculation breakdown for the feature at log distance ${n.ld}`}
      className="ffs-detail__overlay"
      onClick={onClose}
    >
      <div className="ffs-detail__dialog" onClick={(event) => event.stopPropagation()}>
        {/* Accent bar */}
        <div className={`ffs-detail__accent-bar ${failed ? 'ffs-detail__accent-bar--fail' : 'ffs-detail__accent-bar--pass'}`} />

        {/* Header */}
        <div className="ffs-detail__header">
          <div className="ffs-detail__header-left">
            <div className="ffs-detail__header-title-row">
              <h2 className="ffs-detail__title">
                DEFECT @ LD {Number(n.ld).toLocaleString()} m
              </h2>
              <span className="ffs-detail__method-badge">
                {methodLabel} &middot; {areaLabel}
              </span>
            </div>
            <p className="ffs-detail__subtitle">
              {n.section} &middot; {n.surface} &middot; {n.acceptance}
            </p>
          </div>
          <div className="ffs-detail__header-right">
            <SeverityBadge severity={item.conservative.severity} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close calculation breakdown"
              className="ffs-detail__close-btn"
            >
              <FiX />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="ffs-detail__body">
          {/* Input Parameters */}
          <section className="ffs-detail__section">
            <h3 className="ffs-detail__section-title">Input parameters</h3>
            <div className="ffs-detail__input-grid">
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
                label="Outer Diameter (D)"
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
          <section className="ffs-detail__section">
            <h3 className="ffs-detail__section-title">Step-by-step calculation (at ILI date)</h3>
            <div className="ffs-detail__calc-list">
              <CalcStep
                step={1}
                name="Safety Factor (SF)"
                formula="SF = 1 / DF"
                substitution={`1 / ${n.df.toFixed(3)}`}
                result={fmt(n.SF)}
              />

              <CalcStep
                step={2}
                name="Defect Depth (d)"
                formula="d = (Depth% / 100) × t"
                substitution={`(${n.maxDepthPct.toFixed(2)} / 100) × ${n.wall.toFixed(2)}`}
                result={fmt(n.d, 4)}
                unit="mm"
              />

              <CalcStep
                step={3}
                name="D/T Ratio"
                formula="d/t = d / t"
                substitution={`${fmt(n.d, 4)} / ${n.wall.toFixed(2)}`}
                result={fmt(n.dt)}
              />

              <CalcStep
                step={4}
                name="Z Factor"
                formula={'z = L² / (D × t)'}
                substitution={`${n.length.toFixed(0)}² / (${n.od.toFixed(1)} × ${n.wall.toFixed(2)})`}
                result={fmt(n.z)}
              />

              {isOriginal ? (
                n.M !== null ? (
                  <CalcStep
                    step={5}
                    name="M Factor (Folias)"
                    formula={'√(1 + 0.8z)'}
                    substitution={`√(1 + 0.8 × ${fmt(n.z)})`}
                    result={fmt(n.M)}
                    note={`z≤20`}
                    tone="accent"
                  />
                ) : (
                  <CalcStep
                    step={5}
                    name="M Factor (Folias)"
                    formula="M not used for z > 20"
                    substitution="Long-anomaly branch selected"
                    result="n/a"
                    note="z>20"
                  />
                )
              ) : (
                <CalcStep
                  step={5}
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

              <CalcStep
                step={6}
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

              <CalcStep
                step={7}
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

              <CalcStep
                step={8}
                name={'Failure Pressure Pᶠ'}
                formula={'Pᶠ = 2 × Sᶠ × t / D'}
                substitution={`2 × ${fmt(n.Sf, 4)} × ${n.wall.toFixed(2)} / ${n.od.toFixed(1)}`}
                result={fmt(n.Pf, 4)}
                unit="MPa"
              />

              <CalcStep
                step={9}
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

              <CalcStep
                step={10}
                name={'ERF — Estimated Repair Factor'}
                formula={'ERF = S₀ / (Sᶠ × DF)'}
                substitution={`${fmt(n.So, 4)} / (${fmt(n.Sf, 4)} × ${n.df.toFixed(3)})`}
                result={formatErf(n.ERF)}
                tone={n.ERF > 1 ? 'bad' : n.ERF >= screening.reviewBandErf ? 'warn' : 'good'}
              />

              {/* Acceptance Level */}
              <div className={`ffs-detail__acceptance ${failed ? 'ffs-detail__acceptance--fail' : 'ffs-detail__acceptance--pass'}`}>
                <div className="ffs-detail__calc-body">
                  <div className="ffs-detail__calc-info">
                    <span className="ffs-detail__calc-num">11</span>
                    <div>
                      <p className="ffs-detail__calc-name">Acceptance Level</p>
                      <p className="ffs-detail__calc-formula">
                        ERF {'<'} 1 AND Depth {'<'} 80%
                      </p>
                      <p className="ffs-detail__calc-sub">
                        = ERF={formatErf(n.ERF)} {n.ERF < 1 ? '✓' : '✗'} & Depth=
                        {n.maxDepthPct.toFixed(2)}% {n.maxDepthPct < 80 ? '✓' : '✗'}
                      </p>
                    </div>
                  </div>
                  <p className={`ffs-detail__calc-result ${failed ? 'ffs-detail__calc-result--bad' : 'ffs-detail__calc-result--good'}`}>
                    {failed ? 'Not Acceptable' : 'Acceptable'}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Screening Tiers */}
          <section className="ffs-detail__section">
            <h3 className="ffs-detail__section-title">Screening tiers</h3>
            <div className="ffs-detail__tiers-wrap">
              <table className="ffs-detail__tiers-table">
                <thead>
                  <tr>
                    <th className="text-left">Tier</th>
                    <th className="text-right">Depth [%]</th>
                    <th className="text-right">Length [mm]</th>
                    <th className="text-right">P_safe [MPa]</th>
                    <th className="text-right">ERF</th>
                    <th className="text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
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
                      label: `Forecast — ${screening.forecastYears} y at ${item.forecast.growthRateMmPerYear.toFixed(3)} mm/y` + (screening.growthBasis === 'measured' ? ' (measured)' : ' (uniform)'),
                      depth: item.forecast.depthPct,
                      length: item.forecast.lengthMm,
                      safe: item.forecast.safePressure,
                      erf: item.forecast.ERF,
                      severity: item.forecast.severity,
                    },
                  ].map((tier) => (
                    <tr key={tier.label}>
                      <td className="font-medium">{tier.label}</td>
                      <td className="text-right tabular-nums">{tier.depth.toFixed(1)}</td>
                      <td className="text-right tabular-nums">{tier.length.toFixed(0)}</td>
                      <td className="text-right tabular-nums">{fmt(tier.safe, 3)}</td>
                      <td className="text-right font-bold tabular-nums">{formatErf(tier.erf)}</td>
                      <td className="text-center">
                        <SeverityBadge severity={tier.severity} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Expected Life Projection */}
          <section className="ffs-detail__section">
            <h3 className="ffs-detail__section-title">Expected life projection</h3>
            <div className="ffs-detail__life-grid">
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

            <div className="ffs-detail__priority-row">
              <span className="ffs-detail__priority-label">Engineering priority:</span>
              <PriorityLabel priority={item.priority} />
              {item.clockHour !== null && (
                <span className="ffs-detail__priority-label">
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
