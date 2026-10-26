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
    setCurrentStep,
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
        const detail = (error as { detail?: unknown })?.detail;
        let errorDetail = 'Unknown error occurred.';
        if (typeof detail === 'string') {
          errorDetail = detail;
        } else if (Array.isArray(detail)) {
          errorDetail = detail
            .map((item) =>
              typeof item === 'object' && item && 'msg' in item
                ? String((item as { msg: string }).msg)
                : String(item)
            )
            .join('\n');
        } else if (detail && typeof detail === 'object' && 'message' in detail) {
          errorDetail = String((detail as { message: unknown }).message);
        }

        setErrorModal({
          title: 'Timetable Generation Failed',
          message: errorDetail,
        });
        return;
      }

      // Fetch slots for the current division (or first selected division)
      const selectedDivisionId: number =
        divisionId !== null && selectedIds.includes(divisionId) ? divisionId : selectedIds[0] || 0;

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
        title: 'Timetable Generation Failed - Data Missing',
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

      {/* Grouped Error Modal for Generation Failures */}
      <GenerationErrorModal
        isOpen={Boolean(errorModal)}
        onClose={() => setErrorModal(null)}
        rawError={errorModal?.message ?? null}
        divisions={divisions}
        onGoToAllocation={() => {
          setErrorModal(null);
          setCurrentStep(4);
        }}
      />
    </div>
  );
};

interface ParsedIssue {
  id: string;
  raw: string;
  category: 'missing' | 'capacity' | 'other';
  division: string;
  isLab: boolean;
}

interface DivisionGroup {
  division: string;
  items: ParsedIssue[];
  labsCount: number;
  theoryCount: number;
}

interface GenerationErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  rawError: string | null;
  divisions: Division[];
  onGoToAllocation: () => void;
}

const GenerationErrorModal: React.FC<GenerationErrorModalProps> = ({
  isOpen,
  onClose,
  rawError,
  divisions,
  onGoToAllocation,
}) => {
  const [openSectionA, setOpenSectionA] = useState(true);
  const [openSectionB, setOpenSectionB] = useState(true);
  const [openSectionOther, setOpenSectionOther] = useState(false);
  const [collapsedDivisions, setCollapsedDivisions] = useState<Record<string, boolean>>({});

  const toggleDivision = (divisionKey: string) => {
    setCollapsedDivisions((prev) => ({
      ...prev,
      [divisionKey]: !prev[divisionKey],
    }));
  };

  const parsed = useMemo(() => {
    if (!rawError) {
      return { missing: [], capacity: [], other: [], total: 0 };
    }

    const cleaned = rawError.replace(/^Pre-Flight Check Failed:\s*/i, '').trim();
    const lines = cleaned
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l !== 'Pre-Flight Check Failed:');

    const missing: ParsedIssue[] = [];
    const capacity: ParsedIssue[] = [];
    const other: ParsedIssue[] = [];

    lines.forEach((line, idx) => {
      const isLab = /\blab\b|\bpractical\b/i.test(line);
      const lower = line.toLowerCase();

      // Section A: Missing Data (Catch strings starting with "No teacher is eligible...")
      const isMissing =
        lower.startsWith('no teacher is eligible') ||
        lower.includes('no teacher is eligible') ||
        lower.includes('no row in the eligibility table') ||
        lower.includes('not yet active') ||
        lower.includes('no eligible teacher') ||
        lower.startsWith('subject shortage:');

      // Section B: Capacity Issues (Catch strings starting with "Teacher ... is overloaded...")
      const isCapacity =
        lower.includes('is overloaded') ||
        lower.startsWith('teacher overload:') ||
        lower.includes('grid overload:') ||
        lower.includes('lack of lab rooms:') ||
        lower.includes('lab room(s) are mapped') ||
        lower.includes('stretched thin') ||
        lower.includes('periods of capacity') ||
        lower.includes('can only teach');

      // Detect division
      let division = 'All / General';
      for (const d of divisions) {
        const candidates = [
          `${d.year} ${d.name}`,
          `${d.year}-${d.name}`,
          `${d.year} - ${d.name}`,
          d.name,
        ];
        if (candidates.some((c) => c && line.includes(c))) {
          division = d.year && !d.name.startsWith(d.year) ? `${d.year} ${d.name}` : d.name;
          break;
        }
      }

      if (division === 'All / General') {
        const forMatch = line.match(
          /for\s+([A-Z0-9_-]+(?:\s+[A-Z0-9_-]+)?)(?:\s+batch|\.|\s*\(|$)/i
        );
        if (
          forMatch &&
          forMatch[1] &&
          !['the', 'all', 'a', 'each', 'one', 'timetabling'].includes(forMatch[1].toLowerCase())
        ) {
          division = forMatch[1].trim();
        } else {
          const gridMatch = line.match(/Grid Overload:\s*([A-Z0-9_-]+(?:\s+[A-Z0-9_-]+)?)/i);
          if (gridMatch && gridMatch[1]) {
            division = gridMatch[1].trim();
          }
        }
      }

      const item: ParsedIssue = {
        id: `err-${idx}`,
        raw: line,
        category: isMissing ? 'missing' : isCapacity ? 'capacity' : 'other',
        division,
        isLab,
      };

      if (isMissing) {
        missing.push(item);
      } else if (isCapacity) {
        capacity.push(item);
      } else {
        other.push(item);
      }
    });

    return {
      missing,
      capacity,
      other,
      total: lines.length,
    };
  }, [rawError, divisions]);

  const missingGroups = useMemo<DivisionGroup[]>(() => {
    const map: Record<string, { items: ParsedIssue[]; labsCount: number; theoryCount: number }> = {};
    for (const item of parsed.missing) {
      if (!map[item.division]) {
        map[item.division] = { items: [], labsCount: 0, theoryCount: 0 };
      }
      map[item.division]!.items.push(item);
      if (item.isLab) {
        map[item.division]!.labsCount++;
      } else {
        map[item.division]!.theoryCount++;
      }
    }

    return Object.entries(map)
      .map(([division, data]) => ({
        division,
        items: data.items,
        labsCount: data.labsCount,
        theoryCount: data.theoryCount,
      }))
      .sort((a, b) => {
        if (a.division === 'All / General') return 1;
        if (b.division === 'All / General') return -1;
        return a.division.localeCompare(b.division);
      });
  }, [parsed.missing]);

  const capacityGroups = useMemo<DivisionGroup[]>(() => {
    const map: Record<string, { items: ParsedIssue[]; labsCount: number; theoryCount: number }> = {};
    for (const item of parsed.capacity) {
      const divKey = item.division !== 'All / General' ? item.division : 'Faculty & Grid Capacity';
      if (!map[divKey]) {
        map[divKey] = { items: [], labsCount: 0, theoryCount: 0 };
      }
      map[divKey]!.items.push(item);
      if (item.isLab) {
        map[divKey]!.labsCount++;
      } else {
        map[divKey]!.theoryCount++;
      }
    }

    return Object.entries(map)
      .map(([division, data]) => ({
        division,
        items: data.items,
        labsCount: data.labsCount,
        theoryCount: data.theoryCount,
      }))
      .sort((a, b) => {
        if (a.division === 'Faculty & Grid Capacity') return -1;
        if (b.division === 'Faculty & Grid Capacity') return 1;
        return a.division.localeCompare(b.division);
      });
  }, [parsed.capacity]);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-red-100 border border-red-200 flex items-center justify-center shrink-0">
            <svg
              className="w-4 h-4 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div>
            <h3 className="font-display font-bold text-base text-slate-900 leading-tight">
              Timetable Generation Failed
            </h3>
            <p className="text-xs text-slate-500 font-normal mt-0.5">
              The solver encountered data constraints that must be resolved before scheduling.
            </p>
          </div>
        </div>
      }
      maxWidth="xl"
    >
      <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
        {/* Summary Overview Card */}
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold">
              {parsed.total} constraint issue{parsed.total === 1 ? '' : 's'}
            </span>
            <span>found preventing timetable generation.</span>
          </div>
          <span className="text-[11px] text-red-700 font-medium">
            Review the grouped sections below
          </span>
        </div>

        {/* Section A: Missing Data */}
        {parsed.missing.length > 0 && (
          <div className="border border-red-200 rounded-lg overflow-hidden bg-white shadow-xs">
            <button
              type="button"
              onClick={() => setOpenSectionA(!openSectionA)}
              className="w-full px-4 py-3 bg-red-50 hover:bg-red-100/70 transition-colors flex items-center justify-between text-left cursor-pointer select-none"
              aria-expanded={openSectionA}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-5 h-5 rounded-full bg-red-200/80 text-red-800 flex items-center justify-center text-xs font-bold shrink-0">
                  A
                </div>
                <div>
                  <h4 className="font-display font-semibold text-sm text-red-900">
                    Section A: Missing Data
                  </h4>
                  <p className="text-xs text-red-700/90 font-normal">
                    Subjects or lab batches without eligible active teachers
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <span className="bg-red-100 text-red-800 border border-red-300 font-semibold text-xs px-2.5 py-0.5 rounded">
                  {parsed.missing.length} Missing Teacher Assignment
                  {parsed.missing.length === 1 ? '' : 's'} found
                </span>
                <svg
                  className={`w-4 h-4 text-red-700 transition-transform duration-200 ${
                    openSectionA ? 'rotate-180' : ''
                  }`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
            </button>

            {openSectionA && (
              <div className="p-3.5 bg-red-50/30 border-t border-red-100 space-y-3">
                {missingGroups.map((group) => {
                  const isCollapsed = Boolean(collapsedDivisions[`missing-${group.division}`]);
                  const summaryParts: string[] = [];
                  if (group.labsCount > 0) {
                    summaryParts.push(
                      `${group.labsCount} Missing Lab${group.labsCount > 1 ? 's' : ''}`
                    );
                  }
                  if (group.theoryCount > 0) {
                    summaryParts.push(
                      `${group.theoryCount} Missing Lecture${group.theoryCount > 1 ? 's' : ''}`
                    );
                  }
                  const summaryText = summaryParts.join(', ');

                  return (
                    <div
                      key={group.division}
                      className="bg-white border border-red-200/90 rounded-md overflow-hidden shadow-xs"
                    >
                      <button
                        type="button"
                        onClick={() => toggleDivision(`missing-${group.division}`)}
                        className="w-full px-3 py-2 bg-red-50/60 hover:bg-red-50 transition-colors flex items-center justify-between text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-red-950 font-mono">
                            {group.division}
                          </span>
                          {summaryText && (
                            <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-red-100/80 text-red-800 border border-red-200">
                              {summaryText}
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-red-600 hover:text-red-800 font-medium flex items-center gap-1">
                          <span>{isCollapsed ? 'Show details' : 'Hide details'}</span>
                          <svg
                            className={`w-3.5 h-3.5 transition-transform duration-150 ${
                              isCollapsed ? '' : 'rotate-180'
                            }`}
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fillRule="evenodd"
                              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </span>
                      </button>

                      {!isCollapsed && (
                        <div className="p-2.5 space-y-1.5 border-t border-red-100 bg-white">
                          {group.items.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-start gap-2 p-2 rounded bg-red-50/40 border border-red-100 text-xs text-red-900"
                            >
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 mt-0.5 ${
                                  item.isLab
                                    ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                    : 'bg-blue-100 text-blue-800 border border-blue-200'
                                }`}
                              >
                                {item.isLab ? 'Lab' : 'Theory'}
                              </span>
                              <span className="flex-1 leading-relaxed">{item.raw}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Section B: Capacity Issues */}
        {parsed.capacity.length > 0 && (
          <div className="border border-red-200 rounded-lg overflow-hidden bg-white shadow-xs">
            <button
              type="button"
              onClick={() => setOpenSectionB(!openSectionB)}
              className="w-full px-4 py-3 bg-red-50 hover:bg-red-100/70 transition-colors flex items-center justify-between text-left cursor-pointer select-none"
              aria-expanded={openSectionB}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-5 h-5 rounded-full bg-red-200/80 text-red-800 flex items-center justify-center text-xs font-bold shrink-0">
                  B
                </div>
                <div>
                  <h4 className="font-display font-semibold text-sm text-red-900">
                    Section B: Capacity Issues
                  </h4>
                  <p className="text-xs text-red-700/90 font-normal">
                    Teacher daily lecture cap overloads or timetable grid slot shortages
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <span className="bg-red-100 text-red-800 border border-red-300 font-semibold text-xs px-2.5 py-0.5 rounded">
                  {parsed.capacity.length} Capacity Issue
                  {parsed.capacity.length === 1 ? '' : 's'} found
                </span>
                <svg
                  className={`w-4 h-4 text-red-700 transition-transform duration-200 ${
                    openSectionB ? 'rotate-180' : ''
                  }`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
            </button>

            {openSectionB && (
              <div className="p-3.5 bg-red-50/30 border-t border-red-100 space-y-3">
                {capacityGroups.map((group) => {
                  const isCollapsed = Boolean(collapsedDivisions[`capacity-${group.division}`]);
                  return (
                    <div
                      key={group.division}
                      className="bg-white border border-red-200/90 rounded-md overflow-hidden shadow-xs"
                    >
                      <button
                        type="button"
                        onClick={() => toggleDivision(`capacity-${group.division}`)}
                        className="w-full px-3 py-2 bg-red-50/60 hover:bg-red-50 transition-colors flex items-center justify-between text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-red-950 font-mono">
                            {group.division}
                          </span>
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-red-100/80 text-red-800 border border-red-200">
                            {group.items.length} issue{group.items.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        <span className="text-[11px] text-red-600 hover:text-red-800 font-medium flex items-center gap-1">
                          <span>{isCollapsed ? 'Show details' : 'Hide details'}</span>
                          <svg
                            className={`w-3.5 h-3.5 transition-transform duration-150 ${
                              isCollapsed ? '' : 'rotate-180'
                            }`}
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fillRule="evenodd"
                              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </span>
                      </button>

                      {!isCollapsed && (
                        <div className="p-2.5 space-y-1.5 border-t border-red-100 bg-white">
                          {group.items.map((item) => (
                            <div
                              key={item.id}
                              className="flex items-start gap-2 p-2 rounded bg-red-50/40 border border-red-100 text-xs text-red-900"
                            >
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 mt-0.5 bg-red-100 text-red-800 border border-red-200">
                                Overload
                              </span>
                              <span className="flex-1 leading-relaxed">{item.raw}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Section C: Additional Constraints (if any other errors exist) */}
        {parsed.other.length > 0 && (
          <div className="border border-red-200 rounded-lg overflow-hidden bg-white shadow-xs">
            <button
              type="button"
              onClick={() => setOpenSectionOther(!openSectionOther)}
              className="w-full px-4 py-3 bg-red-50 hover:bg-red-100/70 transition-colors flex items-center justify-between text-left cursor-pointer select-none"
              aria-expanded={openSectionOther}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-5 h-5 rounded-full bg-red-200/80 text-red-800 flex items-center justify-center text-xs font-bold shrink-0">
                  !
                </div>
                <div>
                  <h4 className="font-display font-semibold text-sm text-red-900">
                    Additional Validation Constraints
                  </h4>
                  <p className="text-xs text-red-700/90 font-normal">
                    Other pre-flight issues preventing solver generation
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <span className="bg-red-100 text-red-800 border border-red-300 font-semibold text-xs px-2.5 py-0.5 rounded">
                  {parsed.other.length} issue{parsed.other.length === 1 ? '' : 's'}
                </span>
                <svg
                  className={`w-4 h-4 text-red-700 transition-transform duration-200 ${
                    openSectionOther ? 'rotate-180' : ''
                  }`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
            </button>

            {openSectionOther && (
              <div className="p-3.5 bg-red-50/30 border-t border-red-100 space-y-1.5">
                {parsed.other.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-2 p-2 rounded bg-white border border-red-100 text-xs text-red-900"
                  >
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 mt-0.5 bg-slate-100 text-slate-700 border border-slate-200">
                      Notice
                    </span>
                    <span className="flex-1 leading-relaxed">{item.raw}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Fallback if no lines were parsed */}
        {parsed.total === 0 && rawError && (
          <div className="p-3.5 bg-red-50 border border-red-200 rounded-md text-xs text-red-900 whitespace-pre-wrap">
            {rawError}
          </div>
        )}
      </div>

      {/* Call to Action Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 mt-4 border-t border-slate-200">
        <p className="text-xs text-slate-500">
          Ready to fix teacher assignments or hours in Allocation?
        </p>
        <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onGoToAllocation}
            rightIcon={
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            }
          >
            Go to Allocation
          </Button>
        </div>
      </div>
    </Modal>
  );
};
