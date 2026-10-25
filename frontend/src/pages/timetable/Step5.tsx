import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import { Modal } from '../../components/ui/Modal';
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

  const [errorModal, setErrorModal] = useState<{ title: string; message: string } | null>(null);
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
        const errorDetail =
          (error as { detail?: string })?.detail || 'Unknown error occurred.';
        setErrorModal({
          title: 'Timetable Generation Failed',
          message: errorDetail,
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
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unknown error occurred.';
      setErrorModal({
        title: 'Timetable Generation Failed',
        message,
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
      <div className="border border-slate-200 rounded-lg bg-surface p-4 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="font-medium text-slate-700">Filter / Year:</span>
            <button
              type="button"
              onClick={() => setSelectedYear('ALL')}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                selectedYear === 'ALL'
                  ? 'bg-primary text-white font-semibold'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
                  selectedYear === 'yr.value'
                    ? 'bg-primary text-white font-semibold'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
            <Badge size="sm" className="bg-slate-100 text-slate-700">
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
                className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                  allSelected
                    ? 'bg-primary/10 border-primary text-primary font-medium'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
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
                  className={`flex items-center gap-2.5 p-2.5 rounded-md border text-xs cursor-pointer transition-colors ${
                    isChecked
                      ? 'border-primary/50 bg-primary/5 text-slate-900 font-medium'
                      : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleDivision(div.id)}
                    disabled={isGenerating}
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-800">{div.name}</span>
                      <span className="text-[11px] text-slate-500">({div.year})</span>
                      {isCurrent && (
                        <span className="text-[10px] px-1 bg-amber-100 text-amber-800 rounded font-normal">
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
      <div className="border border-slate-200 rounded bg-slate-50 p-4 text-xs text-slate-600 space-y-1.5">
        <p className="font-semibold text-slate-700">What the global solver enforces</p>
        <ul className="list-disc list-inside space-y-0.5">
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

      {/* Persistent Error Modal for Generation Failures */}
      <Modal
        isOpen={Boolean(errorModal)}
        onClose={() => setErrorModal(null)}
        title={errorModal?.title ?? 'Timetable Generation Failed'}
        maxWidth="lg"
      >
        <div className="space-y-4">
          <pre
            className="p-3.5 bg-rose-50 border border-rose-200 rounded text-xs text-rose-800 font-mono overflow-auto max-h-96"
            style={{ whiteSpace: 'pre-wrap' }}
          >
            {errorModal?.message}
          </pre>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setErrorModal(null)}
            >
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
