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
import { useWizard, type Subject } from './WizardContext';

/** Per-subject period counts edited in this step. */
interface Draft {
  /** The id of the persisted weekly_requirements row, if it exists yet. */
  requirementId: number | null;
  theory_periods_per_week: number;
  practical_sessions_per_week: number;
  tutorial_periods_per_week: number;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const defaultDraft = (subject: Subject): Draft => ({
  requirementId: null,
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

/** How long to wait after the last edit before persisting. */
const AUTOSAVE_DELAY_MS = 600;

/**
 * Step 3 — weekly requirements.
 *
 * The solver reads the weekly period quota per subject from this table, so
 * it has to exist before generation can produce anything. Changes are
 * auto-saved (debounced) as the admin edits them, so there is no explicit
 * save button.
 */
export const Step3: React.FC = () => {
  const { divisionId, updateState, nextStep, prevStep } = useWizard();
  const { showToast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [statuses, setStatuses] = useState<Record<number, SaveStatus>>({});
  const [subjects, setSubjects] = useState<Subject[]>([]);

  // One debounce timer per subject, so editing two subjects does not cancel
  // each other's pending save.
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    let mounted = true;
    if (divisionId === null) {
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

        const division = (divisionsRes.data ?? []).find((d) => d.id === divisionId);
        const allSubjects = subjectsRes.data ?? [];
        const allRequirements = reqRes.data ?? [];

        // Subjects taught in this division's branch and year.
        const divisionSubjects = division
          ? allSubjects.filter(
              (subject) =>
                subject.branch_id === division.branch_id && subject.year === division.year
            )
          : [];

        // Pre-fill from any requirement that already exists, keeping its id
        // so edits are patched rather than re-created.
        const nextDrafts: Record<number, Draft> = {};
        divisionSubjects.forEach((subject) => {
          const existingRequirement = allRequirements.find(
            (requirement) =>
              requirement.division_id === divisionId && requirement.subject_id === subject.id
          );
          nextDrafts[subject.id] = existingRequirement
            ? {
                requirementId: existingRequirement.id,
                theory_periods_per_week: existingRequirement.theory_periods_per_week,
                practical_sessions_per_week: existingRequirement.practical_sessions_per_week,
                tutorial_periods_per_week: existingRequirement.tutorial_periods_per_week,
              }
            : defaultDraft(subject);
        });

        setSubjects(divisionSubjects);
        setDrafts(nextDrafts);
      } catch (_err: unknown) {
        if (mounted) {
          showToast({
            type: 'error',
            title: 'Requirements Unavailable',
            message: 'Could not load subjects for this division.',
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
  }, [divisionId]);

  // Clear any pending timers when the step unmounts.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      Object.values(pending).forEach((timer) => clearTimeout(timer));
    };
  }, []);

  /** Persist one subject's requirement (create or update). */
  const persist = async (subject: Subject, draft: Draft) => {
    if (divisionId === null) {
      return;
    }
    setStatuses((current) => ({ ...current, [subject.id]: 'saving' }));
    try {
      if (draft.requirementId !== null) {
        // The backend exposes PATCH (not PUT) for updates.
        const { error } = await apiClient.PATCH('/api/weekly-requirement/{requirement_id}', {
          params: { path: { requirement_id: draft.requirementId } },
          body: {
            theory_periods_per_week: draft.theory_periods_per_week,
            practical_sessions_per_week: draft.practical_sessions_per_week,
            tutorial_periods_per_week: draft.tutorial_periods_per_week,
          },
        });
        if (error) {
          throw new Error('update failed');
        }
      } else {
        const { data, error } = await apiClient.POST('/api/weekly-requirement', {
          body: {
            division_id: divisionId,
            subject_id: subject.id,
            theory_periods_per_week: draft.theory_periods_per_week,
            practical_sessions_per_week: draft.practical_sessions_per_week,
            tutorial_periods_per_week: draft.tutorial_periods_per_week,
          },
        });
        if (error || !data) {
          throw new Error('create failed');
        }
        // Remember the new id so the next edit patches instead of creating.
        setDrafts((current) => {
          const existing = current[subject.id] ?? defaultDraft(subject);
          return {
            ...current,
            [subject.id]: { ...existing, requirementId: data.id },
          };
        });
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
      // Read the latest draft at fire time, not the one captured when the
      // timer was scheduled.
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

  const handleContinue = async () => {
    if (divisionId === null) {
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

    // Flush any pending debounced save so the next step sees fresh data.
    const pending = timers.current;
    await Promise.all(
      Object.entries(pending).map(async ([subjectId, timer]) => {
        clearTimeout(timer);
        const subject = subjects.find((s) => String(s.id) === subjectId);
        const draft = drafts[Number(subjectId)];
        if (subject && draft) {
          await persist(subject, draft);
        }
      })
    );
Object.keys(pending).forEach((key) => {
  delete pending[Number(key)];
});
    // Keep the wizard state in sync for the allocation step.
    const { data: refreshed } = await apiClient.GET('/api/weekly-requirement');
    updateState({
      requirements: (refreshed ?? []).filter(
        (requirement) => requirement.division_id === divisionId
      ),
    });

    nextStep();
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
    field: 'theory_periods_per_week' | 'practical_sessions_per_week' | 'tutorial_periods_per_week',
    label: string,
    max: number
  ) => {
    const draft = drafts[subject.id] ?? defaultDraft(subject);
    const value = draft[field];
    return (
      <div className="flex items-center justify-center gap-1">
        <button
          type="button"
          onClick={() => updateDraft(subject, field, value - 1)}
          disabled={value <= 0}
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
          className="h-8 w-14 text-xs text-center"
          aria-label={`${label} for ${subject.name}`}
        />
        <button
          type="button"
          onClick={() => updateDraft(subject, field, value + 1)}
          disabled={value >= max}
          aria-label={`Increase ${label} for ${subject.name}`}
          className="w-6 h-6 rounded border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          +
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display font-bold text-base text-slate-900">Weekly Requirements</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Set how many periods per week each subject needs. Changes save automatically. A practical
          session counts as one session (2 consecutive periods).
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-6">
          <LoadingSpinner size="md" />
          <span>Loading subjects...</span>
        </div>
      ) : subjects.length === 0 ? (
        <div className="border border-amber-300 bg-amber-50 rounded p-3 text-xs text-amber-800">
          No subjects exist for this branch and year. Create them on the Subjects page first.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="w-40 text-center">Theory / wk</TableHead>
              <TableHead className="w-40 text-center">Practical / wk</TableHead>
              <TableHead className="w-40 text-center">Tutorial / wk</TableHead>
              <TableHead className="w-24 text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subjects.map((subject) => (
              <TableRow key={subject.id}>
                <TableCell isCode>{subject.code}</TableCell>
                <TableCell>{subject.name}</TableCell>
                <TableCell>
                  <Badge
                    size="sm"
                    className={
                      subject.subject_type === 'LAB'
                        ? 'bg-purple-50 text-purple-700 border border-purple-200 font-semibold'
                        : 'bg-blue-50 text-blue-700 border border-blue-200 font-semibold'
                    }
                  >
                    {subject.subject_type}
                  </Badge>
                </TableCell>
                <TableCell>
                  {renderStepper(subject, 'theory_periods_per_week', 'Theory periods', 20)}
                </TableCell>
                <TableCell>
                  {renderStepper(
                    subject,
                    'practical_sessions_per_week',
                    'Practical sessions',
                    10
                  )}
                </TableCell>
                <TableCell>
                  {renderStepper(subject, 'tutorial_periods_per_week', 'Tutorial periods', 10)}
                </TableCell>
                <TableCell className="text-right">{statusLabel(subject.id)}</TableCell>
              </TableRow>
            ))}
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
          disabled={subjects.length === 0}
        >
          Continue
        </Button>
      </div>
    </div>
  );
};
