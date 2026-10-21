import React, { useEffect, useState } from 'react';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/useToast';
import { apiClient } from '../../api/client';
import { ACADEMIC_YEARS, useWizard, type AcademicYear } from './WizardContext';

/**
 * Step 1 — term settings: academic year, semester and daily timings.
 *
 * The timings are read from the active TimetableSettings row (created in a
 * previous slice). They are shown read-only here because the solver always
 * reads the latest settings row; editing them belongs to the Settings page.
 */
export const Step1: React.FC = () => {
  const { academicYear, semester, settings, updateState, nextStep } = useWizard();
  const { showToast } = useToast();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const loadSettings = async () => {
      try {
        const { data, error } = await apiClient.GET('/api/timetable-settings');
        if (!mounted) {
          return;
        }
        if (error) {
          showToast({
            type: 'error',
            title: 'Settings Unavailable',
            message: 'Could not load timetable settings.',
          });
          return;
        }
        const latest = (data ?? [])[0];
        if (latest) {
          updateState({ settings: latest });
        }
      } catch (_err: unknown) {
        if (mounted) {
          showToast({
            type: 'error',
            title: 'Settings Unavailable',
            message: 'Could not load timetable settings.',
          });
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    loadSettings();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (semester < 1 || semester > 8) {
      showToast({
        type: 'error',
        title: 'Invalid Semester',
        message: 'Semester must be between 1 and 8.',
      });
      return;
    }
    nextStep();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="font-display font-bold text-base text-slate-900">Term Settings</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Choose the academic year and semester this timetable covers.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Academic Year"
          required
          value={academicYear}
          onChange={(event) =>
            updateState({ academicYear: event.target.value as AcademicYear })
          }
        >
          {ACADEMIC_YEARS.map((year) => (
            <option key={year.value} value={year.value}>
              {year.label}
            </option>
          ))}
        </Select>

        <Input
          label="Semester"
          type="number"
          min={1}
          max={8}
          required
          value={semester}
          onChange={(event) => updateState({ semester: Number(event.target.value) })}
        />
      </div>

      <div className="border border-slate-200 rounded bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
          Daily Timings
        </p>
        {isLoading ? (
          <p className="text-xs text-slate-500">Loading settings...</p>
        ) : settings ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-600">
            <div className="flex justify-between">
              <dt className="text-slate-500">Day start</dt>
              <dd className="font-mono">{settings.start_time.slice(0, 5)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Day end</dt>
              <dd className="font-mono">{settings.end_time.slice(0, 5)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Period length</dt>
              <dd className="font-mono">{settings.period_minutes} min</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Lunch</dt>
              <dd className="font-mono">{settings.lunch_start.slice(0, 5)}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-xs text-slate-500">
            No timetable settings found. The solver needs at least one settings row to build the
            period grid.
          </p>
        )}
      </div>

      <div className="flex justify-end pt-1">
        <Button type="submit" variant="primary" size="md">
          Continue
        </Button>
      </div>
    </form>
  );
};
