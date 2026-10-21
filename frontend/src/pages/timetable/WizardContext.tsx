import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import type { components } from '../../api/schema';

export type Division = components['schemas']['DivisionRead'];
export type Subject = components['schemas']['SubjectRead'];
export type Teacher = components['schemas']['TeacherRead'];
export type Room = components['schemas']['RoomRead'];
export type Batch = components['schemas']['BatchRead'];
export type Eligibility = components['schemas']['EligibilityRead'];
export type WeeklyRequirement = components['schemas']['WeeklyRequirementRead'];
export type TimetableSettings = components['schemas']['TimetableSettingsRead'];
export type TimetableSlot = components['schemas']['TimetableSlotRead'];
export type DayOfWeek = components['schemas']['DayOfWeek'];

/** Academic years a division can belong to. */
export const ACADEMIC_YEARS = [
  { value: 'FE', label: 'FE (First Year)' },
  { value: 'SE', label: 'SE (Second Year)' },
  { value: 'TE', label: 'TE (Third Year)' },
  { value: 'BE', label: 'BE (Fourth Year)' },
] as const;

export type AcademicYear = (typeof ACADEMIC_YEARS)[number]['value'];

/** Wizard steps, in order. */
export const WIZARD_STEPS = [
  { id: 1, title: 'Term Settings', description: 'Academic year, semester and daily timings' },
  { id: 2, title: 'Division', description: 'Pick the division to generate for' },
  {
    id: 3,
    title: 'Weekly Requirements',
    description: 'Set the periods per week for each subject',
  },
  { id: 4, title: 'Allocation', description: 'Subjects, teachers and rooms' },
  { id: 5, title: 'Generate', description: 'Run the solver and review the grid' },
] as const;

export interface WizardState {
  // Step 1
  academicYear: AcademicYear;
  semester: number;
  // Step 2
  divisionId: number | null;
  // Step 3
  subjects: Subject[];
  teachers: Teacher[];
  rooms: Room[];
  batches: Batch[];
  eligibilities: Eligibility[];
  requirements: WeeklyRequirement[];
  settings: TimetableSettings | null;
  // Step 4
  slots: TimetableSlot[];
  isGenerating: boolean;
}

export interface WizardContextValue extends WizardState {
  currentStep: number;
  totalSteps: number;
  setCurrentStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  updateState: (patch: Partial<WizardState>) => void;
  setSlots: (slots: TimetableSlot[]) => void;
  setIsGenerating: (isGenerating: boolean) => void;
  reset: () => void;
}

const initialState: WizardState = {
  academicYear: 'SE',
  semester: 3,
  divisionId: null,
  subjects: [],
  teachers: [],
  rooms: [],
  batches: [],
  eligibilities: [],
  requirements: [],
  settings: null,
  slots: [],
  isGenerating: false,
};

const WizardContext = createContext<WizardContextValue | null>(null);

export const WizardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<WizardState>(initialState);
  const [currentStep, setCurrentStep] = useState(1);

  const updateState = useCallback((patch: Partial<WizardState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const nextStep = useCallback(() => {
    setCurrentStep((step) => Math.min(step + 1, WIZARD_STEPS.length));
  }, []);

  const prevStep = useCallback(() => {
    setCurrentStep((step) => Math.max(step - 1, 1));
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
    setCurrentStep(1);
  }, []);

  const value = useMemo<WizardContextValue>(
    () => ({
      ...state,
      currentStep,
      totalSteps: WIZARD_STEPS.length,
      setCurrentStep,
      nextStep,
      prevStep,
      updateState,
      setSlots: (slots: TimetableSlot[]) => updateState({ slots }),
      setIsGenerating: (isGenerating: boolean) => updateState({ isGenerating }),
      reset,
    }),
    [state, currentStep, nextStep, prevStep, updateState, reset]
  );

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
};

export const useWizard = (): WizardContextValue => {
  const context = useContext(WizardContext);
  if (!context) {
    throw new Error('useWizard must be used within a WizardProvider');
  }
  return context;
};
