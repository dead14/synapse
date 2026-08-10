import { useState, useEffect, useMemo, useRef } from 'react';
import { FiAlertTriangle, FiCheckCircle, FiFileText, FiRefreshCw, FiChevronLeft } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '../utils/socket';
import { apiFetch, ApiError } from '../utils/api';
import { executionContextLines, executionResultLines } from './executionReport';

import { Button, Callout, Panel, PanelBody, PanelHeader } from '../components/ds';

// Strategies executed through the queued result pipeline rather than the
// legacy /api/run endpoint.  Must stay in step with the capability table in
// alignmentStrategyCapabilities.js, which is the server's own gate.
const RESULT_PIPELINE_STRATEGIES = ['dtw_hungarian_onedirection', 'manual', 'phylogenetic', 'aurora_ili'];

interface StepExecutionProps {
  onBack: () => void;
  config: any;
}

export default function StepExecution({ onBack, config }: StepExecutionProps) {
  const navigate = useNavigate();
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [showValidation, setShowValidation] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const startedRef = useRef(false);
  const jobIdRef = useRef<string | null>(null);
  const completedRef = useRef(false);
  const configuredAlgorithm = config.algorithm || config.summaryData?.algorithm || 'dtw_hungarian';
  const contextLines = useMemo(() => executionContextLines(config), [config]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    completedRef.current = false;

    if (config.sessionStatus === 'completed'
      && !RESULT_PIPELINE_STRATEGIES.includes(configuredAlgorithm)) {
      setTerminalLines([
        ...contextLines,
        'DONE The previous alignment session already completed. Results are ready.',
      ]);
      setProgress(100);
      setShowValidation(true);
      return () => { startedRef.current = false; };
    }

    let mounted = true;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let requestController: AbortController | null = null;
    let requestTimeout: ReturnType<typeof setTimeout> | null = null;
    setTerminalLines([
      ...contextLines,
      'QUEUE Connecting to the alignment worker...',
    ]);
    setFailure(null);
    setProgress(0);

    const finish = (result?: Record<string, any>) => {
      if (!mounted || completedRef.current) return;
      completedRef.current = true;
      if (result) {
        setTerminalLines((previous) => [...previous, ...executionResultLines(result)]);
      }
      setTerminalLines(prev => [...prev, 'DONE Alignment complete. Results are ready for engineering review.']);
      setProgress(100);
      setShowValidation(true);
    };

    const fail = (message: string) => {
      if (mounted) {
        setTerminalLines(prev => [...prev, `[ERROR] ${message}`]);
        setFailure(message);
      }
      if (pollTimer) clearInterval(pollTimer);
    };

    const pollJob = (jobId: string) => {
      pollTimer = setInterval(async () => {
        try {
          const job = await apiFetch<{
            progress?: number;
            state?: string;
            failedReason?: string;
            result?: Record<string, any>;
          }>(`/api/job/${encodeURIComponent(jobId)}/result`);
          if (!mounted || jobIdRef.current !== jobId) return;
          if (typeof job.progress === 'number') setProgress(job.progress);
          if (job.state === 'completed') {
            if (pollTimer) clearInterval(pollTimer);
            finish(job.result);
          } else if (job.state === 'failed') {
            fail(`Worker failed: ${job.failedReason || 'Unknown error'}`);
          }
        } catch {
          // Socket.IO may still deliver progress; keep retrying the local job endpoint.
        }
      }, 1000);
    };

    const startAlignment = async () => {
      try {
        if (!config.sessionId) {
          fail('The alignment session has not been saved yet. Go back to the summary and save the data first.');
          return;
        }

        requestController = new AbortController();
        requestTimeout = setTimeout(() => requestController?.abort(), 15000);
        const algorithm = config.algorithm || config.summaryData?.algorithm || 'dtw_hungarian';
        const usesResultPipeline = RESULT_PIPELINE_STRATEGIES.includes(algorithm);
        const data = await apiFetch<{ success?: boolean; jobId?: string; error?: string }>(
          usesResultPipeline
            ? `/api/ili-results?sessionId=${encodeURIComponent(String(config.sessionId))}`
            : '/api/run',
          usesResultPipeline
            ? { signal: requestController.signal }
            : {
                method: 'POST',
                signal: requestController.signal,
                body: JSON.stringify({ runId: config.sessionId, algorithm }),
              },
        );
        if (requestTimeout) clearTimeout(requestTimeout);
        requestTimeout = null;
        
        if (data.jobId) {
          if (mounted) {
            jobIdRef.current = data.jobId;
            setTerminalLines(prev => [...prev, `QUEUE Job accepted · ID ${data.jobId}`]);
            setProgress(1);
            pollJob(data.jobId);
          }
        } else {
          if (mounted) setTerminalLines(prev => [...prev, `[ERROR] Failed to queue job: ${data.error}`]);
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          fail('The server did not respond within 15 seconds. Check the backend on port 8000 and try again.');
          return;
        }

        // An ApiError means the server answered — reporting it as unreachable
        // sends the operator to check ports and connectivity when the real
        // cause is a rejected request they can act on.
        if (err instanceof ApiError) {
          if (err.status === 401) {
            fail('Your login session has expired. Sign in again to run the alignment.');
          } else if (err.status === 422) {
            fail(`${err.message} Go back to the Inspection data step and choose an available strategy.`);
          } else {
            fail(`The server rejected the request (${err.status}): ${err.message}`);
          }
          return;
        }

        fail(`Could not reach the server: ${err.message}`);
      }
    };

    const socket = getSocket();
    
    const handleProgress = (data: any) => {
      if (!jobIdRef.current || data.jobId !== jobIdRef.current) return;
      const message = `WORK ${data.message}`;
      setTerminalLines((previous) => previous.at(-1) === message ? previous : [...previous, message]);
      setProgress(data.progress);
      if (data.progress === 100) setShowValidation(true);
    };

    const handleComplete = (data: any) => {
      if (!jobIdRef.current || data.jobId !== jobIdRef.current) return;
      if (pollTimer) clearInterval(pollTimer);
      finish(data.result);
    };

    const handleError = (data: any) => {
      if (!jobIdRef.current || data.jobId !== jobIdRef.current) return;
      setTerminalLines(prev => [...prev, `[ERROR] Worker failed: ${data.error}`]);
    };

    socket.on('alignment_progress', handleProgress);
    socket.on('alignment_complete', handleComplete);
    socket.on('alignment_error', handleError);

    // React Strict Mode mounts effects twice in development. Deferring the
    // request lets the first probe clean up before it can start a job, while
    // the real mounted effect starts exactly once.
    const startTimer = setTimeout(startAlignment, 0);

    return () => {
      mounted = false;
      startedRef.current = false;
      clearTimeout(startTimer);
      requestController?.abort();
      if (requestTimeout) clearTimeout(requestTimeout);
      if (pollTimer) clearInterval(pollTimer);
      socket.off('alignment_progress', handleProgress);
      socket.off('alignment_complete', handleComplete);
      socket.off('alignment_error', handleError);
    };
  }, [config.algorithm, config.sessionId, config.sessionStatus, config.summaryData?.algorithm, configuredAlgorithm, contextLines, retryToken]);

  return (
    <div className="ds-stack ds-stack--lg animate-fade-in">
      {/* Execution log */}
      <Panel>
        <div className="ds-exec__chrome">
          <span className="ds-exec__dots" aria-hidden="true"><i /><i /><i /></span>
          <span className="ds-exec__title">alignment-server-v8.1</span>
        </div>
        <div className="ds-exec__log" role="log" aria-live="polite">
          {terminalLines.map((line, i) => {
            let tone = 'is-ok';
            if (line.includes('ERROR') || line.includes('REVIEW')) tone = 'is-warn';
            if (line.startsWith('DONE') || line.includes('AUDIT PASS')) tone = 'is-done';
            if (line.startsWith('RUN') || line.startsWith('RESULT')) tone = 'is-rule';

            return (
              <div key={i} className={`ds-exec__line ${tone}`}>
                <span aria-hidden="true">$</span>{line}
              </div>
            );
          })}
          {progress < 100 && (
            <div className="ds-exec__line is-rule ds-exec__caret">
              <span aria-hidden="true">$</span>_
            </div>
          )}
        </div>

        <div className="ds-exec__progress">
          <div className="ds-row" style={{ justifyContent: 'space-between' }}>
            <span className="ds-panel__eyebrow">Execution progress</span>
            <span className="ds-data" style={{ fontSize: 'var(--ds-t-xs)', fontWeight: 700, color: 'var(--ds-primary-ink)' }}>
              {progress}%
            </span>
          </div>
          <div
            className="ds-exec__track"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Execution progress"
          >
            <i style={{ width: `${progress}%` }} />
          </div>
        </div>
      </Panel>

      {/* A failed job used to leave the operator on a dead terminal with no
          way back to the step that caused it. */}
      {failure && !showValidation && (
        <Panel>
          <PanelBody className="ds-stack">
            <Callout tone="danger" role="alert" icon={<FiAlertTriangle aria-hidden="true" />} title="Alignment could not be started">
              {failure}
            </Callout>
            <div className="ds-btn-group">
              <Button variant="secondary" startIcon={<FiChevronLeft aria-hidden="true" />} onClick={onBack}>
                Back to the previous step
              </Button>
              <Button
                variant="danger-solid"
                startIcon={<FiRefreshCw aria-hidden="true" />}
                onClick={() => setRetryToken((token) => token + 1)}
              >
                Run it again
              </Button>
            </div>
          </PanelBody>
        </Panel>
      )}

      {/* Physics validation results, once the job reports 100% */}
      {showValidation && (
        <Panel className="animate-fade-in-up">
          <PanelHeader
            icon={<FiCheckCircle aria-hidden="true" />}
            eyebrow="Stage complete"
            title="Post-alignment validation results"
            subtitle="GW locks, NEW-reference sections, and ordered anomaly matching have been processed."
          />
          <PanelBody className="ds-stack">
            <Callout tone="success" icon={<FiCheckCircle aria-hidden="true" />} title="Alignment process completed successfully">
              The dashboard only shows results from this job.
            </Callout>
            <div className="ds-actionbar" style={{ marginTop: 0 }}>
              <span />
              <div className="ds-actionbar__end">
                <Button
                  startIcon={<FiFileText aria-hidden="true" />}
                  onClick={() => navigate(
                    `/ili-comparison?sessionId=${config.sessionId || ''}${configuredAlgorithm === 'manual' ? '&mode=intervention' : ''}`,
                  )}
                >
                  View full dashboard
                </Button>
              </div>
            </div>
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
