import React, { useState, useEffect } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/useToast';
import { apiClient } from '../api/client';
import type { components } from '../api/schema';
import { WizardProvider, useWizard, type TimetableSlot, type Division, type Batch } from './timetable/WizardContext';
import { WizardLayout } from './timetable/WizardLayout';
import { TimetableGrid, exportTimetableToExcel } from './timetable/TimetableGrid';
import { EditCellModal } from './timetable/EditCellModal';

type Subject = components['schemas']['SubjectRead'];
type Teacher = components['schemas']['TeacherRead'];
type Room = components['schemas']['RoomRead'];

/**
 * Combined timetable page.
 *
 * Before generation it shows the setup wizard; afterwards it shows the
 * generated master grid together with the download actions.
 */
const TimetablePageInner: React.FC = () => {
  const { divisionId, selectedDivisionIds, reset } = useWizard();
  const { showToast } = useToast();
  const [viewMode, setViewMode] = useState<'wizard' | 'grid'>('wizard');
  const [editingSlot, setEditingSlot] = useState<TimetableSlot | null>(null);

  // The page owns its own copies of the slot list and the lookup tables.
  const [selectedDivisionId, setSelectedDivisionId] = useState<number | null>(null);
  const [timetableSlots, setTimetableSlots] = useState<TimetableSlot[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);

  // 1. Initial lookups load (run ONCE on mount)
  useEffect(() => {
    let isMounted = true;

    const loadInitialData = async () => {
      try {
        const [subjectsRes, teachersRes, roomsRes, divisionsRes, batchesRes] = await Promise.all([
          apiClient.GET('/api/subjects'),
          apiClient.GET('/api/teachers'),
          apiClient.GET('/api/rooms'),
          apiClient.GET('/api/divisions'),
          apiClient.GET('/api/batches'),
        ]);

        if (!isMounted) return;

        const divs = divisionsRes.data ?? [];
        setSubjects(subjectsRes.data ?? []);
        setTeachers(teachersRes.data ?? []);
        setRooms(roomsRes.data ?? []);
        setDivisions(divs);
        setBatches(batchesRes.data ?? []);

        // Pick initial division if not already selected
        if (divs.length > 0) {
          const initialDivId = divisionId ?? divs[0].id;
          setSelectedDivisionId((prev) => prev ?? initialDivId);
        }
      } catch (_err: unknown) {
        if (isMounted) {
          setDivisions([]);
        }
      }
    };

    loadInitialData();

    return () => {
      isMounted = false;
    };
  }, [divisionId]);

  // 2. Fetch timetable slots whenever selectedDivisionId changes.
  // Dependency array ONLY includes [selectedDivisionId].
  useEffect(() => {
    // 5. Add a Guard: If selectedDivisionId is null or undefined, do NOT fetch.
    if (selectedDivisionId === null || selectedDivisionId === undefined) {
      return;
    }

    let isMounted = true;

    const fetchTimetable = async () => {
      try {
        // 4. Dynamic URL using selectedDivisionId
        const { data, error } = await apiClient.GET('/api/timetable/{division_id}', {
          params: { path: { division_id: selectedDivisionId } },
        });

        if (!isMounted) return;

        if (error) {
          showToast({
            type: 'error',
            title: 'Could Not Load Timetable',
            message: 'Failed to fetch timetable for the selected division.',
          });
          setTimetableSlots([]);
          return;
        }

        const loaded = data ?? [];
        setTimetableSlots(loaded);

        if (loaded.length > 0) {
          setViewMode('grid');
        }
      } catch (_err) {
        if (!isMounted) return;
        showToast({
          type: 'error',
          title: 'Error',
          message: 'An error occurred while fetching timetable data.',
        });
        setTimetableSlots([]);
      }
    };

    fetchTimetable();

    return () => {
      isMounted = false;
    };
  }, [selectedDivisionId]);

  const handleGenerateComplete = async () => {
    const targetId = divisionId ?? (selectedDivisionIds.length > 0 ? selectedDivisionIds[0] : (divisions.length > 0 ? divisions[0].id : null));
    if (targetId !== null) {
      if (selectedDivisionId === targetId) {
        // Same division: fetch directly to refresh grid
        const { data } = await apiClient.GET('/api/timetable/{division_id}', {
          params: { path: { division_id: targetId } },
        });
        setTimetableSlots(data ?? []);
      } else {
        setSelectedDivisionId(targetId);
      }
    }
    setViewMode('grid');
  };

  const handleRegenerate = () => {
    reset();
    setTimetableSlots([]);
    setViewMode('wizard');
  };

  const handleDownloadExcel = async () => {
    if (timetableSlots.length === 0) {
      showToast({
        type: 'error',
        title: 'Export Failed',
        message: 'No timetable slots available to export.',
      });
      return;
    }

    try {
      const subjectMap = new Map<number, string>();
      subjects.forEach((s) => subjectMap.set(s.id, s.name));

      const teacherMap = new Map<number, string>();
      teachers.forEach((t) => teacherMap.set(t.id, t.name));

      const roomMap = new Map<number, string>();
      rooms.forEach((r) => roomMap.set(r.id, r.name));

      const batchMap = new Map<number, string>();
      batches.forEach((b) => batchMap.set(b.id, b.name));

      const divObj = divisions.find((d) => d.id === selectedDivisionId);
      const divName = divObj?.name ?? 'A';
      const divYear = divObj?.year ? (divObj.year === '1' ? 'FE' : divObj.year === '2' ? 'SE' : divObj.year === '3' ? 'TE' : divObj.year === '4' ? 'BE' : divObj.year) : 'TE';
      const divSem = divObj?.semester ?? 5;

      await exportTimetableToExcel(
        timetableSlots,
        subjectMap,
        teacherMap,
        roomMap,
        batchMap,
        divName,
        divYear,
        divSem
      );

      showToast({
        type: 'success',
        title: 'Export Complete',
        message: 'Excel spreadsheet has been downloaded.',
      });
    } catch (_err: unknown) {
      showToast({
        type: 'error',
        title: 'Export Failed',
        message: 'Could not export timetable to Excel.',
      });
    }
  };

  const handleSlotSaved = (updated: TimetableSlot) => {
    setTimetableSlots(
      timetableSlots.map((slot) => (slot.id === updated.id ? updated : slot))
    );
    setEditingSlot(null);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Timetable"
        subtitle="Generate and review the weekly master timetable"
        action={
          viewMode === 'grid' ? (
            <>
              <Button variant="secondary" size="sm" onClick={handleRegenerate}>
                Regenerate Timetable
              </Button>
              <Button variant="secondary" size="sm" onClick={handleDownloadExcel}>
                Download Excel
              </Button>
            </>
          ) : undefined
        }
      />

      {viewMode === 'grid' ? (
        <div className="space-y-3">
          {divisions.length > 0 && (
            <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded p-2.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-700">Division:</span>
                <select
                  value={selectedDivisionId ?? ''}
                  onChange={(e) => setSelectedDivisionId(Number(e.target.value))}
                  className="border border-slate-300 rounded px-2.5 py-1 text-xs bg-white text-slate-800 font-medium cursor-pointer"
                >
                  {divisions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} · Year {d.year} · Sem {d.semester}
                    </option>
                  ))}
                </select>
              </div>
              <span className="text-slate-500">
                Viewing schedule for {divisions.find((d) => d.id === selectedDivisionId)?.name ?? (selectedDivisionId ? `Division #${selectedDivisionId}` : '—')}
              </span>
            </div>
          )}
          <TimetableGrid
            schedule={timetableSlots}
            slots={timetableSlots}
            subjects={subjects}
            teachers={teachers}
            rooms={rooms}
            batches={batches}
            divisionName={divisions.find((d) => d.id === selectedDivisionId)?.name}
            onEditCell={setEditingSlot}
          />
        </div>
      ) : (
        <WizardLayout onGenerateComplete={handleGenerateComplete} />
      )}

      <EditCellModal
        slot={editingSlot}
        teachers={teachers}
        rooms={rooms}
        allSlots={timetableSlots}
        onClose={() => setEditingSlot(null)}
        onSaved={handleSlotSaved}
      />
    </div>
  );
};

export const TimetablePage: React.FC = () => (
  <WizardProvider>
    <TimetablePageInner />
  </WizardProvider>
);
