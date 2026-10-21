import type { TimetableSlot } from './WizardContext';

/**
 * Client-side conflict detection over generated slots.
 *
 * The solver already refuses to emit conflicting slots, so these checks are
 * a safety net for the manual-edit path (EditCellModal) where a teacher or
 * room can be moved onto an occupied slot.
 *
 * Note: there is deliberately no "PT" (Physical Training) rule here — the
 * PT subject constraint was removed from this project.
 */

export interface Conflict {
  type: 'TEACHER_DOUBLE_BOOKED' | 'ROOM_DOUBLE_BOOKED';
  message: string;
  slotIds: number[];
}

/** Two slots clash when they share a day and overlap in time. */
const overlaps = (a: TimetableSlot, b: TimetableSlot): boolean => {
  if (a.day_of_week !== b.day_of_week) {
    return false;
  }
  return a.start_time < b.end_time && b.start_time < a.end_time;
};

/**
 * A lab occupies two consecutive period-slots with the same room and
 * teacher, so it is expected to appear as two rows that overlap. Two slots
 * only conflict when they differ in teacher or room.
 */
const sameAssignment = (a: TimetableSlot, b: TimetableSlot): boolean =>
  a.teacher_id === b.teacher_id && a.room_id === b.room_id;

export const findConflicts = (slots: TimetableSlot[]): Conflict[] => {
  const conflicts: Conflict[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i + 1; j < slots.length; j += 1) {
      const a = slots[i];
      const b = slots[j];
      if (!a || !b) {
        continue;
      }
      if (!overlaps(a, b)) {
        continue;
      }
      // Two rows of the same lab are one class, not a conflict.
      if (sameAssignment(a, b)) {
        continue;
      }

      if (a.teacher_id === b.teacher_id) {
        const key = `teacher:${a.teacher_id}:${a.day_of_week}`;
        if (!seen.has(key)) {
          seen.add(key);
          conflicts.push({
            type: 'TEACHER_DOUBLE_BOOKED',
            message: `Teacher #${a.teacher_id} is booked twice on ${a.day_of_week}.`,
            slotIds: [a.id, b.id],
          });
        }
      }

      if (a.room_id === b.room_id) {
        const key = `room:${a.room_id}:${a.day_of_week}`;
        if (!seen.has(key)) {
          seen.add(key);
          conflicts.push({
            type: 'ROOM_DOUBLE_BOOKED',
            message: `Room #${a.room_id} is booked twice on ${a.day_of_week}.`,
            slotIds: [a.id, b.id],
          });
        }
      }
    }
  }

  return conflicts;
};

/** True when the given slot would clash with any other slot. */
export const hasConflictWith = (
  slots: TimetableSlot[],
  candidate: TimetableSlot
): boolean => {
  const others = slots.filter((slot) => slot.id !== candidate.id);
  return findConflicts([...others, candidate]).length > 0;
};
