import { useCallback, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  FiActivity,
  FiArrowLeft,
  FiBarChart2,
  FiDownload,
  FiFileText,
  FiGrid,
  FiSliders,
  FiTable,
} from 'react-icons/fi';
import PageMeta from '../../components/common/PageMeta';
import SynButton from '../../components/ui/SynButton';
import FfsChartsPanel from '../../components/ffs/FfsChartsPanel';
import FfsDetailModal from '../../components/ffs/FfsDetailModal';
import FfsIntegrityPanel from '../../components/ffs/FfsIntegrityPanel';
import FfsNarrativePanel from '../../components/ffs/FfsNarrativePanel';
import FfsResultsTable from '../../components/ffs/FfsResultsTable';
import FfsStatisticsPanel from '../../components/ffs/FfsStatisticsPanel';
import FfsSummaryCards from '../../components/ffs/FfsSummaryCards';
import { Callout, NumberField, Panel } from '../../components/ffs/FfsPrimitives';
import { exportResultsWorkbook } from '../../lib/ffs/exports';
import type { AlignmentImportProvenance } from '../../lib/ffs/alignmentImport';
import { screenResults } from '../../lib/ffs/screening';
import {
  DEFAULT_SCREENING_CONFIG,
  type FfsConfig,
  type FfsResult,
  type FfsScreenedResult,
  type FfsScreeningConfig,
} from '../../lib/ffs/types';

type TabId = 'results' | 'charts' | 'statistics' | 'integrity' | 'narrative';

const TABS: { id: TabId; label: string; icon: typeof FiTable }[] = [
  { id: 'results', label: 'Results', icon: FiTable },
  { id: 'charts', label: 'Charts', icon: FiBarChart2 },
  { id: 'statistics', label: 'Statistics', icon: FiGrid },
  { id: 'integrity', label: 'Integrity review', icon: FiActivity },
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
  const handleFiguresCaptured = useCallback((images: Record<string, string>) => {
    setChartImages((previous) => ({ ...previous, ...images }));
  }, []);

  const results = state?.results ?? NO_RESULTS;
  const config = state?.config;

  const screened = useMemo(
    () => (config ? screenResults(results, config, screening) : []),
    [results, config, screening],
  );

  if (!state || !config) {
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
          <SynButton variant="outline" size="sm" onClick={() => navigate('/ffs')}>
            <span className="inline-flex items-center gap-2">
              <FiArrowLeft /> New assessment
            </span>
          </SynButton>
          <SynButton
            variant="lime"
            size="sm"
            onClick={() => exportResultsWorkbook(screened, config, screening, state.alignmentImport?.accepted)}
          >
            <span className="inline-flex items-center gap-2">
              <FiDownload /> Export Excel
            </span>
          </SynButton>
        </div>
      </div>

      <div className="space-y-5">
        {/* Summary */}
        <FfsSummaryCards items={screened} config={config} screening={screening} />

        {/* Screening assumptions */}
        <Panel className={assumptionsOpen ? '' : '!py-3.5'}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                Screening assumptions
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                ILI tolerance +{screening.depthTolerancePct}% WT and +{screening.lengthToleranceMm} mm/end ·
                growth {screening.growthRateMmPerYear.toFixed(2)} mm/y over {screening.forecastYears} y · review
                band ERF {screening.reviewBandErf.toFixed(2)} · interaction{' '}
                {screening.interactionSpacingFactor}t
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
                  label="Growth rate"
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
            . Measured NEW-run geometry and corrosion growth carry their session and feature provenance.
          </Callout>
        )}

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Assessment views"
          className="flex gap-0 overflow-x-auto border-b border-slate-200 dark:border-slate-700"
        >
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
                onClick={() => setActiveTab(tab.id)}
                className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-5 py-3 text-[13px] font-semibold transition-colors ${
                  active
                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
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
              onSelect={setSelected}
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
              chartImages={chartImages}
              onOpenCharts={() => setActiveTab('charts')}
            />
          )}
        </div>
      </div>

      <FfsDetailModal
        item={selected}
        config={config}
        screening={screening}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
