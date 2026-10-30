import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { EmptyState } from '../../components/ui/EmptyState';
import { Badge } from '../../components/ui/Badge';
import { apiClient } from '../../api/client';
import type { components } from '../../api/schema';
import type { DayOfWeek, TimetableSlot, Batch } from './WizardContext';
import { findConflicts } from './conflictChecker';

type Subject = components['schemas']['SubjectRead'];
type Teacher = components['schemas']['TeacherRead'];
type Room = components['schemas']['RoomRead'];

export const DAYS: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];

export const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: 'Monday',
  TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday',
  FRIDAY: 'Friday',
};

export interface TimetableGridProps {
  slots?: TimetableSlot[];
  schedule?: TimetableSlot[];
  subjects?: Subject[];
  teachers?: Teacher[];
  rooms?: Room[];
  batches?: Batch[];
  divisionName?: string;
  onEditCell?: (slot: TimetableSlot) => void;
}

/** "09:00:00" -> "09:00" for compact grid headers. */
export const formatTime = (value: string): string => value.slice(0, 5);

/**
 * Format a slot string to match the college timetable Excel format:
 * - Lab:    Subject Name (Batch) / Teacher / Room  (e.g., "Web Lab (A1) / GMA / 701")
 * - Theory: Subject Name / Teacher / Room          (e.g., "DBMS / RVB / 705")
 */
export const formatSlotString = (
  slot: TimetableSlot,
  subjectMap: Map<number, string>,
  teacherMap: Map<number, string>,
  roomMap: Map<number, string>,
  batchMap: Map<number, string>
): string => {
  const subj = subjectMap.get(slot.subject_id) ?? `Subject #${slot.subject_id}`;
  const teacher = teacherMap.get(slot.teacher_id) ?? `Teacher #${slot.teacher_id}`;
  const room = roomMap.get(slot.room_id) ?? `Room #${slot.room_id}`;
  const batch = slot.batch_id ? batchMap.get(slot.batch_id) : undefined;
  const tutorialSuffix = slot.is_tutorial ? ' (Tutorial)' : '';

  if (slot.is_lab && batch) {
    return `${subj}${tutorialSuffix} (${batch}) / ${teacher} / ${room}`;
  }
  return `${subj}${tutorialSuffix} / ${teacher} / ${room}`;
};

/**
 * Day labels with letter-spacing matching the college manual format.
 */
const DAY_SPACED: Record<DayOfWeek, string> = {
  MONDAY: 'M O N',
  TUESDAY: 'T U E',
  WEDNESDAY: 'W E D',
  THURSDAY: 'T H U',
  FRIDAY: 'F R I',
};

/**
 * Format a 24-hour "HH:MM:SS" string into a 12-hour-style "HH:MM" display.
 * Hours > 12 are folded (13 -> 01, 14 -> 02, etc.).
 */
const fmtClockTime = (t: string): string => {
  let h = parseInt(t.slice(0, 2), 10);
  const m = t.slice(3, 5);
  if (h > 12) h -= 12;
  return `${h.toString().padStart(2, '0')}:${m}`;
};

/**
 * Normalize a time string (e.g., "10:00:00" -> "10:00") for column matching.
 */
export const normalizeTimeKey = (timeStr: string): string => {
  if (!timeStr) return '';
  const parts = timeStr.split(':');
  if (parts.length >= 2) {
    const h = parts[0]?.padStart(2, '0') ?? '00';
    const m = parts[1]?.padStart(2, '0') ?? '00';
    return `${h}:${m}`;
  }
  return timeStr.slice(0, 5);
};

export interface GridColumnDef {
  id: string;
  name: string;
  timeRange: string;
  isRecess: boolean;
  startKey?: string;
  periodIndex?: number;
}

/**
 * Exact hardcoded 10-column layout (including recess):
 * Periods 1 to 4 (morning), Recess, Periods 5 to 8 (afternoon).
 */
export const HARDCODED_COLUMNS: GridColumnDef[] = [
  { id: 'p1', name: 'Period 1', timeRange: '09:00 - 10:00', isRecess: false, startKey: '09:00', periodIndex: 0 },
  { id: 'p2', name: 'Period 2', timeRange: '10:00 - 11:00', isRecess: false, startKey: '10:00', periodIndex: 1 },
  { id: 'p3', name: 'Period 3', timeRange: '11:00 - 12:00', isRecess: false, startKey: '11:00', periodIndex: 2 },
  { id: 'p4', name: 'Period 4', timeRange: '12:00 - 13:00', isRecess: false, startKey: '12:00', periodIndex: 3 },
  { id: 'recess', name: 'R E C E S S', timeRange: '13:00 - 13:45', isRecess: true },
  { id: 'p5', name: 'Period 5', timeRange: '13:45 - 14:45', isRecess: false, startKey: '13:45', periodIndex: 4 },
  { id: 'p6', name: 'Period 6', timeRange: '14:45 - 15:45', isRecess: false, startKey: '14:45', periodIndex: 5 },
  { id: 'p7', name: 'Period 7', timeRange: '15:45 - 16:45', isRecess: false, startKey: '15:45', periodIndex: 6 },
  { id: 'p8', name: 'Period 8', timeRange: '16:45 - 17:45', isRecess: false, startKey: '16:45', periodIndex: 7 },
];

export const TEACHING_PERIODS = HARDCODED_COLUMNS.filter(
  (c): c is GridColumnDef & { startKey: string; periodIndex: number } =>
    !c.isRecess && c.periodIndex !== undefined && !!c.startKey
);

/**
 * Column definition used internally to build the Excel sheet.
 */
interface _ExcelCol {
  periodNum: string;
  rangeLabel: string;
  isRecess: boolean;
  startKey?: string;
}

/**
 * Standard 9-period college timetable layout:
 * - Periods 1.0 to 4.0: Morning slots (09:00 - 01:00)
 * - Period 5.0: Lunch / Recess (01:00 - 01:45)
 * - Periods 6.0 to 9.0: Afternoon slots (01:45 - 05:45)
 */
const STANDARD_COLUMNS: _ExcelCol[] = [
  { periodNum: '1.0', rangeLabel: '09:00-10:00', isRecess: false, startKey: '09:00' },
  { periodNum: '2.0', rangeLabel: '10:00-11:00', isRecess: false, startKey: '10:00' },
  { periodNum: '3.0', rangeLabel: '11:00-12:00', isRecess: false, startKey: '11:00' },
  { periodNum: '4.0', rangeLabel: '12:00-01:00', isRecess: false, startKey: '12:00' },
  { periodNum: '5.0', rangeLabel: '01:00-01:45', isRecess: true },
  { periodNum: '6.0', rangeLabel: '01:45-02:45', isRecess: false, startKey: '13:45' },
  { periodNum: '7.0', rangeLabel: '02:45-03:45', isRecess: false, startKey: '14:45' },
  { periodNum: '8.0', rangeLabel: '03:45-04:45', isRecess: false, startKey: '15:45' },
  { periodNum: '9.0', rangeLabel: '04:45-05:45', isRecess: false, startKey: '16:45' },
];

/**
 * Generates an Excel (.xlsx) file matching the college's official manual timetable
 * layout and triggers a browser download.
 */
export const exportTimetableToExcel = async (
  slots: TimetableSlot[],
  subjectMap: Map<number, string>,
  teacherMap: Map<number, string>,
  roomMap: Map<number, string>,
  batchMap: Map<number, string>,
  divisionName?: string,
  divisionYear?: string,
  divisionSemester?: string | number,
): Promise<void> => {
  // Determine columns: use standard 9 periods if all slots match standard timing
  const standardKeys = new Set(
    STANDARD_COLUMNS.filter((c) => !c.isRecess).map((c) => c.startKey)
  );
  const hasCustomTiming = slots.some(
    (slot) => !standardKeys.has(slot.start_time.slice(0, 5))
  );

  let columns: _ExcelCol[];
  if (!hasCustomTiming) {
    columns = STANDARD_COLUMNS;
  } else {
    // Dynamically compute period columns from slot data
    const periodTimeMap = new Map<string, string>();
    slots.forEach((slot) => {
      const s = slot.start_time.slice(0, 5);
      if (!periodTimeMap.has(s)) {
        periodTimeMap.set(s, slot.end_time.slice(0, 5));
      }
    });
    const sortedEntries = [...periodTimeMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    let recessInsertIdx = -1;
    for (let i = 0; i < sortedEntries.length - 1; i++) {
      const current = sortedEntries[i];
      const next = sortedEntries[i + 1];
      if (current && next && current[1] < next[0]) {
        recessInsertIdx = i + 1;
        break;
      }
    }

    columns = [];
    let pNum = 1;
    for (let i = 0; i < sortedEntries.length; i++) {
      const entry = sortedEntries[i];
      if (!entry) continue;

      if (i === recessInsertIdx) {
        const rStart = sortedEntries[i - 1]?.[1] ?? '13:00';
        const rEnd = entry[0];
        columns.push({
          periodNum: `${pNum}.0`,
          rangeLabel: `${fmtClockTime(rStart)}-${fmtClockTime(rEnd)}`,
          isRecess: true,
        });
        pNum++;
      }
      const [startT, endT] = entry;
      columns.push({
        periodNum: `${pNum}.0`,
        rangeLabel: `${fmtClockTime(startT)}-${fmtClockTime(endT)}`,
        isRecess: false,
        startKey: startT,
      });
      pNum++;
    }
  }

  // -- Build 2D array for worksheet --
  const totalCols = 1 + columns.length;
  const emptyRow = (): string[] => Array(totalCols).fill('');

  const displayYear = divisionYear || 'TE';
  const displaySem = divisionSemester !== undefined ? String(divisionSemester) : '5';
  const displayDiv = divisionName || 'A';

  // Title rows (1-5)
  const row1 = emptyRow(); row1[0] = 'DATTA MEGHE COLLEGE OF ENGINEERING, Airoli, Navi Mumbai';
  const row2 = emptyRow(); row2[0] = 'DEPARTMENT OF INFORMATION TECHNOLOGY';
  const row3 = emptyRow(); row3[0] = 'DIVISION TIME TABLE (Term - I A. Y. 2026-27)';
  const row4 = emptyRow(); row4[0] = `YEAR: ${displayYear} | SEMESTER: ${displaySem} | Division: ${displayDiv}`;
  const row5 = emptyRow(); row5[0] = 'Date of Commencement of Term: 06/07/2026';

  // Headers (6-7)
  const row6: string[] = ['DAYS', ...columns.map((c) => c.periodNum)];
  const row7: string[] = ['', ...columns.map((c) => c.rangeLabel)];

  // Data rows (8-12)
  const dataRows: string[][] = DAYS.map((day) => {
    const row: string[] = [DAY_SPACED[day]];
    for (const col of columns) {
      if (col.isRecess) {
        row.push('R E C E S S');
        continue;
      }
      const matchingSlots = slots.filter(
        (s) => s.day_of_week === day && s.start_time.slice(0, 5) === col.startKey
      );
      if (matchingSlots.length === 0) {
        row.push('');
      } else {
        const lines = matchingSlots.map((s) =>
          formatSlotString(s, subjectMap, teacherMap, roomMap, batchMap)
        );
        const uniqueLines = Array.from(new Set(lines));
        row.push(uniqueLines.join('\n'));
      }
    }
    return row;
  });

  const aoa = [row1, row2, row3, row4, row5, row6, row7, ...dataRows];

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths
  worksheet['!cols'] = [
    { wch: 12 },
    ...columns.map((c) => ({ wch: c.isRecess ? 16 : 28 })),
  ];

  // Row heights
  worksheet['!rows'] = [
    { hpt: 24 }, // Row 1
    { hpt: 20 }, // Row 2
    { hpt: 20 }, // Row 3
    { hpt: 18 }, // Row 4
    { hpt: 18 }, // Row 5
    { hpt: 20 }, // Row 6
    { hpt: 20 }, // Row 7
    ...DAYS.map(() => ({ hpt: 65 })), // Data rows
  ];

  // Apply wrapText alignment to data cells
  const dataStartRow = 7;
  for (let r = dataStartRow; r < dataStartRow + DAYS.length; r++) {
    for (let c = 1; c < totalCols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (worksheet[addr]) {
        worksheet[addr].s = {
          alignment: { wrapText: true, vertical: 'top' },
        };
      }
    }
  }

  // Merge title rows across the table and merge recess column across Mon-Fri
  const recessColIdx = columns.findIndex((c) => c.isRecess) + 1;
  const merges: XLSX.Range[] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: totalCols - 1 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: totalCols - 1 } },
    { s: { r: 4, c: 0 }, e: { r: 4, c: totalCols - 1 } },
  ];
  if (recessColIdx > 0) {
    merges.push({
      s: { r: dataStartRow, c: recessColIdx },
      e: { r: dataStartRow + DAYS.length - 1, c: recessColIdx },
    });
  }
  worksheet['!merges'] = merges;

  const workbook = XLSX.utils.book_new();
  const sheetName = (displayDiv || 'Timetable').slice(0, 31);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  // Download filename: [Division_Name]_Timetable.xlsx (e.g. TE-A_Timetable.xlsx)
  const fileDivision = displayDiv.includes(displayYear)
    ? displayDiv
    : `${displayYear}-${displayDiv}`;
  const cleanName = fileDivision.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
  const fileName = `${cleanName || 'Timetable'}_Timetable.xlsx`;

  XLSX.writeFile(workbook, fileName);
};

export const TimetableGrid: React.FC<TimetableGridProps> = ({
  slots,
  schedule,
  subjects = [],
  teachers = [],
  rooms = [],
  batches,
  divisionName: _divisionName,
  onEditCell,
}) => {
  const effectiveSlots = useMemo(() => schedule ?? slots ?? [], [schedule, slots]);
  const [showConflictsOnly, setShowConflictsOnly] = useState(false);
  const [internalSubjects, setInternalSubjects] = useState<Subject[]>([]);
  const [internalTeachers, setInternalTeachers] = useState<Teacher[]>([]);
  const [internalRooms, setInternalRooms] = useState<Room[]>([]);
  const [internalBatches, setInternalBatches] = useState<Batch[]>([]);

  // Auto-fetch lookups if not provided by parent component
  useEffect(() => {
    let mounted = true;
    if ((!subjects || subjects.length === 0) && internalSubjects.length === 0) {
      apiClient.GET('/api/subjects').then((res) => {
        if (mounted && res.data) setInternalSubjects(res.data);
      });
    }
    if ((!teachers || teachers.length === 0) && internalTeachers.length === 0) {
      apiClient.GET('/api/teachers').then((res) => {
        if (mounted && res.data) setInternalTeachers(res.data);
      });
    }
    if ((!rooms || rooms.length === 0) && internalRooms.length === 0) {
      apiClient.GET('/api/rooms').then((res) => {
        if (mounted && res.data) setInternalRooms(res.data);
      });
    }
    if ((!batches || batches.length === 0) && internalBatches.length === 0) {
      apiClient.GET('/api/batches').then((res) => {
        if (mounted && res.data) setInternalBatches(res.data);
      });
    }
    return () => {
      mounted = false;
    };
  }, [
    subjects?.length,
    teachers?.length,
    rooms?.length,
    batches?.length,
    internalSubjects.length,
    internalTeachers.length,
    internalRooms.length,
    internalBatches.length,
  ]);

  const allSubjects = subjects && subjects.length > 0 ? subjects : internalSubjects;
  const allTeachers = teachers && teachers.length > 0 ? teachers : internalTeachers;
  const allRooms = rooms && rooms.length > 0 ? rooms : internalRooms;
  const allBatches = batches && batches.length > 0 ? batches : internalBatches;

  const subjectName = useMemo(() => {
    const map = new Map<number, string>();
    allSubjects.forEach((subject) => map.set(subject.id, subject.name));
    return map;
  }, [allSubjects]);

  const teacherName = useMemo(() => {
    const map = new Map<number, string>();
    allTeachers.forEach((teacher) => map.set(teacher.id, teacher.name));
    return map;
  }, [allTeachers]);

  const roomName = useMemo(() => {
    const map = new Map<number, string>();
    allRooms.forEach((room) => map.set(room.id, room.name));
    return map;
  }, [allRooms]);

  const batchMap = useMemo(() => {
    const map = new Map<number, string>();
    allBatches.forEach((batch) => map.set(batch.id, batch.name));
    return map;
  }, [allBatches]);

  const conflicts = useMemo(() => findConflicts(effectiveSlots), [effectiveSlots]);
  const conflictingSlotIds = useMemo(() => {
    const ids = new Set<number>();
    conflicts.forEach((conflict) => conflict.slotIds.forEach((id) => ids.add(id)));
    return ids;
  }, [conflicts]);

  /**
   * Group slots by Day and Period Index (0 to 7) based on exact hardcoded start times.
   */
  const periodsByDay = useMemo(() => {
    const map = new Map<DayOfWeek, TimetableSlot[][]>();
    DAYS.forEach((day) => {
      map.set(day, [[], [], [], [], [], [], [], []]);
    });

    effectiveSlots.forEach((slot) => {
      const dayBuckets = map.get(slot.day_of_week);
      if (!dayBuckets) return;

      const timeKey = normalizeTimeKey(slot.start_time);
      const pIdx = TEACHING_PERIODS.findIndex((p) => p.startKey === timeKey);
      if (pIdx !== -1 && dayBuckets[pIdx]) {
        dayBuckets[pIdx].push(slot);
      }
    });

    return map;
  }, [effectiveSlots]);

  const visibleDays = useMemo(() => {
    return DAYS.filter((day) => {
      if (!showConflictsOnly) return true;
      const dayBuckets = periodsByDay.get(day);
      if (!dayBuckets) return false;
      return dayBuckets.some((bucket) =>
        bucket.some((slot) => conflictingSlotIds.has(slot.id))
      );
    });
  }, [periodsByDay, showConflictsOnly, conflictingSlotIds]);

  if (effectiveSlots.length === 0) {
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
      {/* Grid Controls & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded p-2.5 text-xs">
        <div className="flex items-center gap-3">
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
                className="text-[11px] text-slate-600 hover:text-slate-900 underline font-medium"
              >
                {showConflictsOnly ? 'Show all cells' : 'Show conflicting cells only'}
              </button>
            </>
          )}
        </div>
      </div>

      {showConflictsOnly && conflicts.length > 0 && (
        <ul className="text-[11px] text-danger space-y-0.5">
          {conflicts.map((conflict) => (
            <li key={`${conflict.type}-${conflict.slotIds.join('-')}`}>{conflict.message}</li>
          ))}
        </ul>
      )}

      {/* Excel Sheet Table View matching College Layout */}
      <div className="w-full overflow-x-auto border border-slate-300 rounded bg-white shadow-xs">
        <table className="w-full border-collapse border border-slate-300 text-xs text-center">
          <thead>
            <tr className="bg-slate-100 text-slate-800 font-semibold border-b border-slate-300">
              <th className="p-2 border border-slate-300 select-none text-center w-24 min-w-[5.5rem]">
                Day
              </th>
              {HARDCODED_COLUMNS.map((col) => (
                <th
                  key={col.id}
                  className={`p-2 border border-slate-300 select-none text-center ${
                    col.isRecess ? 'bg-slate-200/80 w-12 min-w-[3rem]' : 'min-w-[9.5rem]'
                  }`}
                >
                  <div
                    className={`font-semibold ${
                      col.isRecess ? 'text-slate-800 text-[11px] tracking-wider' : 'text-slate-900'
                    }`}
                  >
                    {col.name}
                  </div>
                  <div className={`font-normal text-slate-500 ${col.isRecess ? 'text-[10px]' : 'text-[11px]'}`}>
                    {col.timeRange}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleDays.length === 0 && showConflictsOnly ? (
              <tr>
                <td colSpan={10} className="p-8 text-center text-slate-500 bg-white border border-slate-300">
                  No conflicting slots found.
                </td>
              </tr>
            ) : (
              visibleDays.map((day, dayIdx) => {
                const daySlotsByPeriod = periodsByDay.get(day) ?? [[], [], [], [], [], [], [], []];

                // Compute horizontal merge for consecutive lab periods:
                // p: 0, 1, 2, 3 (morning), 4, 5, 6, 7 (afternoon)
                const skipPeriod = [false, false, false, false, false, false, false, false];
                const colSpans = [1, 1, 1, 1, 1, 1, 1, 1];

                for (let p = 0; p < 8; p++) {
                  if (skipPeriod[p]) continue;

                  // Cannot merge across recess (p = 3) or beyond last period (p = 7)
                  if (p !== 3 && p < 7) {
                    const curSlots = daySlotsByPeriod[p] ?? [];
                    const nextSlots = daySlotsByPeriod[p + 1] ?? [];
                    const curLabs = curSlots.filter((s) => s.is_lab);
                    const nextLabs = nextSlots.filter((s) => s.is_lab);

                    if (
                      curLabs.length > 0 &&
                      curLabs.every((c) =>
                        nextLabs.some(
                          (n) =>
                            n.subject_id === c.subject_id &&
                            n.teacher_id === c.teacher_id &&
                            n.room_id === c.room_id &&
                            n.batch_id === c.batch_id
                        )
                      )
                    ) {
                      colSpans[p] = 2;
                      skipPeriod[p + 1] = true;
                    }
                  }
                }

                const renderPeriodCell = (p: number) => {
                  if (skipPeriod[p]) return null;

                  const rawSlots = daySlotsByPeriod[p] ?? [];
                  const visible = rawSlots.filter(
                    (slot) => !showConflictsOnly || conflictingSlotIds.has(slot.id)
                  );

                  // Deduplicate identical slot representations for parallel batch display
                  const seen = new Set<string>();
                  const uniqueSlots: TimetableSlot[] = [];
                  visible.forEach((slot) => {
                    const key = `${slot.subject_id}-${slot.batch_id ?? 'all'}-${slot.teacher_id}-${slot.room_id}`;
                    if (!seen.has(key)) {
                      seen.add(key);
                      uniqueSlots.push(slot);
                    }
                  });

                  if (uniqueSlots.length === 0) {
                    return (
                      <td
                        key={`p-${p}`}
                        colSpan={colSpans[p]}
                        className="p-2 border border-slate-300 bg-white align-middle text-center"
                      />
                    );
                  }

                  return (
                    <td
                      key={`p-${p}`}
                      colSpan={colSpans[p]}
                      className="p-2 border border-slate-300 bg-white align-middle text-center"
                    >
                      <div className="flex flex-col items-center justify-center gap-1.5 text-center">
                        {uniqueSlots.map((slot) => {
                          const subj = subjectName.get(slot.subject_id) ?? `Subject #${slot.subject_id}`;
                          const teacher = teacherName.get(slot.teacher_id) ?? `Teacher #${slot.teacher_id}`;
                          const room = roomName.get(slot.room_id) ?? `Room #${slot.room_id}`;
                          const batch = slot.batch_id ? batchMap.get(slot.batch_id) : undefined;
                          const tutorialSuffix = slot.is_tutorial ? ' (Tutorial)' : '';
                          const subjectLabel =
                            slot.is_lab && batch
                              ? `${subj}${tutorialSuffix} (${batch})`
                              : `${subj}${tutorialSuffix}`;

                          const isConflict = conflictingSlotIds.has(slot.id);

                          return (
                            <div
                              key={slot.id}
                              onClick={() => onEditCell?.(slot)}
                              title={`${subjectLabel} / ${teacher} / ${room}${
                                onEditCell ? ' (Click to edit)' : ''
                              }`}
                              className={`p-1 rounded text-xs leading-normal select-none w-full ${
                                onEditCell ? 'cursor-pointer hover:bg-slate-100 transition-colors' : ''
                              } ${
                                isConflict
                                  ? 'bg-red-50 text-red-700 font-semibold border border-red-300'
                                  : 'text-slate-900'
                              }`}
                            >
                              <div className="whitespace-normal break-words text-center">
                                <span className="font-bold text-slate-900">{subjectLabel}</span>
                                <span className="text-slate-600"> / </span>
                                <span className="text-slate-800">{teacher}</span>
                                <span className="text-slate-600"> / </span>
                                <span className="text-slate-800">{room}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  );
                };

                return (
                  <tr key={day} className="hover:bg-slate-50/40 transition-colors">
                    {/* Day Column */}
                    <td className="p-2 font-bold text-slate-800 bg-slate-50 border border-slate-300 text-center align-middle whitespace-nowrap">
                      {DAY_LABELS[day]}
                    </td>

                    {/* Morning Periods 1 to 4 */}
                    {[0, 1, 2, 3].map((p) => renderPeriodCell(p))}

                    {/* RECESS Column (rendered on first visible row with rowSpan) */}
                    {dayIdx === 0 && (
                      <td
                        rowSpan={visibleDays.length}
                        className="bg-slate-100 border border-slate-300 text-center align-middle p-2 select-none w-12 min-w-[3rem]"
                      >
                        <div className="flex items-center justify-center h-full">
                          <span
                            style={{
                              writingMode: 'vertical-rl',
                              transform: 'rotate(180deg)',
                            }}
                            className="tracking-[0.6em] font-bold text-xs text-slate-600 uppercase select-none inline-block whitespace-nowrap py-4"
                          >
                            R E C E S S
                          </span>
                        </div>
                      </td>
                    )}

                    {/* Afternoon Periods 5 to 8 */}
                    {[4, 5, 6, 7].map((p) => renderPeriodCell(p))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
