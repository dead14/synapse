import React, { useState, useEffect } from 'react';
import StepDataSummary from './wizard/StepDataSummary';
import StepScenarioFilter from './wizard/StepScenarioFilter';
import StepGwSimulator from './wizard/StepGwSimulator';
import StepAnomalyTolerances from './wizard/StepAnomalyTolerances';
import StepExecution from './wizard/StepExecution';
import StepUploadILI from './wizard/StepUploadILI';
import StepTieInConfig from './wizard/StepTieInConfig';
import { apiFetch, ApiError } from './utils/api';

export default function AlignmentPage() {
  const [step, setStep] = useState(0); // 0 is Upload step
  const [wizardConfig, setWizardConfig] = useState<any>({});
  const [, setIsResuming] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    // Start fresh every time — no resume prompt, no empty session creation
    setIsResuming(false);
  }, []);

  const baseSteps = [
    { id: 'upload', name: 'Upload', desc: 'Validate' },
    { id: 'tiein', name: 'Tie-In Config', desc: 'Offset Calc', conditional: true },
    { id: 'summary', name: 'Data Summary', desc: 'Overview' },
    { id: 'gw', name: 'GW Matching', desc: 'Simulator' },
    { id: 'scenario', name: 'Scenario Filter', desc: 'Thresholds' },
    { id: 'anomaly', name: 'Anomaly Tolerances', desc: 'Matcher' },
    { id: 'exec', name: 'Execution', desc: 'Report Gen' }
  ];

  const stepsList = baseSteps.filter(s => !s.conditional || (s.id === 'tiein' && wizardConfig.enablePartialRun));
  
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
    setStep(s => Math.min(s + 1, stepsList.length - 1));
  };

  const handleBack = () => {
    setStep(s => Math.max(s - 1, 0));
  };

  return (
    <div className="min-h-screen bg-[#f8f9fc] flex flex-col items-center pt-8 pb-20">
      <div className="w-full flex flex-col gap-6">
        {saveError && (
          <div role="alert" className="mx-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm md:mx-6 xl:mx-8">
            {saveError}
          </div>
        )}
        
        {/* Alignment Progress Bar (Matches Screenshot 2) */}
        {step > 0 && (
        <div className="bg-white p-8 shadow-sm border-y border-gray-100 flex justify-between items-center relative overflow-hidden">
          <div className="relative z-10 w-full">
            <div className="flex justify-between items-end mb-8">
               <div>
                 <h2 className="text-2xl font-bold text-gray-800 mb-1">Alignment Progress</h2>
                 <p className="text-gray-500 text-sm">Executing multi-step sequential matching algorithm</p>
               </div>
               <div className="text-5xl font-black text-brand-500 tracking-tighter">
                  {Math.round((step / (stepsList.length - 1)) * 100)}%
               </div>
            </div>

            {/* Stepper Line */}
            <div className="relative flex justify-between items-start w-full px-6 mt-4">
              <div className="absolute top-[6px] left-6 right-6 h-[1px] bg-gray-200 -z-10"></div>
              
              {stepsList.map((s, index) => (
                <div key={s.id} className="flex flex-col items-center gap-3 w-32">
                  <div className={`w-3 h-3 rounded-full transition-all duration-300 shrink-0 ${
                    step >= index ? 'bg-brand-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]' : 'bg-gray-300'
                  }`} />
                  <div className="text-center mt-1">
                    <p className={`text-xs font-semibold whitespace-nowrap transition-colors ${step >= index ? 'text-gray-800' : 'text-gray-500'}`}>
                      {s.name}
                    </p>
                    <p className="text-[10px] text-gray-500">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        )}

        {/* Wizard Steps Rendering */}
        <div className="w-full mt-4">
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
