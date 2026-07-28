import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  FiAlertTriangle,
  FiArrowLeft,
  FiCheckCircle,
  FiFilter,
  FiSave,
  FiTrendingUp,
} from 'react-icons/fi';
import PageMeta from '../../components/common/PageMeta';
import SynButton from '../../components/ui/SynButton';
import { useToast } from '../../components/common/ToastProvider';
import ShareSnapshotButton from '../../components/sharing/ShareSnapshotButton';
import { fetchAlignmentResult } from '../../utils/alignment';
import { apiFetch } from '../../utils/api';
import {
  applyInterventions,
  includedInterventionRows,
  type InterventionEvent,
} from '../../utils/interventions';
import {
  DEFAULT_SUGGESTION_RULE,
  analyseComparison,
  buildReviewPayload,
  isMetalLoss,
  suggestSelection,
  summariseCorrosion,
  type CorrosionFeature,
} from '../../lib/corrosion/analysis';
import {
  fetchFfsCandidates,
  saveFfsCandidates,
  selectedKeysOf,
  type FfsCandidateReview,
} from '../../lib/corrosion/reviewClient';

type FeatureFilter = 'assessable' | 'metal-loss' | 'all';

const FILTERS: { id: FeatureFilter; label: string }[] = [
  { id: 'assessable', label: 'FFS-assessable' },
  { id: 'metal-loss', label: 'Metal loss' },
  { id: 'all', label: 'All NEW-run features' },
];

const PAGE_STEP = 250;

const GROWTH_LABEL: Record<CorrosionFeature['growthClass'], string> = {
  active: 'Active',
  'possibly-active': 'Possibly active',
  stable: 'Stable',
  unknown: 'Unknown',
};

const GROWTH_TONE: Record<CorrosionFeature['growthClass'], string> = {
  active: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300',
  'possibly-active': 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
  stable: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300',
  unknown: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
};

function fixed(value: number | null, digits = 2): string {
  return value === null ? '–' : value.toFixed(digits);
}

function SummaryChip({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone || 'border-slate-200 dark:border-slate-700'}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{value.toLocaleString()}</p>
    </div>
  );
}

/**
 * Corrosion Analysis — the gate between a finished alignment and FFS.
 *
 * The engineer reviews the corrosion condition of every NEW-run feature and
 * releases the ones worth a B31G assessment. Nothing is pre-selected: a feature
 * reaches FFS only because someone decided it should.
 */
export default function CorrosionAnalysisPage() {
  const { sessionId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('Loading the alignment result...');
  const [error, setError] = useState('');
  const [features, setFeatures] = useState<CorrosionFeature[]>([]);
  const [review, setReview] = useState<FfsCandidateReview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<FeatureFilter>('assessable');
  const [visibleCount, setVisibleCount] = useState(PAGE_STEP);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError('');
      try {
        const [result, saved, session] = await Promise.all([
          fetchAlignmentResult(sessionId, (pct, message) => {
            if (cancelled) return;
            setProgress(pct);
            setProgressMessage(message);
          }, controller.signal),
          fetchFfsCandidates(sessionId, controller.signal),
          apiFetch<{ config?: { interventions?: InterventionEvent[] } }>(
            `/api/wizard/session/${encodeURIComponent(sessionId)}`,
            { signal: controller.signal },
          ),
        ]);
        if (cancelled) return;

        const includedRows = includedInterventionRows(
          applyInterventions(result.comparison, session.config?.interventions || []),
        );
        setFeatures(analyseComparison(includedRows));
        setReview(saved);
        // A stale review is loaded but not treated as decided: the engineer
        // sees the earlier decisions and has to confirm them against the new
        // result before anything reaches FFS.
        setSelected(saved.stale ? new Set() : selectedKeysOf(saved));
        setReasons(Object.fromEntries(
          saved.items.filter((item) => item.reason).map((item) => [item.sourceKey, item.reason as string]),
        ));
        setDirty(false);
      } catch (caught) {
        if (cancelled || (caught instanceof DOMException && caught.name === 'AbortError')) return;
        setError(caught instanceof Error ? caught.message : 'The alignment result could not be loaded.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sessionId]);

  const summary = useMemo(() => summariseCorrosion(features), [features]);

  const visible = useMemo(() => {
    if (filter === 'all') return features;
    if (filter === 'metal-loss') return features.filter(isMetalLoss);
    return features.filter((feature) => feature.ffsReady && isMetalLoss(feature));
  }, [features, filter]);

  useEffect(() => setVisibleCount(PAGE_STEP), [filter]);

  const toggle = useCallback((sourceKey: string, ffsReady: boolean) => {
    if (!ffsReady) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(sourceKey)) next.delete(sourceKey);
      else next.add(sourceKey);
      return next;
    });
    setDirty(true);
  }, []);

  const applySuggestion = useCallback(() => {
    const suggested = suggestSelection(features, DEFAULT_SUGGESTION_RULE);
    setSelected((current) => new Set([...current, ...suggested]));
    setDirty(true);
    toast.showToast(`${suggested.size.toLocaleString()} feature(s) proposed. Review them before saving.`, 'info');
  }, [features, toast]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    if (!review) return;
    setSaving(true);
    try {
      const items = buildReviewPayload(features, selected, reasons);
      const saved = await saveFfsCandidates(sessionId, { signature: review.signature, items });
      setReview(saved);
      setSelected(selectedKeysOf(saved));
      setDirty(false);
      toast.success(`${saved.selectedCount.toLocaleString()} feature(s) released to FFS.`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'The review could not be saved.');
    } finally {
      setSaving(false);
    }
  }, [features, reasons, review, selected, sessionId, toast]);

  const selectedCount = selected.size;
  const savedCount = review?.items.filter((item) => item.selected).length ?? 0;
  const shareRows = useMemo(() => features.map((feature) => ({
    ...feature,
    selectedForFfs: selected.has(feature.sourceKey),
    selectionReason: reasons[feature.sourceKey] || null,
  })), [features, reasons, selected]);

  if (!sessionId) {
    return (
      <div className="syn-page syn-ui-kit">
        <p className="text-sm text-red-600">No alignment session was specified.</p>
      </div>
    );
  }

  return (
    <div className="syn-page syn-ui-kit">
      <PageMeta
        title="Corrosion Analysis"
        description="Review alignment corrosion results and release features to FFS"
      />

      <div className="syn-page__header flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="syn-eyebrow">Final alignment phase</p>
          <h1 className="syn-page__title">Corrosion Analysis</h1>
          <p className="syn-page__subtitle">
            Review the corrosion condition of the latest run and select the features that go forward to
            fitness-for-service. Nothing reaches FFS unless it is selected here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ShareSnapshotButton
            kind="CORROSION"
            title={`Corrosion Analysis · Session ${sessionId}`}
            sourceRef={`alignment-session:${sessionId}`}
            rows={shareRows}
            summary={[
              { label: 'Metal loss', value: summary.metalLoss },
              { label: 'Assessable', value: summary.ffsReady },
              { label: 'Active growth', value: summary.activeGrowth },
              { label: 'Released to FFS', value: savedCount },
            ]}
            notes={[
              'Frozen Corrosion Analysis review. Only the saved release state is shareable.',
            ]}
            disabled={loading || Boolean(error) || dirty}
            label="Share analysis"
          />
          <SynButton type="button" variant="outline" size="sm" onClick={() => navigate('/ili-comparison')}>
            <span className="inline-flex items-center gap-2"><FiArrowLeft /> Alignment results</span>
          </SynButton>
          <SynButton
            type="button"
            variant="lime"
            size="sm"
            onClick={() => void save()}
            disabled={saving || loading || !review?.reviewable}
          >
            <span className="inline-flex items-center gap-2">
              <FiSave /> {saving ? 'Saving...' : `Save review (${selectedCount})`}
            </span>
          </SynButton>
        </div>
      </div>

      {loading && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{progressMessage}</p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && review && !review.reviewable && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-semibold">This session cannot be released to FFS.</p>
          <p className="mt-1">{review.reason}</p>
        </div>
      )}

      {!loading && review?.stale && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <FiAlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">The alignment was re-run after the last review.</p>
            <p className="mt-1">
              The previous selection no longer describes this result and has been cleared. Review the
              features again and save to restore the FFS handoff.
            </p>
          </div>
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <SummaryChip label="NEW features" value={summary.total} />
            <SummaryChip label="Metal loss" value={summary.metalLoss} />
            <SummaryChip label="Assessable" value={summary.ffsReady} />
            <SummaryChip
              label="Active growth"
              value={summary.activeGrowth}
              tone="border-red-200 dark:border-red-900"
            />
            <SummaryChip label="Growth unknown" value={summary.unknownGrowth} />
            <SummaryChip
              label="Selected"
              value={selectedCount}
              tone="border-indigo-200 dark:border-indigo-900"
            />
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FiFilter className="h-4 w-4 text-slate-400" />
              <div className="flex rounded-lg border border-slate-200 p-1 dark:border-slate-700">
                {FILTERS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setFilter(option.id)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      filter === option.id
                        ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <SynButton type="button" variant="outline" size="sm" onClick={applySuggestion}>
                <span className="inline-flex items-center gap-2"><FiTrendingUp /> Propose by rule</span>
              </SynButton>
              <SynButton type="button" variant="ghost" size="sm" onClick={clearSelection}>
                Clear selection
              </SynButton>
            </div>
          </div>

          <p className="mt-2 text-[11px] text-slate-500">
            The rule proposes assessable metal loss with ERF ≥ {DEFAULT_SUGGESTION_RULE.minErf}, depth ≥{' '}
            {DEFAULT_SUGGESTION_RULE.minDepthPct} %WT, or active growth. It only ticks boxes — the saved
            review is whatever you confirm.
          </p>

          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900/50">
                <tr>
                  <th className="px-3 py-3 w-12">FFS</th>
                  <th className="px-3 py-3">Feature</th>
                  <th className="px-3 py-3">Section</th>
                  <th className="px-3 py-3 text-right">LD [m]</th>
                  <th className="px-3 py-3">Clock</th>
                  <th className="px-3 py-3 text-right">Depth [%WT]</th>
                  <th className="px-3 py-3 text-right">Length [mm]</th>
                  <th className="px-3 py-3 text-right">WT [mm]</th>
                  <th className="px-3 py-3 text-right">Depth growth [%WT/y]</th>
                  <th className="px-3 py-3">Growth</th>
                  <th className="px-3 py-3 text-right">ERF</th>
                  <th className="px-3 py-3">Match</th>
                  <th className="px-3 py-3">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visible.slice(0, visibleCount).map((feature) => {
                  const isSelected = selected.has(feature.sourceKey);
                  return (
                    <tr
                      key={feature.sourceKey}
                      className={isSelected ? 'bg-indigo-50/60 dark:bg-indigo-900/10' : undefined}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!feature.ffsReady || !review?.reviewable}
                          onChange={() => toggle(feature.sourceKey, feature.ffsReady)}
                          aria-label={`Release ${feature.featureId} to FFS`}
                          title={feature.ffsReady ? undefined : feature.blockers.join('; ')}
                          className="h-4 w-4 accent-indigo-600 disabled:opacity-40"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium text-slate-800 dark:text-slate-100">{feature.featureId}</span>
                        <span className="block text-[11px] text-slate-500">{feature.featureType}</span>
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{feature.section}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fixed(feature.distanceM, 3)}</td>
                      <td className="px-3 py-2">{feature.clock}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fixed(feature.depthPct, 1)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fixed(feature.lengthMm, 1)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fixed(feature.wallMm, 2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fixed(feature.depthGrowthPctWtPerYear, 3)}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${GROWTH_TONE[feature.growthClass]}`}>
                          {GROWTH_LABEL[feature.growthClass]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fixed(feature.erf, 3)}</td>
                      <td className="px-3 py-2 text-[11px] text-slate-500">{feature.matchStatus}</td>
                      <td className="px-3 py-2">
                        {feature.ffsReady ? (
                          <input
                            type="text"
                            value={reasons[feature.sourceKey] || ''}
                            onChange={(event) => {
                              const value = event.target.value;
                              setReasons((current) => ({ ...current, [feature.sourceKey]: value }));
                              setDirty(true);
                            }}
                            placeholder="Reason (optional)"
                            className="w-44 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                          />
                        ) : (
                          <span className="text-[11px] text-amber-600" title={feature.blockers.join('; ')}>
                            {feature.blockers[0]}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={13} className="px-3 py-8 text-center text-sm text-slate-500">
                      No feature matches this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {visible.length > visibleCount && (
            <div className="mt-3 text-center">
              <SynButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setVisibleCount((count) => count + PAGE_STEP)}
              >
                Show {Math.min(PAGE_STEP, visible.length - visibleCount).toLocaleString()} more of{' '}
                {visible.length.toLocaleString()}
              </SynButton>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
            <p className="text-xs text-slate-500">
              {dirty
                ? 'Unsaved changes — FFS still uses the last saved review.'
                : `${savedCount.toLocaleString()} feature(s) currently released to FFS.`}
            </p>
            <div className="flex items-center gap-2">
              <SynButton
                type="button"
                variant="lime"
                size="sm"
                onClick={() => void save()}
                disabled={saving || !review?.reviewable}
              >
                <span className="inline-flex items-center gap-2"><FiSave /> Save review</span>
              </SynButton>
              <SynButton
                type="button"
                variant="solid"
                size="sm"
                onClick={() => navigate(`/ffs?sessionId=${encodeURIComponent(sessionId)}`)}
                disabled={dirty || savedCount === 0}
                title={dirty ? 'Save the review first.' : undefined}
              >
                <span className="inline-flex items-center gap-2"><FiCheckCircle /> Continue to FFS</span>
              </SynButton>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
