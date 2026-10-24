import React, { useEffect, useState } from 'react';
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
import { useWizard } from './WizardContext';

/**
 * Step 4 — allocation inputs for the selected division: which subjects are
 * taught, which teachers are eligible, which rooms are available, and the
 * weekly period quota per subject.
 *
 * This is a read-only review of data configured on the setup pages. The
 * solver reads exactly these tables when it runs.
 */
export const Step4: React.FC = () => {
  const {
    divisionId,
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

  useEffect(() => {
    let mounted = true;
    if (divisionId === null) {
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

        const division = allDivisions.find((item) => item.id === divisionId);

        // Keep only what belongs to this division.
        const divisionSubjects = allSubjects.filter((subject) =>
          allRequirements.some(
            (requirement) =>
              requirement.division_id === divisionId && requirement.subject_id === subject.id
          )
        );
        const divisionTeachers = allTeachers.filter((teacher) =>
          allEligibilities.some(
            (eligibility) =>
              eligibility.division_id === divisionId && eligibility.teacher_id === teacher.id
          )
        );
        // Rooms now belong to a branch and an academic year, not to a
        // division — mirror the solver's room filter exactly.
        const divisionRooms = division
          ? allRooms.filter(
              (room) =>
                (room.branch_id === division.branch_id || room.branch_id === null) &&
                (room.year === division.year || room.year === null)
            )
          : allRooms;

        updateState({
          subjects: divisionSubjects,
          teachers: divisionTeachers,
          rooms: divisionRooms,
          batches: allBatches.filter((batch) => batch.division_id === divisionId),
          eligibilities: allEligibilities.filter(
            (eligibility) => eligibility.division_id === divisionId
          ),
          requirements: allRequirements.filter(
            (requirement) => requirement.division_id === divisionId
          ),
        });
      } catch (_err: unknown) {
        if (mounted) {
          showToast({
            type: 'error',
            title: 'Allocation Unavailable',
            message: 'Could not load the allocation data for this division.',
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [divisionId]);

  const subjectName = (id: number) => subjects.find((s) => s.id === id)?.name ?? `#${id}`;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display font-bold text-base text-slate-900">Allocation</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Subjects, teachers and rooms available to this division.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-6">
          <LoadingSpinner size="md" />
          <span>Loading allocation...</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="border border-slate-200 rounded p-3">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">Subjects</p>
              <p className="font-display font-bold text-lg text-slate-900">{subjects.length}</p>
            </div>
            <div className="border border-slate-200 rounded p-3">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">Teachers</p>
              <p className="font-display font-bold text-lg text-slate-900">{teachers.length}</p>
            </div>
            <div className="border border-slate-200 rounded p-3">
              <p className="text-[11px] uppercase tracking-wider text-slate-500">Rooms</p>
              <p className="font-display font-bold text-lg text-slate-900">{rooms.length}</p>
            </div>
          </div>

          {requirements.length === 0 ? (
            <div className="border border-amber-300 bg-amber-50 rounded p-3 text-xs text-amber-800">
              No weekly requirements for this division. The solver will not schedule anything until
              each subject has a period quota.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Theory</TableHead>
                  <TableHead>Practical</TableHead>
                  <TableHead>Tutorial</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requirements.map((requirement) => (
                  <TableRow key={requirement.id}>
                    <TableCell>{subjectName(requirement.subject_id)}</TableCell>
                    <TableCell>{requirement.theory_periods_per_week}</TableCell>
                    <TableCell>{requirement.practical_sessions_per_week}</TableCell>
                    <TableCell>{requirement.tutorial_periods_per_week}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {batches.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
                Batches
              </p>
              <div className="flex flex-wrap gap-1.5">
                {batches.map((batch) => (
                  <Badge key={batch.id} variant="solid" size="sm">
                    {batch.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex justify-between pt-1">
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
