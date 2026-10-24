import React, { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import { useToast } from '../../components/ui/useToast';
import { apiClient } from '../../api/client';
import { useWizard, type Division } from './WizardContext';

const ALL_YEARS = ['FE', 'SE', 'TE', 'BE'] as const;

/**
 * Step 2 — Year & Division Selection for Global Batch Generation.
 *
 * Allows the admin to select multiple Years (FE, SE, TE, BE) and choose
 * which divisions to generate simultaneously, preventing shared teachers
 * from being double-booked across different years or divisions.
 */
export const Step2: React.FC = () => {
  const {
    selectedYears: wizardSelectedYears,
    selectedDivisionIds,
    updateState,
    nextStep,
    prevStep,
  } = useWizard();
  const { showToast } = useToast();

  const [divisions, setDivisions] = useState<Division[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Selected Years: FE, SE, TE, BE
  const [selectedYears, setSelectedYears] = useState<string[]>(() => {
    if (wizardSelectedYears && wizardSelectedYears.length > 0) {
      return wizardSelectedYears;
    }
    return ['FE', 'SE', 'TE', 'BE'];
  });

  // Selected Division IDs
  const [selectedIds, setSelectedIds] = useState<number[]>(() => selectedDivisionIds || []);

  useEffect(() => {
    let mounted = true;
    const loadDivisions = async () => {
      try {
        const { data, error } = await apiClient.GET('/api/divisions');
        if (!mounted) {
          return;
        }
        if (error || !data) {
          showToast({
            type: 'error',
            title: 'Divisions Unavailable',
            message: 'Could not load divisions from backend.',
          });
          return;
        }
        setDivisions(data);

        // Derive active years from Step 1 selected years (or existing selected division ids)
        let activeYears =
          wizardSelectedYears && wizardSelectedYears.length > 0 ? wizardSelectedYears : [];
        if (activeYears.length === 0 && selectedDivisionIds && selectedDivisionIds.length > 0) {
          activeYears = Array.from(
            new Set(data.filter((d) => selectedDivisionIds.includes(d.id)).map((d) => d.year))
          );
        }
        if (activeYears.length === 0) {
          activeYears = ['FE', 'SE', 'TE', 'BE'];
        }
        setSelectedYears(activeYears);

        // Ensure all divisions belonging to ANY of the selected years are fetched and displayed
        const matchingDivs = data.filter((d) => activeYears.includes(d.year));
        const matchingIds = matchingDivs.map((d) => d.id);

        if (selectedDivisionIds && selectedDivisionIds.length > 0) {
          const validIds = selectedDivisionIds.filter((id) => matchingIds.includes(id));
          setSelectedIds(validIds.length > 0 ? validIds : matchingIds);
        } else {
          // Default to selecting ALL divisions for the checked years
          setSelectedIds(matchingIds);
        }
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
  }, [showToast, selectedDivisionIds, wizardSelectedYears]);

  // Synchronize with Wizard Context
  useEffect(() => {
    updateState({
      selectedYears,
      selectedDivisionIds: selectedIds,
      divisionId: selectedIds.length > 0 ? selectedIds[0] : null,
    });
  }, [selectedYears, selectedIds, updateState]);

  // Handle toggling an Academic Year (FE, SE, TE, BE)
  const handleToggleYear = (year: string) => {
    const isCurrentlySelected = selectedYears.includes(year);
    const yearDivisions = divisions.filter((d) => d.year === year);
    const yearDivisionIds = yearDivisions.map((d) => d.id);

    if (isCurrentlySelected) {
      // Uncheck Year: remove year and remove all its division IDs
      setSelectedYears((prev) => prev.filter((y) => y !== year));
      setSelectedIds((prev) => prev.filter((id) => !yearDivisionIds.includes(id)));
    } else {
      // Check Year: add year and default to selecting ALL divisions for that year
      setSelectedYears((prev) => [...prev, year]);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...yearDivisionIds])));
    }
  };

  // Handle toggling an individual division
  const handleToggleDivision = (divisionId: number) => {
    setSelectedIds((prev) =>
      prev.includes(divisionId) ? prev.filter((id) => id !== divisionId) : [...prev, divisionId]
    );
  };

  // Select all divisions for a specific year
  const handleSelectAllYearDivisions = (year: string) => {
    const yearDivIds = divisions.filter((d) => d.year === year).map((d) => d.id);
    setSelectedIds((prev) => Array.from(new Set([...prev, ...yearDivIds])));
  };

  // Deselect all divisions for a specific year
  const handleDeselectAllYearDivisions = (year: string) => {
    const yearDivIds = new Set(divisions.filter((d) => d.year === year).map((d) => d.id));
    setSelectedIds((prev) => prev.filter((id) => !yearDivIds.has(id)));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (selectedIds.length === 0) {
      showToast({
        type: 'error',
        title: 'No Divisions Selected',
        message: 'Select at least one division before continuing.',
      });
      return;
    }
    nextStep();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="font-display font-bold text-base text-slate-900">
          Select Years & Divisions
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Select multiple years at once so the solver can generate timetables globally and prevent
          shared teachers from being double-booked.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-slate-500 text-xs py-6">
          <LoadingSpinner size="md" />
          <span>Loading divisions...</span>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Year Checkboxes Section */}
          <div className="border border-slate-200 rounded-lg bg-surface p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                1. Select Academic Years
              </span>
              <span className="text-[11px] text-slate-400">
                {selectedYears.length} of {ALL_YEARS.length} years selected
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
              {ALL_YEARS.map((year) => {
                const yearCount = divisions.filter((d) => d.year === year).length;
                const isChecked = selectedYears.includes(year);
                return (
                  <label
                    key={year}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                      isChecked
                        ? 'border-primary bg-primary/5 text-primary shadow-2xs font-semibold'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleYear(year)}
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                    />
                    <div className="flex items-center justify-between flex-1">
                      <span className="text-sm font-bold">{year}</span>
                      <Badge size="sm" variant="outline">
                        {yearCount} div{yearCount === 1 ? '' : 's'}
                      </Badge>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Divisions List for Each Checked Year */}
          {selectedYears.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                  2. Select Divisions for Checked Years
                </span>
                <Badge size="sm" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                  {selectedIds.length} total division{selectedIds.length === 1 ? '' : 's'} selected
                </Badge>
              </div>

              {selectedYears.map((year) => {
                const yearDivs = divisions.filter((d) => d.year === year);
                const yearSelectedCount = yearDivs.filter((d) => selectedIds.includes(d.id)).length;
                return (
                  <div
                    key={year}
                    className="border border-slate-200 rounded-lg bg-surface p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-800">{year} Divisions</span>
                        <Badge size="sm" variant="outline">
                          {yearSelectedCount} / {yearDivs.length} selected
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => handleSelectAllYearDivisions(year)}
                          className="text-primary hover:underline font-medium text-xs"
                        >
                          Select All {year}
                        </button>
                        <span className="text-slate-300">|</span>
                        <button
                          type="button"
                          onClick={() => handleDeselectAllYearDivisions(year)}
                          className="text-slate-500 hover:text-slate-700 text-xs"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    {yearDivs.length === 0 ? (
                      <p className="text-xs text-slate-400 py-2">
                        No divisions found for {year}. Create them on the Divisions page.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 pt-1">
                        {yearDivs.map((div) => {
                          const isDivChecked = selectedIds.includes(div.id);
                          return (
                            <label
                              key={div.id}
                              className={`flex items-center gap-2.5 p-2.5 rounded-md border text-xs cursor-pointer transition-colors ${
                                isDivChecked
                                  ? 'border-primary/50 bg-primary/5 text-slate-900 font-medium'
                                  : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isDivChecked}
                                onChange={() => handleToggleDivision(div.id)}
                                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                              />
                              <div className="flex-1 min-w-0">
                                <span className="font-semibold text-slate-800">{div.name}</span>
                                <span className="text-slate-500 text-[11px] ml-1">
                                  (Sem {div.semester})
                                </span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {selectedYears.length === 0 && (
            <div className="border border-dashed border-slate-300 rounded-lg p-6 text-center text-xs text-slate-500">
              Check one or more academic years above (FE, SE, TE, BE) to display their divisions.
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between pt-2">
        <Button type="button" variant="secondary" size="md" onClick={prevStep}>
          Back
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={selectedIds.length === 0 || isLoading}
        >
          Continue ({selectedIds.length} division{selectedIds.length === 1 ? '' : 's'})
        </Button>
      </div>
    </form>
  );
};
