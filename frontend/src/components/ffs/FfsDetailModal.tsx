import { useEffect, useRef } from 'react';
import { FiAlertCircle, FiCheckCircle, FiChevronLeft, FiChevronRight, FiX, FiXCircle } from 'react-icons/fi';
import { formatLifeProjection, lifeProjectionStatusLabel } from '../../lib/ffs/lifeProjection';
import {
  applicabilityChecks,
  applicabilityStatus,
  engineeringDisposition,
  growthAnalysisBasisLabel,
  growthObservationLabel,
  methodProfileLabel,
  pressureBasisLabel,
} from '../../lib/ffs/assessmentProfile.ts';
import type { FfsRepairCreditDecision } from '../../lib/ffs/reportCase';
import type { FfsConfig, FfsScreenedResult, FfsScreeningConfig } from '../../lib/ffs/types';
import { Callout, PriorityLabel, SeverityBadge, formatErf } from './FfsPrimitives';
import FfsScenarioLab from './FfsScenarioLab.tsx';

function fmt(value: number | null, digits = 4): string {
  if (value === null) return 'n/a';
  return Number.isFinite(value) ? value.toFixed(digits) : '∞';
}

/** Expresses a capacity as a multiple of the pressure the ERF is measured against. */
function timesRequired(value: number, requiredPressureMpa: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(requiredPressureMpa) || requiredPressureMpa <= 0) {
    return 'no required-pressure basis';
  }
  return `${(value / requiredPressureMpa).toFixed(2)}× required pressure`;
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
  tone?: 'default' | 'accent' | 'good' | 'warn' | 'bad';
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
  repairCreditDecision,
  position,
  total,
  onPrevious,
  onNext,
  onClose,
}: {
  item: FfsScreenedResult | null;
  config: FfsConfig;
  screening: FfsScreeningConfig;
  repairCreditDecision: FfsRepairCreditDecision | null;
  position: number;
  total: number;
  onPrevious?: () => void;
  onNext?: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const isOpen = item !== null;

  useEffect(() => {
    if (!isOpen) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    titleRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (item && bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [item]);

  if (!item) return null;

  const n = item.nominal;
  const isOriginal = config.method === 'original';
  const kLabel = isOriginal ? '2/3' : '0.85';
  const k = isOriginal ? 2 / 3 : 0.85;
  const areaLabel = isOriginal ? '⅔dL' : '0.85dL';
  const failed = n.acceptance === 'Un-Acceptable';
  const repairCredited = repairCreditDecision?.credited === true;
  const methodChecks = applicabilityChecks(item);
  const methodApplicability = applicabilityStatus(item);
  const disposition = engineeringDisposition(item);

  return (
    <div className="ffs-detail__overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ffs-detail-title"
        className="ffs-detail__dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ffs-detail__nav">
          <button type="button" onClick={onPrevious} disabled={!onPrevious} className="ffs-detail__nav-btn">
            <FiChevronLeft /> Previous
          </button>
          <span className="ffs-detail__nav-count">{position} of {total.toLocaleString()}</span>
          <button type="button" onClick={onNext} disabled={!onNext} className="ffs-detail__nav-btn">
            Next <FiChevronRight />
          </button>
          <button type="button" onClick={onClose} aria-label="Close calculation drawer" className="ffs-detail__close-btn">
            <FiX />
          </button>
        </div>
        {/* Header */}
        <div className="ffs-detail__header">
          <div className="ffs-detail__header-left">
            <h2 id="ffs-detail-title" ref={titleRef} tabIndex={-1} className="ffs-detail__title">
              LD {Number(n.ld).toLocaleString()} m
            </h2>
            <p className="ffs-detail__subtitle">
              {n.featureId ? <>ID: {n.featureId} &middot; </> : null}
              Section: {n.section} &middot; Surface: {n.surface}
            </p>
            <div className="ffs-detail__status-row">
              <span
                className={`ffs-detail__status-pill ffs-detail__status-pill--${
                  n.acceptance === 'Acceptable' ? 'pass' : 'fail'
                }`}
              >
                {n.acceptance === 'Acceptable' ? <FiCheckCircle aria-hidden="true" /> : <FiXCircle aria-hidden="true" />}
                {n.acceptance === 'Acceptable' ? 'Pass' : 'Fail'} at required pressure
              </span>
              <span className="ffs-detail__status-chip">
                Conservative screen: <SeverityBadge severity={item.conservative.severity} />
              </span>
              <span className="ffs-detail__status-chip">
                Priority: <PriorityLabel priority={item.priority} />
              </span>
            </div>
            <p className="ffs-detail__method-badge">
              Method profile: {methodProfileLabel(config)} &middot; {areaLabel} area term
            </p>
          </div>
        </div>

        {/* Body */}
        <div ref={bodyRef} className="ffs-detail__body">
          <section className="ffs-detail__section">
            <h3 className="ffs-detail__section-title">Capacity at required pressure</h3>
            <div className="ffs-detail__metric-grid">
              <LifeCard
                label="Failure pressure"
                value={fmt(n.Pf, 3)}
                unit="MPa"
                description={timesRequired(n.Pf, n.p0)}
              />
              <LifeCard
                label="Safe pressure"
                value={fmt(n.safePressure, 3)}
                unit="MPa"
                description={timesRequired(n.safePressure, n.p0)}
                tone="good"
              />
              <LifeCard label="Required pressure" value={fmt(n.p0, 3)} unit="MPa" description={pressureBasisLabel(config)} />
              <LifeCard
                label="ERF"
                value={formatErf(n.ERF)}
                description={Number.isFinite(n.ERF) ? `${(n.ERF * 100).toFixed(1)}% of safe pressure used` : 'No safe-pressure basis'}
                tone={n.ERF >= 1 ? 'bad' : n.ERF >= screening.reviewBandErf ? 'warn' : 'default'}
              />
            </div>
          </section>

          <FfsScenarioLab
            key={item.key}
            featureKey={item.key}
            nominal={n}
            config={config}
            screening={screening}
          />

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
                label={'Required Pressure P₀'}
                symbol={'P₀'}
                value={n.p0.toFixed(3)}
                unit="MPa"
                description={pressureBasisLabel(config)}
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
                description={growthAnalysisBasisLabel(n.growthEvidence?.depth.analysisBasis)}
              />
              <InputCard
                label="CR Length"
                symbol={'ṙₗ'}
                value={n.crLength.toFixed(4)}
                unit="mm/y"
                description={growthAnalysisBasisLabel(n.growthEvidence?.length.analysisBasis)}
              />
            </div>
          </section>

          <section className="ffs-detail__section">
            <h3 className="ffs-detail__section-title">Growth evidence and projection basis</h3>
            <div className="ffs-detail__evidence-grid">
              <div className="ffs-detail__evidence-card">
                <span className="ffs-detail__evidence-label">Source observation</span>
                <strong>{growthObservationLabel(n.growthEvidence?.depth.observation)}</strong>
                <p>{n.growthEvidence?.depth.note ?? 'No structured growth provenance was attached.'}</p>
              </div>
              <div className="ffs-detail__evidence-card">
                <span className="ffs-detail__evidence-label">Rate used by projection</span>
                <strong>
                  {n.growthEvidence?.depth.analysisRateMmPerYear === null
                    ? 'Not calculable'
                    : `${n.crDepth.toFixed(4)} mm/y`}
                </strong>
                <p>{growthAnalysisBasisLabel(n.growthEvidence?.depth.analysisBasis)}</p>
              </div>
              <div className="ffs-detail__evidence-card">
                <span className="ffs-detail__evidence-label">Survey interval / formula</span>
                <strong>{n.growthEvidence?.intervalYears ? `${n.growthEvidence.intervalYears} years` : 'Not established'}</strong>
                <p className="font-mono">{n.growthEvidence?.depth.formula ?? 'No calculated formula'}</p>
              </div>
            </div>
            {n.growthEvidence?.depth.observation === 'new-only-zero-baseline-estimate' && (
              <div className="mt-3">
                <Callout tone="warn">
                  This rate assumes zero metal-loss depth at the OLD survey date. It provides a transparent
                  screening estimate for a NEW-only feature, not a measured corrosion growth rate.
                </Callout>
              </div>
            )}
          </section>

          <section className="ffs-detail__section">
            <div className="ffs-detail__section-heading-row">
              <h3 className="ffs-detail__section-title">Method applicability and disposition</h3>
              <span className={`ffs-detail__applicability ffs-detail__applicability--${methodApplicability}`}>
                {methodApplicability === 'outside-domain'
                  ? 'Outside supported domain'
                  : methodApplicability === 'limited'
                    ? 'Applicability evidence incomplete'
                    : 'Applicable'}
              </span>
            </div>
            <div className="ffs-detail__checks">
              {methodChecks.map((check) => {
                const Icon = check.status === 'pass' ? FiCheckCircle : check.status === 'fail' ? FiXCircle : FiAlertCircle;
                return (
                  <div key={check.id} className={`ffs-detail__check ffs-detail__check--${check.status}`}>
                    <Icon aria-hidden="true" />
                    <div><strong>{check.label}</strong><p>{check.detail}</p></div>
                  </div>
                );
              })}
            </div>
            <div className="ffs-detail__disposition">
              <span>Engineering disposition</span>
              <strong>{disposition}</strong>
            </div>
          </section>

          {/* Repair disposition and evidence */}
          <section className="mb-6">
            <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Repair disposition and evidence
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <InputCard
                label="Feature identity"
                symbol="ID"
                value={n.featureId ?? '—'}
                description={n.featureId ? 'Stable report key' : 'Required for report readiness'}
              />
              <InputCard
                label="Repair status"
                symbol="R"
                value={
                  n.repairStatus === 'permanent-repair-verified'
                    ? 'Permanent'
                    : n.repairStatus === 'temporary-repair'
                      ? 'Temporary'
                      : 'Unrepaired'
                }
                description={repairCredited ? 'Evidence-qualified capacity credit' : 'Active in as-managed case'}
              />
              <InputCard
                label="Repair method"
                symbol="Method"
                value={n.repairMethod ?? '—'}
                description={n.repairStatus === 'unrepaired' ? 'No repair recorded' : 'Evidence field'}
              />
              <InputCard
                label="Completion date"
                symbol="Date"
                value={n.repairDate ?? '—'}
                description="YYYY-MM-DD"
              />
              <InputCard
                label="Evidence reference"
                symbol="Ref"
                value={n.repairReference ?? '—'}
                description="Work order, dossier, or certificate"
              />
              <InputCard
                label="Action owner"
                symbol="Owner"
                value={n.actionOwner ?? '—'}
                description={n.recommendation ?? 'No recommendation recorded'}
              />
            </div>
            {n.repairStatus !== 'unrepaired' && (
              <div className="mt-3">
                <Callout tone={repairCredited ? 'neutral' : 'warn'}>
                  {repairCredited
                    ? 'This completed permanent repair is excluded from the as-managed population after minimum evidence validation.'
                    : 'This feature remains active in the as-managed population. Temporary repairs, ambiguous identity, incomplete evidence, and out-of-window completion dates receive no capacity credit.'}
                </Callout>
              </div>
            )}
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
                  name: 'Calculated Safe Pressure',
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
                      label: `Forecast — ${screening.forecastYears} y at ${item.forecast.growthRateMmPerYear.toFixed(3)} mm/y (${growthAnalysisBasisLabel(item.forecast.growthAnalysisBasis)})`,
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
                value={formatLifeProjection(n.expectedLife, n.lifeStatus, n.analysisHorizonYears)}
                description={`Bounded to the ${n.analysisHorizonYears}-year analysis horizon`}
                tone={n.expectedLife !== null && n.expectedLife < config.highlightYears ? 'warn' : 'default'}
              />
              <LifeCard
                label="Service Limit Date"
                value={n.yearService ?? '—'}
                description={n.yearService ? 'ILI date + calculated limit time' : 'No finite date established'}
              />
              <LifeCard
                label="Projection Status"
                value={lifeProjectionStatusLabel(n.lifeStatus, n.failureCriteria, n.analysisHorizonYears)}
                description={n.failureCriteria ? 'First condition reached' : 'No failure point calculated'}
                tone={n.failureCriteria === 'ERF = 1' ? 'bad' : 'default'}
              />
              <LifeCard
                label="ERF at Failure"
                value={fmt(n.atFailure_ERF, 4)}
                description={`ERF @ tₗᶠᶠₑ`}
              />
              <LifeCard
                label="Depth % at Failure"
                value={n.atFailure_depth === null ? '—' : n.atFailure_depth.toFixed(2)}
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

            {item.clockHour !== null && (
              <div className="ffs-detail__priority-row">
                <span className="ffs-detail__priority-label">
                  Clock {n.orient}
                  {item.bottomQuadrant && ' · bottom quadrant'}
                </span>
              </div>
            )}
          </section>

          {/* Final callout */}
          {n.lifeStatus !== 'calculated' ? (
            <Callout tone="neutral">
              {n.lifeStatus === 'insufficient-growth-basis'
                ? 'No service-limit date is calculated because neither depth nor length has a positive growth basis.'
                : `Neither the 80% depth limit nor ERF 1.0 is reached inside the configured ${n.analysisHorizonYears}-year analysis horizon.`}{' '}
              This is not a prediction of unlimited service life. Final disposition requires an approved
              procedure and independent checking.
            </Callout>
          ) : (
            <Callout
              tone={
                n.acceptance === 'Un-Acceptable'
                  ? 'danger'
                  : n.expectedLife !== null && n.expectedLife < config.highlightYears
                    ? 'warn'
                    : 'neutral'
              }
            >
              <strong>
                {n.failureCriteria === 'ERF = 1'
                  ? `ERF reached 1.0 at ${n.expectedLife?.toFixed(2)} years`
                  : `Depth limit reached at ${n.expectedLife?.toFixed(2)} years`}
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
