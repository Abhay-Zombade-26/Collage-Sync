import React, { useEffect, useState, useCallback } from 'react';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/useToast';
import { apiClient } from '../../api/client';
import { useWizard, type AcademicYear } from './WizardContext';

const ACADEMIC_YEAR_OPTIONS = ['FE', 'SE', 'TE', 'BE'] as const;

const YEAR_SEMESTER_MAP: Record<string, number> = {
  FE: 1,
  SE: 3,
  TE: 5,
  BE: 7,
};

interface Slot {
  index: number;
  start_time: string;
  end_time: string;
  label: string;
}

/** Parses "HH:MM" or "HH:MM:SS" string into total minutes from midnight */
function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  const h = parseInt(parts[0] ?? '', 10) || 0;
  const m = parseInt(parts[1] ?? '', 10) || 0;
  return h * 60 + m;
}

/** Formats total minutes from midnight into 24-hour "HH:MM" */
function minutesToTime24(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Formats total minutes from midnight into 12-hour "hh:mm AM/PM" */
function minutesToTime12(totalMinutes: number): string {
  const h24 = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

/** Formats dynamic slot range label e.g. "09:00 AM - 10:00 AM" */
function formatSlotLabel(startMin: number, endMin: number): string {
  return `${minutesToTime12(startMin)} - ${minutesToTime12(endMin)}`;
}

/**
 * Recalculates start_time, end_time, and label for all slots based on running time.
 * If current slot index is the selected lunch slot, its length is lunchMinutes.
 * Otherwise, its length is periodMinutes.
 */
function recalculateSlots(
  baseSlots: Slot[],
  baseStartTime: string,
  lunchIndex: number | null,
  periodMin: number,
  lunchMin: number
): Slot[] {
  let currentTime = parseTimeToMinutes(baseStartTime);

  return baseSlots.map((slot) => {
    const isLunch = lunchIndex === slot.index;
    const duration = isLunch ? Number(lunchMin) : Number(periodMin);
    const slotStartMin = currentTime;
    const slotEndMin = currentTime + duration;
    currentTime = slotEndMin;

    return {
      index: slot.index,
      start_time: minutesToTime24(slotStartMin),
      end_time: minutesToTime24(slotEndMin),
      label: formatSlotLabel(slotStartMin, slotEndMin),
    };
  });
}

/**
 * Step 1 — School Settings: academic year, semester and daily timings.
 *
 * Flow:
 * 1. Admin enters Start Time, End Time, Period Length (minutes), and Lunch Length (minutes).
 * 2. Admin clicks "Calculate Slots" (calls POST /api/timetable/calculate-slots).
 * 3. The UI displays the calculated slots as clickable buttons with dynamic times.
 * 4. Admin clicks one slot to designate it as the "Lunch Period" (highlighted in yellow, lunch duration applied).
 * 5. All slots dynamically recalculate their start and end times around the lunch slot.
 * 6. The UI shows summary text ("Total Teaching Periods: X. Lunch is Period Y (Z mins).").
 * 7. Admin clicks "Save & Continue" to persist to TimetableSettings and proceed.
 */
export const Step1: React.FC = () => {
  const {
    selectedYears: wizardSelectedYears,
    settings,
    updateState,
    nextStep,
  } = useWizard();
  const { showToast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Selected Years state: FE, SE, TE, BE
  const [selectedYears, setSelectedYears] = useState<string[]>(() => {
    if (wizardSelectedYears && wizardSelectedYears.length > 0) {
      return wizardSelectedYears;
    }
    return ['FE', 'SE', 'TE', 'BE'];
  });

  const toggleYear = (year: string) => {
    setSelectedYears((prev) =>
      prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]
    );
  };

  // Form state for slot calculation
  const [startTime, setStartTime] = useState<string>('09:00');
  const [endTime, setEndTime] = useState<string>('16:45');
  const [periodMinutes, setPeriodMinutes] = useState<number>(60);
  const [lunchMinutes, setLunchMinutes] = useState<number>(45);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedLunchIndex, setSelectedLunchIndex] = useState<number | null>(null);

  // Reusable slot calculation function
  const calculateSlots = useCallback(
    async (
      st: string = startTime,
      et: string = endTime,
      pm: number = periodMinutes,
      lm: number = lunchMinutes,
      preferredLunchStart?: string
    ) => {
      if (!st || !et) {
        showToast({
          type: 'error',
          title: 'Validation Error',
          message: 'Please provide both start time and end time.',
        });
        return;
      }

      setIsCalculating(true);
      try {
        const payload = {
          start_time: st.slice(0, 5),
          end_time: et.slice(0, 5),
          period_minutes: Number(pm),
          lunch_minutes: Number(lm),
        };

        console.log("Sending Payload:", payload);

        const { data, error } = await apiClient.POST('/api/timetable/calculate-slots', {
          body: payload,
        });

        if (error) {
          console.log("422 Error Details:", error);
          showToast({
            type: 'error',
            title: 'Calculation Failed',
            message: 'Could not calculate timetable slots. Check your timings.',
          });
          return;
        }

        if (!data) {
          showToast({
            type: 'error',
            title: 'Calculation Failed',
            message: 'Could not calculate timetable slots. Check your timings.',
          });
          return;
        }

        const calculatedSlots: Slot[] = data.slots ?? [];

        // Determine which slot is the lunch slot (match preferredLunchStart if exists, otherwise preserve or keep null)
        let lunchIdx = selectedLunchIndex;
        if (preferredLunchStart && calculatedSlots.length > 0) {
          const match = calculatedSlots.find(
            (s) => s.start_time.slice(0, 5) === preferredLunchStart.slice(0, 5)
          );
          if (match) {
            lunchIdx = match.index;
          }
        } else if (lunchIdx !== null) {
          const stillExists = calculatedSlots.some((s) => s.index === lunchIdx);
          if (!stillExists) {
            lunchIdx = null;
          }
        }

        setSelectedLunchIndex(lunchIdx);

        // Dynamically compute times for all slots
        const dynamicallyTimedSlots = recalculateSlots(
          calculatedSlots,
          st,
          lunchIdx,
          Number(pm),
          Number(lm)
        );
        setSlots(dynamicallyTimedSlots);
      } catch (_err: unknown) {
        console.log("422 Error Details:", _err);
        showToast({
          type: 'error',
          title: 'Calculation Failed',
          message: 'An unexpected error occurred while calculating slots.',
        });
      } finally {
        setIsCalculating(false);
      }
    },
    [startTime, endTime, periodMinutes, lunchMinutes, selectedLunchIndex, showToast]
  );

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
          const st = latest.start_time ? latest.start_time.slice(0, 5) : '09:00';
          const et = latest.end_time ? latest.end_time.slice(0, 5) : '17:00';
          const pm = latest.period_minutes || 60;
          const lm = latest.lunch_minutes || 45;
          const ls = latest.lunch_start ? latest.lunch_start.slice(0, 5) : undefined;

          setStartTime(st);
          setEndTime(et);
          setPeriodMinutes(pm);
          setLunchMinutes(lm);

          // Calculate slots automatically on initial load with latest timings
          await calculateSlots(st, et, pm, lm, ls);
        } else {
          // Defaults if no existing settings
          await calculateSlots('09:00', '17:00', 60, 45);
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

  const handleLunchSelect = (index: number) => {
    setSelectedLunchIndex(index);
    setSlots((prevSlots) =>
      recalculateSlots(prevSlots, startTime, index, periodMinutes, lunchMinutes)
    );
  };

  // Total teaching periods: all slots minus 1 designated for lunch
  const totalTeachingPeriods = slots.length > 0 ? slots.length - (selectedLunchIndex !== null ? 1 : 0) : 0;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (selectedYears.length === 0) {
      showToast({
        type: 'error',
        title: 'Validation Error',
        message: 'Please select at least one academic year.',
      });
      return;
    }

    if (slots.length === 0) {
      showToast({
        type: 'error',
        title: 'No Slots Calculated',
        message: 'Please click "Calculate Slots" first before continuing.',
      });
      return;
    }

    if (selectedLunchIndex === null) {
      showToast({
        type: 'error',
        title: 'Lunch Period Required',
        message: 'Please select one slot as the lunch period.',
      });
      return;
    }

    const lunchSlot = slots.find((s) => s.index === selectedLunchIndex);
    const lunchStart = lunchSlot ? `${lunchSlot.start_time.slice(0, 5)}:00` : `${startTime.slice(0, 5)}:00`;
    const formattedStart = `${startTime.slice(0, 5)}:00`;
    const formattedEnd = `${endTime.slice(0, 5)}:00`;
    const schoolDays =
      settings?.school_days && settings.school_days.length > 0
        ? settings.school_days
        : ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];

    setIsSaving(true);
    try {
      // Fetch existing settings list to identify records to patch vs post
      const listRes = await apiClient.GET('/api/timetable-settings');
      const allExisting = listRes.data ?? [];

      // Pass selected years and their mapped semesters to the TimetableSettings endpoint
      const savedSettingsList = await Promise.all(
        selectedYears.map(async (yr) => {
          const sem = YEAR_SEMESTER_MAP[yr] || 1;
          const payload = {
            academic_year: yr,
            semester: sem,
            start_time: formattedStart,
            end_time: formattedEnd,
            period_minutes: Number(periodMinutes),
            lunch_minutes: Number(lunchMinutes),
            lunch_start: lunchStart,
            school_days: schoolDays,
          };

          const existing = allExisting.find(
            (s) => s.academic_year === yr && s.semester === sem
          );

          if (existing?.id) {
            const { data, error } = await apiClient.PATCH('/api/timetable-settings/{settings_id}', {
              params: { path: { settings_id: existing.id } },
              body: payload,
            });
            return !error && data ? data : existing;
          } else {
            const { data, error } = await apiClient.POST('/api/timetable-settings', {
              body: payload,
            });
            if (error) {
              const refreshed = await apiClient.GET('/api/timetable-settings');
              const match = (refreshed.data ?? []).find(
                (s) => s.academic_year === yr && s.semester === sem
              );
              if (match) {
                const patchRes = await apiClient.PATCH('/api/timetable-settings/{settings_id}', {
                  params: { path: { settings_id: match.id } },
                  body: payload,
                });
                return patchRes.data ?? match;
              }
            }
            return data;
          }
        })
      );

      // Calculate total teaching periods per day: all slots minus 1 for lunch
      const periodsPerDay = Math.max(0, slots.length - 1);
      const primaryYear = selectedYears[0] as AcademicYear;
      const primarySem = YEAR_SEMESTER_MAP[primaryYear] || 1;
      const primarySettings = savedSettingsList.find(Boolean) ?? settings;

      // Update frontend context
      updateState({
        academicYear: primaryYear,
        semester: primarySem,
        selectedYears,
        settings: primarySettings
          ? { ...primarySettings, periods_per_day: periodsPerDay }
          : null,
        periodsPerDay,
      });

      showToast({
        type: 'success',
        title: 'Settings Saved',
        message: `Saved settings for ${selectedYears.join(', ')} (${periodsPerDay} teaching periods/day). Lunch is Period ${selectedLunchIndex} (${lunchMinutes} mins).`,
      });

      nextStep();
    } catch (_err: unknown) {
      showToast({
        type: 'error',
        title: 'Save Failed',
        message: 'Could not save timetable settings. Please check your inputs.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="font-display font-bold text-base text-slate-900">Step 1: School Settings</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Configure academic term, daily hours, period length, and designate the lunch break.
        </p>
      </div>

      {/* Academic Term: Multi-Select Year */}
      <div className="border border-border rounded-xl bg-surface p-5 space-y-3 shadow-2xs">
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Academic Years <span className="text-rose-500">*</span>
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Select one or more academic years to configure. Semesters are fixed based on the year (FE &rarr; Sem 1, SE &rarr; Sem 3, TE &rarr; Sem 5, BE &rarr; Sem 7).
            </p>
          </div>
          <span className="text-[11px] text-slate-400 font-medium">
            {selectedYears.length} of {ACADEMIC_YEAR_OPTIONS.length} selected
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
          {ACADEMIC_YEAR_OPTIONS.map((year) => {
            const isChecked = selectedYears.includes(year);
            const sem = YEAR_SEMESTER_MAP[year];
            return (
              <label
                key={year}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  isChecked
                    ? 'border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300 shadow-2xs font-semibold'
                    : 'border-border hover:bg-blue-50/50 dark:hover:bg-blue-950/30 hover:border-blue-500/30 text-slate-700 dark:text-slate-300 bg-surface'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleYear(year)}
                  className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                />
                <div className="flex items-center justify-between flex-1">
                  <span className="text-sm font-bold">{year}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-normal">Sem {sem}</span>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* Daily Timings & Periods Setup */}
      <div className="border border-border rounded-xl bg-surface p-5 space-y-5 shadow-2xs">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Daily Timings & Period Setup
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Enter school operating hours and period lengths, then click Calculate Slots.
          </p>
        </div>

        {isLoading ? (
          <p className="text-xs text-slate-500">Loading settings...</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Input
              label="Start Time"
              type="time"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
            <Input
              label="End Time"
              type="time"
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
            <Input
              label="Period Length (min)"
              type="number"
              min={15}
              max={180}
              required
              value={periodMinutes}
              onChange={(e) => setPeriodMinutes(Number(e.target.value))}
            />
            <Input
              label="Lunch Length (min)"
              type="number"
              min={15}
              max={120}
              required
              value={lunchMinutes}
              onChange={(e) => setLunchMinutes(Number(e.target.value))}
            />
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => calculateSlots()}
            disabled={isCalculating || !startTime || !endTime}
          >
            {isCalculating ? 'Calculating...' : 'Calculate Slots'}
          </Button>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Click to calculate period slots between {startTime || '--:--'} and {endTime || '--:--'} (Lunch: {lunchMinutes}m).
          </span>
        </div>

        {/* Calculated Slots Display */}
        {slots.length > 0 && (
          <div className="pt-4 border-t border-border space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Select Lunch Period
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Click on one slot below to designate it as the daily lunch break ({lunchMinutes} mins).
                </p>
              </div>
              <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 border border-blue-200/70 dark:border-blue-800/50 px-2.5 py-0.5 rounded-full">
                {slots.length} Total Slots
              </span>
            </div>

            {/* Row of slot buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
              {slots.map((slot) => {
                const isSelectedLunch = selectedLunchIndex === slot.index;
                return (
                  <button
                    key={slot.index}
                    type="button"
                    onClick={() => handleLunchSelect(slot.index)}
                    className={`relative p-3 rounded-lg border text-left transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-1 flex flex-col justify-between ${
                      isSelectedLunch
                        ? 'bg-amber-500/15 border-amber-500/40 text-amber-800 dark:text-amber-300 font-medium shadow-xs ring-1 ring-amber-500/50'
                        : 'bg-surface border-border text-slate-700 dark:text-slate-300 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 hover:border-blue-500/40'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className={`text-xs font-bold ${isSelectedLunch ? 'text-amber-700 dark:text-amber-400' : 'text-slate-800 dark:text-slate-200'}`}>
                        Slot {slot.index}
                      </span>
                      {isSelectedLunch && (
                        <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 rounded">
                          Lunch ({lunchMinutes}m)
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] mt-1 font-mono text-slate-500 dark:text-slate-400">
                      {slot.label}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Summary Box */}
            {selectedLunchIndex !== null ? (
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg flex flex-wrap items-center justify-between text-xs text-amber-900 font-medium gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-base">🍱</span>
                  <span>
                    Total Teaching Periods: <strong className="font-bold text-amber-950">{totalTeachingPeriods}</strong>. Lunch is Period <strong className="font-bold text-amber-950">{selectedLunchIndex}</strong> ({lunchMinutes} mins).
                  </span>
                </div>
                <span className="text-[11px] text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded">
                  {slots.length} Periods/Day, Lunch is Period {selectedLunchIndex} ({lunchMinutes} mins)
                </span>
              </div>
            ) : (
              <div className="p-3 bg-amber-50/50 border border-dashed border-amber-300 rounded-lg text-xs text-amber-800">
                ⚠️ Please select one slot above to designate as the Lunch Period.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Form Action */}
      <div className="flex justify-end pt-2">
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={isSaving || slots.length === 0 || selectedLunchIndex === null}
        >
          {isSaving ? 'Saving...' : 'Save & Continue'}
        </Button>
      </div>
    </form>
  );
};
