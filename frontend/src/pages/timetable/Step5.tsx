import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import { useToast } from '../../components/ui/useToast';
import { apiClient } from '../../api/client';
import { useWizard, ACADEMIC_YEARS, type Division } from './WizardContext';

export interface Step5Props {
  onGenerateComplete: () => void;
}

/**
 * Step 5 — run the solver.
 *
 * Supports global batch generation: Admin can select an entire academic year
 * (e.g., "TE") or multiple individual divisions so that shared teachers
 * and rooms are scheduled simultaneously without conflicts.
 */
export const Step5: React.FC<Step5Props> = ({ onGenerateComplete }) => {
  const {
    divisionId,
    selectedDivisionIds,
    updateState,
    isGenerating,
    setIsGenerating,
    setSlots,
    prevStep,
  } = useWizard();
  const { showToast } = useToast();

  const [divisions, setDivisions] = useState<Division[]>([]);
  const [isLoadingDivisions, setIsLoadingDivisions] = useState(true);
  const [selectedYear, setSelectedYear] = useState<string>('ALL');

  // Local selection of division IDs
  const [selectedIds, setSelectedIds] = useState<number[]>(() => {
    if (selectedDivisionIds && selectedDivisionIds.length > 0) {
      return selectedDivisionIds;
    }
    return divisionId !== null ? [divisionId] : [];
  });

  // Load all divisions from backend
  useEffect(() => {
    let mounted = true;
    const fetchDivisions = async () => {
      try {
        const { data, error } = await apiClient.GET('/api/divisions');
        if (!mounted) {
          return;
        }
        if (error || !data) {
          showToast({
            type: 'error',
            title: 'Divisions Unavailable',
            message: 'Could not load divisions for batch generation.',
          });
          return;
        }
        setDivisions(data);
      } catch (_err: unknown) {
        if (mounted) {
          showToast({
            type: 'error',
            title: 'Divisions Unavailable',
            message: 'Could not load divisions for batch generation.',
          });
        }
      } finally {
        if (mounted) {
          setIsLoadingDivisions(false);
        }
      }
    };

    fetchDivisions();
    return () => {
      mounted = false;
    };
  }, [showToast]);

  // Sync from wizard context when Step 5 mounts or selectedDivisionIds updates
  useEffect(() => {
    if (selectedDivisionIds && selectedDivisionIds.length > 0) {
      setSelectedIds(selectedDivisionIds);
    }
  }, [selectedDivisionIds]);

  // Keep wizard state in sync
  useEffect(() => {
    if (selectedIds.length > 0) {
      updateState({ selectedDivisionIds: selectedIds });
    }
  }, [selectedIds, updateState]);

  const filteredDivisions = useMemo(() => {
    if (selectedYear === 'ALL') {
      return divisions;
    }
    return divisions.filter((d) => d.year === selectedYear);
  }, [divisions, selectedYear]);

  const toggleDivision = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((dId) => dId !== id) : [...prev, id]
    );
  };

  const handleSelectWholeYear = (year: string) => {
    const yearDivisions = divisions.filter((d) => d.year === year);
    const yearIds = yearDivisions.map((d) => d.id);
    setSelectedIds((prev) => Array.from(new Set([...prev, ...yearIds])));
  };

  const handleDeselectYear = (year: string) => {
    const yearIds = new Set(divisions.filter((d) => d.year === year).map((d) => d.id));
    setSelectedIds((prev) => prev.filter((id) => !yearIds.has(id)));
  };

  const handleSelectAll = () => {
    setSelectedIds(divisions.map((d) => d.id));
  };

  const handleDeselectAll = () => {
    setSelectedIds([]);
  };

  const handleGenerate = async () => {
    if (selectedIds.length === 0) {
      showToast({
        type: 'error',
        title: 'No Divisions Selected',
        message: 'Select at least one division before generating.',
      });
      return;
    }

    setIsGenerating(true);
    try {
      const { data, error } = await apiClient.POST('/api/timetable/generate', {
        body: { division_ids: selectedIds },
      });

      if (error) {
        showToast({
          type: 'error',
          title: 'Generation Failed',
          message: 'Could not generate the timetable.',
        });
        return;
      }

      // Fetch slots for the current division (or first selected division)
      const selectedDivisionId: number =
        divisionId !== null && selectedIds.includes(divisionId)
          ? divisionId
          : selectedIds[0] || 0;

      if (selectedDivisionId && selectedDivisionId !== divisionId) {
        updateState({ divisionId: selectedDivisionId });
      }

      const slotsRes = await apiClient.GET('/api/timetable/{division_id}', {
        params: { path: { division_id: selectedDivisionId || 0 } },
      });

      if (slotsRes.error) {
        showToast({
          type: 'error',
          title: 'Could Not Load Timetable',
          message: 'The timetable was generated but could not be loaded.',
        });
        return;
      }

      setSlots(slotsRes.data ?? []);
      showToast({
        type: 'success',
        title: 'Timetable Generated',
        message: `Successfully scheduled ${data?.length ?? 0} slots across ${selectedIds.length} division(s).`,
      });
      onGenerateComplete();
    } catch (_err: unknown) {
      showToast({
        type: 'error',
        title: 'Generation Failed',
        message: 'Could not generate the timetable.',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display font-bold text-base text-slate-900">Generate Timetable</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Select divisions to generate simultaneously using the global conflict-free solver.
        </p>
      </div>

      {/* Helper notice */}
      <div className="flex items-start gap-2.5 p-3.5 bg-blue-50/80 border border-blue-200 rounded-lg text-xs text-blue-900">
        <span className="text-base leading-none">💡</span>
        <div>
          <span className="font-semibold">Global Batch Generation:</span> Generate divisions
          together if they share teachers to prevent scheduling conflicts.
        </div>
      </div>

      {/* Division selection controls */}
      <div className="border border-border rounded-lg bg-surface p-4 space-y-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="font-medium text-slate-700 dark:text-slate-300">Filter / Year:</span>
            <button
              type="button"
              onClick={() => setSelectedYear('ALL')}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                selectedYear === 'ALL'
                  ? 'bg-primary text-white font-semibold'
                  : 'bg-surface border border-border text-slate-600 dark:text-slate-400 hover:bg-blue-50/50 dark:hover:bg-blue-950/30'
              }`}
            >
              All
            </button>
            {ACADEMIC_YEARS.map((yr) => (
              <button
                key={yr.value}
                type="button"
                onClick={() => setSelectedYear(yr.value)}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                  selectedYear === yr.value
                    ? 'bg-primary text-white font-semibold'
                    : 'bg-surface border border-border text-slate-600 dark:text-slate-400 hover:bg-blue-50/50 dark:hover:bg-blue-950/30'
                }`}
              >
                {yr.value}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleSelectAll}
              disabled={isGenerating || divisions.length === 0}
            >
              Select All
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleDeselectAll}
              disabled={isGenerating || selectedIds.length === 0}
            >
              Clear
            </Button>
            <Badge size="sm" className="bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/40">
              {selectedIds.length} of {divisions.length} selected
            </Badge>
          </div>
        </div>

        {/* Quick whole-year actions */}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Quick Select:
          </span>
          {ACADEMIC_YEARS.map((yr) => {
            const yearDivs = divisions.filter((d) => d.year === yr.value);
            const count = yearDivs.length;
            if (count === 0) return null;
            const allSelected = yearDivs.every((d) => selectedIds.includes(d.id));
            return (
              <button
                key={yr.value}
                type="button"
                onClick={() =>
                  allSelected ? handleDeselectYear(yr.value) : handleSelectWholeYear(yr.value)
                }
                disabled={isGenerating}
                className={`text-xs px-2.5 py-1 rounded-md border transition-all ${
                  allSelected
                    ? 'bg-blue-600/10 border-blue-500/40 text-blue-700 dark:text-blue-300 font-medium shadow-2xs'
                    : 'bg-surface border-border text-slate-700 dark:text-slate-300 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 hover:border-blue-500/30'
                }`}
              >
                {allSelected ? `✓ All ${yr.value} Selected` : `Select Whole ${yr.value} (${count})`}
              </button>
            );
          })}
        </div>

        {/* Divisions Checkbox Grid */}
        {isLoadingDivisions ? (
          <div className="flex items-center gap-2 text-slate-500 text-xs py-4">
            <LoadingSpinner size="sm" />
            <span>Loading divisions...</span>
          </div>
        ) : filteredDivisions.length === 0 ? (
          <p className="text-xs text-slate-400 py-2">No divisions found for this filter.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 pt-1">
            {filteredDivisions.map((div) => {
              const isChecked = selectedIds.includes(div.id);
              const isCurrent = div.id === divisionId;
              return (
                <label
                  key={div.id}
                  className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                    isChecked
                      ? 'border-blue-500/60 bg-blue-500/10 text-slate-900 dark:text-white font-medium shadow-2xs'
                      : 'border-border hover:bg-blue-50/50 dark:hover:bg-blue-950/30 hover:border-blue-500/30 text-slate-700 dark:text-slate-300 bg-surface'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleDivision(div.id)}
                    disabled={isGenerating}
                    className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{div.name}</span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">({div.year})</span>
                      {isCurrent && (
                        <span className="text-[10px] px-1 bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded font-normal">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 truncate">
                      Branch #{div.branch_id} · Sem {div.semester}
                    </p>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Solver details card */}
      <div className="border border-border rounded-xl bg-surface p-4 text-xs text-slate-600 dark:text-slate-300 space-y-2 shadow-2xs">
        <p className="font-semibold text-slate-800 dark:text-slate-200">What the global solver enforces</p>
        <ul className="list-disc list-inside space-y-1 text-slate-500 dark:text-slate-400">
          <li>Global Batch Generation across all selected divisions</li>
          <li>No teacher or room double-booked across divisions</li>
          <li>Labs placed as 2 consecutive periods in the SAME room</li>
          <li>Compact schedule: fills earliest periods first to prevent midday gaps</li>
          <li>Each teacher's daily lecture cap and visiting hours respected</li>
        </ul>
      </div>

      <div className="flex justify-between pt-1">
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={prevStep}
          disabled={isGenerating}
        >
          Back
        </Button>
        <Button
          type="button"
          variant="primary"
          size="md"
          onClick={handleGenerate}
          isLoading={isGenerating}
          disabled={selectedIds.length === 0}
        >
          {isGenerating
            ? 'Generating...'
            : `Generate Timetable (${selectedIds.length} division${selectedIds.length === 1 ? '' : 's'})`}
        </Button>
      </div>

      {isGenerating && (
        <div className="flex items-center gap-2 text-slate-500 text-xs">
          <LoadingSpinner size="sm" />
          <span>Running global multi-division solver — this may take a few moments.</span>
        </div>
      )}
    </div>
  );
};
