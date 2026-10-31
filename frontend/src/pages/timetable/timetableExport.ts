import jsPDF from 'jspdf';
import autoTable, { type RowInput, type UserOptions } from 'jspdf-autotable';
import * as XLSX from 'xlsx-js-style';
import type { components } from '../../api/schema';
import type { DayOfWeek, TimetableSlot, Batch } from './WizardContext';

type Subject = components['schemas']['SubjectRead'];
type Teacher = components['schemas']['TeacherRead'];
type Room = components['schemas']['RoomRead'];

export const DAYS: DayOfWeek[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];

const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: 'M O N',
  TUESDAY: 'T U E',
  WEDNESDAY: 'W E D',
  THURSDAY: 'T H U',
  FRIDAY: 'F R I',
};

export interface ExportColumnDef {
  periodNum: string;
  rangeLabel: string;
  isRecess: boolean;
  startKey?: string;
  endKey?: string;
}

const STANDARD_COLUMNS: ExportColumnDef[] = [
  { periodNum: '1', rangeLabel: '9.00-10.00', isRecess: false, startKey: '09:00', endKey: '10:00' },
  { periodNum: '2', rangeLabel: '10.00-11.00', isRecess: false, startKey: '10:00', endKey: '11:00' },
  { periodNum: '3', rangeLabel: '11.00-12.00', isRecess: false, startKey: '11:00', endKey: '12:00' },
  { periodNum: '4', rangeLabel: '12.00-1.00', isRecess: false, startKey: '12:00', endKey: '13:00' },
  { periodNum: '5', rangeLabel: '1.00-1.45', isRecess: true, startKey: '13:00', endKey: '13:45' },
  { periodNum: '6', rangeLabel: '1.45-2.45', isRecess: false, startKey: '13:45', endKey: '14:45' },
  { periodNum: '7', rangeLabel: '2.45-3.45', isRecess: false, startKey: '14:45', endKey: '15:45' },
  { periodNum: '8', rangeLabel: '3.45-4.45', isRecess: false, startKey: '15:45', endKey: '16:45' },
  { periodNum: '9', rangeLabel: '4.45-5.45', isRecess: false, startKey: '16:45', endKey: '17:45' },
];

/** Format a 24-hr HH:MM string to clock display e.g. "09:00" -> "9.00", "13:45" -> "1.45" */
export const formatClockTime = (t: string): string => {
  const parts = t.slice(0, 5).split(':');
  let h = parseInt(parts[0] || '0', 10);
  const m = parts[1] || '00';
  if (h > 12) h -= 12;
  const mStr = m === '00' ? '00' : m;
  return `${h}.${mStr}`;
};

/** Extracts a concise 2-4 uppercase letter faculty abbreviation from teacher name */
export const getTeacherAbbreviation = (fullName: string): string => {
  if (!fullName) return 'FAC';
  const clean = fullName
    .replace(/^(Dr\.|Dr|Prof\.|Prof|Mr\.|Mr|Mrs\.|Mrs|Ms\.|Ms)\s+/i, '')
    .trim();

  // Pattern with initials: e.g. "G.M. Arwindekar" -> GMA, "D.P. Kadam" -> DPK
  const dotParts = clean.split('.').map((s) => s.trim()).filter(Boolean);
  if (dotParts.length > 1) {
    const initials = dotParts.slice(0, -1).map((p) => p[0]?.toUpperCase() || '').join('');
    const lastWord = dotParts[dotParts.length - 1];
    const surnameInitial = lastWord ? lastWord[0]?.toUpperCase() || '' : '';
    const res = `${initials}${surnameInitial}`;
    if (res.length >= 2) return res;
  }

  // Two or more words: e.g. "Pankaj Rathi" -> PR, "Aditi Dhage" -> AAD / AD
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words.map((w) => w[0]?.toUpperCase() || '').join('').slice(0, 4);
  }

  return clean.slice(0, 3).toUpperCase();
};

/** Extracts concise room number or label (e.g. "Room 705" -> "705", "Security Lab - 902" -> "902") */
export const getRoomShortLabel = (roomName: string): string => {
  if (!roomName) return '—';
  // Match room number like 705, 902, 701, etc.
  const numMatch = roomName.match(/\b\d{3,4}[A-Za-z]?\b/);
  if (numMatch && numMatch[0]) {
    return numMatch[0];
  }
  return roomName.replace(/^Room\s+/i, '').trim();
};

/** Extracts concise subject code for the timetable grid cell */
export const getSubjectShortCode = (subject: Subject | undefined, fallbackName: string): string => {
  if (!subject) return fallbackName;
  // If code is alphabetic/alphanumeric with letters (like DBMS, ADSA, AT, JAVA, ADSAL)
  if (subject.code && /[A-Za-z]/.test(subject.code)) {
    return subject.code.trim();
  }
  // If code is purely numeric (like 2345111) but name has letters, make an acronym if name is long
  const name = subject.name.trim();
  if (name.length <= 8) return name;
  const words = name.split(/\s+/).filter((w) => !['and', '&', 'of', 'in', 'the'].includes(w.toLowerCase()));
  if (words.length >= 2) {
    return words.map((w) => w[0]?.toUpperCase() || '').join('');
  }
  return name.slice(0, 6).toUpperCase();
};

export interface TimetableExportMeta {
  collegeName: string;
  departmentName: string;
  termTitle: string;
  commencementDate: string;
  yearLabel: string;
  semesterLabel: string;
  divisionLabel: string;
  verifierTitle: string;
  verifierName: string;
  verifierRole: string;
  approverTitle: string;
  approverName: string;
  approverRole: string;
}

export const getExportMetadata = (
  divisionName?: string,
  divisionYear?: string,
  divisionSemester?: string | number
): TimetableExportMeta => {
  const rawYear = (divisionYear || 'TE').toUpperCase();
  let fullYear = 'THIRD YEAR (TE)';
  if (rawYear === '1' || rawYear === 'FE') fullYear = 'FIRST YEAR (FE)';
  else if (rawYear === '2' || rawYear === 'SE') fullYear = 'SECOND YEAR (SE)';
  else if (rawYear === '3' || rawYear === 'TE') fullYear = 'THIRD YEAR (TE)';
  else if (rawYear === '4' || rawYear === 'BE') fullYear = 'FOURTH YEAR (BE)';

  const semNum = Number(divisionSemester) || 5;
  const romanNumerals = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  const semRoman = romanNumerals[semNum] || String(semNum);
  const termRoman = semNum % 2 !== 0 ? 'I' : 'II';

  return {
    collegeName: 'DATTA MEGHE COLLEGE OF ENGINEERING, Airoli, Navi Mumbai',
    departmentName: 'DEPARTMENT OF INFORMATION TECHNOLOGY',
    termTitle: `DIVISION TIME TABLE (Term - ${termRoman} A. Y. 2026-27)`,
    commencementDate: 'Date of Commencement of Term: 06/07/2026',
    yearLabel: `YEAR: ${fullYear}`,
    semesterLabel: `SEMESTER- ${semRoman}`,
    divisionLabel: `Division - ${divisionName || 'A'}`,
    verifierTitle: 'Prepared & Verified by',
    verifierName: 'Mrs. Ashwini Rahude',
    verifierRole: 'Time Table Incharge (TT)',
    approverTitle: 'Approved By',
    approverName: 'Dr. Vidya Kubde',
    approverRole: 'Head of Department',
  };
};

/** Compute dynamic or standard period columns */
export const computeExportColumns = (slots: TimetableSlot[]): ExportColumnDef[] => {
  const standardKeys = new Set(
    STANDARD_COLUMNS.filter((c) => !c.isRecess).map((c) => c.startKey)
  );
  const hasCustomTiming = slots.some(
    (slot) => !standardKeys.has(slot.start_time.slice(0, 5))
  );

  if (!hasCustomTiming && slots.length > 0) {
    return STANDARD_COLUMNS;
  }

  // Compute from slots
  const periodTimeMap = new Map<string, string>();
  slots.forEach((slot) => {
    const s = slot.start_time.slice(0, 5);
    if (!periodTimeMap.has(s)) {
      periodTimeMap.set(s, slot.end_time.slice(0, 5));
    }
  });

  if (periodTimeMap.size === 0) {
    return STANDARD_COLUMNS;
  }

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

  const cols: ExportColumnDef[] = [];
  let pNum = 1;
  for (let i = 0; i < sortedEntries.length; i++) {
    const entry = sortedEntries[i];
    if (!entry) continue;

    if (i === recessInsertIdx) {
      const rStart = sortedEntries[i - 1]?.[1] ?? '13:00';
      const rEnd = entry[0];
      cols.push({
        periodNum: `${pNum}`,
        rangeLabel: `${formatClockTime(rStart)}-${formatClockTime(rEnd)}`,
        isRecess: true,
        startKey: rStart,
        endKey: rEnd,
      });
      pNum++;
    }

    const [startT, endT] = entry;
    cols.push({
      periodNum: `${pNum}`,
      rangeLabel: `${formatClockTime(startT)}-${formatClockTime(endT)}`,
      isRecess: false,
      startKey: startT,
      endKey: endT,
    });
    pNum++;
  }

  return cols;
};

export interface CellData {
  text: string;
  isRecess: boolean;
  colSpan: number;
  skip: boolean;
  isLab: boolean;
}

export interface DayRowData {
  day: DayOfWeek;
  dayLabel: string;
  cells: CellData[];
}

export interface NomenclatureData {
  theorySubjects: string[];
  labSubjects: string[];
  roomsAndLabs: string[];
  facultyDetails: string[];
}

/** Prepares grid data with horizontal lab merges and nomenclature sections */
export const prepareTimetableGridData = (
  slots: TimetableSlot[],
  columns: ExportColumnDef[],
  subjects: Subject[] = [],
  teachers: Teacher[] = [],
  rooms: Room[] = [],
  batches: Batch[] = [],
  subjectMap?: Map<number, string>,
  teacherMap?: Map<number, string>,
  roomMap?: Map<number, string>,
  batchMap?: Map<number, string>
) => {
  const subjObjMap = new Map<number, Subject>();
  subjects.forEach((s) => subjObjMap.set(s.id, s));

  const teacherObjMap = new Map<number, Teacher>();
  teachers.forEach((t) => teacherObjMap.set(t.id, t));

  const roomObjMap = new Map<number, Room>();
  rooms.forEach((r) => roomObjMap.set(r.id, r));

  const batchObjMap = new Map<number, Batch>();
  batches.forEach((b) => batchObjMap.set(b.id, b));

  const getSubjName = (id: number) => subjectMap?.get(id) ?? subjObjMap.get(id)?.name ?? `Subject #${id}`;
  const getSubjShort = (id: number) => {
    const s = subjObjMap.get(id);
    return getSubjectShortCode(s, getSubjName(id));
  };
  const getTeacherName = (id: number) => teacherMap?.get(id) ?? teacherObjMap.get(id)?.name ?? `Teacher #${id}`;
  const getTeacherAbbr = (id: number) => getTeacherAbbreviation(getTeacherName(id));
  const getRoomName = (id: number) => roomMap?.get(id) ?? roomObjMap.get(id)?.name ?? `Room #${id}`;
  const getRoomShort = (id: number) => getRoomShortLabel(getRoomName(id));
  const getBatchName = (id: number | null | undefined) => (id ? batchMap?.get(id) ?? batchObjMap.get(id)?.name ?? `Batch #${id}` : '');

  // Build grid rows
  const dayRows: DayRowData[] = DAYS.map((day) => {
    const dayCells: CellData[] = [];

    for (let cIdx = 0; cIdx < columns.length; cIdx++) {
      const col = columns[cIdx];
      if (!col) continue;

      if (col.isRecess) {
        dayCells.push({
          text: 'R E C E S S',
          isRecess: true,
          colSpan: 1,
          skip: false,
          isLab: false,
        });
        continue;
      }

      const matchingSlots = slots.filter(
        (s) => s.day_of_week === day && s.start_time.slice(0, 5) === col.startKey
      );

      if (matchingSlots.length === 0) {
        dayCells.push({
          text: '',
          isRecess: false,
          colSpan: 1,
          skip: false,
          isLab: false,
        });
        continue;
      }

      const hasLabs = matchingSlots.some((s) => s.is_lab);

      if (hasLabs) {
        // Multi-batch practical entries: e.g. ADSAL(A1)/GMA/701
        const labLines = matchingSlots.map((s) => {
          const sName = getSubjShort(s.subject_id);
          const bName = getBatchName(s.batch_id);
          const tAbbr = getTeacherAbbr(s.teacher_id);
          const rShort = getRoomShort(s.room_id);
          const tut = s.is_tutorial ? '-TUT' : '';
          return `${sName}${tut}(${bName})/${tAbbr}/${rShort}`;
        });
        const uniqueLines = Array.from(new Set(labLines));

        dayCells.push({
          text: uniqueLines.join('\n'),
          isRecess: false,
          colSpan: 1,
          skip: false,
          isLab: true,
        });
      } else {
        // Theory entries: 3-line format: Subject \n Room \n Teacher
        const theoryLines = matchingSlots.map((s) => {
          const sName = getSubjShort(s.subject_id);
          const rShort = getRoomShort(s.room_id);
          const tAbbr = getTeacherAbbr(s.teacher_id);
          const tut = s.is_tutorial ? '-TUT' : '';
          return `${sName}${tut}\n${rShort}\n${tAbbr}`;
        });
        const uniqueLines = Array.from(new Set(theoryLines));

        dayCells.push({
          text: uniqueLines.join('\n'),
          isRecess: false,
          colSpan: 1,
          skip: false,
          isLab: false,
        });
      }
    }

    // Now detect consecutive 2-period lab slots to merge horizontally across period columns
    for (let c = 0; c < dayCells.length - 1; c++) {
      const curCell = dayCells[c];
      const nextCell = dayCells[c + 1];
      const curCol = columns[c];
      const nextCol = columns[c + 1];

      if (!curCell || !nextCell || !curCol || !nextCol) continue;
      if (curCell.skip || curCell.isRecess || nextCell.isRecess) continue;

      if (curCell.isLab && nextCell.isLab && curCell.text === nextCell.text) {
        curCell.colSpan = 2;
        nextCell.skip = true;
        c++; // Skip next cell since merged
      }
    }

    return {
      day,
      dayLabel: DAY_LABELS[day],
      cells: dayCells,
    };
  });

  // Extract Nomenclature data from all slots appearing in this division timetable
  const usedSubjectIds = new Set<number>();
  const usedTeacherIds = new Set<number>();
  const usedRoomIds = new Set<number>();

  slots.forEach((s) => {
    usedSubjectIds.add(s.subject_id);
    usedTeacherIds.add(s.teacher_id);
    usedRoomIds.add(s.room_id);
  });

  const theorySubjects: string[] = [];
  const labSubjects: string[] = [];

  usedSubjectIds.forEach((sId) => {
    const sObj = subjObjMap.get(sId);
    const fullName = getSubjName(sId);
    const code = getSubjShort(sId);
    const isLab = sObj?.subject_type === 'LAB' || slots.some((slot) => slot.subject_id === sId && slot.is_lab);

    const formattedItem = code && code !== fullName ? `${code}-${fullName}` : fullName;
    if (isLab) {
      labSubjects.push(formattedItem);
    } else {
      theorySubjects.push(formattedItem);
    }
  });

  theorySubjects.sort((a, b) => a.localeCompare(b));
  labSubjects.sort((a, b) => a.localeCompare(b));

  const roomsAndLabs: string[] = [];
  usedRoomIds.forEach((rId) => {
    const rObj = roomObjMap.get(rId);
    const rName = getRoomName(rId);
    const rShort = getRoomShortLabel(rName);

    if (rObj?.room_type === 'LAB' || rName.toLowerCase().includes('lab')) {
      const cleanLab = rName.replace(/-\s*\d+.*$/i, '').trim().toUpperCase();
      roomsAndLabs.push(`${cleanLab}: ${rShort}`);
    } else {
      roomsAndLabs.push(`CLASS ROOM: ${rShort}`);
    }
  });
  roomsAndLabs.sort((a, b) => a.localeCompare(b));

  const facultyDetails: string[] = [];
  usedTeacherIds.forEach((tId) => {
    const tName = getTeacherName(tId);
    const tAbbr = getTeacherAbbr(tId);
    facultyDetails.push(`${tAbbr} - ${tName}`);
  });
  facultyDetails.sort((a, b) => a.localeCompare(b));

  const nomenclature: NomenclatureData = {
    theorySubjects,
    labSubjects,
    roomsAndLabs,
    facultyDetails,
  };

  return { dayRows, nomenclature };
};

/**
 * Generates and downloads an Excel (.xlsx) file accurately matching the college's
 * official reference timetable format (borders, merged cells, nomenclature, print landscape).
 */
export const exportTimetableToExcel = async (
  slots: TimetableSlot[],
  subjectMapOrList: Map<number, string> | Subject[] = [],
  teacherMapOrList: Map<number, string> | Teacher[] = [],
  roomMapOrList: Map<number, string> | Room[] = [],
  batchMapOrList: Map<number, string> | Batch[] = [],
  divisionName?: string,
  divisionYear?: string,
  divisionSemester?: string | number,
  subjectsList?: Subject[],
  teachersList?: Teacher[],
  roomsList?: Room[],
  batchesList?: Batch[]
): Promise<void> => {
  // Normalize parameters
  let subjects: Subject[] = subjectsList ?? [];
  let teachers: Teacher[] = teachersList ?? [];
  let rooms: Room[] = roomsList ?? [];
  let batches: Batch[] = batchesList ?? [];

  const subjectMap = new Map<number, string>();
  if (Array.isArray(subjectMapOrList)) {
    subjects = subjectMapOrList;
    subjectMapOrList.forEach((s) => subjectMap.set(s.id, s.name));
  } else if (subjectMapOrList instanceof Map) {
    subjectMapOrList.forEach((v, k) => subjectMap.set(k, v));
  }

  const teacherMap = new Map<number, string>();
  if (Array.isArray(teacherMapOrList)) {
    teachers = teacherMapOrList;
    teacherMapOrList.forEach((t) => teacherMap.set(t.id, t.name));
  } else if (teacherMapOrList instanceof Map) {
    teacherMapOrList.forEach((v, k) => teacherMap.set(k, v));
  }

  const roomMap = new Map<number, string>();
  if (Array.isArray(roomMapOrList)) {
    rooms = roomMapOrList;
    roomMapOrList.forEach((r) => roomMap.set(r.id, r.name));
  } else if (roomMapOrList instanceof Map) {
    roomMapOrList.forEach((v, k) => roomMap.set(k, v));
  }

  const batchMap = new Map<number, string>();
  if (Array.isArray(batchMapOrList)) {
    batches = batchMapOrList;
    batchMapOrList.forEach((b) => batchMap.set(b.id, b.name));
  } else if (batchMapOrList instanceof Map) {
    batchMapOrList.forEach((v, k) => batchMap.set(k, v));
  }

  const meta = getExportMetadata(divisionName, divisionYear, divisionSemester);
  const columns = computeExportColumns(slots);
  const { dayRows, nomenclature } = prepareTimetableGridData(
    slots,
    columns,
    subjects,
    teachers,
    rooms,
    batches,
    subjectMap,
    teacherMap,
    roomMap,
    batchMap
  );

  const totalCols = 1 + columns.length;
  const emptyRow = (): string[] => Array(totalCols).fill('');

  // 1. Header Rows (0 to 4)
  const r0 = emptyRow(); r0[0] = meta.collegeName;
  const r1 = emptyRow(); r1[0] = meta.departmentName;
  const r2 = emptyRow(); r2[0] = meta.termTitle;
  const r3 = emptyRow(); r3[0] = meta.commencementDate;

  // Year / Semester / Division row
  const r4 = emptyRow();
  const midCol1 = Math.floor(totalCols * 0.4);
  const midCol2 = Math.floor(totalCols * 0.7);
  r4[0] = meta.yearLabel;
  r4[midCol1] = meta.semesterLabel;
  r4[midCol2] = meta.divisionLabel;

  // 2. Table Headers (Row 5 & 6)
  const r5: string[] = ['DAYS', ...columns.map((c) => c.periodNum)];
  const r6: string[] = ['', ...columns.map((c) => c.rangeLabel)];

  // 3. Data Rows (Rows 7 to 11)
  const dataRows: string[][] = dayRows.map((dr) => {
    const row: string[] = [dr.dayLabel];
    dr.cells.forEach((cell) => {
      row.push(cell.isRecess ? 'R\nE\nC\nE\nS\nS' : cell.text);
    });
    return row;
  });

  // 4. Blank separator row (Row 12)
  const rSep = emptyRow();

  // 5. Nomenclature Section (Rows 13 onwards)
  const nomHeaders = ['Nomenclature of Subject', 'Nomenclature of Subject Labs', 'Location of Rooms / Labs', 'Faculty Details'];
  const rNomHeader = emptyRow();
  // Distribute the 4 columns across totalCols
  const nomBaseSpan = Math.floor(totalCols / 4);
  const nomRemainder = totalCols - nomBaseSpan * 4;
  const colSpan0 = nomBaseSpan + (nomRemainder > 0 ? 1 : 0);
  const colSpan1 = nomBaseSpan + (nomRemainder > 1 ? 1 : 0);
  const colSpan2 = nomBaseSpan + (nomRemainder > 2 ? 1 : 0);
  const colStart0 = 0;
  const colStart1 = colStart0 + colSpan0;
  const colStart2 = colStart1 + colSpan1;
  const colStart3 = colStart2 + colSpan2;

  rNomHeader[colStart0] = nomHeaders[0] || '';
  rNomHeader[colStart1] = nomHeaders[1] || '';
  rNomHeader[colStart2] = nomHeaders[2] || '';
  rNomHeader[colStart3] = nomHeaders[3] || '';

  const maxNomRows = Math.max(
    nomenclature.theorySubjects.length,
    nomenclature.labSubjects.length,
    nomenclature.roomsAndLabs.length,
    nomenclature.facultyDetails.length,
    1
  );

  const nomRows: string[][] = [];
  for (let i = 0; i < maxNomRows; i++) {
    const nr = emptyRow();
    nr[colStart0] = nomenclature.theorySubjects[i] || '';
    nr[colStart1] = nomenclature.labSubjects[i] || '';
    nr[colStart2] = nomenclature.roomsAndLabs[i] || '';
    nr[colStart3] = nomenclature.facultyDetails[i] || '';
    nomRows.push(nr);
  }

  // 6. Blank separator
  const rSep2 = emptyRow();

  // 7. Footer Signature Rows
  const rFoot1 = emptyRow();
  const rFoot2 = emptyRow();
  const rFoot3 = emptyRow();

  const footLeftCol = 0;
  const footRightCol = Math.floor(totalCols / 2);

  rFoot1[footLeftCol] = meta.verifierTitle;
  rFoot1[footRightCol] = meta.approverTitle;

  rFoot2[footLeftCol] = meta.verifierName;
  rFoot2[footRightCol] = meta.approverName;

  rFoot3[footLeftCol] = meta.verifierRole;
  rFoot3[footRightCol] = meta.approverRole;

  const aoa = [
    r0, r1, r2, r3, r4,
    r5, r6,
    ...dataRows,
    rSep,
    rNomHeader,
    ...nomRows,
    rSep2,
    rFoot1, rFoot2, rFoot3,
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);

  // Force period number cells (row 5) to text type to prevent "1" showing as 1.0
  for (let c = 1; c < totalCols; c++) {
    const addr = XLSX.utils.encode_cell({ r: 5, c });
    if (worksheet[addr]) {
      worksheet[addr].t = 's';
      worksheet[addr].v = String(worksheet[addr].v);
    }
  }

  // Column widths — compact to match official reference format
  worksheet['!cols'] = [
    { wch: 7 }, // DAYS
    ...columns.map((c) => ({ wch: c.isRecess ? 5 : 14 })),
  ];

  // Set row heights
  const rowHeights = [
    { hpt: 22 }, // Title 1 — college name
    { hpt: 16 }, // Title 2 — department
    { hpt: 15 }, // Title 3 — term title
    { hpt: 14 }, // Title 4 — date
    { hpt: 15 }, // Year/Sem/Div
    { hpt: 16 }, // Header Period Num
    { hpt: 14 }, // Header Timings
    ...DAYS.map(() => ({ hpt: 62 })), // Day rows — compact
    { hpt: 6 },  // Sep
    { hpt: 18 }, // Nom Header
    ...nomRows.map(() => ({ hpt: 15 })), // Nom rows
    { hpt: 8 },  // Sep
    { hpt: 16 }, // Foot 1
    { hpt: 16 }, // Foot 2
    { hpt: 16 }, // Foot 3
  ];
  worksheet['!rows'] = rowHeights;

  // Build Merges
  const merges: XLSX.Range[] = [
    // Header title rows across full width
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: totalCols - 1 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: totalCols - 1 } },

    // Row 4: Year, Semester, Division
    { s: { r: 4, c: 0 }, e: { r: 4, c: midCol1 - 1 } },
    { s: { r: 4, c: midCol1 }, e: { r: 4, c: midCol2 - 1 } },
    { s: { r: 4, c: midCol2 }, e: { r: 4, c: totalCols - 1 } },

    // DAYS header merged row 5 and row 6
    { s: { r: 5, c: 0 }, e: { r: 6, c: 0 } },
  ];

  // Recess vertical merge across all 5 days
  const recessColIdx = columns.findIndex((c) => c.isRecess) + 1;
  const gridStartRow = 7;
  if (recessColIdx > 0) {
    merges.push({
      s: { r: gridStartRow, c: recessColIdx },
      e: { r: gridStartRow + DAYS.length - 1, c: recessColIdx },
    });
  }

  // Horizontal lab merges in grid
  dayRows.forEach((dr, dayIdx) => {
    const rIdx = gridStartRow + dayIdx;
    let currentColIdx = 1;
    dr.cells.forEach((cell) => {
      if (cell.colSpan > 1) {
        merges.push({
          s: { r: rIdx, c: currentColIdx },
          e: { r: rIdx, c: currentColIdx + cell.colSpan - 1 },
        });
      }
      currentColIdx++;
    });
  });

  // Nomenclature merges
  const nomHeaderRowIdx = gridStartRow + DAYS.length + 1;
  merges.push(
    { s: { r: nomHeaderRowIdx, c: colStart0 }, e: { r: nomHeaderRowIdx, c: colStart1 - 1 } },
    { s: { r: nomHeaderRowIdx, c: colStart1 }, e: { r: nomHeaderRowIdx, c: colStart2 - 1 } },
    { s: { r: nomHeaderRowIdx, c: colStart2 }, e: { r: nomHeaderRowIdx, c: colStart3 - 1 } },
    { s: { r: nomHeaderRowIdx, c: colStart3 }, e: { r: nomHeaderRowIdx, c: totalCols - 1 } }
  );

  for (let i = 0; i < maxNomRows; i++) {
    const rIdx = nomHeaderRowIdx + 1 + i;
    merges.push(
      { s: { r: rIdx, c: colStart0 }, e: { r: rIdx, c: colStart1 - 1 } },
      { s: { r: rIdx, c: colStart1 }, e: { r: rIdx, c: colStart2 - 1 } },
      { s: { r: rIdx, c: colStart2 }, e: { r: rIdx, c: colStart3 - 1 } },
      { s: { r: rIdx, c: colStart3 }, e: { r: rIdx, c: totalCols - 1 } }
    );
  }

  // Footer signature merges
  const footRowStart = nomHeaderRowIdx + 1 + maxNomRows + 1;
  for (let f = 0; f < 3; f++) {
    const rIdx = footRowStart + f;
    merges.push(
      { s: { r: rIdx, c: footLeftCol }, e: { r: rIdx, c: footRightCol - 1 } },
      { s: { r: rIdx, c: footRightCol }, e: { r: rIdx, c: totalCols - 1 } }
    );
  }

  worksheet['!merges'] = merges;

  // Professional Cell Styles with xlsx-js-style
  const thinBorder = {
    top: { style: 'thin', color: { rgb: '000000' } },
    bottom: { style: 'thin', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } },
    right: { style: 'thin', color: { rgb: '000000' } },
  };

  const mediumBorder = {
    top: { style: 'medium', color: { rgb: '000000' } },
    bottom: { style: 'medium', color: { rgb: '000000' } },
    left: { style: 'medium', color: { rgb: '000000' } },
    right: { style: 'medium', color: { rgb: '000000' } },
  };

  const setCellStyle = (r: number, c: number, style: Record<string, unknown>) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    if (!worksheet[addr]) {
      worksheet[addr] = { t: 's', v: '' };
    }
    worksheet[addr].s = style;
  };

  // 1. Header titles
  for (let c = 0; c < totalCols; c++) {
    setCellStyle(0, c, {
      font: { name: 'Times New Roman', sz: 16, bold: true },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: mediumBorder,
    });
    setCellStyle(1, c, {
      font: { name: 'Times New Roman', sz: 12, bold: true },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: thinBorder,
    });
    setCellStyle(2, c, {
      font: { name: 'Times New Roman', sz: 11, bold: true },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: thinBorder,
    });
    setCellStyle(3, c, {
      font: { name: 'Times New Roman', sz: 10 },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: thinBorder,
    });
    setCellStyle(4, c, {
      font: { name: 'Times New Roman', sz: 10, bold: true },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: thinBorder,
    });
  }

  // 2. Table Headers (Row 5 & 6) — no fill, white background
  for (let c = 0; c < totalCols; c++) {
    setCellStyle(5, c, {
      font: { name: 'Calibri', sz: 10, bold: true },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: thinBorder,
    });
    setCellStyle(6, c, {
      font: { name: 'Calibri', sz: 8, bold: true },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: thinBorder,
    });
  }

  // 3. Grid Data Cells
  for (let r = gridStartRow; r < gridStartRow + DAYS.length; r++) {
    for (let c = 0; c < totalCols; c++) {
      const isDaysCol = c === 0;
      const isRecessCol = c === recessColIdx;
      setCellStyle(r, c, {
        font: {
          name: 'Calibri',
          sz: isDaysCol ? 9 : isRecessCol ? 8 : 9,
          bold: isDaysCol || isRecessCol,
        },
        alignment: {
          horizontal: 'center',
          vertical: 'center',
          wrapText: true,
        },
        border: thinBorder,
      });
    }
  }

  // 4. Nomenclature Section — no fill, white background
  for (let c = 0; c < totalCols; c++) {
    setCellStyle(nomHeaderRowIdx, c, {
      font: { name: 'Calibri', sz: 9, bold: true },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: mediumBorder,
    });
  }

  for (let i = 0; i < maxNomRows; i++) {
    const r = nomHeaderRowIdx + 1 + i;
    for (let c = 0; c < totalCols; c++) {
      setCellStyle(r, c, {
        font: { name: 'Calibri', sz: 8.5 },
        alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
        border: thinBorder,
      });
    }
  }

  // 5. Signature Footer — with borders matching official format
  for (let f = 0; f < 3; f++) {
    const r = footRowStart + f;
    for (let c = 0; c < totalCols; c++) {
      setCellStyle(r, c, {
        font: {
          name: 'Calibri',
          sz: 9,
          bold: f === 1, // bold names
        },
        alignment: { horizontal: 'center', vertical: 'center' },
        border: thinBorder,
      });
    }
  }

  // Print Setup: Landscape, fit to page width
  worksheet['!pageSetup'] = {
    orientation: 'landscape',
    paperSize: 9, // A4
    fitToWidth: 1,
    fitToHeight: 0,
    fitToPage: true,
  };

  const workbook = XLSX.utils.book_new();
  const sheetName = (divisionName ? `Div-${divisionName}` : 'Timetable').slice(0, 31);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  // Filename format: TE-A_Timetable.xlsx
  const fileDiv = divisionName?.includes(divisionYear || '')
    ? divisionName
    : `${divisionYear || 'TE'}-${divisionName || 'A'}`;
  const cleanName = fileDiv.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
  const fileName = `${cleanName || 'Timetable'}_Timetable.xlsx`;

  XLSX.writeFile(workbook, fileName);
};

/**
 * Generates and downloads a high-fidelity PDF file matching the official college reference.
 * Uses jsPDF with autoTable to create real selectable text, vector borders,
 * horizontal lab merges, nomenclature tables, and official footers.
 */
export const exportTimetableToPdf = async (
  slots: TimetableSlot[],
  subjectMapOrList: Map<number, string> | Subject[] = [],
  teacherMapOrList: Map<number, string> | Teacher[] = [],
  roomMapOrList: Map<number, string> | Room[] = [],
  batchMapOrList: Map<number, string> | Batch[] = [],
  divisionName?: string,
  divisionYear?: string,
  divisionSemester?: string | number,
  subjectsList?: Subject[],
  teachersList?: Teacher[],
  roomsList?: Room[],
  batchesList?: Batch[]
): Promise<void> => {
  // Normalize parameters
  let subjects: Subject[] = subjectsList ?? [];
  let teachers: Teacher[] = teachersList ?? [];
  let rooms: Room[] = roomsList ?? [];
  let batches: Batch[] = batchesList ?? [];

  const subjectMap = new Map<number, string>();
  if (Array.isArray(subjectMapOrList)) {
    subjects = subjectMapOrList;
    subjectMapOrList.forEach((s) => subjectMap.set(s.id, s.name));
  } else if (subjectMapOrList instanceof Map) {
    subjectMapOrList.forEach((v, k) => subjectMap.set(k, v));
  }

  const teacherMap = new Map<number, string>();
  if (Array.isArray(teacherMapOrList)) {
    teachers = teacherMapOrList;
    teacherMapOrList.forEach((t) => teacherMap.set(t.id, t.name));
  } else if (teacherMapOrList instanceof Map) {
    teacherMapOrList.forEach((v, k) => teacherMap.set(k, v));
  }

  const roomMap = new Map<number, string>();
  if (Array.isArray(roomMapOrList)) {
    rooms = roomMapOrList;
    roomMapOrList.forEach((r) => roomMap.set(r.id, r.name));
  } else if (roomMapOrList instanceof Map) {
    roomMapOrList.forEach((v, k) => roomMap.set(k, v));
  }

  const batchMap = new Map<number, string>();
  if (Array.isArray(batchMapOrList)) {
    batches = batchMapOrList;
    batchMapOrList.forEach((b) => batchMap.set(b.id, b.name));
  } else if (batchMapOrList instanceof Map) {
    batchMapOrList.forEach((v, k) => batchMap.set(k, v));
  }

  const meta = getExportMetadata(divisionName, divisionYear, divisionSemester);
  const columns = computeExportColumns(slots);
  const { dayRows, nomenclature } = prepareTimetableGridData(
    slots,
    columns,
    subjects,
    teachers,
    rooms,
    batches,
    subjectMap,
    teacherMap,
    roomMap,
    batchMap
  );

  // A4 Landscape: 297mm x 210mm
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 297;
  const margin = 8;
  const contentWidth = pageWidth - margin * 2; // 281mm

  // 1. Draw Official Header
  let currentY = 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(meta.collegeName, pageWidth / 2, currentY, { align: 'center' });

  currentY += 5;
  doc.setFontSize(10.5);
  doc.text(meta.departmentName, pageWidth / 2, currentY, { align: 'center' });

  currentY += 4.5;
  doc.setFontSize(9.5);
  doc.text(meta.termTitle, pageWidth / 2, currentY, { align: 'center' });

  currentY += 4.5;
  doc.setFontSize(8.5);
  doc.text(meta.commencementDate, pageWidth / 2, currentY, { align: 'center' });

  currentY += 2;

  // Year / Semester / Division bar
  const barY = currentY;
  const barHeight = 5.5;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.rect(margin, barY, contentWidth, barHeight);

  doc.setFontSize(8.5);
  doc.text(meta.yearLabel, margin + 4, barY + 3.8);
  doc.text(meta.semesterLabel, pageWidth / 2, barY + 3.8, { align: 'center' });
  doc.text(meta.divisionLabel, margin + contentWidth - 4, barY + 3.8, { align: 'right' });

  currentY += barHeight + 1.5;

  // 2. Prepare Timetable Grid for autoTable
  // Header row 1: Period numbers
  const headRow1 = [
    { content: 'DAYS', rowSpan: 2, styles: { halign: 'center' as const, valign: 'middle' as const, fontStyle: 'bold' as const } },
    ...columns.map((c) => ({
      content: c.periodNum,
      styles: { halign: 'center' as const, fontStyle: 'bold' as const },
    })),
  ];

  // Header row 2: Timings
  const headRow2 = columns.map((c) => ({
    content: c.rangeLabel,
    styles: { halign: 'center' as const, fontSize: 6.5, fontStyle: 'bold' as const },
  }));

  // Find recess column index
  const recessColIdx = columns.findIndex((c) => c.isRecess);

  // Body rows with colSpans for consecutive labs and rowSpan for recess
  const bodyRows: RowInput[] = dayRows.map((dr, dayIdx) => {
    const rowCells: RowInput = [
      {
        content: dr.dayLabel,
        styles: { fontStyle: 'bold' as const, halign: 'center' as const, valign: 'middle' as const, fontSize: 8 },
      },
    ];

    dr.cells.forEach((cell) => {
      if (cell.skip) return;

      if (cell.isRecess) {
        if (dayIdx === 0) {
          rowCells.push({
            content: 'R\nE\nC\nE\nS\nS',
            rowSpan: 5,
            styles: {
              halign: 'center' as const,
              valign: 'middle' as const,
              fillColor: [240, 240, 240],
              fontStyle: 'bold' as const,
              fontSize: 7.5,
              textColor: [60, 60, 60],
            },
          });
        }
        return;
      }

      rowCells.push({
        content: cell.text,
        colSpan: cell.colSpan,
        styles: {
          halign: 'center' as const,
          valign: 'middle' as const,
          fontSize: cell.isLab ? 6.5 : 7,
          fontStyle: cell.isLab ? ('normal' as const) : ('bold' as const),
        },
      });
    });

    return rowCells;
  });

  // Calculate dynamic column widths: DAYS gets ~14mm, Recess gets ~8mm, remaining periods split evenly
  const recessColWidth = 8;
  const otherColCount = columns.length - (recessColIdx >= 0 ? 1 : 0);
  const remainingWidth = contentWidth - 14 - (recessColIdx >= 0 ? recessColWidth : 0);
  const periodColWidth = remainingWidth / otherColCount;

  const columnStylesConfig: Record<number, { cellWidth: number }> = {
    0: { cellWidth: 14 },
  };
  columns.forEach((c, i) => {
    columnStylesConfig[i + 1] = {
      cellWidth: c.isRecess ? recessColWidth : periodColWidth,
    };
  });

  const generateAutoTable = (d: jsPDF, opts: UserOptions) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runner = (typeof autoTable === 'function' ? autoTable : (autoTable as any)?.default || autoTable) as (doc: jsPDF, o: UserOptions) => void;
    runner(d, opts);
  };

  generateAutoTable(doc, {
    startY: currentY,
    margin: { left: margin, right: margin },
    head: [headRow1, headRow2],
    body: bodyRows,
    theme: 'grid',
    styles: {
      lineColor: [0, 0, 0],
      lineWidth: 0.25,
      textColor: [0, 0, 0],
      cellPadding: 1.2,
      overflow: 'linebreak',
      fontSize: 7,
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.25,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      fontSize: 8,
    },
    columnStyles: columnStylesConfig,
  });

  // Get Y position after table
  const afterGridY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 2.5;

  // 3. Nomenclature 4-Column Table
  const nomHeaders = [
    'Nomenclature of Subject',
    'Nomenclature of Subject Labs',
    'Location of Rooms / Labs',
    'Faculty Details',
  ];

  const maxNomRows = Math.max(
    nomenclature.theorySubjects.length,
    nomenclature.labSubjects.length,
    nomenclature.roomsAndLabs.length,
    nomenclature.facultyDetails.length,
    1
  );

  const nomBody: string[][] = [];
  for (let i = 0; i < maxNomRows; i++) {
    nomBody.push([
      nomenclature.theorySubjects[i] || '',
      nomenclature.labSubjects[i] || '',
      nomenclature.roomsAndLabs[i] || '',
      nomenclature.facultyDetails[i] || '',
    ]);
  }

  const nomColWidth = contentWidth / 4;

  generateAutoTable(doc, {
    startY: afterGridY,
    margin: { left: margin, right: margin },
    head: [nomHeaders],
    body: nomBody,
    theme: 'grid',
    styles: {
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      textColor: [0, 0, 0],
      fontSize: 6.5,
      cellPadding: 0.8,
      overflow: 'linebreak',
      halign: 'left',
      valign: 'middle',
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 7.2,
      halign: 'center',
      valign: 'middle',
    },
    columnStyles: {
      0: { cellWidth: nomColWidth },
      1: { cellWidth: nomColWidth },
      2: { cellWidth: nomColWidth },
      3: { cellWidth: nomColWidth },
    },
  });

  // 4. Official Signatures Footer
  const afterNomY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  const leftX = margin + 40;
  const rightX = margin + contentWidth - 40;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(meta.verifierTitle, leftX, afterNomY, { align: 'center' });
  doc.text(meta.approverTitle, rightX, afterNomY, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.text(meta.verifierName, leftX, afterNomY + 4.5, { align: 'center' });
  doc.text(meta.approverName, rightX, afterNomY + 4.5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.text(meta.verifierRole, leftX, afterNomY + 8.5, { align: 'center' });
  doc.text(meta.approverRole, rightX, afterNomY + 8.5, { align: 'center' });

  // Filename
  const fileDiv = divisionName?.includes(divisionYear || '')
    ? divisionName
    : `${divisionYear || 'TE'}-${divisionName || 'A'}`;
  const cleanName = fileDiv.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
  const fileName = `${cleanName || 'Timetable'}_Timetable.pdf`;

  doc.save(fileName);
};
