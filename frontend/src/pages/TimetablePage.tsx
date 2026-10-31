import React, { useState, useEffect } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/useToast';
import { apiClient } from '../api/client';
import type { components } from '../api/schema';
import { WizardProvider, useWizard, type TimetableSlot, type Division, type Batch } from './timetable/WizardContext';
import { WizardLayout } from './timetable/WizardLayout';
import { TimetableGrid, exportTimetableToExcel, exportTimetableToPdf } from './timetable/TimetableGrid';
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
  const [viewMode, setViewMode] = useState<'selection' | 'wizard' | 'grid'>('selection');
  const [hasTimetable, setHasTimetable] = useState<boolean>(false);
  const [isCheckingTimetable, setIsCheckingTimetable] = useState<boolean>(true);
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
          const initialDivId = divisionId ?? divs[0]?.id ?? null;
          setSelectedDivisionId((prev) => prev ?? initialDivId);

          // Check if a timetable already exists for this division
          if (initialDivId !== null) {
            try {
              const { data: ttData } = await apiClient.GET('/api/timetable/{division_id}', {
                params: { path: { division_id: initialDivId } },
              });
              if (isMounted && ttData && ttData.length > 0) {
                setHasTimetable(true);
              }
            } catch (_checkErr) {
              // silently ignore — no timetable found
            }
          }
        }
      } catch (_err: unknown) {
        if (isMounted) {
          setDivisions([]);
        }
      } finally {
        if (isMounted) {
          setIsCheckingTimetable(false);
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

    // Don't auto-fetch when in selection mode (the user hasn't clicked "View" yet)
    if (viewMode === 'selection') {
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
  }, [selectedDivisionId, viewMode]);

  const handleViewExisting = async () => {
    setViewMode('grid');

    // Fetch timetable for the initially selected division
    if (selectedDivisionId !== null) {
      try {
        const { data } = await apiClient.GET('/api/timetable/{division_id}', {
          params: { path: { division_id: selectedDivisionId } },
        });
        setTimetableSlots(data ?? []);
      } catch (_err) {
        showToast({
          type: 'error',
          title: 'Error',
          message: 'Failed to load the timetable.',
        });
      }
    }
  };

  const handleGenerateComplete = async () => {
    const firstSelected = selectedDivisionIds[0];
    const firstDivisionId = divisions[0]?.id;
    const targetId: number | null =
      divisionId ??
      (firstSelected !== undefined ? firstSelected : (firstDivisionId ?? null));
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
    setHasTimetable(true);
  };

  const handleRegenerate = () => {
    reset();
    setTimetableSlots([]);
    setViewMode('wizard');
  };

  const handleBackToOptions = () => {
    setViewMode('selection');
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
        subjects,
        teachers,
        rooms,
        batches,
        divName,
        divYear,
        divSem,
        subjects,
        teachers,
        rooms,
        batches
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

  const handleDownloadPdf = async () => {
    if (timetableSlots.length === 0) {
      showToast({
        type: 'error',
        title: 'Export Failed',
        message: 'No timetable slots available to export.',
      });
      return;
    }

    try {
      const divObj = divisions.find((d) => d.id === selectedDivisionId);
      const divName = divObj?.name ?? 'A';
      const divYear = divObj?.year ? (divObj.year === '1' ? 'FE' : divObj.year === '2' ? 'SE' : divObj.year === '3' ? 'TE' : divObj.year === '4' ? 'BE' : divObj.year) : 'TE';
      const divSem = divObj?.semester ?? 5;

      await exportTimetableToPdf(
        timetableSlots,
        subjects,
        teachers,
        rooms,
        batches,
        divName,
        divYear,
        divSem,
        subjects,
        teachers,
        rooms,
        batches
      );

      showToast({
        type: 'success',
        title: 'Export Complete',
        message: 'PDF timetable document has been downloaded.',
      });
    } catch (_err: unknown) {
      showToast({
        type: 'error',
        title: 'Export Failed',
        message: 'Could not export timetable to PDF.',
      });
    }
  };

  const handleSlotSaved = (updated: TimetableSlot) => {
    setTimetableSlots(timetableSlots.map((slot) => (slot.id === updated.id ? updated : slot)));
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
              <Button variant="secondary" size="sm" onClick={handleBackToOptions}>
                Back to Options
              </Button>
              <Button variant="secondary" size="sm" onClick={handleRegenerate}>
                Regenerate Timetable
              </Button>
              <Button variant="secondary" size="sm" onClick={handleDownloadExcel}>
                Download Excel
              </Button>
              <Button variant="secondary" size="sm" onClick={handleDownloadPdf}>
                Download PDF
              </Button>
            </>
          ) : undefined
        }
      />

      {viewMode === 'selection' && (
        <div className="flex items-center justify-center min-h-[28rem]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl w-full">
            {/* View Existing Timetable */}
            <button
              type="button"
              disabled={!hasTimetable || isCheckingTimetable}
              onClick={handleViewExisting}
              className={`group relative flex flex-col items-center gap-4 p-8 rounded-xl border-2 transition-all duration-150 ${
                hasTimetable && !isCheckingTimetable
                  ? 'border-accent/30 bg-accent/5 hover:border-accent hover:bg-accent/10 hover:shadow-lg cursor-pointer'
                  : 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
              }`}
            >
              {/* Icon: eye / table */}
              <span className={`w-14 h-14 rounded-full flex items-center justify-center ${
                hasTimetable && !isCheckingTimetable ? 'bg-accent/15 text-accent' : 'bg-slate-200 text-slate-400'
              }`}>
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M10.875 12c-.621 0-1.125.504-1.125 1.125M12 12c.621 0 1.125.504 1.125 1.125m0 0v1.5c0 .621-.504 1.125-1.125 1.125M12 15.375c0-.621-.504-1.125-1.125-1.125" />
                </svg>
              </span>
              <span className="text-base font-semibold text-slate-800">View Existing Timetable</span>
              <span className="text-xs text-slate-500 text-center leading-relaxed">
                {isCheckingTimetable
                  ? 'Checking for existing timetable...'
                  : hasTimetable
                    ? 'Open the previously generated timetable grid'
                    : 'No timetable found — generate one first'}
              </span>
            </button>

            {/* Generate New Timetable */}
            <button
              type="button"
              onClick={() => setViewMode('wizard')}
              className="group relative flex flex-col items-center gap-4 p-8 rounded-xl border-2 border-emerald-200 bg-emerald-50/50 hover:border-emerald-500 hover:bg-emerald-50 hover:shadow-lg cursor-pointer transition-all duration-150"
            >
              {/* Icon: sparkles / wand */}
              <span className="w-14 h-14 rounded-full flex items-center justify-center bg-emerald-100 text-emerald-600">
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                </svg>
              </span>
              <span className="text-base font-semibold text-slate-800">Generate New Timetable</span>
              <span className="text-xs text-slate-500 text-center leading-relaxed">
                Run the setup wizard to configure and generate a fresh timetable
              </span>
            </button>
          </div>
        </div>
      )}

      {viewMode === 'wizard' && (
        <WizardLayout onGenerateComplete={handleGenerateComplete} />
      )}

      {viewMode === 'grid' && (
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
