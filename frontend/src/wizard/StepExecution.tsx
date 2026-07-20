import { useState, useEffect, useRef } from 'react';
import { FiCheckCircle, FiFileText } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';
import { getSocket } from '../utils/socket';
import { apiFetch, ApiError } from '../utils/api';

interface StepExecutionProps {
  onBack: () => void;
  config: any;
}

export default function StepExecution({ onBack: _onBack, config }: StepExecutionProps) {
  const navigate = useNavigate();
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [showValidation, setShowValidation] = useState(false);
  const startedRef = useRef(false);
  const jobIdRef = useRef<string | null>(null);
  const completedRef = useRef(false);
  const configuredAlgorithm = config.algorithm || config.summaryData?.algorithm || 'dtw_hungarian';

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (config.sessionStatus === 'completed'
      && !['dtw_hungarian_onedirection', 'manual'].includes(configuredAlgorithm)) {
      setTerminalLines(['Session alignment sebelumnya sudah selesai.', '✅ All done! Results are ready.']);
      setProgress(100);
      setShowValidation(true);
      return () => { startedRef.current = false; };
    }

    let mounted = true;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let requestController: AbortController | null = null;
    let requestTimeout: ReturnType<typeof setTimeout> | null = null;
    setTerminalLines(["Connecting to Alignment Server..."]);

    const finish = () => {
      if (!mounted || completedRef.current) return;
      completedRef.current = true;
      setTerminalLines(prev => [...prev, '✅ All done! Results are ready.']);
      setProgress(100);
      setShowValidation(true);
    };

    const fail = (message: string) => {
      if (mounted) setTerminalLines(prev => [...prev, `[ERROR] ${message}`]);
      if (pollTimer) clearInterval(pollTimer);
    };

    const pollJob = (jobId: string) => {
      pollTimer = setInterval(async () => {
        try {
          const job = await apiFetch<{ progress?: number; state?: string; failedReason?: string }>(`/api/job/${encodeURIComponent(jobId)}/result`);
          if (!mounted || jobIdRef.current !== jobId) return;
          if (typeof job.progress === 'number') setProgress(job.progress);
          if (job.state === 'completed') {
            if (pollTimer) clearInterval(pollTimer);
            finish();
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
          fail('Sesi alignment belum tersimpan. Kembali ke ringkasan dan simpan data terlebih dahulu.');
          return;
        }

        requestController = new AbortController();
        requestTimeout = setTimeout(() => requestController?.abort(), 15000);
        const algorithm = config.algorithm || config.summaryData?.algorithm || 'dtw_hungarian';
        const usesResultPipeline = ['dtw_hungarian_onedirection', 'manual'].includes(algorithm);
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
            setTerminalLines(prev => [...prev, `Job queued successfully. Job ID: ${data.jobId}`]);
            setProgress(1);
            pollJob(data.jobId);
          }
        } else {
          if (mounted) setTerminalLines(prev => [...prev, `[ERROR] Failed to queue job: ${data.error}`]);
        }
      } catch (err: any) {
        if (err instanceof ApiError && err.status === 401) {
          fail('Sesi login sudah kedaluwarsa. Silakan masuk kembali untuk menjalankan alignment.');
          return;
        }

        fail(err.name === 'AbortError'
          ? 'Server did not respond within 15 seconds. Check backend port 8000 and sign in again.'
          : `Could not reach server: ${err.message}`);
      }
    };

    const socket = getSocket();
    
    const handleProgress = (data: any) => {
      if (!jobIdRef.current || data.jobId !== jobIdRef.current) return;
      setTerminalLines(prev => [...prev, data.message]);
      setProgress(data.progress);
      if (data.progress === 100) setShowValidation(true);
    };

    const handleComplete = (data: any) => {
      if (!jobIdRef.current || data.jobId !== jobIdRef.current) return;
      if (pollTimer) clearInterval(pollTimer);
      finish();
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
  }, [config.algorithm, config.sessionId, config.sessionStatus, config.summaryData?.algorithm, configuredAlgorithm]);

  return (
    <div className="alignment-surface bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-gray-100 animate-fade-in flex flex-col gap-8">
      
      {/* Execution log */}
      <div className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.06)]">
        <div className="flex h-11 items-center border-b border-gray-200 bg-gray-50 px-4">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
            <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
          </div>
          <div className="mx-auto text-xs font-mono text-gray-500">alignment-server-v8.1</div>
        </div>
        <div className="relative min-h-[280px] max-h-[350px] overflow-y-auto bg-slate-50/70 p-6 font-mono text-[13px] leading-relaxed">
          {terminalLines.map((line, i) => {
            let textColor = 'text-green-700';
            if (line.includes('ERROR') || line.includes('anomali depth berkurang') || line.includes('clock-shift')) textColor = 'text-orange-700';
            if (line.includes('SELESAI')) textColor = 'text-brand-700 font-bold';
            if (line.startsWith('──')) textColor = 'text-gray-400';
            
            return (
              <div key={i} className={`${textColor} mb-1`} style={{ animationFillMode: 'forwards' }}>
                <span className="mr-2 text-gray-400">$</span>{line}
              </div>
            );
          })}
          {progress < 100 && (
            <div className="mt-2 animate-pulse text-gray-400">
              <span className="mr-2 text-gray-400">$</span>_
            </div>
          )}
        </div>
        
        {/* Integrated Progress Bar inside terminal block */}
        <div className="px-6 pb-6 pt-2">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-mono text-gray-500">Execution Progress</span>
            <span className="text-xs font-mono font-bold text-brand-600">{progress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-1.5 rounded-full bg-brand-500 transition-all duration-700 ease-out" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
      
      {/* Physics Validation Results (Shows up when progress is 100%) */}
      {showValidation && (
        <div className="animate-fade-in-up">
          <h3 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-600">
              <FiCheckCircle size={18} />
            </div>
            Post-Alignment Validation Results
          </h3>
          
          <div className="bg-white border border-green-100 rounded-2xl p-6 shadow-sm mb-8 text-center">
            <h4 className="font-bold text-gray-800 mb-2">Alignment Process Completed Successfully</h4>
            <p className="text-sm text-gray-600">
              GW locks, NEW-reference sections, dan ordered anomaly matching sudah
              selesai diproses. Dashboard hanya menampilkan hasil job yang sama.
            </p>
          </div>
          
          <div className="flex gap-4 justify-end pt-4 border-t border-gray-100">
            <button 
                onClick={() => navigate(
                  `/ili-comparison?sessionId=${config.sessionId || ''}${configuredAlgorithm === 'manual' ? '&mode=intervention' : ''}`,
                )}
                className="bg-brand-500 hover:bg-brand-600 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-theme-md hover:shadow-theme-lg flex items-center gap-2"
              >
                <FiFileText size={18} />
                View Full Dashboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
