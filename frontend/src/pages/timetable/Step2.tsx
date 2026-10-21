import React, { useEffect, useMemo, useState } from 'react';
import { Select } from '../../components/ui/Select';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/useToast';
import { apiClient } from '../../api/client';
import { useWizard, type Division } from './WizardContext';

/**
 * Step 2 — pick the division to generate for.
 *
 * Divisions are filtered by their `year` field, which is one of
 * FE / SE / TE / BE (First Year .. Fourth Year). The previous "Group 1-4" and
 * "Group 5-10" split is gone.
 */
export const Step2: React.FC = () => {
  const { academicYear, divisionId, updateState, nextStep, prevStep } = useWizard();
  const { showToast } = useToast();
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const loadDivisions = async () => {
      try {
        const { data, error } = await apiClient.GET('/api/divisions');
        if (!mounted) {
          return;
        }
        if (error) {
          showToast({
            type: 'error',
            title: 'Divisions Unavailable',
            message: 'Could not load divisions.',
          });
          return;
        }
        setDivisions(data ?? []);
      } catch (_err: unknown) {
        if (mounted) {
          showToast({
            type: 'error',
            title: 'Divisions Unavailable',
            message: 'Could not load divisions.',
          });
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    loadDivisions();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only divisions belonging to the selected academic year are selectable.
  const filtered = useMemo(
    () => divisions.filter((division) => division.year === academicYear),
    [divisions, academicYear]
  );

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (divisionId === null) {
      showToast({
        type: 'error',
        title: 'No Division Selected',
        message: 'Select a division before continuing.',
      });
      return;
    }
    nextStep();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="font-display font-bold text-base text-slate-900">Select Division</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Showing divisions in the {academicYear} academic year.
        </p>
      </div>

      {isLoading ? (
        <p className="text-xs text-slate-500">Loading divisions...</p>
      ) : filtered.length === 0 ? (
        <div className="border border-slate-200 rounded bg-slate-50 p-4 text-xs text-slate-600">
          No divisions exist for {academicYear}. Create one on the Divisions page first.
        </div>
      ) : (
        <Select
          label="Division"
          required
          value={divisionId ?? ''}
          onChange={(event) =>
            updateState({
              divisionId: event.target.value === '' ? null : Number(event.target.value),
            })
          }
        >
          <option value="">-- Select a division --</option>
          {filtered.map((division) => (
            <option key={division.id} value={division.id}>
              {division.name} · Year {division.year} · Sem {division.semester}
            </option>
          ))}
        </Select>
      )}

      <div className="flex justify-between pt-1">
        <Button type="button" variant="secondary" size="md" onClick={prevStep}>
          Back
        </Button>
        <Button type="submit" variant="primary" size="md" disabled={filtered.length === 0}>
          Continue
        </Button>
      </div>
    </form>
  );
};
