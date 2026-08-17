import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  FiActivity,
  FiArrowLeft,
  FiArrowRight,
  FiCheckCircle,
  FiPlus,
  FiShield,
  FiSliders,
  FiTarget,
  FiTrash2,
} from 'react-icons/fi';
import { apiFetch } from '../utils/api';
import { pairTieIn, primaryRunPair, resolveRunPairs } from '../domain/runPairs';
import { timelineLaneLabels } from '../domain/gwTimeline';
import { Button, MathInline } from '../components/ds';

interface StepTieInConfigProps {
  onNext: (data: any) => void;
  onBack: () => void;
  config: any;
}

interface TieInDecision {
  status: 'AUTO_ACCEPTED' | 'REVIEW_REQUIRED' | 'REVIEW_ACKNOWLEDGED';
  reasons: string[];
  requiresHumanReview: boolean;
  evidenceScore: number;
  isProbability: false;
  originalStatus?: 'REVIEW_REQUIRED';
  acknowledgedBy?: number;
}

interface TieInMetrics {
  evidenceToken: string;
  methodVersion: string;
  confidence: number;
  message: string;
  candidatePairCount?: number;
  alignedPairCount?: number;
  unalignedPairCount?: number;
  matchedPairCount: number;
  inlierPairCount: number;
  residualRmseM: number;
  evidenceOverlap?: {
    oldStartM: number;
    oldEndM: number;
    newStartM: number;
    newEndM: number;
  };
  robustFit?: {
    method: string;
    dependencyFree: boolean;
    residualThresholdM: number;
  };
  spanResidual?: {
    count: number;
    medianM: number;
    medianAbsM: number;
    meanAbsM: number;
    p95AbsM: number;
    maximumAbsM: number;
    rmseM: number;
  };
  overlap: {
    oldStartM: number;
    oldEndM: number;
    newStartM: number;
    newEndM: number;
  };
  decision: TieInDecision;
  /**
   * Present only when the estimate is REVIEW_REQUIRED. Partial Run refuses to
   * fall back to a scalar offset, so this server-signed decision is the only
   * way an engineer can proceed on evidence that failed a gate.
   */
  reviewAcknowledgement?: {
    decision: TieInDecision;
    evidenceToken: string;
  };
  tieIn: {
    oldDistanceM: number;
    newDistanceM: number;
    oldId?: string | number | null;
    newId?: string | number | null;
  };
  transform: {
    direction: 'OLD_TO_NEW';
    model: 'MONOTONIC_PIECEWISE_LINEAR';
    allowExtrapolation: false;
    knots: Array<{ oldDistanceM: number; newDistanceM: number }>;
    domain: {
      oldStartM: number;
      oldEndM: number;
      newStartM: number;
      newEndM: number;
    };
    affineFallback: { scale: number; offsetM: number; formula: string };
    localScaleRange?: { minimum: number; maximum: number };
    maximumOffsetStepM?: number;
    knotCount?: number;
  };
  comparisonCoordinates?: {
    direction: 'OLD_SHIFTED_TO_NEW';
    provisionalOffsetM: number;
    isFinalTransform: false;
  };
  candidates?: Array<{
    rank: number;
    evidenceScore: number;
    pairCount: number;
    oldStartM: number;
    newStartM: number;
  }>;
}

const reviewReasonLabels: Record<string, string> = {
  INSUFFICIENT_MATCHED_ANCHORS: 'not enough matched physical anchors',
  INSUFFICIENT_PHYSICAL_COVERAGE: 'physical overlap length is insufficient',
  AMBIGUOUS_OVERLAP: 'another overlap candidate is too similar',
  LOW_INLIER_RATIO: 'too many inconsistent anchors',
  NON_MONOTONIC_TRANSFORM: 'pair order is not monotonic',
  LOCAL_SCALE_OUTSIDE_ENGINEERING_GATE: 'local scale correction exceeds the engineering gate',
  ABRUPT_OFFSET_CHANGE: 'abrupt offset jump detected between spools',
  HIGH_SPAN_RESIDUAL: 'spool length residual is too high',
};

type TieInSelection = 'auto' | 'acknowledged' | 'manual';
type ExcludedRange = { run: 'OLD' | 'NEW'; startM: number; endM: number };
type TieInSection = 'evidence' | 'exclusions' | 'manual';

/**
 * The three decisions this step actually contains, as a rail.
 *
 * They used to be stacked as three cards of similar weight, so the exclusion
 * panel — a tuning aid most runs never need — sat between the recommendation
 * and the sign-off that depends on it, and the manual override read as a third
 * equally valid choice rather than the legacy escape hatch it is.
 */
const TIE_IN_SECTIONS: Array<{
  id: TieInSection;
  title: string;
  detail: string;
  Icon: typeof FiTarget;
}> = [
  {
    id: 'evidence',
    title: 'Partial run calibration',
    detail: 'Map and align the latest run with historical data',
    Icon: FiTarget,
  },
  {
    id: 'exclusions',
    title: 'Exclusion options',
    detail: 'Define ranges to leave out of the estimate',
    Icon: FiShield,
  },
  {
    id: 'manual',
    title: 'Manual override',
    detail: 'Advanced option to set the offset by hand',
    Icon: FiSliders,
  },
];

/**
 * Everything the operator decided about one run pair. A chain session aligns
 * N-1 pairs and each needs its own overlap, transform, and sign-off — a single
 * shared set of these fields only ever described the last pair, and the wizard
 * then applied that pair's transform to all the others.
 */
type PairTieInState = {
  loading: boolean;
  metrics: TieInMetrics | null;
  autoOffset: number | null;
  errorMessage: string | null;
  selection: TieInSelection | null;
  manualOffset: number | '';
  acknowledgementNote: string;
  excludedRanges: ExcludedRange[];
};

const emptyPairState = (excludedRanges: ExcludedRange[] = []): PairTieInState => ({
  loading: true,
  metrics: null,
  autoOffset: null,
  errorMessage: null,
  selection: null,
  manualOffset: '',
  acknowledgementNote: '',
  excludedRanges,
});

export default function StepTieInConfig({ onNext, onBack, config }: StepTieInConfigProps) {
  const pairs = useMemo(() => resolveRunPairs(config?.summaryData), [config?.summaryData]);
  const primaryPair = useMemo(() => primaryRunPair(config?.summaryData), [config?.summaryData]);
  const [activePairKey, setActivePairKey] = useState<string | null>(null);
  const activePair = pairs.find((pair) => pair.key === activePairKey) ?? pairs[0] ?? null;

  const [pairStates, setPairStates] = useState<Record<string, PairTieInState>>(() => (
    Object.fromEntries(resolveRunPairs(config?.summaryData).map((pair) => {
      const stored = pairTieIn(config, pair);
      return [pair.key, emptyPairState(
        Array.isArray(stored?.tieInExcludedRanges) ? stored.tieInExcludedRanges : [],
      )];
    }))
  ));

  const active = (activePair && pairStates[activePair.key]) || emptyPairState();
  const patchActive = (patch: Partial<PairTieInState>) => {
    if (!activePair) return;
    setPairStates((current) => ({
      ...current,
      [activePair.key]: { ...(current[activePair.key] ?? emptyPairState()), ...patch },
    }));
  };

  const { loading, metrics: tieInMetrics, autoOffset, errorMessage, selection, manualOffset, acknowledgementNote, excludedRanges } = active;
  const setSelection = (next: TieInSelection) => patchActive({ selection: next });
  const setManualOffset = (next: number | '') => patchActive({ manualOffset: next });
  const setAcknowledgementNote = (next: string) => patchActive({ acknowledgementNote: next });
  const setExcludedRanges = (next: ExcludedRange[] | ((current: ExcludedRange[]) => ExcludedRange[])) => patchActive({
    excludedRanges: typeof next === 'function' ? next(excludedRanges) : next,
  });

  const [rangeDraft, setRangeDraft] = useState<{ run: 'OLD' | 'NEW'; startM: number | ''; endM: number | '' }>({ run: 'NEW', startM: '', endM: '' });
  const [section, setSection] = useState<TieInSection>('evidence');
  // The runs are named by survey year here for the same reason they are in the
  // viewer: "OLD → NEW master" asks the reader to translate engine sides back
  // onto the two runs they picked at upload.
  const laneLabels = useMemo(
    () => timelineLaneLabels(activePair?.oldRun, activePair?.newRun),
    [activePair],
  );
  const requestRevision = useRef(0);
  const activeExcludedKey = JSON.stringify(excludedRanges);

  useEffect(() => {
    if (!activePair) return;
    const pairKey = activePair.key;
    const controller = new AbortController();
    const currentRequest = ++requestRevision.current;
    const patch = (patchValue: Partial<PairTieInState>) => setPairStates((current) => ({
      ...current,
      [pairKey]: { ...(current[pairKey] ?? emptyPairState()), ...patchValue },
    }));

    const fetchMachineGuess = async () => {
      patch({ loading: true, metrics: null, autoOffset: null, selection: null });
      try {
        // resolveRunPairs only yields pairs whose two runs are both persisted, so
        // the server always reads the anchors from the database and the old
        // raw-feature upload path is no longer reachable from here.
        const data = await apiFetch<TieInMetrics & { success: boolean; offset: number; error?: string }>('/api/estimate-tiein-offset', {
          method: 'POST',
          body: JSON.stringify({
            oldRunId: activePair.oldRunId,
            newRunId: activePair.newRunId,
            excludedRanges,
          }),
          signal: controller.signal
        });
        if (currentRequest !== requestRevision.current) return;

        if (data.success && Number.isFinite(Number(data.offset))) {
          patch({
            autoOffset: Math.round(data.offset * 1000) / 1000,
            errorMessage: null,
            metrics: data,
            selection: data.decision?.status === 'AUTO_ACCEPTED' ? 'auto' : null,
          });
        } else {
          console.error("Tie-in estimation failed:", data.error);
          patch({ errorMessage: data.error || 'Engine failed to return a valid offset.', autoOffset: 0 });
        }
      } catch (err: any) {
        if (err.name === 'AbortError' || currentRequest !== requestRevision.current) return;
        console.error("Failed to fetch tie-in offset:", err);
        patch({ errorMessage: err.message || 'Network error while connecting to engine.', autoOffset: 0 });
      } finally {
        if (currentRequest === requestRevision.current) patch({ loading: false });
      }
    };

    fetchMachineGuess();
    return () => {
      requestRevision.current += 1;
      controller.abort();
    };
    // Keyed on identity rather than object references: `activePair.key` fully
    // determines the pair, and `activeExcludedKey` is the serialized content of
    // `excludedRanges`. Depending on the objects themselves re-estimates the
    // tie-in on every render, which is what made this step re-request in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePair?.key, activeExcludedKey]);

  const partialRunEnabled = Boolean(config?.enablePartialRun);
  const manualAllowed = !partialRunEnabled;
  const autoAccepted = tieInMetrics?.decision?.status === 'AUTO_ACCEPTED';
  const acknowledgement = tieInMetrics?.reviewAcknowledgement ?? null;

  const pairIsResolved = (state: PairTieInState | undefined) => {
    if (!state) return false;
    if (state.selection === 'auto') return state.metrics?.decision?.status === 'AUTO_ACCEPTED';
    if (state.selection === 'acknowledged') return Boolean(state.metrics?.reviewAcknowledgement);
    if (state.selection === 'manual') return manualAllowed && state.manualOffset !== '';
    return false;
  };
  const activeResolved = pairIsResolved(pairStates[activePair?.key ?? '']);
  // Every pair in the chain feeds the same final comparison, so leaving one
  // unresolved would silently fall back to another pair's transform.
  const unresolvedPairs = pairs.filter((pair) => !pairIsResolved(pairStates[pair.key]));
  const canContinue = pairs.length > 0 && unresolvedPairs.length === 0;

  /** The wizard fields describing one pair's accepted tie-in evidence. */
  const tieInEvidenceFor = (state: PairTieInState) => {
    const usesTransform = state.selection === 'auto' || state.selection === 'acknowledged';
    // The evidence token is an HMAC over the decision, so an acknowledged
    // decision has to travel back exactly as the server signed it. The
    // engineer's note is audit context, persisted alongside it, never inside it.
    const decision = state.selection === 'auto'
      ? state.metrics?.decision
      : state.selection === 'acknowledged'
        ? state.metrics!.reviewAcknowledgement!.decision
        : { status: 'MANUAL_OVERRIDE', reasons: ['USER_SUPPLIED_LEGACY_OFFSET'] };
    return {
      globalOffset: usesTransform ? state.autoOffset : Number(state.manualOffset),
      tieInExcludedRanges: state.excludedRanges,
      tieInMetrics: state.metrics,
      tieInAcknowledgementNote: state.selection === 'acknowledged' && state.acknowledgementNote.trim()
        ? state.acknowledgementNote.trim().slice(0, 500)
        : null,
      tieInEvidenceToken: state.selection === 'acknowledged'
        ? state.metrics!.reviewAcknowledgement!.evidenceToken
        : state.selection === 'auto' ? state.metrics?.evidenceToken : null,
      tieInMethodVersion: usesTransform ? state.metrics?.methodVersion : null,
      tieInTransform: usesTransform ? state.metrics?.transform : null,
      tieInDecision: decision,
    };
  };

  const handleContinue = () => {
    if (!canContinue) return;
    const pairTieIns = Object.fromEntries(
      pairs.map((pair) => [pair.key, tieInEvidenceFor(pairStates[pair.key])]),
    );
    // The primary pair's evidence is also written unscoped, so the engines and
    // any session saved by an older client keep resolving a transform.
    const primaryEvidence = primaryPair ? pairTieIns[primaryPair.key] : undefined;
    onNext({ pairTieIns, ...(primaryEvidence || {}) });
  };

  const transformDomain = tieInMetrics?.transform?.domain ?? tieInMetrics?.overlap;
  const useAuto = selection === 'auto';
  const manualSelected = selection === 'manual' && manualAllowed;

  return (
    <div className="tiein-step animate-fade-in">
      <header className="tiein-step__header">
        <div>
          <p className="tiein-step__eyebrow">Partial run</p>
          <h2>Tie-in calibration</h2>
          <p className="tiein-step__lede">
            Find the physical overlap between {laneLabels.old} and {laneLabels.new}, then map the
            historical run onto the latest axis.
          </p>
        </div>
        {pairs.length > 1 && (
          <span className="tiein-step__progress">
            {pairs.length - unresolvedPairs.length} / {pairs.length} pairs ready
          </span>
        )}
      </header>

      {/* One tie-in per chain transition. Each pair has its own overlap, so each
          needs its own transform and its own sign-off. */}
      {pairs.length > 1 && (
        <div className="tiein-step__pairs">
          <span className="tiein-step__pairs-label">Run pair</span>
          {pairs.map((pair) => {
            const state = pairStates[pair.key];
            const resolved = pairIsResolved(state);
            const isActive = pair.key === activePair?.key;
            return (
              <button
                key={pair.key}
                type="button"
                aria-pressed={isActive}
                onClick={() => setActivePairKey(pair.key)}
                className={`tiein-pair-chip${isActive ? ' is-active' : ''}${resolved ? ' is-resolved' : ''}`}
              >
                {resolved ? <FiCheckCircle aria-hidden="true" /> : <span aria-hidden="true">•</span>}
                {pair.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="tiein-step__body">
        <nav className="tiein-rail" aria-label="Tie-in sections">
          {TIE_IN_SECTIONS.map(({ id, title, detail, Icon }) => {
            const isCurrent = section === id;
            return (
              <button
                key={id}
                type="button"
                aria-current={isCurrent ? 'step' : undefined}
                className={`tiein-rail__item${isCurrent ? ' is-active' : ''}`}
                onClick={() => setSection(id)}
              >
                <span className="tiein-rail__icon" aria-hidden="true"><Icon /></span>
                <span className="tiein-rail__copy">
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="tiein-main">
          {loading ? (
            <div className="tiein-loading" role="status" aria-live="polite">
              <span className="tiein-loading__spinner" aria-hidden="true" />
              <strong>Matching ordered physical anchors…</strong>
              <p>
                The engine is searching for the common permanent pipeline using weld order, fittings
                and spool lengths.
              </p>
            </div>
          ) : section === 'evidence' ? (
            <article
              className={`tiein-card${useAuto ? ' is-selected' : ''}`}
              onClick={() => { if (autoAccepted) setSelection('auto'); }}
            >
              <header className="tiein-card__header">
                <span className="tiein-card__badge" aria-hidden="true"><FiActivity /></span>
                <div className="tiein-card__heading">
                  <h3>Engineering evidence recommendation</h3>
                  <p>GW and landmark sequences are matched without using the absolute odometer as identity.</p>
                </div>
                {useAuto
                  ? <span className="tiein-chip is-selected">Selected</span>
                  : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!autoAccepted}
                      onClick={(event) => { event.stopPropagation(); setSelection('auto'); }}
                    >
                      Use this
                    </Button>
                  )}
              </header>

              {errorMessage ? (
                <div className="tiein-alert is-danger" role="alert">
                  <strong>Engine error:</strong> {errorMessage}
                  <span>
                    {partialRunEnabled
                      ? 'Check the anchors or excluded ranges. Partial Run must not fall back to a scalar offset.'
                      : 'Use Manual Override if legacy mode is genuinely required.'}
                  </span>
                </div>
              ) : (
                <div className="tiein-headline">
                  <div>
                    <p className="tiein-headline__label">First stable physical point</p>
                    <p className="tiein-headline__value">
                      {laneLabels.old} {tieInMetrics?.tieIn?.oldDistanceM?.toFixed(3)} m
                      <span aria-hidden="true">→</span>
                      {laneLabels.new} {tieInMetrics?.tieIn?.newDistanceM?.toFixed(3)} m
                    </p>
                    <p className="tiein-headline__note">
                      Transform {laneLabels.old} → {laneLabels.new}, piecewise-linear · legacy offset{' '}
                      {autoOffset?.toLocaleString()} m
                    </p>
                    {tieInMetrics?.comparisonCoordinates && (
                      <p className="tiein-headline__note is-accent">
                        Helper view:{' '}
                        <MathInline
                          tex={
                            `x_{\\text{${laneLabels.old}}} + `
                            + `${tieInMetrics.comparisonCoordinates.provisionalOffsetM.toFixed(3)}`
                            + `\\,\\mathrm{m} \\approx x_{\\text{${laneLabels.new}}}`
                          }
                          label={`${laneLabels.old} plus offset approximates ${laneLabels.new}`}
                        />
                        . Raw odometers are unchanged.
                      </p>
                    )}
                  </div>
                  <div className="tiein-score">
                    <p className={(tieInMetrics?.confidence ?? 0) >= 80 ? 'is-good' : 'is-warn'}>
                      <FiCheckCircle aria-hidden="true" />
                      {tieInMetrics?.confidence ? `${tieInMetrics.confidence.toFixed(1)}/100 evidence` : 'Estimated'}
                    </p>
                    <small>Evidence score, not a probability</small>
                    <small>{tieInMetrics?.message || 'Sequence alignment (anchors)'}</small>
                  </div>
                </div>
              )}

              {tieInMetrics?.decision?.status === 'REVIEW_REQUIRED' && !errorMessage && (
                <div className="tiein-alert is-warning">
                  <strong>Auto-apply blocked:</strong>{' '}
                  {tieInMetrics.decision.reasons.map((reason) => reviewReasonLabels[reason] ?? reason).join('; ')}.
                  <span>
                    Fix the overlap candidates, source anchors or excluded ranges until the engineering
                    gate passes — or knowingly accept this transform below.
                  </span>
                </div>
              )}

              {transformDomain && !errorMessage && (
                <>
                  <dl className="tiein-metrics">
                    <div>
                      <dt>Domain {laneLabels.old}</dt>
                      <dd>{transformDomain.oldStartM?.toFixed(3) ?? '?'}–{transformDomain.oldEndM?.toFixed(3) ?? '?'} m</dd>
                    </div>
                    <div>
                      <dt>Domain {laneLabels.new}</dt>
                      <dd>{transformDomain.newStartM?.toFixed(3) ?? '?'}–{transformDomain.newEndM?.toFixed(3) ?? '?'} m</dd>
                    </div>
                    <div>
                      <dt>Locked weld knots</dt>
                      <dd>{tieInMetrics.transform?.knotCount ?? tieInMetrics.transform?.knots?.length ?? '?'}</dd>
                    </div>
                    <div>
                      <dt>Anchors aligned</dt>
                      <dd>{tieInMetrics.alignedPairCount ?? tieInMetrics.inlierPairCount}</dd>
                    </div>
                    <div>
                      <dt>Anchors unaligned</dt>
                      <dd>{tieInMetrics.unalignedPairCount ?? Math.max(0, tieInMetrics.matchedPairCount - tieInMetrics.inlierPairCount)}</dd>
                    </div>
                    <div>
                      <dt>Span residual P95</dt>
                      <dd>{tieInMetrics.spanResidual ? `${tieInMetrics.spanResidual.p95AbsM.toFixed(3)} m` : 'Not available'}</dd>
                    </div>
                  </dl>
                  <div className="tiein-footnotes">
                    {tieInMetrics.evidenceOverlap && (
                      <p>
                        Evidence envelope (including non-knot fittings): {laneLabels.old}{' '}
                        {tieInMetrics.evidenceOverlap.oldStartM.toFixed(3)}–{tieInMetrics.evidenceOverlap.oldEndM.toFixed(3)} m;{' '}
                        {laneLabels.new} {tieInMetrics.evidenceOverlap.newStartM.toFixed(3)}–{tieInMetrics.evidenceOverlap.newEndM.toFixed(3)} m.
                      </p>
                    )}
                    <p>
                      Affine RMSE {tieInMetrics.residualRmseM.toFixed(3)} m is diagnostic only; the final
                      mapping follows the piecewise knots.
                      {tieInMetrics.robustFit?.method ? ` Fit: ${tieInMetrics.robustFit.method}.` : ''}
                    </p>
                  </div>
                </>
              )}

              {/* Engineer sign-off on evidence that failed a gate. Partial Run has
                  no scalar fallback, so without this the wizard dead-ends. */}
              {acknowledgement && !errorMessage && (
                <div
                  className={`tiein-signoff${selection === 'acknowledged' ? ' is-selected' : ''}`}
                  onClick={(event) => { event.stopPropagation(); setSelection('acknowledged'); }}
                >
                  <div className="tiein-signoff__head">
                    <h4>Accept with review sign-off</h4>
                    {selection === 'acknowledged'
                      ? <span className="tiein-chip is-warning">Selected</span>
                      : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(event) => { event.stopPropagation(); setSelection('acknowledged'); }}
                        >
                          Accept with sign-off
                        </Button>
                      )}
                  </div>
                  <p>
                    The piecewise {laneLabels.old} → {laneLabels.new} transform is still used as-is — not a
                    scalar offset. Only its status changes: the alignment proceeds under engineering
                    responsibility, and the gate reasons above are recorded in the result audit trail.
                  </p>
                  {selection === 'acknowledged' && (
                    <label className="tiein-note">
                      Review note (optional, recorded in the audit)
                      <textarea
                        value={acknowledgementNote}
                        onChange={(event) => setAcknowledgementNote(event.target.value.slice(0, 500))}
                        rows={2}
                        placeholder="Example: short overlap because the 2012 partial run only covers the downstream segment; anchors verified manually."
                      />
                    </label>
                  )}
                </div>
              )}
            </article>
          ) : section === 'exclusions' ? (
            <article className="tiein-card">
              <header className="tiein-card__header">
                <span className="tiein-card__badge is-warning" aria-hidden="true"><FiShield /></span>
                <div className="tiein-card__heading">
                  <h3>Exclude noisy GW area from the tie-in</h3>
                  <p>
                    Nothing is removed from the file. Anchors inside the range are left out of the tie-in
                    estimate only, and stay recorded in the results and the audit.
                  </p>
                </div>
              </header>

              <div className="tiein-range-form">
                <label>
                  Run
                  <select
                    className="ds-select"
                    value={rangeDraft.run}
                    onChange={(event) => setRangeDraft((current) => ({ ...current, run: event.target.value as 'OLD' | 'NEW' }))}
                  >
                    <option value="OLD">{laneLabels.old}</option>
                    <option value="NEW">{laneLabels.new}</option>
                  </select>
                </label>
                <label>
                  Start (m)
                  <input
                    type="number"
                    className="ds-input"
                    value={rangeDraft.startM}
                    placeholder="Enter start position"
                    onChange={(event) => setRangeDraft((current) => ({ ...current, startM: event.target.value === '' ? '' : Number(event.target.value) }))}
                  />
                </label>
                <label>
                  End (m)
                  <input
                    type="number"
                    className="ds-input"
                    value={rangeDraft.endM}
                    placeholder="Enter end position"
                    onChange={(event) => setRangeDraft((current) => ({ ...current, endM: event.target.value === '' ? '' : Number(event.target.value) }))}
                  />
                </label>
                <Button
                  variant="secondary"
                  startIcon={<FiPlus aria-hidden="true" />}
                  disabled={rangeDraft.startM === '' || rangeDraft.endM === '' || rangeDraft.startM === rangeDraft.endM}
                  onClick={() => {
                    if (rangeDraft.startM === '' || rangeDraft.endM === '') return;
                    setExcludedRanges((current) => [...current, { run: rangeDraft.run, startM: Number(rangeDraft.startM), endM: Number(rangeDraft.endM) }]);
                    setRangeDraft((current) => ({ ...current, startM: '', endM: '' }));
                  }}
                >
                  Exclude range
                </Button>
              </div>

              <div className="tiein-ranges">
                <h4>Excluded ranges ({excludedRanges.length})</h4>
                {excludedRanges.length === 0 ? (
                  <p className="tiein-ranges__empty">
                    No exclusions. Every anchor in the overlap is feeding the estimate.
                  </p>
                ) : (
                  <ul>
                    {excludedRanges.map((range, index) => (
                      <li key={`${range.run}-${range.startM}-${range.endM}-${index}`}>
                        <span>
                          {range.run === 'OLD' ? laneLabels.old : laneLabels.new}{' '}
                          {Math.min(range.startM, range.endM)}–{Math.max(range.startM, range.endM)} m
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove excluded range ${range.run} ${range.startM} to ${range.endM} metres`}
                          onClick={() => setExcludedRanges((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        >
                          <FiTrash2 aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </article>
          ) : (
            <article className={`tiein-card${manualSelected ? ' is-selected' : ''}${manualAllowed ? '' : ' is-disabled'}`}>
              <header className="tiein-card__header">
                <span className="tiein-card__badge is-neutral" aria-hidden="true"><FiSliders /></span>
                <div className="tiein-card__heading">
                  <h3>Manual override</h3>
                  <p>
                    {manualAllowed
                      ? 'Compatibility mode for legacy full-run comparisons. Use only when the automatic tie-in is not reliable; a manual offset can introduce drift.'
                      : 'Disabled for Partial Run: a scalar offset cannot control drift and missing welds.'}
                  </p>
                </div>
                {manualSelected
                  ? <span className="tiein-chip is-neutral">Enabled</span>
                  : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!manualAllowed}
                      onClick={() => setSelection('manual')}
                    >
                      {manualAllowed ? 'Enable manual override' : 'Disabled'}
                    </Button>
                  )}
              </header>

              {manualSelected && (
                <div className="tiein-manual">
                  <label>
                    Offset
                    <span className="tiein-manual__input">
                      <input
                        type="number"
                        className="ds-input"
                        value={manualOffset}
                        placeholder="e.g. 40000"
                        onChange={(event) => setManualOffset(Number(event.target.value))}
                      />
                      <em>m</em>
                    </span>
                  </label>
                  <p>
                    This value is added to the {laneLabels.new} odometer. For automatic results the system
                    uses the more accurate {laneLabels.old} → {laneLabels.new} transform.
                  </p>
                </div>
              )}
            </article>
          )}
        </div>
      </div>

      <div className="ds-panel__footer" style={{ flexWrap: 'wrap' }}>
        <Button variant="ghost" startIcon={<FiArrowLeft aria-hidden="true" />} onClick={onBack}>
          Back
        </Button>
        {/* A disabled Confirm button with no explanation reads as a broken app,
            which is exactly how the old dead-end presented itself. */}
        {!loading && !canContinue && (
          <p className="ds-toolbar__hint" style={{ flex: '1 1 12rem', textAlign: 'right', margin: 0 }} role="status">
            {!activeResolved && selection === null
              ? 'Select one of the options above to continue.'
              : !activeResolved && selection === 'manual' && manualOffset === ''
                ? 'Enter a manual offset value first.'
                : unresolvedPairs.length > 0
                  ? `Still to resolve: ${unresolvedPairs.map((pair) => pair.label).join(', ')}.`
                  : 'The selected option does not have valid evidence yet.'}
          </p>
        )}
        <Button
          onClick={handleContinue}
          disabled={loading || !canContinue}
          endIcon={<FiArrowRight aria-hidden="true" />}
        >
          Confirm &amp; continue
        </Button>
      </div>
    </div>
  );
}
