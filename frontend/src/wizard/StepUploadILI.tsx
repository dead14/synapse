import { useState, useEffect, useMemo, useRef } from 'react';
import { FiUploadCloud, FiInfo, FiChevronDown, FiChevronUp, FiDatabase, FiShield, FiPlus, FiDownload, FiArrowRight, FiCheckCircle } from 'react-icons/fi';
import { apiFetch, apiUrl } from '../utils/api';
import { Button, LinkButton } from '../components/ds';
import { useToast } from '../components/common/ToastProvider';
import { formatIngestionImportError } from '../domain/ingestionError';
import {
  buildPersistedIliRun,
  describeIngestionProgress,
  ingestPersistedInspectionRunPair,
  runChronology,
  type IngestionFileProgress,
  type IngestionResponse,
} from '../domain/alignmentIntake';
import PipelineSpecFields from '../components/pipeline/PipelineSpecFields';
import {
  EMPTY_PIPELINE_SPEC_FORM,
  formToSpecification,
  pipelineSpecFormProblems,
  specificationToForm,
  type PipelineSpecForm,
} from '../domain/pipelineSpecForm';
import { pipelineExportFields } from '../domain/pipelineExport';
import { isBlankSpecification, type PipelineRegisterEntry } from '../domain/pipelineSpecification';
import { fetchPipelineDossier, fetchPipelineRegister, savePipelineDossier } from '../lib/pipelines/pipelineClient';

interface StepUploadILIProps {
  onNext: (data?: any) => void;
}

type StrategyCapability = {
  id: string;
  available: boolean;
  validated: boolean;
  reasonCode: string | null;
};

const STRATEGY_LABELS: Record<string, string> = {
  dtw_hungarian_onedirection: 'DTW + Ordered Match (OneDirection)',
  dtw_hungarian: 'DTW + Hungarian Match (Legacy)',
  traditional_hungarian: 'Traditional Hungarian',
  manual: 'Manual Algorithm',
  phylogenetic: 'Phylogenetic Algorithm',
  aurora_ili: 'AURORA-ILI Universal Registration',
};

const STRATEGY_HINTS: Record<string, string> = {
  aurora_ili:
    'Registers the structure first, rebuilds local coordinates, then resolves features. '
    + 'It estimates local odometer drift and clock rotation instead of widening tolerances, '
    + 'and reports 1:1, 1:N, N:1 and region-only correspondence separately. Use it across '
    + 'vendors, tool generations or runs with a large drift.',
};

const STRATEGY_ORDER = [
  'dtw_hungarian_onedirection',
  'aurora_ili',
  'dtw_hungarian',
  'traditional_hungarian',
  'manual',
  'phylogenetic',
];

const UNAVAILABLE_REASONS: Record<string, string> = {
  MOCK_ENGINE_NOT_VALIDATED: 'engine not yet validated',
  UNKNOWN_STRATEGY: 'unknown strategy',
};

// Until the capability table arrives, only offer the engines the server is
// known to accept.  Guessing optimistically here would recreate the dead end
// this list exists to prevent: the wizard would take the operator through
// every remaining step before the execution endpoint rejects the choice.
const FALLBACK_AVAILABLE = new Set([
  'dtw_hungarian_onedirection', 'manual', 'phylogenetic', 'aurora_ili',
]);

function strategyLabel(capability: StrategyCapability): string {
  const name = STRATEGY_LABELS[capability.id] || capability.id;
  if (capability.available) return name;
  const reason = capability.reasonCode ? UNAVAILABLE_REASONS[capability.reasonCode] : null;
  return `${name} — unavailable${reason ? ` (${reason})` : ''}`;
}

function fileStem(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '').trim();
  return stem || 'ILI Alignment';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The survey year a date implies.
 *
 * The intake collects one value — the day the tool ran — and everything that
 * used to be keyed on the year is derived from it, so the run can never be
 * stored with a year that disagrees with its own date.
 */
function yearOfSurveyDate(surveyDate: string): string {
  return ISO_DATE.test(surveyDate) ? surveyDate.slice(0, 4) : '';
}

/** A survey date that is a real calendar day inside the plausible run window. */
function isUsableSurveyDate(surveyDate: string): boolean {
  if (!ISO_DATE.test(surveyDate)) return false;
  const parsed = new Date(`${surveyDate}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return false;
  // Round-tripping rejects a rolled-over day such as 2026-02-31.
  if (parsed.toISOString().slice(0, 10) !== surveyDate) return false;
  const year = parsed.getUTCFullYear();
  return year >= 1900 && year <= 2100;
}

function longSurveyDate(surveyDate: string): string {
  if (!isUsableSurveyDate(surveyDate)) return '';
  return new Date(`${surveyDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

/** The `YYYY-MM-DD` a filename spells out, when it spells one out at all. */
function surveyDateFromFileName(fileName: string): string {
  const iso = fileName.match(/\b(19|20)(\d{2})[-_.]?(\d{2})[-_.]?(\d{2})\b/);
  if (iso) {
    const candidate = `${iso[1]}${iso[2]}-${iso[3]}-${iso[4]}`;
    if (isUsableSurveyDate(candidate)) return candidate;
  }
  return '';
}

function abortError(): Error {
  return new DOMException('Aborted', 'AbortError');
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(abortError());
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort);
  });
}

async function waitForIngestion(
  jobId: string,
  reportProgress: (percent: number) => void,
  signal?: AbortSignal,
) {
  for (let attempt = 0; attempt < 900; attempt += 1) {
    // An unmounted uploader must stop polling immediately instead of keeping
    // this loop alive for up to 15 minutes.
    if (signal?.aborted) throw abortError();
    const job = await apiFetch<IngestionResponse>(`/api/ingestion-jobs/${encodeURIComponent(jobId)}`, { signal });
    reportProgress(Number(job.progress || 0));
    if (job.state === 'completed') {
      reportProgress(100);
      return {
        ...job,
        pipeline_run_id: job.result?.pipelineRunId,
        run_summary: job.result?.summary,
        audit: job.result?.audit,
      } satisfies IngestionResponse;
    }
    if (job.state === 'failed') {
      throw new Error(job.errorMessage || 'Ingestion failed.');
    }
    await wait(1_000, signal);
  }
  throw new Error('Ingestion job timed out. Reopen the session to check its status.');
}

export default function StepUploadILI({ onNext }: StepUploadILIProps) {
  const toast = useToast();
  const [expandedSection, setExpandedSection] = useState<string | null>('all');
  const [datasets, setDatasets] = useState<any[]>([
    { id: 1, surveyDate: '', vendor: '', file: null },
    { id: 2, surveyDate: '', vendor: '', file: null },
  ]);
  const [masterIndex, setMasterIndex] = useState(1);
  const [algorithm, setAlgorithm] = useState('dtw_hungarian_onedirection');
  const [enablePartialRun, setEnablePartialRun] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  // Runs are imported concurrently, so a single label written by whichever
  // poll fired last showed one file at 100 % while another was still at 20 %,
  // which reads as a stalled import. Progress is tracked per file and reported
  // as one figure covering the whole intake.
  const [fileProgress, setFileProgress] = useState<IngestionFileProgress[]>([]);
  const [sessionName, setSessionName] = useState('');
  /**
   * The line's design data, as typed.
   *
   * It used to live here as loose strings that travelled no further than the
   * Excel export, so FFS asked the same engineer for the same numbers again in
   * different units. It is now the pipeline dossier: filed against the line on
   * import, and read back by every assessment that follows.
   */
  const [specForm, setSpecForm] = useState<PipelineSpecForm>(EMPTY_PIPELINE_SPEC_FORM);
  // Whether the operator has touched the dossier. A recorded dossier is loaded
  // over an untouched form and offered as a button over a typed one, so
  // switching the pipeline name never wipes out work in progress.
  const [specTouched, setSpecTouched] = useState(false);
  const [register, setRegister] = useState<PipelineRegisterEntry[]>([]);
  const [dossierNote, setDossierNote] = useState('');
  const specProblems = pipelineSpecFormProblems(specForm);

  /** The pipeline this session's name already names, if the org has one. */
  const matchedPipeline = useMemo(() => {
    const name = sessionName.trim().toLowerCase();
    if (!name) return null;
    return register.find((entry) => entry.pipelineName.trim().toLowerCase() === name) || null;
  }, [register, sessionName]);
  // Aborts in-flight ingestion work (upload + status polling) on unmount and
  // suppresses state updates that would otherwise land after navigation.
  const unmountAbortRef = useRef<AbortController | null>(null);
  /** The line the uploads were filed under, learned from the first response. */
  const pipelineIdRef = useRef<number | null>(null);
  const [strategies, setStrategies] = useState<StrategyCapability[]>(() =>
    STRATEGY_ORDER.map((id) => ({
      id,
      available: FALLBACK_AVAILABLE.has(id),
      validated: FALLBACK_AVAILABLE.has(id),
      reasonCode: FALLBACK_AVAILABLE.has(id) ? null : 'MOCK_ENGINE_NOT_VALIDATED',
    })),
  );

  useEffect(() => {
    const controller = new AbortController();
    unmountAbortRef.current = controller;
    return () => controller.abort();
  }, []);

  // The lines this organization already has a dossier for. Read once: the
  // register is small, and the alternative is a lookup on every keystroke in
  // the name field.
  useEffect(() => {
    let active = true;
    fetchPipelineRegister()
      .then((entries) => { if (active) setRegister(entries); })
      .catch(() => {
        // No register is not an error here: the intake still files a dossier
        // once the run is imported and the pipeline exists.
      });
    return () => { active = false; };
  }, []);

  /**
   * Loads the dossier already filed for the named line.
   *
   * Applied without asking only while the form is untouched, which is the
   * ordinary case: an engineer types the line name first and expects the
   * numbers they filed last time to be there.
   */
  const loadDossier = async (pipelineId: number, pipelineName: string) => {
    try {
      const dossier = await fetchPipelineDossier(pipelineId);
      if (!dossier?.specification) return;
      setSpecForm(specificationToForm(dossier.specification, {
        diameterUnit: specForm.diameterUnit,
        pressureUnit: specForm.pressureUnit,
      }));
      setSpecTouched(false);
      setDossierNote(`Loaded the dossier filed for ${pipelineName}.`);
    } catch {
      setDossierNote('');
    }
  };

  useEffect(() => {
    if (!matchedPipeline?.recorded || specTouched) return;
    void loadDossier(matchedPipeline.pipelineId, matchedPipeline.pipelineName);
    // Only the identity of the matched line should re-trigger this; the form
    // state it writes is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedPipeline?.pipelineId, matchedPipeline?.recorded]);

  useEffect(() => {
    let active = true;
    apiFetch<{ strategies?: StrategyCapability[] }>('/api/alignment/strategies')
      .then((payload) => {
        if (!active || !Array.isArray(payload.strategies) || payload.strategies.length === 0) return;
        const known = new Map(payload.strategies.map((item) => [item.id, item]));
        const ordered = STRATEGY_ORDER.filter((id) => known.has(id)).map((id) => known.get(id)!);
        const extra = payload.strategies.filter((item) => !STRATEGY_ORDER.includes(item.id));
        setStrategies([...ordered, ...extra]);
      })
      .catch(() => {
        // Keep the conservative fallback list; it never offers an engine the
        // execution endpoint would reject.
      });
    return () => { active = false; };
  }, []);

  // A capability can go unavailable between page loads.  Never leave a rejected
  // engine selected, or the wizard would advance on a choice that cannot run.
  useEffect(() => {
    const selected = strategies.find((item) => item.id === algorithm);
    if (selected && !selected.available) {
      const firstAvailable = strategies.find((item) => item.available);
      if (firstAvailable) setAlgorithm(firstAvailable.id);
    }
  }, [strategies, algorithm]);

  useEffect(() => {
    if (algorithm === 'phylogenetic') {
      setDatasets((prev) => {
        if (prev.length >= 3 && !prev[0].phyloLabel) {
          return prev.map((ds, i) => ({ ...ds, phyloLabel: i === 0 ? 'Ancestor Data' : `ILI Alignment ${i}` }));
        }
        if (prev.length < 3 || prev[0].phyloLabel) return prev;
        return [
          { id: 1, surveyDate: '', vendor: '', file: null, phyloLabel: 'Ancestor Data' },
          { id: 2, surveyDate: '', vendor: '', file: null, phyloLabel: 'ILI Alignment 1' },
          { id: 3, surveyDate: '', vendor: '', file: null, phyloLabel: 'ILI Alignment 2' },
        ];
      });
      setMasterIndex(0);
    } else {
      setMasterIndex((prev) => (prev === 0 ? 1 : prev));
      setDatasets((currentDatasets) => {
        if (currentDatasets[0]?.phyloLabel) {
          return currentDatasets.map(({ phyloLabel: _phyloLabel, ...rest }) => rest);
        }
        return currentDatasets;
      });
    }
  }, [algorithm]);

  const processingLabel = describeIngestionProgress(fileProgress);

  const allFilesUploaded = datasets.every((ds) => (
    ds.file !== null
    && isUsableSurveyDate(String(ds.surveyDate || '').trim())
    && String(ds.vendor || '').trim().length > 0
  ));

  /** Two runs flown on the same day cannot be ordered into OLD and NEW. */
  const duplicateSurveyDates = (() => {
    const seen = new Set<string>();
    const clashes = new Set<string>();
    for (const dataset of datasets) {
      const value = String(dataset.surveyDate || '').trim();
      if (!isUsableSurveyDate(value)) continue;
      if (seen.has(value)) clashes.add(value);
      seen.add(value);
    }
    return [...clashes];
  })();

  const handleInitialize = async () => {
    const signal = unmountAbortRef.current?.signal;
    const reportFileProgress = (index: number, name: string, percent: number) => {
      if (signal?.aborted) return;
      setFileProgress((current) => {
        const next = current.slice();
        next[index] = { name, percent };
        return next;
      });
    };
    setIsProcessing(true);
    // A line the register already knows is the dossier's home even if the
    // upload is a re-use of a run already imported.
    pipelineIdRef.current = matchedPipeline?.pipelineId ?? null;
    setFileProgress(datasets.map((dataset) => ({ name: dataset.file?.name || '', percent: 0 })));
    try {
      const masterFile = datasets[masterIndex]?.file as File | null;
      const pipelineName = sessionName.trim() || fileStem(masterFile?.name || 'ILI Alignment');
      const summaryData: any = {
        sessionName: sessionName || pipelineName,
        algorithm: algorithm,
        enablePartialRun: enablePartialRun
      };
      summaryData.newRun = { name: 'Waiting for data...', vendor: '', year: '', tool: '', total: 0, anomalies: 0, welds: 0, valves: 0, tees: 0, offtakes: 0, bends: 0, others: 0 };
      summaryData.oldRun = { name: 'Waiting for data...', vendor: '', year: '', tool: '', total: 0, anomalies: 0, welds: 0, valves: 0, tees: 0, offtakes: 0, bends: 0, others: 0 };

      const ingestCallback = async (dataset: any, index: number) => {
        const formData = new FormData();
        formData.append('file', dataset.file);
        formData.append('pipelineName', pipelineName);
        // The server derives the year from the date; `surveyYear` still travels
        // so an older backend that has not learned about dates keeps working.
        formData.append('surveyDate', dataset.surveyDate);
        formData.append('surveyYear', yearOfSurveyDate(dataset.surveyDate));
        formData.append('vendor', dataset.vendor);
        const queued = await apiFetch<IngestionResponse>('/api/upload-csv', {
          method: 'POST',
          body: formData,
          signal,
        });
        // Every upload in this intake names the same line, so whichever answers
        // first identifies the pipeline the dossier is filed against.
        const uploadedPipelineId = Number(queued.pipeline_id);
        if (Number.isSafeInteger(uploadedPipelineId) && uploadedPipelineId > 0) {
          pipelineIdRef.current = uploadedPipelineId;
        }
        const response = queued.jobId
          ? await waitForIngestion(
            String(queued.jobId),
            (percent) => reportFileProgress(index, dataset.file.name, percent),
            signal,
          )
          : queued;
        reportFileProgress(index, dataset.file.name, 100);
        return buildPersistedIliRun(response, {
          name: dataset.file.name,
          vendor: dataset.vendor,
          year: yearOfSurveyDate(dataset.surveyDate),
          surveyDate: dataset.surveyDate,
          tool: dataset.tool,
        });
      };

      const runPair = await ingestPersistedInspectionRunPair({
        datasets: datasets.map((dataset) => ({
          file: dataset.file as File,
          vendor: String(dataset.vendor || ''),
          year: yearOfSurveyDate(String(dataset.surveyDate || '')),
          surveyDate: String(dataset.surveyDate || ''),
          tool: String(dataset.tool || ''),
        })),
        masterIndex,
        ingest: ingestCallback,
      });
      Object.assign(summaryData, runPair);

      // File the dossier against the line the runs were imported into. A
      // failure here does not stop the alignment: the design data is
      // supporting evidence, and losing the import over it would cost the run.
      const specification = formToSpecification(specForm);
      if (pipelineIdRef.current !== null) {
        try {
          await savePipelineDossier(pipelineIdRef.current, specification, signal);
        } catch (error) {
          if (!signal?.aborted) {
            console.error('Failed to file the pipeline dossier:', error);
            toast.error('The runs were imported, but the pipeline data could not be saved.');
          }
        }
      } else if (!isBlankSpecification(specification)) {
        // Nothing to file it against: the server answered without naming the
        // line. Say so rather than letting the dossier disappear silently.
        toast.error('The runs were imported, but the pipeline this line belongs to could not be identified, '
          + 'so the pipeline data was not saved. Enter it in the Pipeline register.');
      }

      if (algorithm === 'phylogenetic') {
        const sorted = [...runPair.historicalRuns, runPair.masterRun]
          .sort((a, b) => runChronology(a) - runChronology(b));
        summaryData.ancestorRun = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
          summaryData[`run${i}`] = sorted[i];
        }
      }

      if (signal?.aborted) return;
      const inspectionRuns = [
        {
          role: 'Master',
          year: runPair.masterRun.year,
          surveyDate: runPair.masterRun.surveyDate,
          vendor: runPair.masterRun.vendor,
          fileName: runPair.masterRun.name,
          runId: runPair.masterRun.runId,
          total: runPair.masterRun.total,
        },
        ...runPair.historicalRuns.map((run) => ({
          role: 'Historical',
          year: run.year,
          surveyDate: run.surveyDate,
          vendor: run.vendor,
          fileName: run.name,
          runId: run.runId,
          total: run.total,
        })),
      ];
      onNext({
        summaryData,
        algorithm,
        enablePartialRun,
        pipelineData: {
          pipelineName,
          ...pipelineExportFields(specification),
          inspectionRuns,
        },
      });
    } catch (err) {
      // Unmounted mid-flight: the abort is intentional, keep quiet.
      if (signal?.aborted) return;
      console.error(err);
      toast.error(formatIngestionImportError(err));
    } finally {
      if (!signal?.aborted) {
        setIsProcessing(false);
        setFileProgress([]);
      }
    }
  };

  const toggleSection = (section: string) => {
    if (expandedSection === 'all') {
      setExpandedSection(section);
    } else {
      setExpandedSection(expandedSection === section ? null : section);
    }
  };

  const isExpanded = (section: string) => expandedSection === 'all' || expandedSection === section;

  return (
    <div className="alignment-surface alignment-intake w-full flex flex-col gap-4 animate-fade-in">
      
      {/* Page Title */}
      <section className="alignment-intake__header">
        <div className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em]">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg"><FiDatabase size={14} aria-hidden="true" /></span>
              01 — New alignment run
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Inspection intake</h1>
            <p className="mt-2 text-sm leading-6 sm:text-base">
              Add the inspection runs that will be compared, with the date each was flown, then provide the
              pipeline context for a traceable alignment.
            </p>
          </div>
          <div className="ds-btn-group">
            <LinkButton
              variant="secondary"
              href={apiUrl('/api/download-template')}
              target="_blank"
              rel="noreferrer"
              startIcon={<FiDownload aria-hidden="true" />}
            >
              Download Excel template
            </LinkButton>
            <Button
              onClick={handleInitialize}
              disabled={!allFilesUploaded || isProcessing || specProblems.length > 0}
              endIcon={allFilesUploaded && !isProcessing ? <FiArrowRight aria-hidden="true" /> : undefined}
            >
              {isProcessing ? processingLabel || 'Importing data…' : 'Initialize alignment'}
            </Button>
          </div>
        </div>
      </section>

      {isProcessing && (
        <section className="alignment-import-progress" role="status" aria-live="polite">
          <div className="alignment-import-progress__orb" aria-hidden="true"><i /><i /></div>
          <div className="alignment-import-progress__copy">
            <span>Building canonical inspection registry</span>
            <strong>{processingLabel || 'Reading uploaded ILI rows…'}</strong>
            <small>Validating columns, normalizing feature types, and preserving source-row identity.</small>
          </div>
          <div className="alignment-import-progress__rail" aria-hidden="true"><i /></div>
          <div className="alignment-import-progress__facts">
            <span>Schema mapping</span>
            <span>Run chronology</span>
            <span>GW inventory</span>
            <span>Source evidence</span>
          </div>
        </section>
      )}

      <div className="flex flex-col-reverse gap-4">
        {/* Pipeline dossier — one record for the line, not a form that is
            thrown away. It is filed against the pipeline the runs import into
            and read back by FFS, RBI, and the next intake for the same line. */}
        <div className="alignment-config-panel alignment-intake__dossier">
          <button
            onClick={() => toggleSection('dossier')}
            className="alignment-config-panel__trigger"
          >
            <h3 className="flex items-center gap-2 font-semibold">
              <FiInfo aria-hidden="true" /> Pipeline data
              {matchedPipeline?.recorded && (
                <span className="ds-badge ds-badge--success ds-badge--pill">On record</span>
              )}
            </h3>
            {isExpanded('dossier') ? <FiChevronUp /> : <FiChevronDown />}
          </button>

          {isExpanded('dossier') && (
            <div className="alignment-config-panel__body">
              <div className="alignment-intake__dossier-name">
                <label className="ds-field__label" htmlFor="intake-pipeline-name">
                  Pipeline / line name (From — To)
                </label>
                <input
                  id="intake-pipeline-name"
                  type="text"
                  value={sessionName}
                  onChange={(event) => setSessionName(event.target.value)}
                  className="ds-input"
                  placeholder="e.g. Station A — Station B"
                />
                <p className="alignment-intake__dossier-hint">
                  {matchedPipeline
                    ? matchedPipeline.recorded
                      ? `${matchedPipeline.pipelineName} is already on record with `
                        + `${matchedPipeline.runCount.toLocaleString()} run(s) and `
                        + `${matchedPipeline.segmentCount.toLocaleString()} registered stretch(es). `
                        + 'Saving here updates that record.'
                      : `${matchedPipeline.pipelineName} exists but has no design data recorded yet.`
                    : 'The runs are imported under this name, and the design data below is filed against it.'}
                </p>
                {dossierNote && (
                  <p className="alignment-intake__dossier-note">
                    <FiCheckCircle aria-hidden="true" /> {dossierNote}
                  </p>
                )}
                {matchedPipeline?.recorded && specTouched && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void loadDossier(matchedPipeline.pipelineId, matchedPipeline.pipelineName)}
                  >
                    Reload the recorded dossier
                  </Button>
                )}
              </div>

              <PipelineSpecFields
                value={specForm}
                problems={specProblems}
                onChange={(next) => {
                  setSpecTouched(true);
                  setDossierNote('');
                  setSpecForm(next);
                }}
              />
            </div>
          )}
        </div>


        {/* Right Column: ILI Uploads */}
        <div className="flex flex-col gap-4">
          <div className="alignment-run-panel">
            <div className="alignment-run-panel__toolbar">
              <div className="alignment-run-panel__title">
                <p className="alignment-run-panel__eyebrow">Run pair setup</p>
                <h3>
                  <FiShield aria-hidden="true" /> ILI data configuration
                </h3>
              </div>

              <div className="alignment-run-panel__controls">
                {datasets.length < 6 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    startIcon={<FiPlus aria-hidden="true" />}
                    onClick={() => setDatasets([...datasets, { id: Date.now(), surveyDate: '', vendor: '', file: null }])}
                  >
                    Add another run
                  </Button>
                )}
                <label className="alignment-run-panel__strategy">
                  <span>Strategy</span>
                  <select
                    className="ds-select ds-select--sm"
                    value={algorithm}
                    onChange={(e) => setAlgorithm(e.target.value)}
                  >
                    {strategies.map((capability) => (
                      <option
                        key={capability.id}
                        value={capability.id}
                        disabled={!capability.available}
                      >
                        {strategyLabel(capability)}
                      </option>
                    ))}
                  </select>
                </label>
                {algorithm !== 'phylogenetic' && (
                  <label className="alignment-run-panel__toggle">
                    <input
                      type="checkbox"
                      checked={enablePartialRun}
                      onChange={(e) => setEnablePartialRun(e.target.checked)}
                    />
                    Enable partial run (tie-in)
                  </label>
                )}
              </div>

              {STRATEGY_HINTS[algorithm] && (
                <p className="alignment-run-panel__hint">{STRATEGY_HINTS[algorithm]}</p>
              )}
              {duplicateSurveyDates.length > 0 && (
                <p className="alignment-run-panel__conflict" role="alert">
                  Two runs share the survey date {duplicateSurveyDates.join(', ')}. Give each run the day
                  it was actually flown, or the chain cannot order them into OLD and NEW.
                </p>
              )}
            </div>
            
             <div className="alignment-dataset-grid no-scrollbar">
              
              {datasets.map((ds, index) => {
                const isMaster = index === masterIndex;
                return (
                  <div key={ds.id} className={`alignment-dataset-card${isMaster ? ' is-master' : ''}`}>
                    <div className="alignment-dataset-card__head">
                      <span className="alignment-dataset-card__rule" aria-hidden="true" />
                      <div className="alignment-dataset-card__identity">
                        <p className="alignment-dataset-card__role">
                          {isMaster ? 'Alignment anchor' : 'Comparison source'}
                        </p>
                        <h4 className="alignment-dataset-card__name">
                          {algorithm === 'phylogenetic' ? ds.phyloLabel : isMaster ? 'Master dataset' : `Dataset ${index + 1}`}
                        </h4>
                      </div>
                      {yearOfSurveyDate(ds.surveyDate || '') && (
                        <span className="alignment-dataset-card__year">{yearOfSurveyDate(ds.surveyDate)}</span>
                      )}
                      {isMaster && <span className="alignment-dataset-card__flag">Master</span>}
                    </div>

                    <div className="alignment-dropzone group">
                      <input
                        type="file"
                        accept=".csv,.xlsx"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        aria-label={`Upload the inspection data file for ${isMaster ? 'the master dataset' : `dataset ${index + 1}`}`}
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            const file = e.target.files[0];
                            // A filename that spells out a full date pre-fills
                            // it; a bare year cannot, because the day is the
                            // part FFS needs and guessing 1 January would date
                            // every assessment wrong by up to a year.
                            const detected = surveyDateFromFileName(file.name);
                            setDatasets((current) => current.map((item, itemIndex) => (
                              itemIndex === index
                                ? { ...item, file, surveyDate: item.surveyDate || detected }
                                : item
                            )));
                          }
                        }}
                      />
                      {ds.file ? (
                        <>
                          <span className="alignment-dropzone__badge" aria-hidden="true">
                            <FiDatabase />
                          </span>
                          <p className="alignment-dropzone__file">{ds.file.name}</p>
                          <p className="alignment-dropzone__hint">Click to replace</p>
                        </>
                      ) : (
                        <>
                          <FiUploadCloud className="alignment-dropzone__icon" aria-hidden="true" />
                          <p className="alignment-dropzone__title">Upload data file</p>
                          <p className="alignment-dropzone__hint">Drag &amp; drop, or click to browse · .xlsx, .xls, .csv</p>
                        </>
                      )}
                    </div>
                    <div className="alignment-dataset-card__fields">
                      <label className="alignment-field">
                        <span className="alignment-field__label">
                          Survey date <em>required</em>
                        </span>
                        <input
                          type="date"
                          min="1900-01-01"
                          max="2100-12-31"
                          required
                          value={ds.surveyDate || ''}
                          onChange={(event) => setDatasets((current) => current.map((item, itemIndex) => (
                            itemIndex === index ? { ...item, surveyDate: event.target.value } : item
                          )))}
                          className="ds-input alignment-field__input"
                        />
                        <span className="alignment-field__note">
                          {longSurveyDate(ds.surveyDate || '')
                            || 'The day the tool ran. Carried into the FFS assessment.'}
                        </span>
                      </label>
                      <label className="alignment-field">
                        <span className="alignment-field__label">
                          Vendor <em>required</em>
                        </span>
                        <input
                          type="text"
                          required
                          value={ds.vendor || ''}
                          onChange={(event) => setDatasets((current) => current.map((item, itemIndex) => (
                            itemIndex === index ? { ...item, vendor: event.target.value } : item
                          )))}
                          className="ds-input alignment-field__input"
                          placeholder="e.g. ROSEN"
                        />
                        <span className="alignment-field__note">The ILI contractor that ran this survey.</span>
                      </label>
                    </div>
                  </div>
                );
              })}

            </div>
          </div>
        </div>
      </div>
      
    </div>
  );
}
