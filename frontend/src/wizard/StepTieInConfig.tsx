import React, { useState, useEffect, useMemo, useRef } from 'react';
import { FiArrowRight, FiArrowLeft, FiCheckCircle, FiTarget, FiActivity, FiPlus, FiTrash2 } from 'react-icons/fi';
import { apiFetch } from '../utils/api';
import { pairTieIn, primaryRunPair, resolveRunPairs } from '../domain/runPairs';
import { Button } from '../components/ds';

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
    <div className="alignment-surface bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-full animate-fade-in">
      <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-blue-50 to-white">
        <div>
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <FiTarget className="text-brand-500" /> Partial Run Calibration
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Find the physical overlap, then map the historical run onto the latest master axis.
          </p>
        </div>
        {pairs.length > 1 && (
          <div className="text-right text-xs font-semibold text-gray-500">
            {pairs.length - unresolvedPairs.length} / {pairs.length} pairs ready
          </div>
        )}
      </div>

      {/* One tie-in per chain transition. Each pair has its own overlap, so each
          needs its own transform and its own sign-off. */}
      {pairs.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 bg-brand-50/60 px-6 py-3">
          <span className="text-xs font-bold uppercase tracking-wide text-brand-700">Run pair</span>
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
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  isActive
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'border border-brand-200 bg-white text-brand-700 hover:bg-brand-100'
                }`}
              >
                {resolved ? <FiCheckCircle aria-hidden="true" /> : <span aria-hidden="true">•</span>}
                {pair.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="p-8 flex-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-center" role="status" aria-live="polite">
            <div className="w-12 h-12 border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin mb-4"></div>
            <h3 className="text-lg font-semibold text-gray-700">Matching ordered physical anchors...</h3>
            <p className="text-gray-500 max-w-md mt-2">
              The engine is searching for the common permanent pipeline using weld order, fittings, and spool lengths.
            </p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-8">
            
            {/* Auto Guess Card */}
            <div 
              className={`p-6 rounded-xl border-2 transition-all cursor-pointer ${useAuto ? 'border-brand-500 bg-brand-50 shadow-md' : 'border-gray-200 hover:border-brand-300'}`}
              onClick={() => { if (autoAccepted) setSelection('auto'); }}
            >
              <div className="flex items-start gap-4">
                <button
                  type="button"
                  aria-label="Use the automatic engineering recommendation"
                  aria-pressed={useAuto}
                  disabled={!autoAccepted}
                  onClick={(event) => { event.stopPropagation(); setSelection('auto'); }}
                  className={`mt-1 rounded-full p-2 ${useAuto ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-400'}`}
                >
                  <FiActivity size={20} />
                </button>
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-lg font-bold text-gray-800">Engineering Evidence Recommendation</h3>
                    {useAuto && <span className="text-xs font-bold bg-brand-500 text-white px-2 py-1 rounded-full uppercase tracking-wider">Selected</span>}
                  </div>
                  <p className="text-gray-600 mb-4">
                    GW and landmark sequences are matched without using the absolute odometer as identity.
                  </p>
                  {errorMessage ? (
                    <div className="bg-red-50 p-4 rounded-lg border border-red-200 text-red-700 text-sm mb-4" role="alert">
                      <strong>Engine Error:</strong> {errorMessage}
                      <br/>
                      <span className="text-red-500 text-xs">
                        {partialRunEnabled
                          ? 'Check the anchors or excluded ranges. Partial Run must not fall back to a scalar offset.'
                          : 'Use Manual Override if legacy mode is genuinely required.'}
                      </span>
                    </div>
                  ) : (
                    <div className="bg-white p-4 rounded-lg border border-gray-200 flex items-center justify-between">
                      <div>
                        <p className="text-sm text-gray-500 font-medium">First stable physical point</p>
                        <p className="text-xl font-black text-gray-800 mt-1">
                          OLD {tieInMetrics?.tieIn?.oldDistanceM?.toFixed(3)} m
                          <span className="mx-2 text-brand-500">→</span>
                          NEW master {tieInMetrics?.tieIn?.newDistanceM?.toFixed(3)} m
                        </p>
                        <p className="mt-1 text-xs text-gray-500">Transform: OLD → NEW, piecewise-linear; legacy offset {autoOffset?.toLocaleString()} m</p>
                        {tieInMetrics?.comparisonCoordinates && (
                          <p className="mt-1 text-xs text-blue-700">
                            TIE-IN helper view: OLD + {tieInMetrics.comparisonCoordinates.provisionalOffsetM.toFixed(3)} m ≈ NEW. Raw odometers are unchanged.
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold flex items-center gap-1 justify-end ${(tieInMetrics?.confidence ?? 0) >= 80 ? 'text-green-600' : 'text-amber-600'}`}>
                          <FiCheckCircle /> {tieInMetrics?.confidence ? `${tieInMetrics.confidence.toFixed(1)}/100 evidence` : 'Estimated'}
                        </p>
                        <p className="mt-1 text-[11px] font-medium text-gray-500">Evidence score, not a probability</p>
                        <p className="text-xs text-gray-400 mt-1">{tieInMetrics?.message || 'Sequence Alignment (Anchors)'}</p>
                      </div>
                    </div>
                  )}
                  {tieInMetrics?.decision?.status === 'REVIEW_REQUIRED' && !errorMessage && (
                    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                      <strong>Auto-apply blocked:</strong>{' '}
                      {tieInMetrics.decision.reasons.map((reason) => reviewReasonLabels[reason] ?? reason).join('; ')}.
                      {' '}Fix the overlap candidates, source anchors, or excluded ranges until the engineering gate passes — or knowingly accept this transform below.
                    </div>
                  )}
                  {transformDomain && !errorMessage && (
                    <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
                      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                        <span>Domain transform OLD<br/><strong>{transformDomain.oldStartM?.toFixed(3) ?? '?'}–{transformDomain.oldEndM?.toFixed(3) ?? '?'} m</strong></span>
                        <span>Domain transform NEW<br/><strong>{transformDomain.newStartM?.toFixed(3) ?? '?'}–{transformDomain.newEndM?.toFixed(3) ?? '?'} m</strong></span>
                        <span>Locked weld knots<br/><strong>{tieInMetrics.transform?.knotCount ?? tieInMetrics.transform?.knots?.length ?? '?'}</strong></span>
                        <span>Anchor aligned<br/><strong>{tieInMetrics.alignedPairCount ?? tieInMetrics.inlierPairCount}</strong></span>
                        <span>Anchor unaligned<br/><strong>{tieInMetrics.unalignedPairCount ?? Math.max(0, tieInMetrics.matchedPairCount - tieInMetrics.inlierPairCount)}</strong></span>
                        <span>Span residual P95<br/><strong>{tieInMetrics.spanResidual ? `${tieInMetrics.spanResidual.p95AbsM.toFixed(3)} m` : 'Not available'}</strong></span>
                      </div>
                      {tieInMetrics.evidenceOverlap && (
                        <p className="mt-3 border-t border-blue-200 pt-2 text-blue-700">
                          Evidence envelope (including non-knot fittings): OLD {tieInMetrics.evidenceOverlap.oldStartM.toFixed(3)}–{tieInMetrics.evidenceOverlap.oldEndM.toFixed(3)} m; NEW {tieInMetrics.evidenceOverlap.newStartM.toFixed(3)}–{tieInMetrics.evidenceOverlap.newEndM.toFixed(3)} m.
                        </p>
                      )}
                      <p className="mt-1 text-blue-700">
                        Affine RMSE {tieInMetrics.residualRmseM.toFixed(3)} m is diagnostic only; the final mapping follows the piecewise knots.
                        {tieInMetrics.robustFit?.method ? ` Fit: ${tieInMetrics.robustFit.method}.` : ''}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-6">
              <h3 className="font-bold text-gray-800">Exclude noisy GW area from Tie-In</h3>
              <p className="mt-1 text-sm text-gray-600">This area is not removed from the file. Anchors in the range are only excluded from the tie-in estimate and stay recorded in the results/audit.</p>
              <div className="mt-4 grid items-end gap-3 md:grid-cols-[130px_1fr_1fr_auto]">
                <label className="text-xs font-semibold text-gray-600">Run
                  <select value={rangeDraft.run} onChange={(event) => setRangeDraft((current) => ({ ...current, run: event.target.value as 'OLD' | 'NEW' }))} className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"><option value="OLD">OLD</option><option value="NEW">NEW master</option></select>
                </label>
                <label className="text-xs font-semibold text-gray-600">Start (m)
                  <input type="number" value={rangeDraft.startM} onChange={(event) => setRangeDraft((current) => ({ ...current, startM: event.target.value === '' ? '' : Number(event.target.value) }))} className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm" />
                </label>
                <label className="text-xs font-semibold text-gray-600">End (m)
                  <input type="number" value={rangeDraft.endM} onChange={(event) => setRangeDraft((current) => ({ ...current, endM: event.target.value === '' ? '' : Number(event.target.value) }))} className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm" />
                </label>
                <button type="button" disabled={rangeDraft.startM === '' || rangeDraft.endM === '' || rangeDraft.startM === rangeDraft.endM} onClick={() => {
                  if (rangeDraft.startM === '' || rangeDraft.endM === '') return;
                  setExcludedRanges((current) => [...current, { run: rangeDraft.run, startM: Number(rangeDraft.startM), endM: Number(rangeDraft.endM) }]);
                  setRangeDraft((current) => ({ ...current, startM: '', endM: '' }));
                }} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"><FiPlus className="mr-1 inline" />Exclude</button>
              </div>
              {excludedRanges.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{excludedRanges.map((range, index) => <span key={`${range.run}-${range.startM}-${range.endM}-${index}`} className="rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-semibold text-amber-800">{range.run} {Math.min(range.startM, range.endM)}–{Math.max(range.startM, range.endM)} m <button type="button" aria-label={`Remove excluded range ${range.run} ${range.startM} to ${range.endM} meters`} onClick={() => setExcludedRanges((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="ml-2 text-red-600"><FiTrash2 className="inline" /></button></span>)}</div>}
            </div>

            {/* Engineer sign-off on evidence that failed a gate. Partial Run has
                no scalar fallback, so without this the wizard dead-ends. */}
            {acknowledgement && !errorMessage && (
              <div
                className={`p-6 rounded-xl border-2 transition-all cursor-pointer ${selection === 'acknowledged' ? 'border-amber-500 bg-amber-50 shadow-md' : 'border-amber-200 hover:border-amber-400'}`}
                onClick={() => setSelection('acknowledged')}
              >
                <div className="flex items-start gap-4">
                  <button
                    type="button"
                    aria-label="Accept the tie-in transform with a review note"
                    aria-pressed={selection === 'acknowledged'}
                    onClick={(event) => { event.stopPropagation(); setSelection('acknowledged'); }}
                    className={`mt-1 flex h-5 w-5 items-center justify-center rounded-full border-2 ${selection === 'acknowledged' ? 'border-amber-600' : 'border-amber-300'}`}
                  >
                    {selection === 'acknowledged' && <div className="h-2.5 w-2.5 rounded-full bg-amber-600" />}
                  </button>
                  <div className="flex-1">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-lg font-bold text-gray-800">Accept with Review Sign-off</h3>
                      {selection === 'acknowledged' && <span className="rounded-full bg-amber-600 px-2 py-1 text-xs font-bold uppercase tracking-wider text-white">Selected</span>}
                    </div>
                    <p className="mb-4 text-sm text-gray-600">
                      The piecewise OLD → NEW transform is still used as-is — not a scalar offset. Only its
                      status changes: the alignment proceeds under engineering responsibility, and the gate reasons
                      above are recorded in the result audit trail.
                    </p>
                    {selection === 'acknowledged' && (
                      <label className="block animate-fade-in text-xs font-semibold text-gray-600">
                        Review note (optional, recorded in the audit)
                        <textarea
                          value={acknowledgementNote}
                          onChange={(event) => setAcknowledgementNote(event.target.value.slice(0, 500))}
                          rows={2}
                          placeholder="Example: short overlap because the 2012 partial run only covers the downstream segment; anchors verified manually."
                          className="mt-1 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-normal"
                        />
                      </label>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Manual Override Card */}
            <div 
              className={`p-6 rounded-xl border-2 transition-all ${manualAllowed ? 'cursor-pointer hover:border-gray-300' : 'cursor-not-allowed opacity-60'} ${manualSelected ? 'border-gray-800 bg-gray-50 shadow-md' : 'border-gray-200'}`}
              onClick={() => { if (manualAllowed) setSelection('manual'); }}
            >
              <div className="flex items-start gap-4">
                <button
                  type="button"
                  aria-label="Use manual override"
                  aria-pressed={manualSelected}
                  disabled={!manualAllowed}
                  onClick={(event) => { event.stopPropagation(); setSelection('manual'); }}
                  className={`mt-1 flex h-5 w-5 items-center justify-center rounded-full border-2 ${manualSelected ? 'border-gray-800' : 'border-gray-300'}`}
                >
                  {manualSelected && <div className="w-2.5 h-2.5 bg-gray-800 rounded-full"></div>}
                </button>
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="text-lg font-bold text-gray-800">Manual Override</h3>
                    {manualSelected && <span className="text-xs font-bold bg-gray-800 text-white px-2 py-1 rounded-full uppercase tracking-wider">Selected</span>}
                  </div>
                  <p className="text-gray-600 mb-4 text-sm">
                    {manualAllowed
                      ? 'Compatibility mode for legacy full-run comparisons.'
                      : 'Disabled for Partial Run: a scalar offset cannot control drift and missing welds.'}
                  </p>
                  
                  {manualSelected && (
                    <div className="flex items-center gap-3 mt-4 animate-fade-in">
                      <div className="flex-1 max-w-xs relative">
                        <input 
                          type="number" 
                          value={manualOffset}
                          onChange={(e) => setManualOffset(Number(e.target.value))}
                          placeholder="e.g. 40000"
                          className="w-full pl-4 pr-12 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-800 focus:border-gray-800 transition-all font-mono text-lg"
                        />
                        <span className="absolute right-4 top-3 text-gray-400 font-medium">m</span>
                      </div>
                      <p className="text-sm text-gray-500">
                        Compatibility mode: this value is added to the NEW odometer. For automatic results the system uses the more accurate OLD → NEW transform.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        )}
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
