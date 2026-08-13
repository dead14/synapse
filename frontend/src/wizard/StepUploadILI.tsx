import { useState, useEffect, useRef } from 'react';
import { FiUploadCloud, FiInfo, FiChevronDown, FiChevronUp, FiDatabase, FiSettings, FiShield, FiPlus, FiDownload, FiArrowRight } from 'react-icons/fi';
import { apiFetch, apiUrl } from '../utils/api';
import { Button, LinkButton } from '../components/ds';
import { useToast } from '../components/common/ToastProvider';
import { formatIngestionImportError } from '../domain/ingestionError';
import {
  buildPersistedIliRun,
  ingestPersistedInspectionRunPair,
  runChronology,
  type IngestionResponse,
} from '../domain/alignmentIntake';

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
  fileName: string,
  setLabel: (value: string) => void,
  signal?: AbortSignal,
) {
  for (let attempt = 0; attempt < 900; attempt += 1) {
    // An unmounted uploader must stop polling immediately instead of keeping
    // this loop alive for up to 15 minutes.
    if (signal?.aborted) throw abortError();
    const job = await apiFetch<IngestionResponse>(`/api/ingestion-jobs/${encodeURIComponent(jobId)}`, { signal });
    setLabel(`Processing ${fileName}: ${Number(job.progress || 0)}%`);
    if (job.state === 'completed') {
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
  const [processingLabel, setProcessingLabel] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [pipelineData, setPipelineData] = useState({
    segmentRoute: '',
    environment: '',
    lengthKm: '',
    productMedium: '',
    maopPsi: '',
    designPressureMpa: '',
    operatingPressureMpa: '',
    outerDiameter: '',
    nominalWtMm: '',
    materialGrade: '',
    smysMpa: '',
    designFactor: '',
    seamType: '',
    externalCoating: '',
    installationYear: '',
    buildYear: '',
    designLifeYears: '',
    locationClass: '',
  });
  const setPipelineField = (field: keyof typeof pipelineData, value: string) => {
    setPipelineData((current) => ({ ...current, [field]: value }));
  };
  // Aborts in-flight ingestion work (upload + status polling) on unmount and
  // suppresses state updates that would otherwise land after navigation.
  const unmountAbortRef = useRef<AbortController | null>(null);
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
    const setLabelIfMounted = (value: string) => {
      if (!signal?.aborted) setProcessingLabel(value);
    };
    setIsProcessing(true);
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
        setLabelIfMounted(`Importing ${index + 1} of ${datasets.length}: ${dataset.file.name}`);
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
        const response = queued.jobId
          ? await waitForIngestion(String(queued.jobId), dataset.file.name, setLabelIfMounted, signal)
          : queued;
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
          ...pipelineData,
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
        setProcessingLabel('');
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
              disabled={!allFilesUploaded || isProcessing}
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
        {/* Left Column (Now Bottom): Asset & Specs */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          
          {/* Section 1: Asset Identification */}
          <div className="alignment-config-panel">
            <button 
              onClick={() => toggleSection('asset')}
              className="alignment-config-panel__trigger"
            >
              <h3 className="flex items-center gap-2 font-semibold">
                <FiInfo aria-hidden="true" /> Asset &amp; operations
              </h3>
              {isExpanded('asset') ? <FiChevronUp /> : <FiChevronDown />}
            </button>
            
            {isExpanded('asset') && (
              <div className="alignment-config-panel__body grid grid-cols-1 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="ds-field__label">Pipeline Name (From — To)</label>
                  <input type="text" value={sessionName} onChange={(e) => setSessionName(e.target.value)} className="ds-input" placeholder="e.g. Station A — Station B" />
                </div>
                <div>
                  <label className="ds-field__label">Environment</label>
                  <select className="ds-select" value={pipelineData.environment} onChange={(event) => setPipelineField('environment', event.target.value)}>
                    <option value="">Not provided</option>
                    <option value="Onshore">Onshore</option>
                    <option value="Offshore">Offshore</option>
                    <option value="Subsea">Subsea</option>
                    <option value="Swamp">Swamp</option>
                  </select>
                </div>
                <div>
                  <label className="ds-field__label">Pipe Length (km)</label>
                  <input type="number" value={pipelineData.lengthKm} onChange={(event) => setPipelineField('lengthKm', event.target.value)} className="ds-input" placeholder="e.g. 150" />
                </div>
                <div>
                  <label className="ds-field__label">Product Medium</label>
                  <select className="ds-select" value={pipelineData.productMedium} onChange={(event) => setPipelineField('productMedium', event.target.value)}>
                    <option value="">Not provided</option>
                    <option value="Natural Gas (Dry)">Natural Gas (Dry)</option>
                    <option value="Natural Gas (Wet)">Natural Gas (Wet)</option>
                    <option value="Crude Oil">Crude Oil</option>
                    <option value="Refined Product">Refined Product</option>
                    <option value="Water">Water</option>
                  </select>
                </div>
                <div>
                  <label className="ds-field__label">Build Year</label>
                  <input type="text" value={pipelineData.buildYear} onChange={(event) => setPipelineField('buildYear', event.target.value)} className="ds-input" placeholder="e.g. 1995" />
                </div>
                <div>
                  <label className="ds-field__label">Design Life (years)</label>
                  <input type="number" value={pipelineData.designLifeYears} onChange={(event) => setPipelineField('designLifeYears', event.target.value)} className="ds-input" placeholder="e.g. 30" />
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Physical Specs & Protection */}
          <div className="alignment-config-panel">
            <button 
              onClick={() => toggleSection('specs')}
              className="alignment-config-panel__trigger"
            >
              <h3 className="flex items-center gap-2 font-semibold">
                <FiSettings aria-hidden="true" /> Physical specs &amp; protection
              </h3>
              {isExpanded('specs') ? <FiChevronUp /> : <FiChevronDown />}
            </button>
            
            {isExpanded('specs') && (
              <div className="alignment-config-panel__body grid grid-cols-1 sm:grid-cols-2">
                <div>
                  <label className="ds-field__label">Outer Diameter (OD)</label>
                  <input type="text" value={pipelineData.outerDiameter} onChange={(event) => setPipelineField('outerDiameter', event.target.value)} className="ds-input" placeholder="e.g. 10 inch or 273.1 mm" />
                </div>
                <div>
                  <label className="ds-field__label">Nominal WT (mm)</label>
                  <input type="number" step="0.01" value={pipelineData.nominalWtMm} onChange={(event) => setPipelineField('nominalWtMm', event.target.value)} className="ds-input" placeholder="e.g. 12.7" />
                </div>
                <div>
                  <label className="ds-field__label">MAOP (psi)</label>
                  <input type="number" value={pipelineData.maopPsi} onChange={(event) => setPipelineField('maopPsi', event.target.value)} className="ds-input" placeholder="e.g. 1200" />
                </div>
                <div>
                  <label className="ds-field__label">Design Pressure (MPa)</label>
                  <input type="number" step="0.01" value={pipelineData.designPressureMpa} onChange={(event) => setPipelineField('designPressureMpa', event.target.value)} className="ds-input" placeholder="e.g. 10.0" />
                </div>
                <div>
                  <label className="ds-field__label">Operating Pressure (MPa)</label>
                  <input type="number" step="0.01" value={pipelineData.operatingPressureMpa} onChange={(event) => setPipelineField('operatingPressureMpa', event.target.value)} className="ds-input" placeholder="e.g. 9.46" />
                </div>
                <div>
                  <label className="ds-field__label">Design Factor</label>
                  <input type="number" step="0.01" value={pipelineData.designFactor} onChange={(event) => setPipelineField('designFactor', event.target.value)} className="ds-input" placeholder="e.g. 0.72" />
                </div>
                <div>
                  <label className="ds-field__label">Material Grade</label>
                  <select className="ds-select" value={pipelineData.materialGrade} onChange={(event) => setPipelineField('materialGrade', event.target.value)}>
                    <option value="">Not provided</option>
                    <option value="API 5L X42">API 5L X42</option>
                    <option value="API 5L X52">API 5L X52</option>
                    <option value="API 5L X60">API 5L X60</option>
                    <option value="API 5L X65">API 5L X65</option>
                    <option value="API 5L X70">API 5L X70</option>
                    <option value="API 5L X80">API 5L X80</option>
                  </select>
                </div>
                <div>
                  <label className="ds-field__label">SMYS (MPa)</label>
                  <input type="number" step="0.1" value={pipelineData.smysMpa} onChange={(event) => setPipelineField('smysMpa', event.target.value)} className="ds-input" placeholder="e.g. 358.5" />
                </div>
                <div>
                  <label className="ds-field__label">Seam Type</label>
                  <select className="ds-select" value={pipelineData.seamType} onChange={(event) => setPipelineField('seamType', event.target.value)}>
                    <option value="">Not provided</option>
                    <option value="SMLS (Seamless)">SMLS (Seamless)</option>
                    <option value="ERW">ERW</option>
                    <option value="DSAW">DSAW</option>
                    <option value="SAWH">SAWH</option>
                  </select>
                </div>
                <div>
                  <label className="ds-field__label">External Coating</label>
                  <select className="ds-select" value={pipelineData.externalCoating} onChange={(event) => setPipelineField('externalCoating', event.target.value)}>
                    <option value="">Not provided</option>
                    <option value="3LPE">3LPE</option>
                    <option value="FBE">FBE</option>
                    <option value="Coal Tar Enamel (CTE)">Coal Tar Enamel (CTE)</option>
                    <option value="Bare">Bare</option>
                  </select>
                </div>
                <div>
                  <label className="ds-field__label">Inst. Year / Loc Class</label>
                  <div className="flex gap-2">
                    <input type="text" value={pipelineData.installationYear} onChange={(event) => setPipelineField('installationYear', event.target.value)} className="ds-input" placeholder="Year" />
                    <select className="ds-select" value={pipelineData.locationClass} onChange={(event) => setPipelineField('locationClass', event.target.value)}>
                      <option value="">Not provided</option>
                      <option value="Class 1">Class 1</option>
                      <option value="Class 2">Class 2</option>
                      <option value="Class 3">Class 3</option>
                      <option value="Class 4">Class 4</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

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
