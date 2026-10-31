import React from 'react';
import { WIZARD_STEPS, useWizard } from './WizardContext';
import { Step1 } from './Step1';
import { Step2 } from './Step2';
import { Step3 } from './Step3';
import { Step4 } from './Step4';
import { Step5 } from './Step5';

export interface WizardLayoutProps {
  onGenerateComplete: () => void;
}

/**
 * Four-step wizard shell: term settings -> division -> allocation -> generate.
 */
export const WizardLayout: React.FC<WizardLayoutProps> = ({ onGenerateComplete }) => {
  const { currentStep, totalSteps, setCurrentStep } = useWizard();

  return (
    <div className="grid grid-cols-[14rem_1fr] gap-6 items-start spring-in">
      {/* Step rail */}
      <ol className="space-y-1.5 spotlight-card p-2 border-border">
        {WIZARD_STEPS.map((step) => {
          const isActive = step.id === currentStep;
          const isDone = step.id < currentStep;
          return (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => setCurrentStep(step.id)}
                className={`w-full text-left rounded-lg px-3 py-2.5 transition-all duration-150 ${
                  isActive
                    ? 'bg-blue-600/10 dark:bg-blue-500/15 border border-blue-500/30 shadow-xs'
                    : 'border border-transparent hover:bg-blue-50/50 dark:hover:bg-blue-950/30'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-mono font-semibold shrink-0 transition-all ${
                      isActive
                        ? 'bg-blue-600 text-white shadow-xs ring-2 ring-blue-500/30'
                        : isDone
                          ? 'bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800/60'
                          : 'bg-surface text-slate-400 dark:text-slate-500 border border-border'
                    }`}
                  >
                    {isDone ? '✓' : step.id}
                  </span>
                  <span
                    className={`text-xs font-semibold tracking-tight transition-colors ${
                      isActive
                        ? 'text-blue-600 dark:text-blue-400'
                        : isDone
                          ? 'text-slate-800 dark:text-slate-200'
                          : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {step.title}
                  </span>
                </span>
                <span className="block mt-1 pl-8 text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
                  {step.description}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Step body */}
      <div className="spotlight-card p-6 min-h-[26rem] border-border shadow-sm">
        {currentStep === 1 && <Step1 />}
        {currentStep === 2 && <Step2 />}
        {currentStep === 3 && <Step3 />}
        {currentStep === 4 && <Step4 />}
        {currentStep === 5 && <Step5 onGenerateComplete={onGenerateComplete} />}
        {currentStep > totalSteps && (
          <p className="text-sm text-slate-500 dark:text-slate-400">All steps complete.</p>
        )}
      </div>
    </div>
  );
};
