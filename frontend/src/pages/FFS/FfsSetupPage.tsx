import { useEffect, useMemo, useState } from 'react';
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
  describeEmptyIntake,
  getAlignmentImportReadiness,
  mapAlignmentRowsToFfs,
  normalizedSectionKey,
  summariseReleasedIntake,
  type AlignmentSectionOption,
  type FfsIntakeScope,
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
import { areaTermTex, FFS_TEX } from '../../lib/ffs/notation.ts';
import { MathInline, MathBlock } from '../../components/ds';

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
  // The date the selected release carried, kept so the field can say where its
  // value came from — and stop saying it once the engineer overrides it.
  const [iliDateSource, setIliDateSource] = useState('');
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
  // The same rows before excluded ones are dropped. Only the intake summary
  // reads these, so that "a reviewer excluded it" is never reported as "this
  // feature does not exist in the run".
  const [alignmentRowsWithExclusions, setAlignmentRowsWithExclusions] = useState<ComparisonRow[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Record<string, string>>({});
  /**
   * How much of the run this assessment covers.
   *
   * Defaults to every anomaly. The release used to be both the scope and the
   * gate, so an anomaly nobody had reviewed never reached the assessment and
   * left no trace in the report that it existed.
   */
  const [intakeScope, setIntakeScope] = useState<FfsIntakeScope>('all');
  /** Why the saved release cannot be used as a scope, when it cannot. */
  const [releaseBlockReason, setReleaseBlockReason] = useState<string | null>(null);
  const [alignmentLoading, setAlignmentLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [alignmentMessage, setAlignmentMessage] = useState('');
  const [alignmentError, setAlignmentError] = useState('');

  // Pipeline parameters. Alignment carries anomaly geometry, not line design.
  const [outerDiameterMm, setOuterDiameterMm] = useState('');
  // Only used where the run reported no wall for a feature, which is the one
  // measured field an engineer can legitimately supply from the line record.
  const [nominalWallThickness, setNominalWallThickness] = useState('');
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
  // ASME B31.4-2025 inputs. E defaults to 1.0, which covers seamless, ERW, and
  // electric flash welded pipe — most line pipe — and is the only value that
  // leaves the design thickness where B31G practice would put it anyway.
  const [weldJointFactor, setWeldJointFactor] = useState('1');
  const [yieldToTensileRatio, setYieldToTensileRatio] = useState('');
  const [unusualLoading, setUnusualLoading] = useState(false);

  // Sections come from the features in scope, and the factor for each is typed
  // once against a stretch the engineer has already named and reviewed. Keyed
  // by the normalised section name so a reload keeps the entered values.
  const [sectionFactors, setSectionFactors] = useState<Record<string, string>>({});

  const normalizeDisplayValue = (
    value: string,
    convert: (numeric: number) => number,
  ) => {
    // An empty field stays empty. `Number('')` is 0, so converting it turned a
    // blank optional input into a typed zero the moment the unit was switched.
    if (value.trim() === '') return value;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Number(convert(numeric).toFixed(6)).toString() : value;
  };
  const outerDiameterMmForCalculation = normalizeDisplayValue(
    outerDiameterMm,
    (value) => toMillimetres(value, diameterUnit),
  );
  const nominalWallThicknessMmForCalculation = normalizeDisplayValue(
    nominalWallThickness,
    (value) => toMillimetres(value, diameterUnit),
  );
  const parsedNominalWall = nominalWallThickness.trim() === ''
    ? null
    : Number(nominalWallThicknessMmForCalculation);
  const nominalWallThicknessMm = parsedNominalWall !== null
    && Number.isFinite(parsedNominalWall)
    && parsedNominalWall > 0
    ? parsedNominalWall
    : null;
  const smysMpaForCalculation = normalizeDisplayValue(smysMpa, (value) => toMegapascals(value, pressureUnit));
  const operatingPressureMpaForCalculation = normalizeDisplayValue(
    operatingPressureMpa,
    (value) => toMegapascals(value, pressureUnit),
  );

  /**
   * The stretches that will appear in this assessment.
   *
   * Derived rather than stored, because the scope can change after the session
   * is loaded: switching from the release to the whole run brings in sections
   * the review never touched, and a stale list would have assessed them at the
   * line default without ever showing them.
   */
  const sectionOptions: AlignmentSectionOption[] = useMemo(
    () => (alignmentRows.length === 0
      ? []
      : alignmentSectionOptions(alignmentRows, { selectedKeys, scope: intakeScope })),
    [alignmentRows, selectedKeys, intakeScope],
  );

  // Every section shows what it will actually be assessed with, so a new one
  // starts at the line default instead of blank. A value the engineer has typed
  // is never overwritten.
  useEffect(() => {
    setSectionFactors((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const option of sectionOptions) {
        const key = normalizedSectionKey(option.section);
        if (next[key] === undefined) {
          next[key] = designFactor;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [sectionOptions, designFactor]);

  /** The overrides as the import layer wants them: named section, numeric factor. */
  const sectionDesignFactors = sectionOptions
    .map((option) => ({
      section: option.section,
      designFactor: Number(sectionFactors[normalizedSectionKey(option.section)] ?? designFactor),
    }))
    .filter((rule) => Number.isFinite(rule.designFactor) && rule.designFactor > 0);

  const invalidSectionFactors = sectionOptions.filter((option) => {
    const raw = sectionFactors[normalizedSectionKey(option.section)];
    // A section that has not been seeded yet falls back to the line default,
    // which is validated on its own. Treating it as invalid put a "enter a
    // design factor" message on screen for the frame between a scope change and
    // the seeding effect.
    if (raw === undefined) return false;
    if (raw.trim() === '') return true;
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
    ...(yieldToTensileRatio.trim() !== '' &&
      (!Number.isFinite(Number(yieldToTensileRatio)) ||
        Number(yieldToTensileRatio) <= 0 ||
        Number(yieldToTensileRatio) > 1)
      ? ['Yield-to-tensile ratio must be greater than 0 and not more than 1, or left empty.']
      : []),
  ];

  /**
   * What the assessment would accept from this release, recomputed as the wall
   * fallback is typed. The engineer sees the answer before filling in the form,
   * instead of a thrown error after pressing Run.
   */
  const intake = useMemo(
    () => summariseReleasedIntake(
      alignmentRowsWithExclusions,
      { selectedKeys, scope: intakeScope },
      nominalWallThicknessMm,
    ),
    [alignmentRowsWithExclusions, selectedKeys, intakeScope, nominalWallThicknessMm],
  );

  const alignmentReadinessReasons = getAlignmentImportReadiness({
    lineName,
    iliDate,
    selectedRunId,
    alignmentRowCount: alignmentRows.length,
    scope: intakeScope,
    // Under the whole-run scope the population is the result itself, so the
    // review's size is not a precondition for running anything.
    selectedFeatureCount: intakeScope === 'all' ? intake.released : selectedKeys.size,
    assessableFeatureCount: intake.assessable,
    intakeBlockReason: describeEmptyIntake(intake),
    outerDiameterMm: outerDiameterMmForCalculation,
    smysMpa: smysMpaForCalculation,
    designFactor,
    operatingPressureMpa: operatingPressureMpaForCalculation,
    fallbackDepthGrowthMmPerYear: fallbackDepthGrowth,
    fallbackLengthGrowthMmPerYear: fallbackLengthGrowth,
    nominalWallThicknessMm: nominalWallThickness,
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
    setAlignmentRowsWithExclusions([]);
    setSelectedKeys(new Set());
    setReasons({});
    setSectionFactors({});
    setReleaseBlockReason(null);
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
      // A missing, empty or superseded review no longer stops the assessment —
      // it only means there is no release to narrow it to. The session is loaded
      // either way and the scope falls back to the whole run, which is the
      // population the engineer asked to see.
      const keys = selectedKeysOf(review);
      const releaseBlocked = review.stale
        ? 'The alignment was re-run after the Corrosion Analysis review, so that release no longer describes this result.'
        : keys.size === 0
          ? 'No Corrosion Analysis review has released features from this session.'
          : null;
      const scope: FfsIntakeScope = releaseBlocked === null ? intakeScope : 'all';
      setReleaseBlockReason(releaseBlocked);
      setIntakeScope(scope);

      const revisedRows = applyInterventions(result.comparison, sessionConfig.config?.interventions || []);
      const includedRows = includedInterventionRows(revisedRows);
      setAlignmentRowsWithExclusions(revisedRows);
      setAlignmentRows(includedRows);
      setSelectedKeys(keys);
      setReasons(Object.fromEntries(
        review.items.filter((item) => item.reason).map((item) => [item.sourceKey, item.reason as string]),
      ));
      setAlignmentMessage(
        `${includedRows.length.toLocaleString()} included comparison rows loaded`
        + (keys.size > 0 ? `, ${keys.size.toLocaleString()} of them released by review.` : '.'),
      );
      const session = sessions.find((item) => item.id === sessionId);
      if (!lineName && session) setLineName(session.pipelineName);
      // The upload recorded when the run was flown, so the engineer should not
      // have to retype it. Only an untouched field is filled: a date typed by
      // hand is a deliberate correction and must survive changing sessions.
      if (session?.inspectionDate && !iliDate) {
        setIliDate(session.inspectionDate);
        setIliDateSource(session.inspectionDate);
      }
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
        // ASME B31.4-2025: these decide the Code disposition reported beside the
        // B31G result, never the B31G result itself.
        weldJointFactor: Number(weldJointFactor) > 0 ? Number(weldJointFactor) : 1,
        yieldToTensileRatio: yieldToTensileRatio.trim() === '' ? null : Number(yieldToTensileRatio),
        unusualLoading,
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
        nominalWallThicknessMm,
      }, selectedRunId, { selectedKeys, reasons, scope: intakeScope });

      // The reason of whichever row happened to sit first used to be raised
      // here. That row is almost always the OLD side of the comparison, so the
      // engineer was told their release "does not contain a NEW-run feature"
      // about a row they never released. Say what actually stopped the run.
      if (imported.accepted.length === 0) {
        throw new Error(describeEmptyIntake(intake));
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
            scope: intakeScope,
            accepted: imported.accepted.map((item) => item.provenance),
            // In-scope anomalies that could not be assessed, and why — not the
            // OLD side of the comparison and not the features a release held
            // back, which are counted separately.
            rejected: imported.rejected,
            skipped: imported.skipped,
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
                  {/* The parabola, written as the fraction the code states.
                      `0.67dL` beside the neighbouring `0.85dL` read as two
                      decimals of the same kind; they are a fraction and a
                      fitted constant, and the notation now says so. */}
                  <span className="text-[10px] opacity-70">
                    <MathInline tex={areaTermTex('original')} label="two thirds d L" scale="sm" />
                  </span>
                </button>
                <button
                  onClick={() => setMethod('modified')}
                  className={`flex flex-1 flex-col items-center rounded-md px-3 py-2 text-xs font-semibold transition-colors ${method === 'modified' ? 'border border-indigo-200 bg-indigo-100 text-indigo-700 dark:border-indigo-800/50 dark:bg-indigo-900/30 dark:text-indigo-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                  <span>Modified B31G</span>
                  <span className="text-[10px] opacity-70">
                    <MathInline tex={areaTermTex('modified')} label="0.85 d L" scale="sm" />
                  </span>
                </button>
              </div>

              {method === 'modified' && (
                <div className="mt-2 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900">
                  <span className="text-xs font-medium text-slate-500">
                    Modified <MathInline tex="\Sfail" label="failure stress" scale="sm" /> formula:
                  </span>
                  <div className="flex rounded border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-800">
                    <button
                      onClick={() => setModifiedSa('smys69')}
                      className={`rounded px-2 py-1 text-[11px] font-medium ${modifiedSa === 'smys69' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400' : 'text-slate-500'}`}
                    >
                      <MathInline tex="\SMYS + 69\,\mathrm{MPa}" label="SMYS plus 69 MPa" scale="sm" />
                    </button>
                    <button
                      onClick={() => setModifiedSa('smys11')}
                      className={`rounded px-2 py-1 text-[11px] font-medium ${modifiedSa === 'smys11' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400' : 'text-slate-500'}`}
                    >
                      <MathInline tex="1.1 \times \SMYS" label="1.1 times SMYS" scale="sm" />
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
              {iliDateSource && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <FiCheckCircle className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                  {iliDate === iliDateSource
                    ? 'Taken from the survey date recorded when this run was uploaded.'
                    : `Overrides the uploaded survey date (${iliDateSource}).`}
                </p>
              )}
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
                  <label className="mt-4 flex items-start gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={screening.deriveMissingGrowthRates}
                      onChange={(event) =>
                        setScreening((s) => ({ ...s, deriveMissingGrowthRates: event.target.checked }))
                      }
                      className="mt-0.5"
                    />
                    <span>
                      Derive a growth rate where the run pair measured none
                      <span className="mt-0.5 block text-[10px] font-normal leading-snug text-slate-500 dark:text-slate-400">
                        Unmatched features, merged clusters, and pairs reporting an apparent decrease otherwise
                        carry no remaining life at all. With this on they are projected from the measured metal
                        loss over the service age of the line, or from the rate of comparable measured features —
                        each labelled as a derivation and raised as a report finding. A measured rate, including a
                        measured zero, is never replaced.
                      </span>
                    </span>
                  </label>
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
                    Anomalies come from a completed alignment
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    A session appears here once its alignment reached the final phase. NEW-run geometry and growth
                    evidence keep their session, feature, survey interval, formula, and analysis-basis provenance.
                    Whichever coverage you choose, every anomaly the run reported is accounted for: assessed, or
                    listed with the reason it could not be.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Completed alignment session
              </label>
              <div className="flex gap-2">
                <select
                  value={selectedRunId}
                  onChange={(event) => setSelectedRunId(event.target.value)}
                  disabled={alignmentLoading || sessionsLoading}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value="">Select a completed session</option>
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.pipelineName}
                      {session.selectedCount > 0
                        ? ` · ${session.selectedCount.toLocaleString()} released by review`
                        : ' · whole run'}
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
                  No alignment has reached the final phase yet. Finish an alignment run, then assess it here.
                </p>
              )}
              {alignmentMessage && <p className="mt-2 text-xs font-medium text-emerald-600">{alignmentMessage}</p>}
              {alignmentError && <p role="alert" className="mt-2 text-xs font-medium text-red-600">{alignmentError}</p>}
            </div>

            {/* How much of the run this assessment covers. */}
            {alignmentRows.length > 0 && !alignmentLoading && (
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  Assessment coverage
                </p>
                <div role="radiogroup" aria-label="Assessment coverage" className="ds-segmented mt-2.5 w-max max-w-full">
                  {([
                    {
                      value: 'all' as const,
                      label: 'Every anomaly in the run',
                      hint: 'Assesses all NEW-run metal loss, whether or not it matched the previous inspection.',
                      disabled: false,
                    },
                    {
                      value: 'released' as const,
                      label: 'Only features released by review',
                      hint: releaseBlockReason
                        || 'Assesses only the features an engineer ticked in Corrosion Analysis.',
                      disabled: releaseBlockReason !== null,
                    },
                  ]).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={intakeScope === option.value}
                      disabled={option.disabled}
                      title={option.hint}
                      className={`ds-segmented__option${intakeScope === option.value ? ' is-active' : ''}`}
                      onClick={() => setIntakeScope(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  {intakeScope === 'all'
                    ? 'Unmatched anomalies are assessed too. Their depth growth is a disclosed zero-baseline '
                      + 'estimate rather than a measured run-pair rate, and each one says so.'
                    : `${selectedKeys.size.toLocaleString()} feature(s) were released by the Corrosion Analysis `
                      + 'review. Anything outside that release is listed in the assessment as not assessed, '
                      + 'never dropped.'}
                </p>
                {releaseBlockReason && (
                  <p className="mt-1.5 text-[11px] font-medium leading-relaxed text-amber-700 dark:text-amber-400">
                    {releaseBlockReason}{' '}
                    <Link
                      to={`/alignment/${encodeURIComponent(selectedRunId)}/corrosion`}
                      className="font-semibold text-indigo-600 hover:underline"
                    >
                      Open Corrosion Analysis
                    </Link>
                  </p>
                )}
              </div>
            )}

            {/* What the assessment would do with this scope, before it runs. */}
            {intake.released > 0 && !alignmentLoading && (
              <div
                className={`rounded-xl border p-4 ${
                  intake.assessable === 0
                    ? 'border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/20'
                    : intake.blockers.length > 0 || intake.missingFromResult > 0
                    ? 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20'
                    : 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20'
                }`}
              >
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {intake.assessable.toLocaleString()} of {intake.released.toLocaleString()}{' '}
                  {intakeScope === 'all' ? 'anomal' : 'released featur'}
                  {intake.released === 1
                    ? (intakeScope === 'all' ? 'y' : 'e')
                    : (intakeScope === 'all' ? 'ies' : 'es')}{' '}
                  can be assessed
                </p>
                {intake.assessable > 0 && (
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    Metal loss the NEW run reported for the first time is assessed too, on a disclosed
                    zero-depth baseline at the OLD survey rather than a measured run-pair rate.
                  </p>
                )}
                {intake.assessable < intake.released && (
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    The {(intake.released - intake.assessable).toLocaleString()} that cannot be calculated are
                    carried into the assessment as unassessed anomalies, with the reason against each one.
                  </p>
                )}
                {intake.usingNominalWall > 0 && (
                  <p className="mt-1 text-[11px] font-medium leading-relaxed text-amber-700 dark:text-amber-400">
                    {intake.usingNominalWall.toLocaleString()} of them will use the line nominal wall you
                    entered, because the run reported none. Each says so in its warnings.
                  </p>
                )}
                {intake.excludedByIntervention > 0 && (
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                    {intake.excludedByIntervention.toLocaleString()} anomal
                    {intake.excludedByIntervention === 1 ? 'y was' : 'ies were'} excluded from the released
                    outputs by a reviewer, so {intake.excludedByIntervention === 1 ? 'it is' : 'they are'} not
                    assessed.
                  </p>
                )}
                {intake.missingFromResult > 0 && (
                  <p className="mt-2 text-[11px] font-medium leading-relaxed text-red-700 dark:text-red-400">
                    {intake.missingFromResult.toLocaleString()} released feature
                    {intake.missingFromResult === 1 ? ' does' : 's do'} not exist in the loaded result. The
                    review was saved against a different run —{' '}
                    <Link
                      to={`/alignment/${encodeURIComponent(selectedRunId)}/corrosion`}
                      className="font-semibold text-indigo-600 hover:underline"
                    >
                      review it again
                    </Link>.
                  </p>
                )}
                {intake.blockers.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {intake.blockers.map((blocker) => (
                      <li key={blocker.reason} className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                        <span className="font-semibold tabular-nums">{blocker.count.toLocaleString()}</span>
                        {' — '}{blocker.reason}
                        <span className="text-slate-400"> e.g. {blocker.examples.join(', ')}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {intake.assessable === 0 && intake.blockers.some((blocker) => blocker.reason.includes('Wall WT NEW')) && (
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                    Wall thickness is a property of the pipe, not a measurement of the defect: enter the line
                    nominal wall below and these features become assessable.
                  </p>
                )}
              </div>
            )}

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
                    setNominalWallThickness((value) => normalizeDisplayValue(value, (numeric) => convertLength(numeric, diameterUnit, next)));
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
                Nominal wall thickness [{diameterUnit}]
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={nominalWallThickness}
                  onChange={(event) => setNominalWallThickness(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
                <span className="mt-1 block text-[10px] font-normal leading-snug">
                  Optional. Used only where the run reported no wall for a feature, and disclosed on every
                  feature that used it.
                </span>
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
                Divides the estimated failure pressure to give the safe operating pressure.
              </p>
              <MathBlock
                tex={FFS_TEX.safePressure}
                label="safe pressure equals failure pressure over safety factor"
              />
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
                  Each section is assessed at{' '}
                  <MathInline tex={FFS_TEX.safetyFactorFromDesign} label="SF equals one over F" />
                  {' '}on its own design factor
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
                <span className="mt-1 block text-[10px] font-normal leading-snug">Reported as consumed design life, and used to derive a service-age corrosion rate for any feature the run pair could not measure.</span>
              </label>
            </div>

            {/* ASME B31.4-2025 inputs. They do not touch the B31G calculation —
                they decide the Code disposition beside it: the para. 403.2.1
                design thickness the 20 % no-repair band is a fraction of, and
                the para. 451.6.2.2(b) triggers for engineering analysis. */}
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-semibold text-slate-500">
                Weld joint factor E (B31.4 Table 403.2.1-1)
                <select
                  value={weldJointFactor}
                  onChange={(event) => setWeldJointFactor(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <option value="1">1.00 — seamless, ERW, electric flash welded</option>
                  <option value="0.8">0.80 — electric fusion welded</option>
                  <option value="0.6">0.60 — furnace butt welded, continuous welded</option>
                </select>
                <span className="mt-1 block text-[10px] font-normal leading-snug">Sets the design thickness t = P·D / (2·F·E·SMYS) the B31.4 20 % no-repair band is measured against.</span>
              </label>
              <label className="block text-xs font-semibold text-slate-500">
                Yield-to-tensile ratio
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="any"
                  value={yieldToTensileRatio}
                  onChange={(event) => setYieldToTensileRatio(event.target.value)}
                  placeholder="e.g. 0.88"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                />
                <span className="mt-1 block text-[10px] font-normal leading-snug">Above 0.93, B31.4 para. 451.6.2.2(b) requires an engineering analysis instead of B31G. Leave empty if the dossier gives none.</span>
              </label>
            </div>

            <label className="flex items-start gap-2 text-xs font-semibold text-slate-500">
              <input
                type="checkbox"
                checked={unusualLoading}
                onChange={(event) => setUnusualLoading(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                Unusual axial loads, lateral movement, or settlement
                <span className="mt-0.5 block text-[10px] font-normal leading-snug">B31.4 para. 451.6.2.2(b) requires an engineering analysis for these lines; the B31G screen is then reported but is not the Code disposition.</span>
              </span>
            </label>

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
