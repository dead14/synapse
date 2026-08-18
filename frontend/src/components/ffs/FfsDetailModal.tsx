import { useEffect, useMemo, useRef, useState } from 'react';
import { FiAlertCircle, FiCheckCircle, FiChevronLeft, FiChevronRight, FiEye, FiEyeOff, FiX, FiXCircle } from 'react-icons/fi';
import {
  formatRemnantLife,
  remnantLifeCaveats,
  remnantLimitLabel,
} from '../../lib/ffs/lifeProjection';
import { buildCalcTrace, verifyCalcTrace, type FfsCalcStep } from '../../lib/ffs/calcTrace.ts';
import {
  applicabilityChecks,
  applicabilityStatus,
  engineeringDisposition,
  growthAnalysisBasisLabel,
  growthObservationLabel,
  designFactorSourceLabel,
  outerDiameterSourceLabel,
  b314DispositionLabel,
  methodProfileLabel,
  pressureBasisLabel,
  safetyFactorSourceLabel,
} from '../../lib/ffs/assessmentProfile.ts';
import type { FfsRepairCreditDecision } from '../../lib/ffs/reportCase';
import type { FfsConfig, FfsScreenedResult, FfsScreeningConfig } from '../../lib/ffs/types';
import { MathInline, MathBlock } from '../ds';
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
  symbolTex,
  value,
  unit,
  description,
  basis,
  showWorking = true,
}: {
  label: string;
  /** A plain word standing in for a symbol — `Method`, `Owner`, `Ref`. */
  symbol?: string;
  /**
   * The quantity's actual symbol, typeset.
   *
   * These were Unicode approximations — `Dₛ`, `ṙᵈ`, `ṙₗ`, `dₘₑₐₛ` — assembled
   * out of whichever combining subscripts happened to exist. Half of them do
   * not exist as Unicode at all, which is why the depth rate was spelled with
   * a superscript `d` where it needed a subscript, and why the same rate
   * appeared as `CR depth` two cards later. One notation, typeset once.
   */
  symbolTex?: string;
  value: string;
  unit?: string;
  description: string;
  /** Where the figure came from, for the reader who has to defend it. */
  basis?: string;
  showWorking?: boolean;
}) {
  return (
    <div className="ffs-detail__input-card">
      <p className="ffs-detail__input-label">{label}</p>
      <p className="ffs-detail__input-value">
        {value}
        {unit && <span className="ffs-detail__input-unit">{unit}</span>}
      </p>
      <p className="ffs-detail__input-desc">
        <span className="ffs-detail__input-symbol">
          {symbolTex ? <MathInline tex={symbolTex} /> : symbol}
        </span>
        {' = '}
        {description}
      </p>
      {basis && showWorking && <p className="ffs-detail__basis">{basis}</p>}
    </div>
  );
}

/**
 * One step of the verified trace.
 *
 * `showWorking` is the reader's choice between the answer and the derivation.
 * Collapsed, a step is a name and a number; expanded, it carries the formula,
 * this feature's numbers substituted into it, and the clause or project rule
 * the figure rests on.
 */
function CalcStep({ step, showWorking }: { step: FfsCalcStep; showWorking: boolean }) {
  const result = step.display ?? fmt(step.value, step.id === 'z' || step.id === 'depth-ratio' ? 4 : 4);
  const resultClass =
    step.tone === 'bad'
      ? ' ffs-detail__calc-result--bad'
      : step.tone === 'good'
        ? ' ffs-detail__calc-result--good'
        : '';

  return (
    <div className={`ffs-detail__calc-step ffs-detail__calc-step--${step.tone}`}>
      <div className="ffs-detail__calc-body">
        <div className="ffs-detail__calc-info">
          <span className="ffs-detail__calc-num">{step.index}</span>
          <div>
            <p className="ffs-detail__calc-name">
              {step.name}
              {step.note && <span className="ffs-detail__calc-note">{step.note}</span>}
            </p>
            {showWorking && (
              <>
                {/* Typeset, not spelled out. The failure-stress step alone
                    carries a fraction inside a fraction, which on one line of
                    monospace was the single worst thing to read on this
                    screen. */}
                <div className="ffs-detail__calc-formula">
                  <MathBlock tex={step.formulaTex} label={step.formula} />
                </div>
                {step.substitutionTex && (
                  <div className="ffs-detail__calc-sub">
                    <MathBlock
                      tex={`= ${step.substitutionTex}`}
                      label={`= ${step.substitution}`}
                      scale="sm"
                    />
                  </div>
                )}
                <p className="ffs-detail__basis">{step.basis}</p>
              </>
            )}
          </div>
        </div>
        <p className={`ffs-detail__calc-result${resultClass}`}>
          {result}
          {step.unit && <span className="ffs-detail__calc-unit">{step.unit}</span>}
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
  formulaTex,
  basis,
  showWorking = true,
  tone = 'default',
}: {
  label: string;
  value: string;
  unit?: string;
  description: string;
  /**
   * The equation the figure comes from, typeset above the prose.
   *
   * Split out of `basis` rather than left embedded in it. These cards used to
   * open with `P_F = 2·S_F·t/D — step 8.`, which put the one part of the
   * sentence that is not prose in the middle of a paragraph set at 0.6rem, in
   * the reading face, with a middle dot standing in for multiplication.
   */
  formulaTex?: string;
  /** The rule behind the figure, in words, shown when working is on. */
  basis?: string;
  showWorking?: boolean;
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
      {formulaTex && showWorking && (
        <div className="ffs-detail__life-formula">
          <MathBlock tex={formulaTex} scale="sm" />
        </div>
      )}
      {basis && showWorking && <p className="ffs-detail__basis">{basis}</p>}
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

  /**
   * Whether the derivation is on screen alongside the answers.
   *
   * Both readings are legitimate and neither is a default for everybody: an
   * engineer checking a disposition wants the four numbers that carry it, and
   * the same engineer defending the assessment in a report review wants every
   * formula, every substitution, and the clause behind each one. Working stays
   * on, because a calculation you cannot see is the thing this drawer exists to
   * prevent — but it collapses in one click.
   */
  const [showWorking, setShowWorking] = useState(true);

  const trace = useMemo(
    () => (item ? buildCalcTrace(item.nominal, config, screening) : []),
    [item, config, screening],
  );
  // A step whose printed working no longer reproduces its printed result is a
  // defect in this drawer, not in the assessment. It is surfaced rather than
  // swallowed: a trace that silently disagrees with itself is worse than none.
  const traceDefects = useMemo(() => verifyCalcTrace(trace), [trace]);

  if (!item) return null;

  const n = item.nominal;
  const life = n.remnantLife;
  // The depth rejection line this projection was actually measured to. Read
  // from the projection rather than assumed to be 80: it is configurable, and
  // remnantLife carries the value that was used.
  const depthLimitPct = Number(
    (Number.isFinite(life.depthLimitPct) ? life.depthLimitPct : 80).toFixed(2),
  );
  const depthLimitRatio = (depthLimitPct / 100).toFixed(2);
  const caveats = remnantLifeCaveats(life);
  const isOriginal = config.method === 'original';
  // The idealised metal-loss area. The Original method's parabola is two
  // thirds of the depth × length box and the Modified method's is 0.85 of it —
  // which the vulgar fraction `⅔dL` said in a glyph that does not exist at
  // every font weight this application uses, beside a decimal that does.
  const areaTex = isOriginal ? '\\tfrac{2}{3}\\,d\\,L' : '0.85\\,d\\,L';
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
              Method profile: {methodProfileLabel(config)} &middot;{' '}
              <MathInline tex={areaTex} label="idealised metal-loss area" /> area term
            </p>
            {/* The Code disposition, stated in the Code's own words. B31G says
                what the pipe can hold; B31.4 says what has to be done about it,
                and the two are allowed to differ. */}
            {item.b314 && (
              <p className="ffs-detail__method-badge">
                {b314DispositionLabel(item.b314.disposition)}
                {item.b314DesignThicknessMm !== null && item.b314DesignThicknessMm !== undefined && (
                  <> &middot; t<sub>design</sub> = {fmt(item.b314DesignThicknessMm, 3)} mm
                    {item.b314.depthRatioOfDesignThickness !== null && (
                      <> &middot; d/t<sub>design</sub> = {fmt(item.b314.depthRatioOfDesignThickness, 3)}</>
                    )}
                  </>
                )}
                <span title={item.b314.reference}> — {item.b314.statement}</span>
              </p>
            )}
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
                formulaTex="\Pfail = \frac{2\,\Sfail\,t}{D}"
                basis="Step 8. An estimate of the pressure at which the corroded wall would fail, carrying no margin. It is never an operating limit."
                showWorking={showWorking}
              />
              <LifeCard
                label="Safe pressure"
                value={fmt(n.safePressure, 3)}
                unit="MPa"
                description={timesRequired(n.safePressure, n.p0)}
                formulaTex={`\\Psafe = \\frac{\\Pfail}{\\SFac} \\quad\\text{at}\\quad \\SFac = ${fmt(n.SF, 4)}`}
                basis={`Step 10, with the safety factor ${safetyFactorSourceLabel(n.safetyFactorSource).toLowerCase()}. This is the pressure the assessment stands behind for this feature.`}
                showWorking={showWorking}
                tone="good"
              />
              <LifeCard
                label="Required pressure"
                value={fmt(n.p0, 3)}
                unit="MPa"
                description={pressureBasisLabel(config)}
                basis="The pressure the feature is assessed against, taken from the assessment setup. Every ERF on this screen is measured against it."
                showWorking={showWorking}
              />
              <LifeCard
                label="ERF"
                value={formatErf(n.ERF)}
                description={Number.isFinite(n.ERF) ? `${(n.ERF * 100).toFixed(1)}% of safe pressure used` : 'No safe-pressure basis'}
                formulaTex="\ERF = \frac{\Pop}{\Psafe}"
                basis="Step 11. An operator convention, not a B31G term: the code criterion is that the safe pressure equals or exceeds the required pressure."
                showWorking={showWorking}
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
                symbolTex="d_{\mathrm{meas}}"
                value={`${n.maxDepthPct.toFixed(2)}%`}
                description={`${n.maxDepthPct.toFixed(0)}% of wall`}
                basis="ILI-reported maximum depth. No sizing tolerance is applied here — that is the conservative tier below."
                showWorking={showWorking}
              />
              <InputCard
                label="Wall Thickness (t)"
                symbolTex="t"
                value={n.wall.toFixed(2)}
                unit="mm"
                description="Nominal"
                basis="Nominal wall for this joint. Depth %, the area term, and both Barlow pressures are all taken against it, so an incorrect wall moves every number in this drawer."
                showWorking={showWorking}
              />
              <InputCard
                label="Outer Diameter (D)"
                symbolTex="D_{\mathrm{s}}"
                value={n.od.toFixed(1)}
                unit="mm"
                description={outerDiameterSourceLabel(n.outerDiameterSource)}
                basis="Nominal outside diameter of the pipe this feature sits in — a line of more than one diameter carries one per section. Used for both the normalised length and the Barlow relation, which is why the two are consistent."
                showWorking={showWorking}
              />
              <InputCard
                label="SMYS"
                symbolTex="\SMYS"
                value={n.smys.toFixed(1)}
                unit="MPa"
                description="Specified"
                basis="Specified minimum yield strength of the grade — a specification floor, not a measured or certified property of this joint."
                showWorking={showWorking}
              />
              <InputCard
                label={'Required Pressure P₀'}
                symbolTex="\Pop"
                value={n.p0.toFixed(3)}
                unit="MPa"
                description={pressureBasisLabel(config)}
                basis="The pressure the acceptance criterion is applied at, set once for the assessment."
                showWorking={showWorking}
              />
              <InputCard
                label="Design Factor"
                symbolTex="\DFac"
                value={n.df.toFixed(3)}
                description={designFactorSourceLabel(n.designFactorSource)}
                basis={
                  n.safetyFactorSource === 'explicit'
                    ? 'The B31.8 design factor for this section. Recorded for traceability only: this assessment divides by the explicit safety factor from step 1, so the design factor does not enter the pressures.'
                    : 'The B31.8 design factor for this section. With no hydrotest ratio supplied it also sets the safety factor, as SF = 1/DF.'
                }
                showWorking={showWorking}
              />
              <InputCard
                label="Defect Length"
                symbolTex="L"
                value={n.length.toFixed(0)}
                unit="mm"
                description="ILI measured"
                basis="Axial extent of the metal-loss box as reported. It sets the normalised length and therefore which branch of the method applies."
                showWorking={showWorking}
              />
              <InputCard
                label="CR Depth"
                symbolTex="\CRd"
                value={n.crDepth.toFixed(4)}
                unit="mm/y"
                description={growthAnalysisBasisLabel(n.growthEvidence?.depth.analysisBasis)}
                basis={n.growthEvidence?.depth.note ?? 'No structured growth provenance was attached to this row.'}
                showWorking={showWorking}
              />
              <InputCard
                label="CR Length"
                symbolTex="\CRl"
                value={n.crLength.toFixed(4)}
                unit="mm/y"
                basis={n.growthEvidence?.length.note ?? 'No structured growth provenance was attached to this row.'}
                showWorking={showWorking}
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
                symbol="Repair"
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

          {/* Step-by-step calculation, built from the same result the engine
              produced and self-checked against it. */}
          <section className="ffs-detail__section">
            <div className="ffs-detail__section-heading-row">
              <h3 className="ffs-detail__section-title">Step-by-step calculation (at ILI date)</h3>
              <button
                type="button"
                onClick={() => setShowWorking((open) => !open)}
                aria-pressed={showWorking}
                className="ffs-detail__working-toggle"
              >
                {showWorking ? <FiEyeOff aria-hidden="true" /> : <FiEye aria-hidden="true" />}
                {showWorking ? 'Results only' : 'Show working'}
              </button>
            </div>

            {traceDefects.length > 0 && (
              <div className="mb-3">
                <Callout tone="danger">
                  <strong>Do not sign this trace.</strong> {traceDefects.length}{' '}
                  {traceDefects.length === 1 ? 'step does' : 'steps do'} not reproduce the result printed
                  beside {traceDefects.length === 1 ? 'it' : 'them'} (
                  {traceDefects.map((step) => step.name).join(', ')}). The assessment numbers come from the
                  engine and are unaffected, but this working cannot be used as evidence until it is corrected.
                </Callout>
              </div>
            )}

            <div className="ffs-detail__calc-list">
              {trace.map((step) => (
                <CalcStep key={step.id} step={step} showWorking={showWorking} />
              ))}
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
                      clampedFrom: null as number | null,
                    },
                    {
                      label: `Conservative — +${screening.depthTolerancePct}% WT, +${2 * screening.lengthToleranceMm} mm`,
                      depth: item.conservative.depthPct,
                      length: item.conservative.lengthMm,
                      safe: item.conservative.safePressure,
                      erf: item.conservative.ERF,
                      severity: item.conservative.severity,
                      clampedFrom: item.conservative.depthClamped
                        ? item.conservative.requestedDepthPct
                        : null,
                    },
                    {
                      label: `Forecast — ${screening.forecastYears} y at ${item.forecast.growthRateMmPerYear.toFixed(3)} mm/y (${growthAnalysisBasisLabel(item.forecast.growthAnalysisBasis)})`,
                      depth: item.forecast.depthPct,
                      length: item.forecast.lengthMm,
                      safe: item.forecast.safePressure,
                      erf: item.forecast.ERF,
                      severity: item.forecast.severity,
                      // A projection past the wall is evaluated at 99.5 %WT, so
                      // every figure on this row belongs to a shallower defect
                      // than the one projected. Say so on the row itself.
                      clampedFrom: item.forecast.depthClamped
                        ? item.forecast.requestedDepthPct
                        : null,
                    },
                  ].map((tier) => (
                    <tr key={tier.label}>
                      <td className="font-medium">{tier.label}</td>
                      <td className="text-right tabular-nums">
                        {tier.depth.toFixed(1)}
                        {tier.clampedFrom !== null && (
                          <span
                            className="ffs-detail__clamp-note"
                            title={`Projected to ${tier.clampedFrom.toFixed(1)} %WT, past the wall. Evaluated at ${tier.depth.toFixed(1)} %WT — the figures on this row describe that shallower defect.`}
                          >
                            {' '}(capped from {tier.clampedFrom.toFixed(0)})
                          </span>
                        )}
                      </td>
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

          {/* Remnant life */}
          <section className="ffs-detail__section">
            <h3 className="ffs-detail__section-title">Remnant life</h3>
            <div className="ffs-detail__life-grid">
              <LifeCard
                label="Remnant Life"
                value={formatRemnantLife(life)}
                description={`As reported, from the ILI date of ${config.iliDate.toISOString().slice(0, 10)}`}
                basis="The earlier of the two limits below, projected from the as-reported dimensions at the growth rates on this row. It is a projection under a stated growth assumption, not a service-life guarantee."
                showWorking={showWorking}
                tone={life.years !== null && life.years < config.highlightYears ? 'warn' : 'default'}
              />
              <LifeCard
                label="Due Date"
                value={life.dueDateIso ?? '—'}
                description={life.dueDateIso ? 'ILI date + calculated limit time' : 'No finite date established'}
                basis="Counted from the inspection date, not from today. Time elapsed since the run has already been consumed and is not added back."
                showWorking={showWorking}
              />
              <LifeCard
                label="Governing Limit"
                value={remnantLimitLabel(life)}
                description={life.governingLimit ? 'First condition reached' : 'No limit reached'}
                basis="Whichever limit is reached first. A tie goes to the depth limit, because quoting an ERF date past the depth line would report a number outside the range the method is written for."
                showWorking={showWorking}
                tone={life.governingLimit === 'ERF = 1' ? 'bad' : 'default'}
              />
              {/* Both criteria, always. The governing figure alone hides how
                  close the other limit is, which is what decides whether a
                  repair buys years or months. */}
              {/* The depth line is configurable, so neither the heading nor the
                  arithmetic beneath it may hard-code 80: at a project screening
                  at 70 %WT the working printed a sum that does not produce the
                  number above it. `depthLimitPct` is what the projection used. */}
              <LifeCard
                label={`Years to ${depthLimitPct}% Depth`}
                value={life.depthLimitYears === null ? '—' : life.depthLimitYears.toFixed(2)}
                unit={life.depthLimitYears === null ? undefined : 'y'}
                description="Closed form, from the as-reported depth"
                formulaTex={
                  `t_{\\text{depth}} = \\frac{\\left(${depthLimitRatio} - \\frac{d}{t}\\right) t}{\\CRd}`
                  + ` = \\frac{\\left(${depthLimitRatio} - ${fmt(n.dt, 4)}\\right)`
                  + ` \\times ${n.wall.toFixed(2)}}{${life.depthRateMmPerYear.toFixed(4)}}`
                }
                basis={`The ${depthLimitPct} %WT line is a project rejection threshold, not a B31G applicability limit.`}
                showWorking={showWorking}
              />
              <LifeCard
                label="Years to ERF 1.0"
                value={life.erfLimitYears === null ? '—' : life.erfLimitYears.toFixed(2)}
                unit={life.erfLimitYears === null ? undefined : 'y'}
                description="Depth and length both projected"
                basis={
                  life.lengthHeldConstant
                    ? 'Found by bisection on the projected geometry. No length growth rate was established, so the axial extent is held constant and this figure is non-conservative in the length direction.'
                    : 'Found by bisection on the projected geometry, growing depth and length together. A flaw that lengthens loses capacity through the bulging term even at constant depth.'
                }
                showWorking={showWorking}
              />
              <LifeCard
                label="Tolerance-adjusted"
                value={formatRemnantLife(item.remnantLifeConservative)}
                description={`+${screening.depthTolerancePct}% WT and +${2 * screening.lengthToleranceMm} mm`}
                basis="The same calculation from tolerance-adjusted dimensions — the sensitivity case, reported beside the as-reported figure rather than instead of it."
                showWorking={showWorking}
                tone={
                  item.remnantLifeConservative.years !== null &&
                  item.remnantLifeConservative.years < config.highlightYears
                    ? 'warn'
                    : 'default'
                }
              />
              <LifeCard
                label="CR Depth"
                value={life.depthRateMmPerYear.toFixed(3)}
                unit="mm/y"
                description={growthObservationLabel(n.growthEvidence?.depth.observation)}
                basis={n.growthEvidence?.depth.note ?? 'No structured growth provenance was attached to this row.'}
                showWorking={showWorking}
              />
              <LifeCard
                label="CR Length"
                value={life.lengthHeldConstant ? 'Not calculated' : life.lengthRateMmPerYear.toFixed(3)}
                unit={life.lengthHeldConstant ? undefined : 'mm/y'}
                description={growthObservationLabel(n.growthEvidence?.length.observation)}
                basis={
                  life.lengthHeldConstant
                    ? 'No usable axial rate. This is not a measured zero — it is the difference between "this flaw is not lengthening" and "nobody established whether it is".'
                    : (n.growthEvidence?.length.note ?? 'Supplied on the assessment row.')
                }
                showWorking={showWorking}
                tone={life.lengthHeldConstant ? 'warn' : 'default'}
              />
              <LifeCard
                label="ERF at Limit"
                value={fmt(n.atFailure_ERF, 4)}
                description="At the remnant-life date"
                formulaTex="\ERF\big|_{t = t_{\text{remnant}}}"
                basis="The feature re-evaluated at the remnant-life date. It reads 1.0 when ERF governs, and below 1.0 when the depth limit or the design-life cap got there first."
                showWorking={showWorking}
              />
              <LifeCard
                label="Depth % at Limit"
                value={n.atFailure_depth === null ? '—' : n.atFailure_depth.toFixed(2)}
                unit="%"
                description="At the remnant-life date"
                formulaTex="d_{\%} = \frac{d + \CRd\,t_{\text{remnant}}}{t}\times 100"
                basis="Projected depth at the remnant-life date, at the depth growth rate above."
                showWorking={showWorking}
              />
              <LifeCard
                label="Failure stress at limit"
                value={fmt(n.atFailure_Sf, 4)}
                unit="MPa"
                description="At the remnant-life date"
                formulaTex="\Sfail\big|_{t = t_{\text{remnant}}}"
                basis="Failure stress recomputed at the projected depth and length, through the same equation as step 7."
                showWorking={showWorking}
              />
            </div>

            {caveats.length > 0 && (
              <ul className="ffs-detail__caveats">
                {caveats.map((caveat) => (
                  <li key={caveat}>{caveat}</li>
                ))}
              </ul>
            )}

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
          {life.status !== 'calculated' ? (
            <Callout tone="neutral">
              {life.status === 'insufficient-growth-basis'
                ? 'No due date is calculated because neither depth nor length has a positive growth basis.'
                : `Neither the ${depthLimitPct}% depth limit nor ERF 1.0 is reached inside the configured ${life.analysisHorizonYears}-year analysis horizon.`}{' '}
              This is not a prediction of unlimited service life. Final disposition requires an approved
              procedure and independent checking.
            </Callout>
          ) : (
            <Callout
              tone={
                n.acceptance === 'Un-Acceptable'
                  ? 'danger'
                  : life.years !== null && life.years < config.highlightYears
                    ? 'warn'
                    : 'neutral'
              }
            >
              <strong>
                {life.governingLimit === 'ERF = 1'
                  ? `ERF reaches 1.0 at ${life.years?.toFixed(2)} years`
                  : life.governingLimit === 'Original design life'
                    ? `Reported at the ${life.designLifeYears}-year original design life`
                    : `Depth limit reached at ${life.years?.toFixed(2)} years`}
                {' — '}
                due {life.dueDateIso}
              </strong>
            </Callout>
          )}
        </div>
      </div>
    </div>
  );
}
