import React, { useState, useEffect } from 'react';
import StepDataSummary from './wizard/StepDataSummary';
import StepScenarioFilter from './wizard/StepScenarioFilter';
import StepGwSimulator from './wizard/StepGwSimulator';
import StepAnomalyTolerances from './wizard/StepAnomalyTolerances';
import StepExecution from './wizard/StepExecution';
import StepUploadILI from './wizard/StepUploadILI';
import StepTieInConfig from './wizard/StepTieInConfig';
import StepMatchingSections from './wizard/StepMatchingSections';
import { apiFetch, ApiError } from './utils/api';
import ConfirmDialog from './components/common/ConfirmDialog';
import './styles/alignment-review.css';

const WIZARD_PROGRESS_STORAGE_KEY = 'synapse_alignment_wizard_progress';

const baseSteps = [
  { id: 'upload', name: 'Inspection data', desc: 'Import & validate' },
  { id: 'tiein', name: 'Tie-in setup', desc: 'Calculate offset', conditional: true },
  { id: 'summary', name: 'Data review', desc: 'Check extraction' },
  { id: 'gw', name: 'GW matching', desc: 'Review alignment' },
  { id: 'sections', name: 'Sectioning', desc: 'Define reference' },
  { id: 'scenario', name: 'Feature rules', desc: 'Set thresholds' },
  { id: 'anomaly', name: 'Tolerances', desc: 'Tune matcher' },
  { id: 'exec', name: 'Execution', desc: 'Run & report' },
];

const visibleSteps = (config: any) => baseSteps.filter((item) => {
  if (config?.algorithm === 'manual') return ['upload', 'exec'].includes(item.id);
  if (item.conditional && item.id === 'tiein' && !config?.enablePartialRun) return false;
  return true;
});

export default function AlignmentPage() {
  const [step, setStep] = useState(0); // 0 is Upload step
  const [wizardConfig, setWizardConfig] = useState<any>({});
  const [isResuming, setIsResuming] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const saveErrorRef = React.useRef<HTMLDivElement>(null);

  // The wizard footer sits far below the fold, so a save rejection used to look
  // like a dead button: the banner rendered at the top of a scrolled-away page.
  useEffect(() => {
    if (saveError) saveErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [saveError]);

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

        const session = await apiFetch<{ config?: any; sessionId?: string | number; status?: string; sessionRevision?: string }>(
          `/api/wizard/session/${encodeURIComponent(String(parsed.sessionId))}`,
        );
        if (!active || !session.config || !session.sessionId) return;

        const restoredConfig = { ...session.config, sessionId: session.sessionId, sessionRevision: session.sessionRevision, sessionStatus: session.status };
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
  const currentStep = stepsList[step];
  const progress = stepsList.length > 1 ? Math.round((step / (stepsList.length - 1)) * 100) : 100;
  const runLabel = wizardConfig.sessionName
    || wizardConfig.summaryData?.newRun?.name
    || wizardConfig.summaryData?.masterRun?.name
    || 'Unsaved alignment run';
  
  const handleNext = async (data?: any) => {
    let updatedConfig = { ...wizardConfig };
    if (data && typeof data === 'object' && !('nativeEvent' in data)) {
      updatedConfig = { ...updatedConfig, ...data };
    }
    
    try {
      const resData = await apiFetch<{ success?: boolean; sessionId?: string | number; sessionRevision?: string }>('/api/wizard/save', {
        method: 'POST',
        body: JSON.stringify({
          config: updatedConfig,
          sessionId: updatedConfig.sessionId,
          sessionRevision: updatedConfig.sessionRevision,
        })
      });
      if (resData.success && resData.sessionId) {
        updatedConfig.sessionId = resData.sessionId;
        updatedConfig.sessionRevision = resData.sessionRevision;
        localStorage.setItem('synapse_last_session_id', String(resData.sessionId));
      } else {
        setSaveError('The server did not return an alignment session ID. Check the backend and try again.');
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
        ? `Failed to save the alignment session (${err.status}): ${err.message}`
        : 'Failed to save the alignment session. Make sure the backend and database are running.');
      return;
    }

    setSaveError(null);
    setWizardConfig(updatedConfig);
    const nextStep = Math.min(step + 1, visibleSteps(updatedConfig).length - 1);
    setStep(nextStep);
    localStorage.setItem(WIZARD_PROGRESS_STORAGE_KEY, JSON.stringify({ sessionId: updatedConfig.sessionId, step: nextStep }));
  };

  const handleBack = (data?: any) => {
    if (data && typeof data === 'object' && !('nativeEvent' in data)) {
      setWizardConfig((current: any) => ({ ...current, ...data }));
    }
    const previousStep = Math.max(step - 1, 0);
    setStep(previousStep);
    if (previousStep === 0) {
      localStorage.removeItem(WIZARD_PROGRESS_STORAGE_KEY);
    } else if (wizardConfig.sessionId) {
      localStorage.setItem(WIZARD_PROGRESS_STORAGE_KEY, JSON.stringify({ sessionId: wizardConfig.sessionId, step: previousStep }));
    }
  };

  if (isResuming) {
    return <div className="alignment-workspace flex min-h-[60vh] items-center justify-center"><p className="text-sm font-medium text-gray-500">Restoring your last alignment...</p></div>;
  }

  return (
    <div className={`alignment-workspace${currentStep?.id === 'gw' ? ' alignment-workspace--gw' : ''}`}>
      <div className="alignment-shell flex flex-col gap-5">
        {saveError && (
          <div
            ref={saveErrorRef}
            role="alert"
            className="sticky top-2 z-30 mx-4 flex items-start justify-between gap-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm md:mx-6 xl:mx-8"
          >
            <span>{saveError}</span>
            <button
              type="button"
              onClick={() => setSaveError(null)}
              aria-label="Dismiss error message"
              className="shrink-0 font-bold text-red-400 hover:text-red-700"
            >
              ×
            </button>
          </div>
        )}
        
        {step > 0 && (
          <section className="alignment-progress" aria-label="Alignment progress">
            <div className="alignment-progress-header">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="alignment-eyebrow">Alignment workspace</p>
                  <span className="alignment-run-label" title={runLabel}>{runLabel}</span>
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className="alignment-reset"
                    title="Clear current progress and start a new alignment run"
                  >
                    Start New Run
                  </button>
                </div>
                <h1 className="alignment-title">{currentStep?.name}</h1>
                <p className="alignment-subtitle">{currentStep?.desc}. Verify the engineering evidence before continuing.</p>
              </div>
              <div className="alignment-progress-value">
                <span>Stage {step + 1} / {stepsList.length}</span>
                <strong>{progress}%</strong>
              </div>
            </div>

            <div className="alignment-progress-track" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </div>
            <ol className="alignment-stepper">
              {stepsList.map((s, index) => {
                const isComplete = index < step;
                const isCurrent = index === step;
                return (
                  <li key={s.id} aria-current={isCurrent ? 'step' : undefined} className={isCurrent ? 'is-current' : isComplete ? 'is-complete' : ''}>
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

          {stepsList[step]?.id === 'sections' && <StepMatchingSections onNext={handleNext} onBack={handleBack} config={wizardConfig} />}

          {stepsList[step]?.id === 'scenario' && <StepScenarioFilter onNext={handleNext} onBack={handleBack} config={wizardConfig} />}

          {stepsList[step]?.id === 'anomaly' && <StepAnomalyTolerances onNext={handleNext} onBack={handleBack} config={wizardConfig} />}

          {stepsList[step]?.id === 'exec' && <StepExecution onBack={handleBack} config={wizardConfig} />}

        </div>
      </div>

      {showResetConfirm && (
        <ConfirmDialog
          title="Start a new run?"
          message="This abandons the current session and clears the wizard progress. Data already saved on the server is not deleted."
          confirmLabel="Start New Run"
          danger
          onConfirm={() => {
            localStorage.removeItem(WIZARD_PROGRESS_STORAGE_KEY);
            setStep(0);
            setWizardConfig({});
            setShowResetConfirm(false);
          }}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}
    </div>
  );
}
