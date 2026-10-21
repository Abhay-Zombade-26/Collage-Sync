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
    <div className="grid grid-cols-[13rem_1fr] gap-6 items-start">
      {/* Step rail */}
      <ol className="space-y-1">
        {WIZARD_STEPS.map((step) => {
          const isActive = step.id === currentStep;
          const isDone = step.id < currentStep;
          return (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => setCurrentStep(step.id)}
                className={`w-full text-left rounded px-3 py-2 transition-colors duration-75 ${
                  isActive
                    ? 'bg-accent/10 border border-accent/30'
                    : 'border border-transparent hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${
                      isActive
                        ? 'bg-accent text-white'
                        : isDone
                          ? 'bg-slate-200 text-slate-600'
                          : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {isDone ? '✓' : step.id}
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      isActive ? 'text-accent' : isDone ? 'text-slate-700' : 'text-slate-400'
                    }`}
                  >
                    {step.title}
                  </span>
                </span>
                <span className="block mt-0.5 pl-7 text-[10px] text-slate-400 leading-tight">
                  {step.description}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Step body */}
      <div className="bg-surface border border-slate-200 rounded p-5 min-h-[24rem]">
        {currentStep === 1 && <Step1 />}
        {currentStep === 2 && <Step2 />}
        {currentStep === 3 && <Step3 />}
        {currentStep === 4 && <Step4 />}
        {currentStep === 5 && <Step5 onGenerateComplete={onGenerateComplete} />}
        {currentStep > totalSteps && <p className="text-sm text-slate-500">All steps complete.</p>}
      </div>
    </div>
  );
};
