import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FiAlertCircle,
  FiCheckCircle,
  FiDatabase,
  FiDownload,
  FiFileText,
  FiRefreshCw,
  FiSettings,
  FiShield,
  FiUploadCloud,
} from 'react-icons/fi';
import PageMeta from '../../components/common/PageMeta';
import { validateData } from '../../lib/ffs/validation';
import type { ValidationError } from '../../lib/ffs/validation';
import { processAllRows } from '../../lib/ffs/calcEngine';
import { DEFAULT_SCREENING_CONFIG, type FfsConfig, type FfsScreeningConfig } from '../../lib/ffs/types';
import SynButton from '../../components/ui/SynButton';
import { NumberField } from '../../components/ffs/FfsPrimitives';
import { fetchAlignmentResult, type ComparisonRow } from '../../utils/alignment';
import { apiFetch } from '../../utils/api';
import {
  applyInterventions,
  includedInterventionRows,
  type InterventionEvent,
} from '../../utils/interventions';
import {
  alignmentSectionOptions,
  describeEmptyImport,
  getAlignmentImportReadiness,
  mapAlignmentRowsToFfs,
  normalizedSectionKey,
  type AlignmentSectionOption,
} from '../../lib/ffs/alignmentImport';
import { convertLength, convertPressure, toMegapascals, toMillimetres, type LengthUnit, type PressureUnit } from '../../lib/ffs/units';
import {
  fetchFfsCandidates,
  fetchFfsEligibleSessions,
  selectedKeysOf,
  type FfsBlockedSession,
  type FfsEligibleSession,
} from '../../lib/corrosion/reviewClient';
import {
  downloadManualFfsTemplate,
  MANUAL_FFS_ACCEPT,
  readManualFfsFile,
} from '../../lib/ffs/manualWorkbook.ts';
import { DEFAULT_FFS_ANALYSIS_HORIZON_YEARS } from '../../lib/ffs/lifeProjection.ts';

/**
 * FFS intake supports either a reviewed alignment release or a separately
 * traceable manual workbook. The two sources are never mixed in one assessment.
 */
export default function FfsSetupPage() {
  const navigate = useNavigate();

  // Assessment configuration
  const [lineName, setLineName] = useState('');
  const [method, setMethod] = useState<'original' | 'modified'>('modified');
  const [modifiedSa, setModifiedSa] = useState<'smys69' | 'smys11'>('smys69');
  const [iliDate, setIliDate] = useState('');
  const [highlightYears, setHighlightYears] = useState(5);
  const [analysisHorizonYears, setAnalysisHorizonYears] = useState(DEFAULT_FFS_ANALYSIS_HORIZON_YEARS);
  const [screening, setScreening] = useState<FfsScreeningConfig>(DEFAULT_SCREENING_CONFIG);
  const [screeningOpen, setScreeningOpen] = useState(false);

  // Source data
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [sourceMode, setSourceMode] = useState<'released' | 'manual'>('released');
  const [manualFile, setManualFile] = useState<File | null>(null);
  const [manualRows, setManualRows] = useState<Record<string, string>[]>([]);
  const [sessions, setSessions] = useState<FfsEligibleSession[]>([]);
  const [blocked, setBlocked] = useState<FfsBlockedSession[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [alignmentRows, setAlignmentRows] = useState<ComparisonRow[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [alignmentLoading, setAlignmentLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [alignmentMessage, setAlignmentMessage] = useState('');
  const [alignmentError, setAlignmentError] = useState('');

  // Pipeline parameters. Alignment carries anomaly geometry, not line design.
  const [outerDiameterMm, setOuterDiameterMm] = useState('');
  const [smysMpa, setSmysMpa] = useState('');
  const [designFactor, setDesignFactor] = useState('0.72');
  const [operatingPressureMpa, setOperatingPressureMpa] = useState('');
  const [pressureBasis, setPressureBasis] = useState<FfsConfig['pressureBasis']>('current-operating');
  const [pressureUnit, setPressureUnit] = useState<PressureUnit>('MPa');
  const [diameterUnit, setDiameterUnit] = useState<LengthUnit>('mm');
  const [fallbackDepthGrowth, setFallbackDepthGrowth] = useState('0');
  const [fallbackLengthGrowth, setFallbackLengthGrowth] = useState('0');
  const [safetyFactorMode, setSafetyFactorMode] = useState<'derived' | 'explicit'>('derived');
  const [safetyFactor, setSafetyFactor] = useState('1.39');
  const [designLifeYears, setDesignLifeYears] = useState('');
  const [commissioningYear, setCommissioningYear] = useState('');

  // Sections come from the released features, and the factor for each is typed
  // once against a stretch the engineer has already named and reviewed. Keyed
  // by the normalised section name so a reload keeps the entered values.
  const [sectionOptions, setSectionOptions] = useState<AlignmentSectionOption[]>([]);
  const [sectionFactors, setSectionFactors] = useState<Record<string, string>>({});

  const normalizeDisplayValue = (
    value: string,
    convert: (numeric: number) => number,
  ) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Number(convert(numeric).toFixed(6)).toString() : value;
  };
  const outerDiameterMmForCalculation = normalizeDisplayValue(
    outerDiameterMm,
    (value) => toMillimetres(value, diameterUnit),
  );
  const smysMpaForCalculation = normalizeDisplayValue(smysMpa, (value) => toMegapascals(value, pressureUnit));
  const operatingPressureMpaForCalculation = normalizeDisplayValue(
    operatingPressureMpa,
    (value) => toMegapascals(value, pressureUnit),
  );

  /** The overrides as the import layer wants them: named section, numeric factor. */
  const sectionDesignFactors = sectionOptions
    .map((option) => ({
      section: option.section,
      designFactor: Number(sectionFactors[normalizedSectionKey(option.section)] ?? designFactor),
    }))
    .filter((rule) => Number.isFinite(rule.designFactor) && rule.designFactor > 0);

  const invalidSectionFactors = sectionOptions.filter((option) => {
    const raw = sectionFactors[normalizedSectionKey(option.section)];
    if (raw === undefined || raw.trim() === '') return true;
    const value = Number(raw);
    return !Number.isFinite(value) || value <= 0 || value > 1;
  });

  const explicitSafetyFactor = safetyFactorMode === 'explicit' ? Number(safetyFactor) : null;
  const safetyFactorReasons = safetyFactorMode === 'explicit' &&
    (!Number.isFinite(explicitSafetyFactor) || (explicitSafetyFactor ?? 0) <= 0)
    ? ['Safety factor must be a number greater than zero.']
    : [];

  const serviceLifeReasons = [
    ...(designLifeYears.trim() !== '' &&
      (!Number.isFinite(Number(designLifeYears)) || Number(designLifeYears) <= 0)
      ? ['Original design life must be greater than 0 years, or left empty.']
      : []),
    ...(commissioningYear.trim() !== '' &&
      (!Number.isInteger(Number(commissioningYear)) ||
        Number(commissioningYear) < 1900 ||
        Number(commissioningYear) > 2100)
      ? ['Commissioning year must be a four-digit year between 1900 and 2100, or left empty.']
      : []),
  ];

  const alignmentReadinessReasons = getAlignmentImportReadiness({
    lineName,
    iliDate,
    selectedRunId,
    alignmentRowCount: alignmentRows.length,
    selectedFeatureCount: selectedKeys.size,
    outerDiameterMm: outerDiameterMmForCalculation,
    smysMpa: smysMpaForCalculation,
    designFactor,
    operatingPressureMpa: operatingPressureMpaForCalculation,
    fallbackDepthGrowthMmPerYear: fallbackDepthGrowth,
    fallbackLengthGrowthMmPerYear: fallbackLengthGrowth,
  });
  const manualReadinessReasons = [
    ...(!lineName.trim() ? ['Enter the pipeline / line name.'] : []),
    ...(!iliDate ? ['Select the ILI inspection date.'] : []),
    ...(!manualFile ? ['Upload the completed FFS template.'] : []),
    ...(manualFile && manualRows.length === 0 ? ['The uploaded workbook has no usable rows.'] : []),
  ];
  const readinessReasons = [
    ...(sourceMode === 'released' ? alignmentReadinessReasons : manualReadinessReasons),
    ...(sourceMode === 'released' && invalidSectionFactors.length > 0
      ? [`Enter a design factor between 0 and 1 for: ${invalidSectionFactors.map((option) => option.section).join(', ')}.`]
      : []),
    ...safetyFactorReasons,
    ...serviceLifeReasons,
  ];

  useEffect(() => {
    let cancelled = false;
    setSessionsLoading(true);
    setAlignmentError('');
    fetchFfsEligibleSessions()
      .then((response) => {
        if (cancelled) return;
        setSessions(response.items);
        setBlocked(response.blocked);
        const requested = new URLSearchParams(window.location.search).get('sessionId')
          || localStorage.getItem('synapse_last_session_id')
          || '';
        const initial = response.items.some((session) => session.id === requested)
          ? requested
          : response.items[0]?.id || '';
        setSelectedRunId(initial);
      })
      .catch((caught) => {
        if (!cancelled) {
          setAlignmentError(caught instanceof Error ? caught.message : 'The alignment history could not be loaded.');
        }
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedRunId) return;
    void loadSession(selectedRunId);
    // loadSession runs whenever a different released session is chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRunId]);

  const loadSession = async (sessionId: string) => {
    setAlignmentLoading(true);
    setAlignmentError('');
    setAlignmentRows([]);
    setSelectedKeys(new Set());
    setReasons({});
    setSectionOptions([]);
    setSectionFactors({});
    try {
      const [result, review, sessionConfig] = await Promise.all([
        fetchAlignmentResult(sessionId, (pct, message) => {
          setProgress(pct);
          setAlignmentMessage(message);
        }),
        fetchFfsCandidates(sessionId),
        apiFetch<{ config?: { interventions?: InterventionEvent[] } }>(
          `/api/wizard/session/${encodeURIComponent(sessionId)}`,
        ),
      ]);
      if (review.stale) {
        throw new Error('The alignment was re-run after the Corrosion Analysis review. Review it again before assessing.');
      }
      const keys = selectedKeysOf(review);
      if (keys.size === 0) {
        throw new Error('The Corrosion Analysis review for this session released no feature to FFS.');
      }
      const includedRows = includedInterventionRows(
        applyInterventions(result.comparison, sessionConfig.config?.interventions || []),
      );
      setAlignmentRows(includedRows);
      setSelectedKeys(keys);
      const options = alignmentSectionOptions(includedRows, { selectedKeys: keys });
      setSectionOptions(options);
      // Seed every section with the line default so the table always shows what
      // each stretch will actually be assessed with, not a blank the reader has
      // to interpret.
      setSectionFactors(Object.fromEntries(
        options.map((option) => [normalizedSectionKey(option.section), designFactor]),
      ));
      setReasons(Object.fromEntries(
        review.items.filter((item) => item.reason).map((item) => [item.sourceKey, item.reason as string]),
      ));
      setAlignmentMessage(
        `${keys.size.toLocaleString()} released feature(s) out of ${includedRows.length.toLocaleString()} included comparison rows.`,
      );
      const session = sessions.find((item) => item.id === sessionId);
      if (!lineName && session) setLineName(session.pipelineName);
    } catch (caught) {
      setAlignmentError(caught instanceof Error ? caught.message : 'The alignment results could not be loaded.');
    } finally {
      setAlignmentLoading(false);
    }
  };

  const loadManualFile = async (file: File | null) => {
    setManualFile(file);
    setManualRows([]);
    setErrors([]);
    setAlignmentError('');
    setAlignmentMessage('');
    if (!file) return;
    try {
      const parsed = await readManualFfsFile(file);
      if (parsed.missingColumns.length > 0) {
        throw new Error(`Missing required columns: ${parsed.missingColumns.join(', ')}`);
      }
      setManualRows(parsed.rows);
      setAlignmentMessage(`${parsed.rows.length.toLocaleString()} manual row(s) ready for validation.`);
    } catch (caught) {
      setAlignmentError(caught instanceof Error ? caught.message : 'The manual workbook could not be read.');
    }
  };

  const runAssessment = async () => {
    if (readinessReasons.length > 0) return;
    setIsProcessing(true);
    setErrors([]);
    setAlignmentError('');
    try {
      const config: FfsConfig = {
        lineName,
        method,
        modifiedSa,
        iliDate: new Date(iliDate),
        highlightYears,
        analysisHorizonYears,
        inputUnits: { pressure: pressureUnit, diameter: diameterUnit },
        pressureBasis,
        serviceLife: {
          designLifeYears: designLifeYears.trim() === '' ? null : Number(designLifeYears),
          commissioningYear: commissioningYear.trim() === '' ? null : Number(commissioningYear),
        },
        // The nominal acceptance column and the remnant-life limit answer to the
        // screening step's rejection line, not to a second hard-coded 80 %WT.
        depthRejectionPct: screening.depthRejectionPct,
      };

      if (sourceMode === 'manual') {
        const dataErrors = validateData(manualRows);
        if (dataErrors.length > 0) {
          setErrors(dataErrors);
          return;
        }
        const ffsResults = await processAllRows(manualRows, config, setProgress);
        navigate('/ffs/results', {
          state: {
            results: ffsResults,
            config,
            screening,
            manualImport: {
              fileName: manualFile?.name || 'manual workbook',
              rowCount: manualRows.length,
            },
          },
        });
        return;
      }

      const imported = mapAlignmentRowsToFfs(alignmentRows, {
        outerDiameterMm: Number(outerDiameterMmForCalculation),
        smysMpa: Number(smysMpaForCalculation),
        designFactor: Number(designFactor),
        sectionDesignFactors,
        safetyFactor: explicitSafetyFactor,
        operatingPressureMpa: Number(operatingPressureMpaForCalculation),
        fallbackDepthGrowthMmPerYear: Number(fallbackDepthGrowth),
        fallbackLengthGrowthMmPerYear: Number(fallbackLengthGrowth),
      }, selectedRunId, { selectedKeys, reasons });

      if (imported.accepted.length === 0) {
        throw new Error(describeEmptyImport(imported));
      }
      const rows = imported.accepted.map((item) => item.row);
      const dataErrors = validateData(rows);
      if (dataErrors.length > 0) {
        setErrors(dataErrors);
        return;
      }
      const calculatedResults = await processAllRows(rows, config, setProgress);
      const ffsResults = calculatedResults.map((result, index) => ({
        ...result,
        growthEvidence: imported.accepted[index].provenance.growthEvidence,
      }));
      navigate('/ffs/results', {
        state: {
          results: ffsResults,
          config,
          screening,
          alignmentImport: {
            sessionId: selectedRunId,
            accepted: imported.accepted.map((item) => item.provenance),
            // Features the review did not release are the bulk of the rejects;
            // they are carried through so the results page can state the count.
            rejected: imported.rejected,
            // The weld ladder the spool review groups against. Sent with the
            // results because it is a property of the run, not of any feature.
            girthWelds: imported.girthWelds,
            // Every metal-loss record the run reported, so the spool register can
            // count the line rather than only the released subset.
            census: imported.census,
            warningCount: imported.accepted.reduce((sum, item) => sum + item.warnings.length, 0),
          },
        },
      });
    } catch (caught) {
      setAlignmentError(caught instanceof Error ? caught.message : 'The FFS source data could not be processed.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="syn-page syn-ui-kit">
      <PageMeta title="FFS Pipeline Assessment" description="ASME B31G Modified" />

      <div className="syn-page__header">
        <div>
          <p className="syn-eyebrow">Fitness-for-service</p>
          <h1 className="syn-page__title">Assessment setup</h1>
          <p className="syn-page__subtitle">
            Run a traceable B31G assessment from a Corrosion Analysis release or a controlled manual workbook.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* LEFT COLUMN: SETUP */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-5 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
            <FiSettings className="h-5 w-5" />
            Assessment Setup
          </div>

          <div className="space-y-5">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Pipeline / Line Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={lineName}
                onChange={e => setLineName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                placeholder="e.g. 20in CPA - PK6.3"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Assessment Method <span className="text-red-500">*</span>
              </label>
              <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900">
                <button
                  onClick={() => setMethod('original')}
                  className={`flex flex-1 flex-col items-center rounded-md px-3 py-2 text-xs font-semibold transition-colors ${method === 'original' ? 'border border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800/50 dark:bg-emerald-900/30 dark:text-emerald-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                  <span>Original B31G</span>
                  <span className="text-[10px] opacity-70">0.67dL</span>
                </button>
                <button
                  onClick={() => setMethod('modified')}
                  className={`flex flex-1 flex-col items-center rounded-md px-3 py-2 text-xs font-semibold transition-colors ${method === 'modified' ? 'border border-indigo-200 bg-indigo-100 text-indigo-700 dark:border-indigo-800/50 dark:bg-indigo-900/30 dark:text-indigo-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                  <span>Modified B31G</span>
                  <span className="text-[10px] opacity-70">0.85dL</span>
                </button>
              </div>

              {method === 'modified' && (
                <div className="mt-2 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">
                  <span className="text-xs font-medium text-slate-500">Modified S<sub>f</sub> formula:</span>
                  <div className="flex rounded border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800">
                    <button
                      onClick={() => setModifiedSa('smys69')}
                      className={`rounded px-2 py-1 text-[11px] font-medium ${modifiedSa === 'smys69' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400' : 'text-slate-500'}`}
                    >
                      SMYS + 69 MPa
                    </button>
                    <button
                      onClick={() => setModifiedSa('smys11')}
                      className={`rounded px-2 py-1 text-[11px] font-medium ${modifiedSa === 'smys11' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400' : 'text-slate-500'}`}
                    >
                      1.1 × SMYS
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                ILI Inspection Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={iliDate}
                onChange={e => setIliDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none [color-scheme:light] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:[color-scheme:dark]"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Review threshold
              </label>
              <div className="flex overflow-hidden rounded-lg border border-slate-200 focus-within:border-indigo-500 dark:border-slate-700">
                <span className="border-r border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50">Remnant life &lt;</span>
                <input
                  type="number"
                  value={highlightYears}
                  onChange={e => setHighlightYears(parseFloat(e.target.value))}
                  className="flex-1 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:outline-none dark:bg-slate-900 dark:text-slate-200"
                  min="0" step="0.5"
                />
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
              <NumberField
                label="Life analysis horizon"
                value={analysisHorizonYears}
                onChange={setAnalysisHorizonYears}
                unit="years"
                min={1}
                max={100}
                step={1}
              />
              <p className="mt-2 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
                Numerical projection boundary only. If neither ERF 1.0 nor 80% depth is reached inside this
                window, Synapse reports no service-limit date.
              </p>
            </div>

            <div className="my-4 h-px bg-slate-200 dark:bg-slate-700"></div>

            {/* Screening assumptions — project decisions, not code requirements */}
            <div>
              <button
                type="button"
                onClick={() => setScreeningOpen((open) => !open)}
                aria-expanded={screeningOpen}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-left transition-colors hover:border-indigo-300 dark:border-slate-700 dark:hover:border-indigo-700"
              >
                <span className="min-w-0">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Screening assumptions
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">
                    ILI tolerance, growth rate, forecast horizon, review band
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                  {screeningOpen ? 'Hide' : 'Adjust'}
                </span>
              </button>

              {screeningOpen && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700 dark:bg-slate-900/40">
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField
                      label="ILI depth tolerance"
                      value={screening.depthTolerancePct}
                      onChange={(depthTolerancePct) => setScreening((s) => ({ ...s, depthTolerancePct }))}
                      unit="% WT"
                      min={0}
                      step={0.5}
                    />
                    <NumberField
                      label="ILI length tolerance"
                      value={screening.lengthToleranceMm}
                      onChange={(lengthToleranceMm) => setScreening((s) => ({ ...s, lengthToleranceMm }))}
                      unit="mm/end"
                      min={0}
                      step={1}
                    />
                    {/* Under the default measured basis this rate only applies
                        to features whose run pair reported no growth. The basis
                        itself is switched on the results page, where the effect
                        on the numbers is visible. */}
                    <NumberField
                      label={screening.growthBasis === 'measured' ? 'Fallback growth' : 'Uniform growth'}
                      value={screening.growthRateMmPerYear}
                      onChange={(growthRateMmPerYear) => setScreening((s) => ({ ...s, growthRateMmPerYear }))}
                      unit="mm/y"
                      min={0}
                      step={0.01}
                      hint={screening.growthBasis === 'measured' ? 'Used only where no rate was measured' : undefined}
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
                      label="Interaction spacing"
                      value={screening.interactionSpacingFactor}
                      onChange={(interactionSpacingFactor) =>
                        setScreening((s) => ({ ...s, interactionSpacingFactor }))
                      }
                      unit="× t"
                      min={1}
                      max={20}
                      step={1}
                    />
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    These are project screening decisions, not ASME B31G requirements. They can also be retuned
                    on the results page without re-running the assessment.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: SOURCE DATA */}
        <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-5 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
            <FiDatabase className="h-5 w-5" />
            ILI source data
          </div>

          <div className="flex-1 space-y-4">
            <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-900">
              {[
                ['released', 'Released alignment', FiShield],
                ['manual', 'Manual upload', FiUploadCloud],
              ].map(([mode, label, Icon]) => (
                <button
                  key={mode as string}
                  type="button"
                  onClick={() => {
                    setSourceMode(mode as 'released' | 'manual');
                    setErrors([]);
                    setAlignmentError('');
                    setAlignmentMessage('');
                  }}
                  className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold transition ${
                    sourceMode === mode
                      ? 'bg-white text-indigo-700 shadow-sm dark:bg-slate-800 dark:text-indigo-300'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <Icon className="h-4 w-4" /> {label as string}
                </button>
              ))}
            </div>

            {sourceMode === 'released' ? (
              <>
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 dark:border-indigo-900 dark:bg-indigo-950/20">
              <div className="flex items-start gap-3">
                <FiShield className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    Anomalies come from Corrosion Analysis only
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    A session appears here once its alignment reached the final phase and an engineer released
                    features for assessment. NEW-run geometry and growth evidence keep their session, feature,
                    survey interval, formula, and analysis-basis provenance.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Released alignment session
              </label>
              <div className="flex gap-2">
                <select
                  value={selectedRunId}
                  onChange={(event) => setSelectedRunId(event.target.value)}
                  disabled={alignmentLoading || sessionsLoading}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value="">Select a released session</option>
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.pipelineName} · {session.selectedCount.toLocaleString()} released
                    </option>
                  ))}
                </select>
                <SynButton
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => selectedRunId && void loadSession(selectedRunId)}
                  disabled={!selectedRunId || alignmentLoading}
                >
                  <span className="inline-flex items-center gap-2">
                    <FiRefreshCw className={alignmentLoading ? 'animate-spin' : ''} /> Reload
                  </span>
                </SynButton>
              </div>
              {sessionsLoading && <p className="mt-2 text-xs text-slate-500">Loading released sessions…</p>}
              {!sessionsLoading && sessions.length === 0 && (
                <p className="mt-2 text-xs text-amber-600">
                  No alignment session has released features yet. Finish an alignment, then complete its
                  Corrosion Analysis review.
                </p>
              )}
              {alignmentMessage && <p className="mt-2 text-xs font-medium text-emerald-600">{alignmentMessage}</p>}
              {alignmentError && <p role="alert" className="mt-2 text-xs font-medium text-red-600">{alignmentError}</p>}
            </div>

            {blocked.length > 0 && (
              <details className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                <summary className="cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {blocked.length} completed session(s) not available for FFS
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {blocked.map((session) => (
                    <li key={session.id} className="text-[11px] text-slate-500">
                      <span className="font-medium text-slate-700 dark:text-slate-300">{session.pipelineName}</span>
                      {' — '}{session.reason}
                      {session.reviewedCount > 0 && (
                        <Link
                          to={`/alignment/${encodeURIComponent(session.id)}/corrosion`}
                          className="ml-1 font-medium text-indigo-600 hover:underline"
                        >
                          Open Corrosion Analysis
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-semibold text-slate-500">
                Outer Diameter [{diameterUnit}]
                <select
                  value={diameterUnit}
                  onChange={(event) => {
                    const next = event.target.value as LengthUnit;
                    setOuterDiameterMm((value) => normalizeDisplayValue(value, (numeric) => convertLength(numeric, diameterUnit, next)));
                    setDiameterUnit(next);
                  }}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  aria-label="Outer diameter unit"
                >
                  <option value="mm">mm</option>
                  <option value="in">inch</option>
                </select>
                <input type="number" min="0" step="any" value={outerDiameterMm} onChange={(event) => setOuterDiameterMm(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" />
              </label>
              <label className="block text-xs font-semibold text-slate-500">
                Pressure unit
                <select
                  value={pressureUnit}
                  onChange={(event) => {
                    const next = event.target.value as PressureUnit;
                    setSmysMpa((value) => normalizeDisplayValue(value, (numeric) => convertPressure(numeric, pressureUnit, next)));
                    setOperatingPressureMpa((value) => normalizeDisplayValue(value, (numeric) => convertPressure(numeric, pressureUnit, next)));
                    setPressureUnit(next);
                  }}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value="MPa">MPa</option>
                  <option value="bar">bar</option>
                  <option value="psi">psi</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-500">
                SMYS [{pressureUnit}]
                <input type="number" min="0" step="any" value={smysMpa} onChange={(event) => setSmysMpa(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" />
              </label>
              <label className="block text-xs font-semibold text-slate-500">
                Design Factor (line default)
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={designFactor}
                  onChange={(event) => {
                    const next = event.target.value;
                    // Sections still sitting on the old default follow it; one
                    // the engineer has deliberately changed does not get reset.
                    setSectionFactors((previous) => {
                      const updated = { ...previous };
                      for (const option of sectionOptions) {
                        const key = normalizedSectionKey(option.section);
                        if (updated[key] === designFactor) updated[key] = next;
                      }
                      return updated;
                    });
                    setDesignFactor(next);
                  }}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
                <span className="mt-1 block text-[10px] font-normal leading-snug">Applied to any section without its own value below.</span>
              </label>
              <label className="block text-xs font-semibold text-slate-500">
                Required assessment pressure [{pressureUnit}]
                <input type="number" min="0" step="any" value={operatingPressureMpa} onChange={(event) => setOperatingPressureMpa(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" />
              </label>
              <label className="block text-xs font-semibold text-slate-500">
                Pressure basis
                <select
                  value={pressureBasis}
                  onChange={(event) => setPressureBasis(event.target.value as FfsConfig['pressureBasis'])}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value="maop">MAOP</option>
                  <option value="mop">MOP / approved operating limit</option>
                  <option value="current-operating">Current operating pressure</option>
                  <option value="other-required">Other required assessment pressure</option>
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-500">
                Fallback depth CGR [mm/y]
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={fallbackDepthGrowth}
                  onChange={(event) => setFallbackDepthGrowth(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
                <span className="mt-1 block text-[10px] font-normal leading-snug">Optional explicit assumption; 0 means no fallback.</span>
              </label>
              <label className="block text-xs font-semibold text-slate-500">
                Fallback length growth [mm/y]
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={fallbackLengthGrowth}
                  onChange={(event) => setFallbackLengthGrowth(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
                <span className="mt-1 block text-[10px] font-normal leading-snug">Optional explicit assumption; NEW-only length is not inferred from zero.</span>
              </label>
            </div>
            {sectionOptions.length > 0 && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    Design factor by section
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    {sectionOptions.length} section{sectionOptions.length === 1 ? '' : 's'} carry released
                    features. Buried line pipe and a river crossing or riser rarely share a factor — assessing
                    a crossing at the line-pipe factor overstates its safe pressure. Each feature records
                    which value it was assessed with.
                  </p>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900/70">
                      <tr>
                        <th className="px-4 py-2">Section</th>
                        <th className="px-2 py-2 text-right">Features</th>
                        <th className="px-2 py-2 text-right">Range [m]</th>
                        <th className="px-4 py-2 text-right">Design factor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {sectionOptions.map((option) => {
                        const key = normalizedSectionKey(option.section);
                        const value = sectionFactors[key] ?? designFactor;
                        const numeric = Number(value);
                        const invalid = value.trim() === '' || !Number.isFinite(numeric) || numeric <= 0 || numeric > 1;
                        return (
                          <tr key={key}>
                            <td className="px-4 py-2 font-medium text-slate-700 dark:text-slate-200">
                              {option.section}
                              {value !== designFactor && !invalid && (
                                <span className="ml-2 rounded border border-indigo-200 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-indigo-600 dark:border-indigo-800/60 dark:text-indigo-400">
                                  Override
                                </span>
                              )}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-slate-500">
                              {option.featureCount.toLocaleString()}
                            </td>
                            <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-400">
                              {option.startLd.toFixed(0)} – {option.endLd.toFixed(0)}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <input
                                type="number"
                                min="0"
                                max="1"
                                step="0.01"
                                value={value}
                                aria-label={`Design factor for ${option.section}`}
                                aria-invalid={invalid}
                                onChange={(event) =>
                                  setSectionFactors((previous) => ({ ...previous, [key]: event.target.value }))
                                }
                                className={`w-24 rounded-lg border bg-slate-50 px-2 py-1.5 text-right text-xs tabular-nums text-slate-800 focus:outline-none dark:bg-slate-900 dark:text-slate-200 ${
                                  invalid
                                    ? 'border-rose-400 focus:border-rose-500'
                                    : 'border-slate-200 focus:border-indigo-500 dark:border-slate-700'
                                }`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* B31G para. 1.9 divides the failure pressure by a safety factor —
                the hydrotest-to-MAOP ratio, usually not below 1.25 — not by the
                B31.8 design factor. The two only coincide while the line runs at
                its design hoop stress, so the choice is made explicitly here. */}
            <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                Safety factor
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                Divides the estimated failure pressure to give the safe operating pressure:
                P<sub>S</sub> = P<sub>F</sub> / SF.
              </p>
              <div role="radiogroup" aria-label="Safety factor basis" className="ds-segmented mt-2.5 w-max">
                {([
                  { value: 'derived', label: 'Derive from design factor', hint: 'SF = 1/F per section. Historic B31G practice and the basis of the Level 0 tables; correct only at the design hoop stress.' },
                  { value: 'explicit', label: 'Explicit safety factor', hint: 'The ratio B31G para. 1.9 asks for: minimum hydrostatic test pressure over MAOP or MOP.' },
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={safetyFactorMode === option.value}
                    title={option.hint}
                    className={`ds-segmented__option${safetyFactorMode === option.value ? ' is-active' : ''}`}
                    onClick={() => setSafetyFactorMode(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {safetyFactorMode === 'explicit' ? (
                <label className="mt-3 block text-xs font-semibold text-slate-500">
                  Safety factor
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={safetyFactor}
                    onChange={(event) => setSafetyFactor(event.target.value)}
                    className="mt-1.5 w-32 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm tabular-nums text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  />
                  {Number(safetyFactor) > 0 && Number(safetyFactor) < 1.25 && (
                    <span className="mt-1 block text-[10px] font-normal leading-snug text-amber-600">
                      Below the 1.25 minimum B31G para. 1.9 recommends. The report will carry a blocking finding.
                    </span>
                  )}
                </label>
              ) : (
                <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
                  Each section is assessed at SF = 1 / its design factor
                  {sectionDesignFactors.length > 0 && (
                    <> — {[...new Set(sectionDesignFactors.map((rule) => rule.designFactor))]
                      .sort((a, b) => a - b)
                      .map((factor) => `${factor} → ${(1 / factor).toFixed(2)}`)
                      .join(', ')}</>
                  )}
                  .
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-semibold text-slate-500">
                Original design life [years]
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={designLifeYears}
                  onChange={(event) => setDesignLifeYears(event.target.value)}
                  placeholder="e.g. 25"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
                <span className="mt-1 block text-[10px] font-normal leading-snug">Remnant life is not reported above this. Leave empty for no cap.</span>
              </label>
              <label className="block text-xs font-semibold text-slate-500">
                Commissioning year
                <input
                  type="number"
                  min="1900"
                  max="2100"
                  step="1"
                  value={commissioningYear}
                  onChange={(event) => setCommissioningYear(event.target.value)}
                  placeholder="e.g. 1985"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
                <span className="mt-1 block text-[10px] font-normal leading-snug">Reported as consumed design life; it does not change the calculation.</span>
              </label>
            </div>

            <p className="text-xs text-slate-500">Inputs are converted to MPa and mm before the ASME B31G calculation. ERF compares the selected required pressure basis with the calculated safe pressure; current operating pressure is not silently treated as MAOP.</p>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-4 dark:border-indigo-900 dark:bg-indigo-950/20">
                  <div className="flex items-start gap-3">
                    <FiFileText className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
                    <div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                        Upload the controlled FFS template
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Manual rows are assessed as a separate source and are never mixed with released alignment
                        features. XLSX, XLS, and CSV files up to 10 MB are supported. The template includes optional
                        Feature ID, repair evidence, recommendation, and action-owner fields used by Case Review;
                        Feature ID becomes mandatory when the output is prepared as an auditable report.
                      </p>
                    </div>
                  </div>
                </div>

                <SynButton
                  type="button"
                  variant="outline"
                  size="sm"
                  className="inline-flex w-full items-center justify-center gap-2"
                  onClick={downloadManualFfsTemplate}
                >
                  <FiDownload /> Download FFS template
                </SynButton>

                <label
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    void loadManualFile(event.dataTransfer.files?.[0] || null);
                  }}
                  className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center transition hover:border-indigo-400 hover:bg-indigo-50/40 dark:border-slate-600 dark:bg-slate-900"
                >
                  <FiUploadCloud className="h-8 w-8 text-indigo-500" />
                  <span className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {manualFile?.name || 'Drop the completed template here'}
                  </span>
                  <span className="mt-1 text-xs text-slate-500">
                    {manualRows.length > 0
                      ? `${manualRows.length.toLocaleString()} row(s) loaded`
                      : 'or click to browse XLSX, XLS, or CSV'}
                  </span>
                  <input
                    type="file"
                    accept={MANUAL_FFS_ACCEPT}
                    className="sr-only"
                    onChange={(event) => void loadManualFile(event.target.files?.[0] || null)}
                  />
                </label>

                {alignmentMessage && (
                  <p className="text-xs font-medium text-emerald-600">{alignmentMessage}</p>
                )}
                {alignmentError && (
                  <p role="alert" className="text-xs font-medium text-red-600">{alignmentError}</p>
                )}
              </>
            )}

            {readinessReasons.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                <p className="font-semibold">Complete these items to run the assessment:</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {readinessReasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              </div>
            )}

            <SynButton
              onClick={() => void runAssessment()}
              disabled={readinessReasons.length > 0 || isProcessing || alignmentLoading}
              variant="lime"
              size="lg"
              className="inline-flex w-full items-center justify-center gap-2"
            >
              {isProcessing ? `Processing (${progress}%)` : <><FiCheckCircle /> Run Assessment</>}
            </SynButton>
          </div>
        </div>
      </div>

      {/* Validation Errors Display */}
      {errors.length > 0 && (
        <div className="mt-8 overflow-hidden rounded-xl border border-red-200 bg-white shadow-sm dark:border-red-900 dark:bg-slate-800">
          <div className="flex items-center gap-3 border-b border-red-100 bg-red-50 px-6 py-4 dark:border-red-900/50 dark:bg-red-900/20">
            <FiAlertCircle className="h-5 w-5 text-red-500" />
            <span className="font-medium text-red-700 dark:text-red-400">
              {errors.length} source value{errors.length > 1 ? 's' : ''} cannot be assessed — correct the ILI data
              {sourceMode === 'released' ? ' or de-select the feature in Corrosion Analysis.' : '.'}
            </span>
          </div>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase text-slate-500 dark:bg-slate-900/50">
                <tr>
                  <th className="px-6 py-3">#</th>
                  <th className="px-6 py-3">Row</th>
                  <th className="px-6 py-3">Column</th>
                  <th className="px-6 py-3">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 dark:divide-slate-800 dark:text-slate-300">
                {errors.slice(0, 100).map((err, i) => (
                  <tr key={i}>
                    <td className="px-6 py-3 text-slate-400">{i + 1}</td>
                    <td className="px-6 py-3 font-medium text-amber-600 dark:text-amber-500">Row {err.row}</td>
                    <td className="px-6 py-3 text-indigo-600 dark:text-indigo-400">{err.col}</td>
                    <td className="px-6 py-3 text-red-600 dark:text-red-400">{err.msg}</td>
                  </tr>
                ))}
                {errors.length > 100 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-3 text-center italic text-slate-500">
                      ...and {errors.length - 100} more errors not shown.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
