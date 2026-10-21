import React, { useState, useEffect, useCallback } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/useToast';
import { apiClient } from '../api/client';
import type { components } from '../api/schema';
import { WizardProvider, useWizard, type TimetableSlot } from './timetable/WizardContext';
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
 * generated master grid together with the download actions. The separate
 * "Generate & Review" and "Master Grid" pages have been merged into this
 * one.
 */
const TimetablePageInner: React.FC = () => {
  const { divisionId, setSlots, reset } = useWizard();
  const { showToast } = useToast();
  const [isGenerated, setIsGenerated] = useState(false);
  const [editingSlot, setEditingSlot] = useState<TimetableSlot | null>(null);

  // The page owns its own copies of the slot list and the lookup tables.
  // The wizard writes into the context, but the page reads from its own
  // state so the grid always renders from the freshly fetched data rather
  // than depending on the order in which two components update state.
  const [timetableSlots, setTimetableSlots] = useState<TimetableSlot[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);

  /** Load the lookups needed to resolve subject/teacher/room ids to names. */
  const loadLookups = useCallback(async () => {
    try {
      const [subjectsRes, teachersRes, roomsRes] = await Promise.all([
        apiClient.GET('/api/subjects'),
        apiClient.GET('/api/teachers'),
        apiClient.GET('/api/rooms'),
      ]);
      setSubjects(subjectsRes.data ?? []);
      setTeachers(teachersRes.data ?? []);
      setRooms(roomsRes.data ?? []);
    } catch (_err: unknown) {
      setSubjects([]);
      setTeachers([]);
      setRooms([]);
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
    // The wizard has already generated the timetable; re-read the slots
    // here so the page renders from its own state.
    if (divisionId !== null) {
      await loadSlots(divisionId);
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
        <TimetableGrid
          slots={timetableSlots}
          subjects={subjects}
          teachers={teachers}
          rooms={rooms}
          onEditCell={setEditingSlot}
        />
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
