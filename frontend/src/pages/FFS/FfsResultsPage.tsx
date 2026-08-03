import { useCallback, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  FiActivity,
  FiArrowLeft,
  FiBarChart2,
  FiDownload,
  FiFileText,
  FiGrid,
  FiShield,
  FiSliders,
  FiTable,
} from 'react-icons/fi';
import PageMeta from '../../components/common/PageMeta';
import SynButton from '../../components/ui/SynButton';
import FfsChartsPanel from '../../components/ffs/FfsChartsPanel';
import FfsCaseReviewPanel from '../../components/ffs/FfsCaseReviewPanel';
import FfsDetailModal from '../../components/ffs/FfsDetailModal';
import FfsIntegrityPanel from '../../components/ffs/FfsIntegrityPanel';
import FfsNarrativePanel from '../../components/ffs/FfsNarrativePanel';
import FfsResultsTable from '../../components/ffs/FfsResultsTable';
import FfsStatisticsPanel from '../../components/ffs/FfsStatisticsPanel';
import FfsSummaryCards from '../../components/ffs/FfsSummaryCards';
import ShareSnapshotButton from '../../components/sharing/ShareSnapshotButton';
import { Callout, NumberField, Panel } from '../../components/ffs/FfsPrimitives';
import { exportResultsWorkbook } from '../../lib/ffs/exports';
import { methodProfileLabel, pressureBasisLabel } from '../../lib/ffs/assessmentProfile.ts';
import type { AlignmentImportProvenance } from '../../lib/ffs/alignmentImport';
import { screenResults } from '../../lib/ffs/screening';
import {
  buildFfsReportCase,
  createFfsReportContext,
  formatLocalCalendarDate,
} from '../../lib/ffs/reportCase';
import {
  DEFAULT_SCREENING_CONFIG,
  type FfsConfig,
  type FfsResult,
  type FfsRepairDispositionPatch,
  type FfsScreenedResult,
  type FfsScreeningConfig,
} from '../../lib/ffs/types';

type TabId = 'results' | 'charts' | 'statistics' | 'integrity' | 'case' | 'narrative';

const TABS: { id: TabId; label: string; icon: typeof FiTable }[] = [
  { id: 'results', label: 'Results', icon: FiTable },
  { id: 'charts', label: 'Charts', icon: FiBarChart2 },
  { id: 'statistics', label: 'Statistics', icon: FiGrid },
  { id: 'integrity', label: 'Integrity review', icon: FiActivity },
  { id: 'case', label: 'Case review', icon: FiShield },
  { id: 'narrative', label: 'Narrative', icon: FiFileText },
];

/** Stable empty fallback so the screening memo is not invalidated every render. */
const NO_RESULTS: FfsResult[] = [];

interface LocationState {
  results: FfsResult[];
  config: FfsConfig;
  screening?: FfsScreeningConfig;
  alignmentImport?: {
    sessionId: string;
    accepted: AlignmentImportProvenance[];
    rejected: unknown[];
    warningCount: number;
  };
}

/**
 * The assessment workspace. The nominal B31G results arrive from the setup page;
 * the screening tiers are derived here so the engineer can retune the tolerance
 * and growth assumptions without re-running the parse.
 */
export default function FfsResultsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as LocationState | null;

  const [activeTab, setActiveTab] = useState<TabId>('results');
  const [selected, setSelected] = useState<FfsScreenedResult | null>(null);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const [screening, setScreening] = useState<FfsScreeningConfig>(
    state?.screening ?? DEFAULT_SCREENING_CONFIG,
  );
  // Figures snapshotted by the Charts tab, kept so the narrative can embed them
  // after that panel unmounts.
  const [chartImages, setChartImages] = useState<Record<string, string>>({});
  const [repairOverrides, setRepairOverrides] = useState<Record<number, FfsRepairDispositionPatch>>({});
  const [reportAsOfDateIso] = useState(() => formatLocalCalendarDate());
  const handleFiguresCaptured = useCallback((images: Record<string, string>) => {
    setChartImages((previous) => ({ ...previous, ...images }));
  }, []);
  const closeDetail = useCallback(() => setSelected(null), []);

  const results = state?.results ?? NO_RESULTS;
  const config = state?.config;

  const resultsWithRepairReview = useMemo(
    () => results.map((result, index) => ({ ...result, ...(repairOverrides[index] ?? {}) })),
    [results, repairOverrides],
  );

  const updateRepairDisposition = useCallback((index: number, patch: FfsRepairDispositionPatch) => {
    setRepairOverrides((previous) => ({ ...previous, [index]: patch }));
  }, []);

  const resetRepairDisposition = useCallback((index: number) => {
    setRepairOverrides((previous) => {
      if (!(index in previous)) return previous;
      const next = { ...previous };
      delete next[index];
      return next;
    });
  }, []);

  const screened = useMemo(
    () => (config ? screenResults(resultsWithRepairReview, config, screening) : []),
    [resultsWithRepairReview, config, screening],
  );
  const reportContext = useMemo(
    () => config
      ? { ...createFfsReportContext(config), asOfDateIso: reportAsOfDateIso }
      : null,
    [config, reportAsOfDateIso],
  );
  const reportCase = useMemo(
    () => reportContext ? buildFfsReportCase(screened, reportContext) : null,
    [screened, reportContext],
  );
  const selectedIndex = selected
    ? screened.findIndex((item) => item.index === selected.index && item.key === selected.key)
    : -1;
  const selectedItem = selectedIndex >= 0 ? screened[selectedIndex] : null;

  if (!state || !config || !reportContext || !reportCase) {
    return <Navigate to="/ffs" replace />;
  }

  const methodLabel = config.method === 'original' ? 'Original B31G' : 'Modified B31G';
  const saLabel =
    config.method === 'original'
      ? '1.1 × SMYS'
      : config.modifiedSa === 'smys11'
        ? '1.1 × SMYS'
        : 'SMYS + 69 MPa';

  return (
    <div className="syn-page syn-ui-kit">
      <PageMeta
        title={`FFS results — ${config.lineName}`}
        description="ASME B31G fitness-for-service assessment results"
      />

      {/* Page header */}
      <div className="syn-page__header">
        <div className="min-w-0">
          <p className="syn-eyebrow">Fitness-for-service</p>
          <h1 className="syn-page__title">Assessment results</h1>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
            {config.lineName} · {methodLabel} · S_flow {saLabel} · ILI{' '}
            {config.iliDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} ·{' '}
            {results.length.toLocaleString()} features
            {state.alignmentImport && ' · imported from alignment'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ShareSnapshotButton
            kind="FFS"
            title={`${config.lineName} · FFS results`}
            sourceRef={state.alignmentImport?.sessionId
              ? `alignment-session:${state.alignmentImport.sessionId}`
              : undefined}
            rows={screened}
            summary={[
              {
                label: 'Pass',
                value: screened.filter((item) => item.conservative.severity === 'pass').length,
              },
              {
                label: 'Review',
                value: screened.filter((item) => item.conservative.severity === 'review').length,
              },
              {
                label: 'Fail',
                value: screened.filter((item) => item.conservative.severity === 'fail').length,
              },
            ]}
            notes={[
              `${methodLabel}; flow stress basis ${saLabel}.`,
              'FFS values remain subject to qualified engineering review and validation of inputs.',
            ]}
            label="Share FFS"
          />
          <SynButton variant="outline" size="sm" onClick={() => navigate('/ffs')}>
            <span className="inline-flex items-center gap-2">
              <FiArrowLeft /> New assessment
            </span>
          </SynButton>
          <SynButton
            variant="lime"
            size="sm"
            onClick={() => exportResultsWorkbook(
              screened,
              config,
              screening,
              state.alignmentImport?.accepted,
              reportContext,
            )}
          >
            <span className="inline-flex items-center gap-2">
              <FiDownload /> {reportCase.readiness.status === 'blocked' ? 'Download Draft Excel' : 'Export Excel'}
            </span>
          </SynButton>
        </div>
      </div>

      <div className="space-y-5">
        {/* Summary */}
        <FfsSummaryCards items={screened} config={config} screening={screening} />

        <Panel className="!p-3.5">
          <div className="grid gap-3 text-[11px] md:grid-cols-3">
            <div><span className="block font-bold uppercase tracking-wide text-slate-500">Method profile</span><strong className="mt-1 block text-slate-800 dark:text-slate-100">{methodProfileLabel(config)}</strong></div>
            <div><span className="block font-bold uppercase tracking-wide text-slate-500">Required pressure basis</span><strong className="mt-1 block text-slate-800 dark:text-slate-100">{pressureBasisLabel(config)}</strong></div>
            <div><span className="block font-bold uppercase tracking-wide text-slate-500">Result boundary</span><strong className="mt-1 block text-slate-800 dark:text-slate-100">Metal-loss screening; disposition remains separate</strong></div>
          </div>
        </Panel>

        {/* Screening assumptions */}
        <Panel className={assumptionsOpen ? '' : '!py-3.5'}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                Screening assumptions
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                ILI tolerance +{screening.depthTolerancePct}% WT and +{screening.lengthToleranceMm} mm/end ·
                growth{' '}
                {screening.growthBasis === 'measured'
                  ? `per-feature source evidence${screening.growthRateMmPerYear > 0 ? ` (explicit fallback ${screening.growthRateMmPerYear.toFixed(2)} mm/y)` : ' (no implicit fallback)'}`
                  : `uniform ${screening.growthRateMmPerYear.toFixed(2)} mm/y`}{' '}
                over {screening.forecastYears} y · review band ERF {screening.reviewBandErf.toFixed(2)} ·
                interaction {screening.interactionSpacingFactor}t
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAssumptionsOpen((open) => !open)}
              aria-expanded={assumptionsOpen}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                assumptionsOpen
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-600 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400'
                  : 'border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600 dark:border-slate-700 dark:text-slate-400'
              }`}
            >
              <FiSliders className="h-3.5 w-3.5" /> {assumptionsOpen ? 'Hide' : 'Adjust'}
            </button>
          </div>

          {assumptionsOpen && (
            <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
              {/* The growth basis governs the forecast tier, the remaining-life
                  search, and every priority derived from them, so it sits above
                  the numeric fields rather than among them. */}
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Growth basis
                </p>
                <div role="radiogroup" aria-label="Growth basis" className="ds-segmented w-max">
                  {([
                    { value: 'measured', label: 'Per-feature source evidence', hint: 'Uses each anomaly’s recorded rate and preserves whether it was measured, estimated, assumed, or unavailable.' },
                    { value: 'uniform', label: 'Uniform assumed rate', hint: 'Applies one rate to the whole population, for when the run pair’s growth numbers are not trusted.' },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={screening.growthBasis === option.value}
                      title={option.hint}
                      className={`ds-segmented__option${screening.growthBasis === option.value ? ' is-active' : ''}`}
                      onClick={() => setScreening((s) => ({ ...s, growthBasis: option.value }))}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {screening.growthBasis === 'measured'
                    ? 'The rate below is used only when source growth is unavailable; a reported zero remains zero.'
                    : 'The rate below is applied to every feature, overriding the reported rates.'}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
                <NumberField
                  label="ILI depth tol."
                  value={screening.depthTolerancePct}
                  onChange={(depthTolerancePct) => setScreening((s) => ({ ...s, depthTolerancePct }))}
                  unit="% WT"
                  min={0}
                  step={0.5}
                />
                <NumberField
                  label="ILI length tol."
                  value={screening.lengthToleranceMm}
                  onChange={(lengthToleranceMm) => setScreening((s) => ({ ...s, lengthToleranceMm }))}
                  unit="mm"
                  min={0}
                  step={1}
                />
                <NumberField
                  label={screening.growthBasis === 'measured' ? 'Fallback growth' : 'Uniform growth'}
                  value={screening.growthRateMmPerYear}
                  onChange={(growthRateMmPerYear) => setScreening((s) => ({ ...s, growthRateMmPerYear }))}
                  unit="mm/y"
                  min={0}
                  step={0.01}
                />
                <NumberField
                  label="Forecast horizon"
                  value={screening.forecastYears}
                  onChange={(forecastYears) => setScreening((s) => ({ ...s, forecastYears }))}
                  unit="years"
                  min={1}
                  max={50}
                  step={1}
                />
                <NumberField
                  label="Review band"
                  value={screening.reviewBandErf}
                  onChange={(reviewBandErf) => setScreening((s) => ({ ...s, reviewBandErf }))}
                  unit="ERF"
                  min={0.5}
                  max={1}
                  step={0.01}
                />
                <NumberField
                  label="Interaction"
                  value={screening.interactionSpacingFactor}
                  onChange={(interactionSpacingFactor) =>
                    setScreening((s) => ({ ...s, interactionSpacingFactor }))
                  }
                  unit="× t"
                  min={1}
                  max={20}
                  step={1}
                />
                <NumberField
                  label="Depth limit"
                  value={screening.depthRejectionPct}
                  onChange={(depthRejectionPct) => setScreening((s) => ({ ...s, depthRejectionPct }))}
                  unit="% WT"
                  min={40}
                  max={100}
                  step={1}
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-2xl text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  These are project screening decisions, not ASME B31G requirements. Changing them recalculates
                  the conservative and forecast tiers, remaining life, priorities, and the action register — the
                  nominal code result is unaffected.
                </p>
                <button
                  type="button"
                  onClick={() => setScreening(DEFAULT_SCREENING_CONFIG)}
                  className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:border-rose-300 hover:bg-rose-50 dark:border-slate-700 dark:hover:bg-rose-950/30"
                >
                  Reset assumptions
                </button>
              </div>
            </div>
          )}
        </Panel>

        {/* Alignment provenance */}
        {state.alignmentImport && (
          <Callout>
            Imported from alignment session{' '}
            <strong className="font-mono">{state.alignmentImport.sessionId}</strong> ·{' '}
            {state.alignmentImport.accepted.length.toLocaleString()} features accepted
            {state.alignmentImport.rejected.length > 0 &&
              ` · ${state.alignmentImport.rejected.length.toLocaleString()} rejected`}
            {state.alignmentImport.warningCount > 0 &&
              ` · ${state.alignmentImport.warningCount.toLocaleString()} with warnings`}
            . NEW-run geometry and each growth observation carry session, feature, formula, and analysis-basis provenance.
          </Callout>
        )}

        {/* Matches the Corrosion Analysis view switcher for a shared review workflow. */}
        <div className="max-w-full overflow-x-auto">
          <div role="tablist" aria-label="Assessment views" className="ds-segmented w-max">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  aria-controls={`ffs-panel-${tab.id}`}
                  id={`ffs-tab-${tab.id}`}
                  className={`ds-segmented__option${active ? ' is-active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon aria-hidden="true" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Panels */}
        <div
          role="tabpanel"
          id="ffs-panel-results"
          aria-labelledby="ffs-tab-results"
          hidden={activeTab !== 'results'}
        >
          <FfsResultsTable
            items={screened}
            config={config}
            screening={screening}
            onSelect={setSelected}
          />
        </div>

        <div
          role="tabpanel"
          id="ffs-panel-charts"
          aria-labelledby="ffs-tab-charts"
          hidden={activeTab !== 'charts'}
        >
          {activeTab === 'charts' && (
            <FfsChartsPanel
              items={screened}
              config={config}
              screening={screening}
              onSelect={setSelected}
              onFiguresCaptured={handleFiguresCaptured}
            />
          )}
        </div>

        <div
          role="tabpanel"
          id="ffs-panel-statistics"
          aria-labelledby="ffs-tab-statistics"
          hidden={activeTab !== 'statistics'}
        >
          {activeTab === 'statistics' && (
            <FfsStatisticsPanel items={screened} config={config} onSelect={setSelected} />
          )}
        </div>

        <div
          role="tabpanel"
          id="ffs-panel-integrity"
          aria-labelledby="ffs-tab-integrity"
          hidden={activeTab !== 'integrity'}
        >
          {activeTab === 'integrity' && (
            <FfsIntegrityPanel
              items={screened}
              config={config}
              screening={screening}
              reportContext={reportContext}
              onSelect={setSelected}
            />
          )}
        </div>

        <div
          role="tabpanel"
          id="ffs-panel-case"
          aria-labelledby="ffs-tab-case"
          hidden={activeTab !== 'case'}
        >
          {activeTab === 'case' && (
            <FfsCaseReviewPanel
              items={screened}
              reportContext={reportContext}
              onSelect={setSelected}
              onUpdateRepair={updateRepairDisposition}
              onResetRepair={resetRepairDisposition}
              changedRepairIndexes={new Set(Object.keys(repairOverrides).map(Number))}
            />
          )}
        </div>

        <div
          role="tabpanel"
          id="ffs-panel-narrative"
          aria-labelledby="ffs-tab-narrative"
          hidden={activeTab !== 'narrative'}
        >
          {activeTab === 'narrative' && (
            <FfsNarrativePanel
              items={screened}
              config={config}
              screening={screening}
              reportContext={reportContext}
              chartImages={chartImages}
              onOpenCharts={() => setActiveTab('charts')}
            />
          )}
        </div>
      </div>

      <FfsDetailModal
        item={selectedItem}
        config={config}
        screening={screening}
        repairCreditDecision={selectedItem ? reportCase.repairCreditDecisions.get(selectedItem) ?? null : null}
        position={selectedIndex + 1}
        total={screened.length}
        onPrevious={selectedIndex > 0 ? () => setSelected(screened[selectedIndex - 1]) : undefined}
        onNext={selectedIndex >= 0 && selectedIndex < screened.length - 1 ? () => setSelected(screened[selectedIndex + 1]) : undefined}
        onClose={closeDetail}
      />
    </div>
  );
}
