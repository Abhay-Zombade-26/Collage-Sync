import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { LoadingSpinner } from '../../components/ui/LoadingSpinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/Table';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../components/ui/useToast';
import { apiClient } from '../../api/client';
import { useWizard, type Division, type Subject } from './WizardContext';

/**
 * Step 4 — allocation inputs for all selected divisions: which subjects are
 * taught, which teachers are eligible, which rooms are available, and the
 * weekly period quota per subject.
 *
 * Aggregates summary statistics across ALL selected divisions and displays
 * a grouped table view per division with sticky division headers.
 */
export const Step4: React.FC = () => {
  const {
    divisionId,
    selectedDivisionIds,
    subjects,
    teachers,
    rooms,
    batches,
    requirements,
    updateState,
    nextStep,
    prevStep,
  } = useWizard();
  const { showToast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [allSubjectsList, setAllSubjectsList] = useState<Subject[]>([]);

  // Array of target division IDs across previous steps
  const targetDivisionIds = useMemo(() => {
    if (selectedDivisionIds && selectedDivisionIds.length > 0) {
      return selectedDivisionIds;
    }
    return divisionId !== null ? [divisionId] : [];
  }, [selectedDivisionIds, divisionId]);

  useEffect(() => {
    let mounted = true;
    if (targetDivisionIds.length === 0) {
      setIsLoading(false);
      return;
    }

    const loadAllocation = async () => {
      setIsLoading(true);
      try {
        const [subjectsRes, teachersRes, roomsRes, batchesRes, eligRes, reqRes, divisionsRes] =
          await Promise.all([
            apiClient.GET('/api/subjects'),
            apiClient.GET('/api/teachers'),
            apiClient.GET('/api/rooms'),
            apiClient.GET('/api/batches'),
            apiClient.GET('/api/eligibility'),
            apiClient.GET('/api/weekly-requirement'),
            apiClient.GET('/api/divisions'),
          ]);
        if (!mounted) {
          return;
        }

        const allSubjects = subjectsRes.data ?? [];
        const allTeachers = teachersRes.data ?? [];
        const allRooms = roomsRes.data ?? [];
        const allBatches = batchesRes.data ?? [];
        const allEligibilities = eligRes.data ?? [];
        const allRequirements = reqRes.data ?? [];
        const allDivisions = divisionsRes.data ?? [];

        setAllSubjectsList(allSubjects);

        // Keep all selected divisions
        const activeDivisions = allDivisions.filter((d) => targetDivisionIds.includes(d.id));
        setDivisions(activeDivisions);

        // Weekly requirements for ALL selected divisions
        const aggregatedRequirements = allRequirements.filter((req) =>
          targetDivisionIds.includes(req.division_id)
        );

        // Unique subjects required across all selected divisions
        const requiredSubjectIds = new Set(aggregatedRequirements.map((r) => r.subject_id));
        const aggregatedSubjects = allSubjects.filter((subject) =>
          requiredSubjectIds.has(subject.id)
        );

        // Unique teachers eligible across all selected divisions
        const selectedEligibilities = allEligibilities.filter((elig) =>
          targetDivisionIds.includes(elig.division_id)
        );
        const eligibleTeacherIds = new Set(selectedEligibilities.map((e) => e.teacher_id));
        const aggregatedTeachers = allTeachers.filter((teacher) =>
          eligibleTeacherIds.has(teacher.id)
        );

        // Rooms matching the branch and year of any selected division
        const aggregatedRooms = allRooms.filter((room) =>
          activeDivisions.some(
            (division) =>
              (room.branch_id === division.branch_id || room.branch_id === null) &&
              (room.year === division.year || room.year === null)
          )
        );

        // Batches for all selected divisions
        const aggregatedBatches = allBatches.filter((batch) =>
          targetDivisionIds.includes(batch.division_id)
        );

        updateState({
          subjects: aggregatedSubjects,
          teachers: aggregatedTeachers,
          rooms: aggregatedRooms.length > 0 ? aggregatedRooms : allRooms,
          batches: aggregatedBatches,
          eligibilities: selectedEligibilities,
          requirements: aggregatedRequirements,
        });
      } catch (_err: unknown) {
        if (mounted) {
          showToast({
            type: 'error',
            title: 'Allocation Unavailable',
            message: 'Could not load the allocation data for the selected divisions.',
          });
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    loadAllocation();
    return () => {
      mounted = false;
    };
  }, [targetDivisionIds, showToast, updateState]);

  const subjectName = (id: number) =>
    allSubjectsList.find((s) => s.id === id)?.name ??
    subjects.find((s) => s.id === id)?.name ??
    `#${id}`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display font-bold text-base text-slate-900">Allocation</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Aggregated subjects, teachers, and rooms available across all selected divisions.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-6">
          <LoadingSpinner size="md" />
          <span>Loading allocation data...</span>
        </div>
      ) : (
        <>
          {/* Summary Cards with aggregate totals across ALL selected divisions */}
          <div className="grid grid-cols-3 gap-3">
            <div className="border border-slate-200 rounded-lg p-3.5 bg-white shadow-sm">
              <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
                Subjects
              </p>
              <p className="font-display font-bold text-2xl text-slate-900 mt-1">
                {subjects.length}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">Across all selected divisions</p>
            </div>
            <div className="border border-slate-200 rounded-lg p-3.5 bg-white shadow-sm">
              <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
                Teachers
              </p>
              <p className="font-display font-bold text-2xl text-slate-900 mt-1">
                {teachers.length}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">Assigned to eligible subjects</p>
            </div>
            <div className="border border-slate-200 rounded-lg p-3.5 bg-white shadow-sm">
              <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
                Rooms
              </p>
              <p className="font-display font-bold text-2xl text-slate-900 mt-1">
                {rooms.length}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">Available for these cohorts</p>
            </div>
          </div>

          {/* Grouped Table View: Loop through each selected division */}
          {divisions.length === 0 ? (
            <div className="border border-amber-300 bg-amber-50 rounded-lg p-4 text-xs text-amber-800">
              No divisions selected. Please return to Step 2 and choose one or more divisions.
            </div>
          ) : (
            <div className="space-y-6">
              {divisions.map((division) => {
                const divReqs = requirements.filter((r) => r.division_id === division.id);
                const divBatches = batches.filter((b) => b.division_id === division.id);

                return (
                  <div
                    key={division.id}
                    className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm"
                  >
                    {/* Sticky Division Header with distinctive styling */}
                    <div className="bg-slate-100/90 border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10 backdrop-blur-sm">
                      <div className="flex items-center gap-2.5">
                        <span className="font-display font-bold text-sm text-slate-900">
                          {division.year} Div {division.name}
                        </span>
                        <Badge variant="outline" size="sm">
                          Semester {division.semester}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
                        <span>
                          {divReqs.length} {divReqs.length === 1 ? 'Subject' : 'Subjects'}
                        </span>
                        {divBatches.length > 0 && (
                          <>
                            <span>•</span>
                            <span>{divBatches.length} Batches</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Requirements Table or Empty State */}
                    {divReqs.length === 0 ? (
                      <div className="p-4 text-xs text-amber-800 bg-amber-50/50">
                        No weekly requirements configured for {division.year} Div {division.name}.
                        The solver will not schedule any periods for this division.
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50/60">
                            <TableHead className="font-semibold text-slate-700">Subject</TableHead>
                            <TableHead className="font-semibold text-slate-700 w-28">
                              Theory (hrs)
                            </TableHead>
                            <TableHead className="font-semibold text-slate-700 w-32">
                              Practical (sessions)
                            </TableHead>
                            <TableHead className="font-semibold text-slate-700 w-28">
                              Tutorial (hrs)
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {divReqs.map((requirement) => (
                            <TableRow key={requirement.id} className="hover:bg-slate-50/50">
                              <TableCell className="font-medium text-slate-900">
                                {subjectName(requirement.subject_id)}
                              </TableCell>
                              <TableCell>{requirement.theory_periods_per_week}</TableCell>
                              <TableCell>{requirement.practical_sessions_per_week}</TableCell>
                              <TableCell>{requirement.tutorial_periods_per_week}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}

                    {/* Division Batches */}
                    {divBatches.length > 0 && (
                      <div className="px-4 py-2.5 bg-slate-50/70 border-t border-slate-100 flex items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          Batches:
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {divBatches.map((batch) => (
                            <Badge key={batch.id} variant="solid" size="sm">
                              {batch.name}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="flex justify-between pt-2">
        <Button type="button" variant="secondary" size="md" onClick={prevStep}>
          Back
        </Button>
        <Button type="button" variant="primary" size="md" onClick={nextStep}>
          Continue
        </Button>
      </div>
    </div>
  );
};
