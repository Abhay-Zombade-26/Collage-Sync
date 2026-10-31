import React, { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/useToast';
import { apiClient } from '../api/client';
import type { components } from '../api/schema';
import { WizardProvider, useWizard, type TimetableSlot, type Division } from './timetable/WizardContext';
import { WizardLayout } from './timetable/WizardLayout';
import { TimetableGrid } from './timetable/TimetableGrid';
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
  const { divisionId, selectedDivisionIds, setSlots, reset } = useWizard();
  const { showToast } = useToast();
  const [isGenerated, setIsGenerated] = useState(false);
  const [editingSlot, setEditingSlot] = useState<TimetableSlot | null>(null);

  // The page owns its own copies of the slot list and the lookup tables.
  const [timetableSlots, setTimetableSlots] = useState<TimetableSlot[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [viewDivisionId, setViewDivisionId] = useState<number | null>(null);

  /** Load the lookups needed to resolve subject/teacher/room ids to names. */
  const loadLookups = useCallback(async () => {
    try {
      const [subjectsRes, teachersRes, roomsRes, divisionsRes] = await Promise.all([
        apiClient.GET('/api/subjects'),
        apiClient.GET('/api/teachers'),
        apiClient.GET('/api/rooms'),
        apiClient.GET('/api/divisions'),
      ]);
      setSubjects(subjectsRes.data ?? []);
      setTeachers(teachersRes.data ?? []);
      setRooms(roomsRes.data ?? []);
      setDivisions(divisionsRes.data ?? []);
    } catch (_err: unknown) {
      setSubjects([]);
      setTeachers([]);
      setRooms([]);
      setDivisions([]);
    }
  }, []);

  /** Fetch the generated slots for a division. */
  const loadSlots = useCallback(async (id: number) => {
    const { data, error } = await apiClient.GET('/api/timetable/{division_id}', {
      params: { path: { division_id: id } },
    });
    console.log('Fetched Timetable Data:', data, error);
    if (error) {
      showToast({
        type: 'error',
        title: 'Could Not Load Timetable',
        message: 'The timetable was generated but could not be loaded.',
      });
      setTimetableSlots([]);
      return [];
    }
    const loaded = data ?? [];
    setTimetableSlots(loaded);
    // Keep the wizard context in sync (the Edit modal reads from it).
    setSlots(loaded);
    return loaded;
  }, [setSlots, showToast]);

  // Load the lookup tables as soon as the page mounts, so the grid can
  // resolve ids to names.
  useEffect(() => {
    loadLookups();
  }, [loadLookups]);

  const handleGenerateComplete = async () => {
    const targetId: number | null =
      divisionId ?? (selectedDivisionIds.length > 0 ? selectedDivisionIds[0] : null) ?? null;
    setViewDivisionId(targetId);
    if (targetId !== null) {
      await loadSlots(targetId);
    }
    await loadLookups();
    setIsGenerated(true);
  };

  const handleStartOver = () => {
    reset();
    setTimetableSlots([]);
    setIsGenerated(false);
  };

  const handleDownloadPdf = () => {
    showToast({
      type: 'info',
      title: 'Export Pending',
      message: 'PDF export is not wired up yet — opening the print dialog instead.',
    });
    window.print();
  };

  const handleDownloadExcel = () => {
    showToast({
      type: 'info',
      title: 'Export Pending',
      message: 'Excel export is not wired up yet — opening the print dialog instead.',
    });
    window.print();
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
          isGenerated ? (
            <>
              <Button variant="secondary" size="sm" onClick={handleDownloadExcel}>
                Download Excel
              </Button>
              <Button variant="primary" size="sm" onClick={handleDownloadPdf}>
                Download PDF
              </Button>
              <Button variant="secondary" size="sm" onClick={handleStartOver}>
                Start Over
              </Button>
            </>
          ) : undefined
        }
      />

      {isGenerated ? (
        <div className="space-y-3">
          {divisions.length > 0 && (
            <div className="flex flex-wrap items-center justify-between border border-border bg-surface rounded-xl p-3 text-xs gap-3 spotlight-card shadow-xs">
              <div className="flex items-center gap-2.5">
                <span className="font-semibold text-slate-700 dark:text-slate-300">Active Division:</span>
                <select
                  value={viewDivisionId ?? ''}
                  onChange={async (e) => {
                    const id = Number(e.target.value);
                    setViewDivisionId(id);
                    await loadSlots(id);
                  }}
                  className="border border-border rounded-lg px-3 py-1.5 text-xs bg-surface text-slate-800 dark:text-slate-200 font-medium cursor-pointer focus-ring shadow-2xs"
                >
                  {divisions
                    .filter(
                      (d) =>
                        selectedDivisionIds.length === 0 ||
                        selectedDivisionIds.includes(d.id)
                    )
                    .map((d) => (
                      <option key={d.id} value={d.id} className="bg-slate-900 text-slate-100">
                        {d.name} · Year {d.year} · Sem {d.semester}
                      </option>
                    ))}
                </select>
              </div>
              <span className="text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                Viewing schedule: {divisions.find((d) => d.id === viewDivisionId)?.name ?? `Division #${viewDivisionId}`}
              </span>
            </div>
          )}
          <TimetableGrid
            slots={timetableSlots}
            subjects={subjects}
            teachers={teachers}
            rooms={rooms}
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
