import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../components/ui/useToast';
import { apiClient } from '../../api/client';
import { useWizard, type Subject, type Division } from './WizardContext';

/** Per-subject period counts edited in this step. */
interface Draft {
  /** Map of division ID to the persisted weekly_requirements row ID, if it exists yet. */
  requirementIds: Record<number, number>;
  // Admin enters weekly periods directly.
  theory_periods_per_week: number;
  practical_sessions_per_week: number; // 1 session = 2 consecutive periods
  tutorial_periods_per_week: number;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const defaultDraft = (subject: Subject): Draft => ({
  requirementIds: {},
  ...(subject.subject_type === 'LAB'
    ? {
        theory_periods_per_week: 0,
        practical_sessions_per_week: 1,
        tutorial_periods_per_week: 0,
      }
    : {
        theory_periods_per_week: 3,
        practical_sessions_per_week: 0,
        tutorial_periods_per_week: 0,
      }),
});

/** Human-readable labels for academic year codes. */
const YEAR_LABELS: Record<string, string> = {
  FE: 'First Year (FE)',
  SE: 'Second Year (SE)',
  TE: 'Third Year (TE)',
  BE: 'Fourth Year (BE)',
};

/** How long to wait after the last edit before persisting. */
const AUTOSAVE_DELAY_MS = 600;

/**
 * Step 3 — weekly requirements.
 *
 * The solver reads the weekly period quota per subject from this table, so
 * it has to exist before generation can produce anything. Changes are
 * auto-saved (debounced) as the admin edits them, or explicitly persisted when
 * clicking "Save & Continue".
 *
 * Subjects are grouped by year and saved to ALL divisions within each year.
 */
export const Step3: React.FC = () => {
  const {
    selectedYears,
    selectedDivisionIds,
    selectedBranchId,
    settings,
    periodsPerDay,
    updateState,
    nextStep,
    prevStep,
  } = useWizard();
  const { showToast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [statuses, setStatuses] = useState<Record<number, SaveStatus>>({});
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);

  // Persistent lookup map: `${subjectId}-${divisionId}` -> requirementId
  const requirementMapRef = useRef<Record<string, number>>({});

  // One debounce timer per subject, so editing two subjects does not cancel
  // each other's pending save.
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    let mounted = true;
    if (!selectedYears || selectedYears.length === 0) {
      setIsLoading(false);
      return;
    }

    const loadRequirements = async () => {
      setIsLoading(true);
      try {
        const [subjectsRes, divisionsRes, reqRes] = await Promise.all([
          apiClient.GET('/api/subjects'),
          apiClient.GET('/api/divisions'),
          apiClient.GET('/api/weekly-requirement'),
        ]);
        if (!mounted) {
          return;
        }

        const allSubjects = subjectsRes.data ?? [];
        const allDivisions = divisionsRes.data ?? [];
        const allRequirements = reqRes.data ?? [];

        // Determine effective branch ID from WizardContext or selected divisions
        const effectiveBranchId =
          selectedBranchId ??
          allDivisions.find((d) => selectedDivisionIds?.includes(d.id))?.branch_id ??
          (allDivisions.length > 0 ? allDivisions[0].branch_id : null);

        // Filter subjects for selected branch and selected years
        const filteredSubjects = allSubjects.filter((subject) => {
          const matchesYear = subject.year && selectedYears.includes(subject.year);
          const matchesBranch = effectiveBranchId !== null
            ? subject.branch_id === effectiveBranchId || subject.branch_id === null
            : true;
          return matchesYear && matchesBranch;
        });

        // Filter divisions for selected branch and selected years
        const filteredDivisions = allDivisions.filter((division) => {
          const matchesYear = selectedYears.includes(division.year);
          const matchesBranch = effectiveBranchId !== null
            ? division.branch_id === effectiveBranchId
            : true;
          return matchesYear && matchesBranch;
        });

        // Populate lookup map of (subject_id, division_id) -> requirement.id
        requirementMapRef.current = {};
        allRequirements.forEach((req) => {
          requirementMapRef.current[`${req.subject_id}-${req.division_id}`] = req.id;
        });

        // Pre-fill drafts from existing requirements, keeping requirement IDs
        // per division so edits are patched rather than re-created.
        const nextDrafts: Record<number, Draft> = {};
        filteredSubjects.forEach((subject) => {
          const isLab = subject.subject_type === 'LAB';

          // Find ALL existing requirements for this subject across divisions
          const matchingRequirements = allRequirements.filter(
            (req) => req.subject_id === subject.id
          );

          // Build the requirementIds map: division_id -> requirement.id
          const requirementIds: Record<number, number> = {};
          matchingRequirements.forEach((req) => {
            requirementIds[req.division_id] = req.id;
          });

          // Use the first matching requirement to pre-fill the periods
          const existingRequirement = matchingRequirements.length > 0
            ? matchingRequirements[0]
            : null;

          nextDrafts[subject.id] = existingRequirement
            ? {
                requirementIds,
                theory_periods_per_week: isLab
                  ? 0
                  : existingRequirement.theory_periods_per_week,
                practical_sessions_per_week: isLab
                  ? existingRequirement.practical_sessions_per_week
                  : 0,
                tutorial_periods_per_week:
                  existingRequirement.tutorial_periods_per_week,
              }
            : defaultDraft(subject);
        });

        setSubjects(filteredSubjects);
        setDivisions(filteredDivisions);
        setDrafts(nextDrafts);
      } catch (_err: unknown) {
        if (mounted) {
          showToast({
            type: 'error',
            title: 'Requirements Unavailable',
            message: 'Could not load subjects for selected years.',
          });
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    loadRequirements();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYears.join(','), selectedBranchId]);

  // Clear any pending timers when the step unmounts.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      Object.values(pending).forEach((timer) => clearTimeout(timer));
    };
  }, []);

  /** Group subjects by year, preserving the order of selectedYears. */
  const subjectsByYear = useMemo(() => {
    const groups: Record<string, Subject[]> = {};
    for (const year of selectedYears) {
      groups[year] = subjects.filter((s) => s.year === year);
    }
    return groups;
  }, [subjects, selectedYears]);

  /** Get divisions for a specific year. */
  const getDivisionsForYear = (year: string): Division[] => {
    return divisions.filter((d) => d.year === year);
  };

  /** Persist one subject's requirement (create or update) for ALL divisions of that year. */
  const persist = async (subject: Subject, draft: Draft) => {
    const isLab = subject.subject_type === 'LAB';
    const theoryWeekly = isLab ? 0 : draft.theory_periods_per_week;
    const tutorialWeekly = draft.tutorial_periods_per_week;
    const practicalWeekly = isLab ? draft.practical_sessions_per_week : 0;

    setStatuses((current) => ({ ...current, [subject.id]: 'saving' }));
    try {
      // Find all divisions for the subject's year
      const subjectDivisions = getDivisionsForYear(subject.year ?? '');

      for (const division of subjectDivisions) {
        const key = `${subject.id}-${division.id}`;
        const existingReqId = requirementMapRef.current[key] ?? draft.requirementIds[division.id];

        if (existingReqId) {
          // Update existing requirement
          const { error } = await apiClient.PATCH('/api/weekly-requirement/{requirement_id}', {
            params: { path: { requirement_id: existingReqId } },
            body: {
              theory_periods_per_week: theoryWeekly,
              practical_sessions_per_week: practicalWeekly,
              tutorial_periods_per_week: tutorialWeekly,
            },
          });
          if (error) {
            throw new Error(`update failed for division ${division.id}`);
          }
        } else {
          // Create new requirement
          const { data, error, response } = await apiClient.POST('/api/weekly-requirement', {
            body: {
              division_id: division.id,
              subject_id: subject.id,
              theory_periods_per_week: theoryWeekly,
              practical_sessions_per_week: practicalWeekly,
              tutorial_periods_per_week: tutorialWeekly,
            },
          });

          if (error || !data) {
            // Handle 409 conflict: requirement already exists in DB
            if (response?.status === 409) {
              const { data: latestReqs } = await apiClient.GET('/api/weekly-requirement');
              const found = (latestReqs ?? []).find(
                (r) => r.subject_id === subject.id && r.division_id === division.id
              );
              if (found) {
                requirementMapRef.current[key] = found.id;
                await apiClient.PATCH('/api/weekly-requirement/{requirement_id}', {
                  params: { path: { requirement_id: found.id } },
                  body: {
                    theory_periods_per_week: theoryWeekly,
                    practical_sessions_per_week: practicalWeekly,
                    tutorial_periods_per_week: tutorialWeekly,
                  },
                });
                continue;
              }
            }
            throw new Error(`create failed for division ${division.id}`);
          }

          requirementMapRef.current[key] = data.id;
          setDrafts((current) => {
            const existing = current[subject.id] ?? defaultDraft(subject);
            return {
              ...current,
              [subject.id]: {
                ...existing,
                requirementIds: {
                  ...existing.requirementIds,
                  [division.id]: data.id,
                },
              },
            };
          });
        }
      }
      setStatuses((current) => ({ ...current, [subject.id]: 'saved' }));
    } catch (_err: unknown) {
      setStatuses((current) => ({ ...current, [subject.id]: 'error' }));
      showToast({
        type: 'error',
        title: 'Save Failed',
        message: `Could not save the requirement for ${subject.name}.`,
      });
    }
  };

  /** Update the local state immediately and schedule a debounced save. */
  const updateDraft = (subject: Subject, field: keyof Draft, value: number) => {
    const safeValue = Number.isNaN(value) ? 0 : Math.max(0, value);
    setDrafts((current) => {
      const existing = current[subject.id] ?? defaultDraft(subject);
      return {
        ...current,
        [subject.id]: { ...existing, [field]: safeValue },
      };
    });
    setStatuses((current) => ({ ...current, [subject.id]: 'saving' }));

    // Reset the debounce timer for this subject.
    const pending = timers.current;
    if (pending[subject.id]) {
      clearTimeout(pending[subject.id]);
    }
    pending[subject.id] = setTimeout(() => {
      delete pending[subject.id];
      setDrafts((current) => {
        const draft = current[subject.id];
        if (draft) {
          void persist(subject, draft);
        }
        return current;
      });
    }, AUTOSAVE_DELAY_MS);
  };

  const hasAnyPeriods = useMemo(
    () =>
      Object.values(drafts).some(
        (draft) =>
          draft.theory_periods_per_week > 0 ||
          draft.practical_sessions_per_week > 0 ||
          draft.tutorial_periods_per_week > 0
      ),
    [drafts]
  );

  const schoolDaysCount = settings?.school_days?.length || 5;
  const dailyTeachingPeriods = periodsPerDay || settings?.periods_per_day || 7;
  const weeklyMaxPeriods = dailyTeachingPeriods * schoolDaysCount;

  // Calculate total weekly periods grouped by academic year
  const yearCalculatedPeriods = useMemo(() => {
    const result: Record<string, number> = {};
    for (const year of selectedYears) {
      const yearSubjs = subjects.filter((s) => s.year === year);
      result[year] = yearSubjs.reduce((sum, subject) => {
        const draft = drafts[subject.id];
        if (!draft) return sum;
        const isLab = subject.subject_type === 'LAB';
        const theory = isLab ? 0 : draft.theory_periods_per_week;
        // 1 practical session = 2 periods
        const practical = isLab ? draft.practical_sessions_per_week * 2 : 0;
        const tutorial = draft.tutorial_periods_per_week;
        return sum + theory + practical + tutorial;
      }, 0);
    }
    return result;
  }, [drafts, subjects, selectedYears]);

  // Check if any year exceeds the weekly capacity
  const exceedingYears = useMemo(() => {
    return Object.entries(yearCalculatedPeriods)
      .filter(([_, periods]) => periods > weeklyMaxPeriods)
      .map(([year]) => year);
  }, [yearCalculatedPeriods, weeklyMaxPeriods]);

  const hasCapacityExceeded = exceedingYears.length > 0;

  const handleContinue = async () => {
    if (!selectedDivisionIds || selectedDivisionIds.length === 0) {
      showToast({
        type: 'error',
        title: 'No Divisions Selected',
        message: 'No divisions selected. Please go back to Step 2.',
      });
      return;
    }
    if (!hasAnyPeriods) {
      showToast({
        type: 'error',
        title: 'No Periods Set',
        message: 'Set at least one period for a subject before continuing.',
      });
      return;
    }
    if (hasCapacityExceeded) {
      showToast({
        type: 'error',
        title: 'Weekly Capacity Exceeded',
        message: `Total weekly periods for ${exceedingYears.join(', ')} exceed maximum capacity (${weeklyMaxPeriods}). Please reduce the periods.`,
      });
      return;
    }

    setIsSavingAll(true);
    try {
      // Clear pending debounce timers
      const pending = timers.current;
      Object.values(pending).forEach((timer) => clearTimeout(timer));
      timers.current = {};

      // Explicitly save all requirements for all subjects across all divisions of their years
      for (const subject of subjects) {
        const draft = drafts[subject.id] ?? defaultDraft(subject);
        await persist(subject, draft);
      }

      // Keep the wizard state in sync for the allocation step.
      const { data: refreshed } = await apiClient.GET('/api/weekly-requirement');
      updateState({
        requirements: (refreshed ?? []).filter(
          (requirement) => selectedDivisionIds.includes(requirement.division_id)
        ),
      });

      nextStep();
    } catch (_err: unknown) {
      showToast({
        type: 'error',
        title: 'Save Failed',
        message: 'Failed to save all requirements before proceeding.',
      });
    } finally {
      setIsSavingAll(false);
    }
  };

  const statusLabel = (subjectId: number) => {
    const status = statuses[subjectId] ?? 'idle';
    if (status === 'saving') {
      return <span className="text-[11px] text-slate-400">Saving…</span>;
    }
    if (status === 'saved') {
      return <span className="text-[11px] text-green-600 font-medium">Saved ✓</span>;
    }
    if (status === 'error') {
      return <span className="text-[11px] text-danger font-medium">Save failed</span>;
    }
    return <span className="text-[11px] text-slate-300">Auto-saved</span>;
  };

  /** A compact -/+ stepper around a number input. */
  const renderStepper = (
    subject: Subject,
    field: keyof Draft,
    label: string,
    max: number,
    isDisabled = false
  ) => {
    const draft = drafts[subject.id] ?? defaultDraft(subject);
    const value = isDisabled ? 0 : draft[field];
    return (
      <div className={`flex items-center justify-center gap-1 ${isDisabled ? 'opacity-40' : ''}`}>
        <button
          type="button"
          onClick={() => updateDraft(subject, field, value - 1)}
          disabled={isDisabled || value <= 0}
          aria-label={`Decrease ${label} for ${subject.name}`}
          className="w-6 h-6 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          −
        </button>
        <Input
          type="number"
          min={0}
          max={max}
          value={value}
          onChange={(event) => updateDraft(subject, field, Number(event.target.value))}
          disabled={isDisabled}
          className={`h-8 w-14 text-xs text-center ${isDisabled ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : ''}`}
          aria-label={`${label} for ${subject.name}`}
        />
        <button
          type="button"
          onClick={() => updateDraft(subject, field, value + 1)}
          disabled={isDisabled || value >= max}
          aria-label={`Increase ${label} for ${subject.name}`}
          className="w-6 h-6 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          +
        </button>
      </div>
    );
  };

  /** Render a single subject row inside the table. */
  const renderSubjectRow = (subject: Subject) => {
    const isLab = subject.subject_type === 'LAB';
    return (
      <TableRow key={subject.id}>
        <TableCell isCode>{subject.code}</TableCell>
        <TableCell>{subject.name}</TableCell>
        <TableCell>
          <Badge
            size="sm"
            className={
              isLab
                ? 'bg-purple-50 text-purple-700 border border-purple-200 font-semibold'
                : 'bg-blue-50 text-blue-700 border border-blue-200 font-semibold'
            }
          >
            {subject.subject_type}
          </Badge>
        </TableCell>
        <TableCell>
          {renderStepper(subject, 'theory_periods_per_week', 'Theory periods per week', 6, isLab)}
        </TableCell>
        <TableCell>
          {renderStepper(
            subject,
            'practical_sessions_per_week',
            'Practical sessions per week',
            3,
            !isLab
          )}
        </TableCell>
        <TableCell>
          {renderStepper(subject, 'tutorial_periods_per_week', 'Tutorial periods per week', 2)}
        </TableCell>
        <TableCell className="text-right">{statusLabel(subject.id)}</TableCell>
      </TableRow>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display font-bold text-base text-slate-900">Weekly Requirements</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Enter the weekly periods exactly as calculated. 1 Practical Session = 2 consecutive periods.
          Requirements will be applied to all divisions in each academic year.
        </p>
      </div>

      {/* Teaching Capacity Limit Banner */}
      <div className="flex flex-wrap items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs gap-3">
        <div className="flex items-center gap-2 text-slate-700">
          <span className="font-semibold text-slate-900">Teaching Capacity:</span>
          <span>{dailyTeachingPeriods} periods/day × {schoolDaysCount} school days =</span>
          <span className="font-bold text-slate-900 bg-white border border-slate-200 px-2 py-0.5 rounded shadow-2xs">
            {weeklyMaxPeriods} max periods/week per division
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {selectedYears.map((year) => {
            const periods = yearCalculatedPeriods[year] ?? 0;
            const isExceeded = periods > weeklyMaxPeriods;
            return (
              <div key={year} className="flex items-center gap-1.5">
                <span className="text-slate-600 font-medium">{year}:</span>
                <span
                  className={`font-bold px-2 py-0.5 rounded text-xs ${
                    isExceeded
                      ? 'bg-red-100 text-red-700 border border-red-300'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  }`}
                >
                  {periods} / {weeklyMaxPeriods} periods
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Red error banner when capacity is exceeded */}
      {hasCapacityExceeded && (
        <div className="p-3.5 bg-red-50 border-2 border-red-400 rounded-lg text-sm text-red-800 font-semibold flex items-center gap-2">
          <span className="text-red-600 text-lg">⚠️</span>
          Total weekly periods for {exceedingYears.join(', ')} exceed maximum capacity ({weeklyMaxPeriods}). Please reduce the periods.
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-6">
          <LoadingSpinner size="md" />
          <span>Loading subjects...</span>
        </div>
      ) : subjects.length === 0 ? (
        <div className="border border-amber-300 bg-amber-50 rounded p-3 text-xs text-amber-800">
          No subjects exist for the selected years ({selectedYears.join(', ')}). Create them on the Subjects page first.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="w-44 text-center">Theory Periods / Wk</TableHead>
              <TableHead className="w-44 text-center">Practical Sessions / Wk</TableHead>
              <TableHead className="w-44 text-center">Tutorial Periods / Wk</TableHead>
              <TableHead className="w-24 text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {selectedYears.map((year) => {
              const yearSubjects = subjectsByYear[year] ?? [];
              const yearDivisions = getDivisionsForYear(year);
              const yearPeriods = yearCalculatedPeriods[year] ?? 0;
              const isExceeded = yearPeriods > weeklyMaxPeriods;

              return (
                <React.Fragment key={year}>
                  {/* Visually distinct header row for each year */}
                  <tr className="bg-slate-800 text-white">
                    <td
                      colSpan={7}
                      className="bg-slate-800 text-white text-xs font-bold tracking-wide px-4 py-2.5 border-y border-slate-700"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold tracking-wide">
                            {YEAR_LABELS[year] ?? `${year} Subjects`}
                          </span>
                          <span
                            className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                              isExceeded
                                ? 'bg-red-500 text-white'
                                : 'bg-slate-700 text-slate-200'
                            }`}
                          >
                            {yearPeriods} / {weeklyMaxPeriods} periods/wk
                          </span>
                        </div>
                        <span className="text-slate-300 font-normal text-[11px]">
                          {yearSubjects.length} subject{yearSubjects.length === 1 ? '' : 's'} · {yearDivisions.length} division{yearDivisions.length === 1 ? '' : 's'} ({yearDivisions.map((d) => d.name).join(', ') || 'none'})
                        </span>
                      </div>
                    </td>
                  </tr>

                  {yearSubjects.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-4 text-xs text-slate-400 bg-slate-50/50">
                        No subjects configured for {year}.
                      </td>
                    </tr>
                  ) : (
                    yearSubjects.map((subject) => renderSubjectRow(subject))
                  )}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}

      <div className="flex justify-between pt-1">
        <Button type="button" variant="secondary" size="md" onClick={prevStep}>
          Back
        </Button>
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={handleContinue}
          disabled={subjects.length === 0 || hasCapacityExceeded || isSavingAll}
        >
          {isSavingAll ? 'Saving...' : 'Save & Continue'}
        </Button>
      </div>
    </div>
  );
};