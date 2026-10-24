import React, { useMemo, useState } from 'react';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from '../../components/ui/Badge';
import type { components } from '../../api/schema';
import type { DayOfWeek, TimetableSlot } from './WizardContext';
import { findConflicts } from './conflictChecker';

type Subject = components['schemas']['SubjectRead'];
type Teacher = components['schemas']['TeacherRead'];
type Room = components['schemas']['RoomRead'];

const DAYS: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];

const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: 'Monday',
  TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday',
  FRIDAY: 'Friday',
};

export interface TimetableGridProps {
  slots: TimetableSlot[];
  subjects: Subject[];
  teachers: Teacher[];
  rooms: Room[];
  onEditCell?: (slot: TimetableSlot) => void;
}

/** "09:00:00" -> "09:00" for compact grid headers. */
const formatTime = (value: string): string => value.slice(0, 5);

export const TimetableGrid: React.FC<TimetableGridProps> = ({
  slots,
  subjects,
  teachers,
  rooms,
  onEditCell,
}) => {
  const [showConflictsOnly, setShowConflictsOnly] = useState(false);

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

  const conflicts = useMemo(() => findConflicts(slots), [slots]);
  const conflictingSlotIds = useMemo(() => {
    const ids = new Set<number>();
    conflicts.forEach((conflict) => conflict.slotIds.forEach((id) => ids.add(id)));
    return ids;
  }, [conflicts]);

  /**
   * Grid layout: rows are days, columns are the distinct period start
   * times. A practical spans two consecutive periods, so it shows up in
   * two cells with the same teacher and room.
   */
  const { periods, byDay } = useMemo(() => {
    const allPeriods: string[] = [];
    const seen = new Set<string>();
    slots.forEach((slot) => {
      if (!seen.has(slot.start_time)) {
        seen.add(slot.start_time);
        allPeriods.push(slot.start_time);
      }
    });
    const sorted = [...allPeriods].sort((a, b) => a.localeCompare(b));

    const cells = new Map<DayOfWeek, Map<string, TimetableSlot[]>>();
    DAYS.forEach((day) => cells.set(day, new Map()));
    slots.forEach((slot) => {
      const dayCells = cells.get(slot.day_of_week);
      if (!dayCells) {
        return;
      }
      const bucket = dayCells.get(slot.start_time);
      if (bucket) {
        bucket.push(slot);
      } else {
        dayCells.set(slot.start_time, [slot]);
      }
    });

    return { periods: sorted, byDay: cells };
  }, [slots]);

  if (slots.length === 0) {
    return (
      <EmptyState
        title="No timetable generated"
        description="Run the wizard to generate a timetable for a division."
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
    );
  }

  return (
    <div className="space-y-3">
      {/* Conflict summary */}
      <div className="flex flex-wrap items-center gap-3">
        {conflicts.length === 0 ? (
          <Badge variant="status-active" size="sm">
            No conflicts detected
          </Badge>
        ) : (
          <>
            <Badge variant="status-inactive" size="sm">
              {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'}
            </Badge>
            <button
              type="button"
              onClick={() => setShowConflictsOnly((prev) => !prev)}
              className="text-[11px] text-slate-600 hover:text-slate-900 underline"
            >
              {showConflictsOnly ? 'Show all cells' : 'Show conflicting cells only'}
            </button>
          </>
        )}
      </div>

      {showConflictsOnly && conflicts.length > 0 && (
        <ul className="text-[11px] text-danger space-y-0.5">
          {conflicts.map((conflict) => (
            <li key={`${conflict.type}-${conflict.slotIds.join('-')}`}>{conflict.message}</li>
          ))}
        </ul>
      )}

      <div className="w-full overflow-x-auto border border-slate-200 rounded bg-surface">
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              <th className="px-4 py-2.5 font-semibold select-none w-28">Day</th>
              {periods.map((period) => (
                <th key={period} className="px-4 py-2.5 font-semibold select-none">
                  {formatTime(period)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {DAYS.map((day) => {
              const dayCells = byDay.get(day);
              const dayHasVisibleCell = dayCells
                ? Array.from(dayCells.values()).some((cell) =>
                    cell.some((slot) => !showConflictsOnly || conflictingSlotIds.has(slot.id))
                  )
                : false;

              if (showConflictsOnly && !dayHasVisibleCell) {
                return null;
              }

              return (
                <tr
                  key={day}
                  className="hover:bg-slate-50/80 transition-colors duration-75 align-top"
                >
                  <td className="px-4 py-2.5 font-semibold text-slate-800 whitespace-nowrap">
                    {DAY_LABELS[day]}
                  </td>
                  {periods.map((period) => {
                    const cell = dayCells?.get(period) ?? [];
                    const visible = cell.filter(
                      (slot) => !showConflictsOnly || conflictingSlotIds.has(slot.id)
                    );
                    return (
                      <td key={period} className="px-4 py-2.5 align-top min-w-[9rem]">
                        {visible.length === 0 ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <div className="space-y-1">
                            {visible.map((slot) => (
                              <div
                                key={slot.id}
                                className={
                                  conflictingSlotIds.has(slot.id)
                                    ? 'rounded border border-danger-border bg-danger-subtle p-1.5'
                                    : 'rounded border border-slate-200 p-1.5'
                                }
                              >
                                <p className="font-semibold text-slate-800 text-xs">
                                  {subjectName.get(slot.subject_id) ??
                                    `Subject #${slot.subject_id}`}
                                </p>
                                <p className="text-[11px] text-slate-500">
                                  {teacherName.get(slot.teacher_id) ??
                                    `Teacher #${slot.teacher_id}`}
                                </p>
                                <p className="text-[11px] text-slate-400">
                                  {roomName.get(slot.room_id) ?? `Room #${slot.room_id}`}
                                  {slot.is_lab ? ' · Lab' : ''}
                                  {slot.locked ? ' · Locked' : ''}
                                </p>
                                {onEditCell && (
                                  <button
                                    type="button"
                                    onClick={() => onEditCell(slot)}
                                    className="mt-1 text-[10px] uppercase tracking-wider text-slate-500 hover:text-accent"
                                  >
                                    Edit
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
