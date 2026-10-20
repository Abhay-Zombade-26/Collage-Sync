import React, { useState, useEffect, useMemo } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { useToast } from '../components/ui/useToast';
import { apiClient } from '../api/client';
import type { components } from '../api/schema';

type Division = components['schemas']['DivisionRead'];
type Subject = components['schemas']['SubjectRead'];
type Teacher = components['schemas']['TeacherRead'];
type Room = components['schemas']['RoomRead'];
type TimetableSlot = components['schemas']['TimetableSlotRead'];
type DayOfWeek = components['schemas']['DayOfWeek'];

const DAYS: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];

const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: 'Monday',
  TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday',
  FRIDAY: 'Friday',
};

/**
 * Extract a human-readable message from an openapi-fetch error payload.
 * The backend returns `{ "detail": ... }` for HTTPException responses and
 * `{ "detail": [{ msg, loc, ... }] }` for request validation errors.
 */
const extractErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'object' && error !== null && 'detail' in error) {
    const detail = (error as { detail: unknown }).detail;
    if (typeof detail === 'string') {
      return detail;
    }
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (first && typeof first.msg === 'string') {
        return first.msg;
      }
    }
    if (typeof detail === 'object' && detail !== null && 'message' in detail) {
      const message = (detail as { message: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
    }
  }
  return fallback;
};

/** "09:00:00" -> "09:00" for compact grid headers. */
const formatTime = (value: string): string => value.slice(0, 5);

export const TimetablePage: React.FC = () => {
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [selectedDivisionId, setSelectedDivisionId] = useState<number | ''>('');
  const [timetableSlots, setTimetableSlots] = useState<TimetableSlot[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  // Lookup tables so the grid can show names instead of raw ids.
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);

  const { showToast } = useToast();

  useEffect(() => {
    let mounted = true;
    const loadLookups = async () => {
      setIsLoading(true);
      try {
        const [divisionsRes, subjectsRes, teachersRes, roomsRes] = await Promise.all([
          apiClient.GET('/api/divisions'),
          apiClient.GET('/api/subjects'),
          apiClient.GET('/api/teachers'),
          apiClient.GET('/api/rooms'),
        ]);
        if (!mounted) {
          return;
        }
        setDivisions(divisionsRes.data ?? []);
        setSubjects(subjectsRes.data ?? []);
        setTeachers(teachersRes.data ?? []);
        setRooms(roomsRes.data ?? []);
      } catch (_err: unknown) {
        if (mounted) {
          setDivisions([]);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    loadLookups();
    return () => {
      mounted = false;
    };
  }, []);

  const subjectName = useMemo(() => {
    const map = new Map<number, string>();
    subjects.forEach((subject) => map.set(subject.id, subject.name));
    return map;
  }, [subjects]);

  const teacherName = useMemo(() => {
    const map = new Map<number, string>();
    teachers.forEach((teacher) => map.set(teacher.id, teacher.name));
    return map;
  }, [teachers]);

  const roomName = useMemo(() => {
    const map = new Map<number, string>();
    rooms.forEach((room) => map.set(room.id, room.name));
    return map;
  }, [rooms]);

  /**
   * The grid is keyed by day -> period start time. A lab spans two
   * consecutive periods, so each period keeps its own entry and the second
   * one is rendered as a continuation of the same class.
   */
  const grid = useMemo(() => {
    const periods: string[] = [];
    const seen = new Set<string>();

    timetableSlots.forEach((slot) => {
      const key = `${slot.day_of_week}|${slot.start_time}`;
      if (!seen.has(key)) {
        seen.add(key);
        periods.push(slot.start_time);
      }
    });

    const sortedPeriods = [...periods].sort((a, b) => a.localeCompare(b));

    const byDay = new Map<DayOfWeek, Map<string, TimetableSlot[]>>();
    DAYS.forEach((day) => {
      const dayCells = new Map<string, TimetableSlot[]>();
      timetableSlots
        .filter((slot) => slot.day_of_week === day)
        .forEach((slot) => {
          const key = slot.start_time;
          const bucket = dayCells.get(key);
          if (bucket) {
            bucket.push(slot);
          } else {
            dayCells.set(key, [slot]);
          }
        });
      byDay.set(day, dayCells);
    });

    return { periods: sortedPeriods, byDay };
  }, [timetableSlots]);

  const handleGenerate = async () => {
    if (selectedDivisionId === '') {
      showToast({
        type: 'error',
        title: 'No Division Selected',
        message: 'Select a division before generating a timetable.',
      });
      return;
    }

    const divisionId = selectedDivisionId;
    setIsGenerating(true);
    try {
      const { error } = await apiClient.POST('/api/timetable/generate', {
        body: { division_id: divisionId },
      });
      if (error) {
        showToast({
          type: 'error',
          title: 'Generation Failed',
          message: extractErrorMessage(error, 'Could not generate timetable.'),
        });
        return;
      }

      const slotsRes = await apiClient.GET('/api/timetable/{division_id}', {
        params: { path: { division_id: divisionId } },
      });
      if (slotsRes.error) {
        showToast({
          type: 'error',
          title: 'Could Not Load Timetable',
          message: extractErrorMessage(slotsRes.error, 'Could not load the generated timetable.'),
        });
        return;
      }

      setTimetableSlots(slotsRes.data ?? []);
      showToast({
        type: 'success',
        title: 'Timetable Generated',
        message: `Timetable generated for the selected division (${slotsRes.data?.length ?? 0} slots).`,
      });
    } catch (_err: unknown) {
      showToast({
        type: 'error',
        title: 'Generation Failed',
        message: 'Could not generate timetable.',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const renderCell = (slots: TimetableSlot[] | undefined) => {
    if (!slots || slots.length === 0) {
      return <span className="text-slate-300">—</span>;
    }
    return (
      <div className="space-y-1">
        {slots.map((slot) => (
          <div key={slot.id}>
            <p className="font-semibold text-slate-800 text-xs">
              {subjectName.get(slot.subject_id) ?? `Subject #${slot.subject_id}`}
            </p>
            <p className="text-[11px] text-slate-500">
              {teacherName.get(slot.teacher_id) ?? `Teacher #${slot.teacher_id}`}
            </p>
            <p className="text-[11px] text-slate-400">
              {roomName.get(slot.room_id) ?? `Room #${slot.room_id}`}
              {slot.is_lab ? ' · Lab' : ''}
              {slot.locked ? ' · Locked' : ''}
            </p>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <PageHeader
        title="Timetable"
        subtitle="Timetable Generation / Master Grid"
        action={
          <Button
            variant="primary"
            size="sm"
            onClick={handleGenerate}
            isLoading={isGenerating}
            disabled={isLoading || divisions.length === 0}
          >
            Generate Timetable
          </Button>
        }
      />

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <Select
            label="Select Division"
            value={selectedDivisionId}
            onChange={(event) => {
              const next = event.target.value;
              setSelectedDivisionId(next === '' ? '' : Number(next));
            }}
            disabled={isLoading || isGenerating}
          >
            <option value="">-- Select a division --</option>
            {divisions.map((division) => (
              <option key={division.id} value={division.id}>
                {division.name} · {division.department} · Year {division.year} · Sem {division.semester}
              </option>
            ))}
          </Select>
        </div>
        <Button
          variant="secondary"
          size="md"
          onClick={handleGenerate}
          isLoading={isGenerating}
          disabled={isLoading || divisions.length === 0}
        >
          Generate Timetable
        </Button>
      </div>

      {/* Main Content Viewport */}
      {isLoading ? (
        <div className="flex items-center justify-center p-16 bg-surface border border-slate-200 rounded">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <LoadingSpinner size="md" />
            <span>Loading timetable data...</span>
          </div>
        </div>
      ) : isGenerating ? (
        <div className="flex items-center justify-center p-16 bg-surface border border-slate-200 rounded">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <LoadingSpinner size="md" />
            <span>Generating timetable...</span>
          </div>
        </div>
      ) : timetableSlots.length === 0 ? (
        <EmptyState
          title="No timetable generated"
          description="Select a division and generate a timetable to see the weekly master grid."
          icon={
            <svg
              className="w-5 h-5 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          }
        />
      ) : (
        <div className="w-full overflow-x-auto border border-slate-200 rounded bg-surface">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="px-4 py-2.5 font-semibold select-none w-32">Day</th>
                {grid.periods.map((period) => (
                  <th key={period} className="px-4 py-2.5 font-semibold select-none">
                    {formatTime(period)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {DAYS.map((day) => {
                const dayCells = grid.byDay.get(day);
                return (
                  <tr key={day} className="hover:bg-slate-50/80 transition-colors duration-75 align-top">
                    <td className="px-4 py-2.5 font-semibold text-slate-800 whitespace-nowrap">
                      {DAY_LABELS[day]}
                    </td>
                    {grid.periods.map((period) => (
                      <td key={period} className="px-4 py-2.5 text-slate-800 align-top">
                        {renderCell(dayCells?.get(period))}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
