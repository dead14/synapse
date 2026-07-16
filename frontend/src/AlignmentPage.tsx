import React, { useState, useEffect } from 'react';
import StepDataSummary from './wizard/StepDataSummary';
import StepScenarioFilter from './wizard/StepScenarioFilter';
import StepGwSimulator from './wizard/StepGwSimulator';
import StepAnomalyTolerances from './wizard/StepAnomalyTolerances';
import StepExecution from './wizard/StepExecution';
import StepUploadILI from './wizard/StepUploadILI';
import StepTieInConfig from './wizard/StepTieInConfig';
import { apiFetch, ApiError } from './utils/api';

const WIZARD_PROGRESS_STORAGE_KEY = 'synapse_alignment_wizard_progress';

const baseSteps = [
  { id: 'upload', name: 'Upload', desc: 'Validate' },
  { id: 'tiein', name: 'Tie-In Config', desc: 'Offset Calc', conditional: true },
  { id: 'summary', name: 'Data Summary', desc: 'Overview' },
  { id: 'gw', name: 'GW Matching', desc: 'Simulator' },
  { id: 'scenario', name: 'Scenario Filter', desc: 'Thresholds' },
  { id: 'anomaly', name: 'Anomaly Tolerances', desc: 'Matcher' },
  { id: 'exec', name: 'Execution', desc: 'Report Gen' },
];

const visibleSteps = (config: any) => baseSteps.filter((item) => !item.conditional || (item.id === 'tiein' && config?.enablePartialRun));

export default function AlignmentPage() {
  const [step, setStep] = useState(0); // 0 is Upload step
  const [wizardConfig, setWizardConfig] = useState<any>({});
  const [isResuming, setIsResuming] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    // Start fresh every time — no resume prompt, no empty session creation
    let active = true;

    const restoreWizardProgress = async () => {
      try {
        const storedProgress = localStorage.getItem(WIZARD_PROGRESS_STORAGE_KEY);
        if (!storedProgress) return;

        const parsed = JSON.parse(storedProgress) as { sessionId?: string | number; step?: number };
        if (!parsed.sessionId || !Number.isInteger(parsed.step) || parsed.step < 1) {
          localStorage.removeItem(WIZARD_PROGRESS_STORAGE_KEY);
          return;
        }

        const session = await apiFetch<{ config?: any; sessionId?: string | number; status?: string }>(
          `/api/wizard/session/${encodeURIComponent(String(parsed.sessionId))}`,
        );
        if (!active || !session.config || !session.sessionId) return;

        const restoredConfig = { ...session.config, sessionId: session.sessionId, sessionStatus: session.status };
        setWizardConfig(restoredConfig);
        setStep(Math.min(parsed.step, visibleSteps(restoredConfig).length - 1));
        localStorage.setItem('synapse_last_session_id', String(session.sessionId));
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          localStorage.removeItem(WIZARD_PROGRESS_STORAGE_KEY);
        }
      } finally {
        if (active) setIsResuming(false);
      }
    };

    void restoreWizardProgress();
    return () => { active = false; };
  }, []);

  const stepsList = visibleSteps(wizardConfig);
  
  const handleNext = async (data?: any) => {
    let updatedConfig = { ...wizardConfig };
    if (data && typeof data === 'object' && !('nativeEvent' in data)) {
      updatedConfig = { ...updatedConfig, ...data };
    }
    
    try {
      const resData = await apiFetch<{ success?: boolean; sessionId?: string | number }>('/api/wizard/save', {
        method: 'POST',
        body: JSON.stringify({ config: updatedConfig, sessionId: updatedConfig.sessionId })
      });
      if (resData.success && resData.sessionId) {
        updatedConfig.sessionId = resData.sessionId;
        localStorage.setItem('synapse_last_session_id', String(resData.sessionId));
      } else {
        setSaveError('Server tidak mengembalikan ID sesi alignment. Periksa backend lalu coba lagi.');
        return;
      }
    } catch (err) {
      console.error("Failed to save wizard state:", err);
      if (err instanceof ApiError && err.status === 401) {
        // apiFetch already notifies AuthContext; do not advance the wizard
        // while the current session is no longer authorized.
        return;
      }
      setSaveError(err instanceof ApiError
        ? `Gagal menyimpan sesi alignment (${err.status}): ${err.message}`
        : 'Gagal menyimpan sesi alignment. Pastikan backend dan database aktif.');
      return;
    }

    setSaveError(null);
    setWizardConfig(updatedConfig);
    const nextStep = Math.min(step + 1, visibleSteps(updatedConfig).length - 1);
    setStep(nextStep);
    localStorage.setItem(WIZARD_PROGRESS_STORAGE_KEY, JSON.stringify({ sessionId: updatedConfig.sessionId, step: nextStep }));
  };

  const handleBack = () => {
    const previousStep = Math.max(step - 1, 0);
    setStep(previousStep);
    if (previousStep === 0) {
      localStorage.removeItem(WIZARD_PROGRESS_STORAGE_KEY);
    } else if (wizardConfig.sessionId) {
      localStorage.setItem(WIZARD_PROGRESS_STORAGE_KEY, JSON.stringify({ sessionId: wizardConfig.sessionId, step: previousStep }));
    }
  };

  if (isResuming) {
    return <div className="alignment-workspace flex min-h-[60vh] items-center justify-center"><p className="text-sm font-medium text-gray-500">Memulihkan alignment terakhir...</p></div>;
  }

  return (
    <div className="alignment-workspace">
      <div className="alignment-shell flex flex-col gap-5">
        {saveError && (
          <div role="alert" className="mx-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm md:mx-6 xl:mx-8">
            {saveError}
          </div>
        )}
        
        {step > 0 && (
          <section className="alignment-progress" aria-label="Alignment progress">
            <div className="flex flex-col gap-4 border-b border-gray-100 pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-4">
                  <p className="alignment-eyebrow">Pipeline alignment</p>
                  <button 
                    onClick={() => {
                      if (window.confirm("Are you sure you want to abandon this session and start a new run?")) {
                        localStorage.removeItem(WIZARD_PROGRESS_STORAGE_KEY);
                        setStep(0);
                        setWizardConfig({});
                      }
                    }} 
                    className="text-xs text-red-500 hover:text-red-700 font-semibold underline transition-colors"
                    title="Clear current progress and start a new alignment run"
                  >
                    Start New Run
                  </button>
                </div>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">{stepsList[step]?.name}</h1>
                <p className="mt-1 text-sm text-gray-500">{stepsList[step]?.desc} · Review each decision before continuing.</p>
              </div>
              <div className="alignment-progress-value">
                <span>Step {step + 1} of {stepsList.length}</span>
                <strong>{Math.round((step / (stepsList.length - 1)) * 100)}%</strong>
              </div>
            </div>

            <ol className="alignment-stepper">
              {stepsList.map((s, index) => {
                const isComplete = index < step;
                const isCurrent = index === step;
                return (
                  <li key={s.id} className={isCurrent ? 'is-current' : isComplete ? 'is-complete' : ''}>
                    <span className="alignment-stepper-index">{isComplete ? '✓' : index + 1}</span>
                    <span className="alignment-stepper-copy">
                      <strong>{s.name}</strong>
                      <small>{s.desc}</small>
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {/* Wizard Steps Rendering */}
        <div className="alignment-content w-full">
          {stepsList[step]?.id === 'upload' && (
            <StepUploadILI onNext={handleNext} />
          )}

          {stepsList[step]?.id === 'tiein' && <StepTieInConfig onNext={handleNext} onBack={handleBack} config={wizardConfig} />}

          {stepsList[step]?.id === 'summary' && <StepDataSummary onNext={handleNext} onBack={handleBack} config={wizardConfig} />}
          
          {stepsList[step]?.id === 'gw' && <StepGwSimulator initialOta={wizardConfig.ota || 1.5} onNext={handleNext} onBack={handleBack} config={wizardConfig} />}

          {stepsList[step]?.id === 'scenario' && <StepScenarioFilter onNext={handleNext} onBack={handleBack} config={wizardConfig} />}

          {stepsList[step]?.id === 'anomaly' && <StepAnomalyTolerances onNext={handleNext} onBack={handleBack} config={wizardConfig} />}

          {stepsList[step]?.id === 'exec' && <StepExecution onBack={handleBack} config={wizardConfig} />}
          
        </div>
      </div>
    </div>
  );
}
