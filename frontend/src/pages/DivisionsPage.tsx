import React, { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/Table';
import { useToast } from '../components/ui/useToast';
import { apiClient } from '../api/client';
import type { components } from '../api/schema';

type Division = components['schemas']['DivisionRead'];
type DivisionCreate = components['schemas']['DivisionCreate'];
type Branch = components['schemas']['BranchRead'];

/** The four fixed academic years a division can belong to. */
const YEARS = ['FE', 'SE', 'TE', 'BE'] as const;

interface DivisionFormData {
  name: string;
  semester: number;
  /** Comma-separated batch names, e.g. "A1, A2, A3". Created with the division. */
  batches: string;
}

/**
 * Extract a human-readable message from an openapi-fetch error payload.
 * The backend returns `{ "detail": ... }` for HTTPException responses and
 * `{ "detail": [{ msg, loc, ... }] }` for request validation errors.
 */
const extractErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'object' && error !== null && 'detail' in error) {
    const detail = (error as { detail: unknown }).detail;
    if (typeof detail === 'string') {
      return detail;
    }
    if (typeof detail === 'object' && detail !== null && 'message' in detail) {
      const message = (detail as { message: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
    }
  }
  return fallback;
};

export const DivisionsPage: React.FC = () => {
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<number | ''>('');
  const [selectedYear, setSelectedYear] = useState<string>('SE');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [selectedDivision, setSelectedDivision] = useState<Division | null>(null);
  const [divisionToDelete, setDivisionToDelete] = useState<Division | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const { showToast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DivisionFormData>({
    defaultValues: {
      name: '',
      semester: 3,
      batches: '',
    },
  });

  /**
   * Fetch the division list. Exposed as a stable callback so it can be
   * re-run after a create or delete without a page reload.
   */
  const loadDivisions = useCallback(async () => {
    try {
      const { data, error } = await apiClient.GET('/api/divisions');
      if (error) {
        setDivisions([]);
        return;
      }
      setDivisions(data ?? []);
    } catch (_err: unknown) {
      setDivisions([]);
    }
  }, []);

  const loadBranches = useCallback(async () => {
    try {
      const { data } = await apiClient.GET('/api/branches');
      setBranches(data ?? []);
    } catch (_err: unknown) {
      setBranches([]);
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    const initialLoad = async () => {
      setIsLoading(true);
      await Promise.all([loadDivisions(), loadBranches()]);
      if (mounted) {
        setIsLoading(false);
      }
    };
    initialLoad();
    return () => {
      mounted = false;
    };
  }, [loadDivisions, loadBranches]);

  const onSubmit = async (data: DivisionFormData) => {
    setIsSubmitting(true);
    setApiError(null);

    if (isEditing && selectedDivision) {
      try {
        const { error } = await apiClient.PATCH('/api/divisions/{division_id}', {
          params: { path: { division_id: selectedDivision.id } },
          body: {
            name: data.name,
            semester: data.semester,
          },
        });
        if (error) {
          const message = extractErrorMessage(error, 'Could not update division.');
          setApiError(message);
          showToast({
            type: 'error',
            title: 'Update Failed',
            message,
          });
          return;
        }
        showToast({
          type: 'success',
          title: 'Division Updated',
          message: `Division ${data.name} was updated successfully.`,
        });
        setIsModalOpen(false);
        setIsEditing(false);
        setSelectedDivision(null);
        reset();
        await loadDivisions();
      } catch (_err: unknown) {
        const message = 'Could not update division.';
        setApiError(message);
        showToast({
          type: 'error',
          title: 'Update Failed',
          message,
        });
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (selectedBranchId === '') {
      const message = 'Select a branch before creating a division.';
      setApiError(message);
      setIsSubmitting(false);
      return;
    }
    // Branch and year come from the page-level selectors, not the form.
    const payload: DivisionCreate = {
      name: data.name,
      branch_id: selectedBranchId,
      year: selectedYear,
      semester: data.semester,
    };
    try {
      const { data: created, error } = await apiClient.POST('/api/divisions', {
        body: payload,
      });
      if (error || !created) {
        const message = extractErrorMessage(error, 'Could not create division.');
        setApiError(message);
        showToast({
          type: 'error',
          title: 'Submission Failed',
          message,
        });
        return;
      }

      // Create the batches under the new division. The batch names come from
      // a comma-separated string; blank entries are ignored.
      const newDivisionId = created.id;
      const batchNames = data.batches
        .split(',')
        .map((batchName) => batchName.trim())
        .filter((batchName) => batchName.length > 0);

      let createdBatches = 0;
      for (const batchName of batchNames) {
        const { error: batchError } = await apiClient.POST('/api/batches', {
          body: { name: batchName, division_id: newDivisionId },
        });
        if (batchError) {
          const message = extractErrorMessage(batchError, `Could not create batch "${batchName}".`);
          setApiError(message);
          showToast({
            type: 'error',
            title: 'Batch Not Created',
            message,
          });
          continue;
        }
        createdBatches += 1;
      }

      showToast({
        type: 'success',
        title: 'Division Created',
        message:
          createdBatches > 0
            ? `Division ${data.name} created with ${createdBatches} batch${
                createdBatches === 1 ? '' : 'es'
              }.`
            : `Division ${data.name} created successfully.`,
      });
      setIsModalOpen(false);
      reset();
      // Refresh the table so the new division appears without a reload.
      await loadDivisions();
    } catch (_err: unknown) {
      const message = 'Could not create division.';
      setApiError(message);
      showToast({
        type: 'error',
        title: 'Submission Failed',
        message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenCreateModal = () => {
    setIsEditing(false);
    setSelectedDivision(null);
    setApiError(null);
    const defaultSem = selectedYear === 'FE' ? 1 : selectedYear === 'SE' ? 3 : selectedYear === 'TE' ? 5 : 7;
    reset({
      name: '',
      semester: defaultSem,
      batches: '',
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (division: Division) => {
    setIsEditing(true);
    setSelectedDivision(division);
    setApiError(null);
    reset({
      name: division.name,
      semester: division.semester,
      batches: '',
    });
    setIsModalOpen(true);
  };

  const branchName = (branchId: number): string => {
    const branch = branches.find((item) => item.id === branchId);
    return branch ? branch.name : `Branch #${branchId}`;
  };

  /** Only the divisions of the selected branch and year are listed. */
  const visibleDivisions = divisions.filter(
    (division) =>
      selectedBranchId !== '' &&
      division.branch_id === selectedBranchId &&
      division.year === selectedYear
  );

  const handleDeleteClick = (division: Division) => {
    setDivisionToDelete(division);
  };

  const handleConfirmDelete = async () => {
    if (!divisionToDelete) return;
    setIsDeleting(true);
    try {
      const { error } = await apiClient.DELETE('/api/divisions/{division_id}', {
        params: { path: { division_id: divisionToDelete.id } },
      });
      if (error) {
        const message = extractErrorMessage(error, 'Could not delete division.');
        showToast({
          type: 'error',
          title: 'Delete Failed',
          message,
        });
        return;
      }
      showToast({
        type: 'success',
        title: 'Division Deleted',
        message: `Division ${divisionToDelete.name} was deleted.`,
      });
      setDivisionToDelete(null);
      await loadDivisions();
    } catch (_err: unknown) {
      showToast({
        type: 'error',
        title: 'Delete Failed',
        message: 'Could not delete division.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <PageHeader
        title="Divisions"
        subtitle="Setup / Academic Divisions Management"
        action={
          <Button
            variant="primary"
            size="sm"
            onClick={handleOpenCreateModal}
            leftIcon={
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                  clipRule="evenodd"
                />
              </svg>
            }
          >
            Add Division
          </Button>
        }
      />

      {/* Branch and Year selectors */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <Select
            label="Select Branch"
            value={selectedBranchId}
            onChange={(event) =>
              setSelectedBranchId(event.target.value === '' ? '' : Number(event.target.value))
            }
            disabled={isLoading}
          >
            <option value="">-- Select a branch --</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </div>

        {/* Year tabs */}
        <div className="flex items-center gap-1 border border-slate-200 rounded p-0.5 bg-surface">
          {YEARS.map((year) => (
            <button
              key={year}
              type="button"
              onClick={() => setSelectedYear(year)}
              className={`px-3 h-8 rounded text-xs font-medium transition-colors duration-75 ${
                selectedYear === year ? 'bg-accent text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {year}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content Viewport */}
      {isLoading ? (
        <div className="flex items-center justify-center p-16 bg-surface border border-slate-200 rounded">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <LoadingSpinner size="md" />
            <span>Loading divisions...</span>
          </div>
        </div>
      ) : selectedBranchId === '' ? (
        <EmptyState
          title="Select a branch"
          description="Pick a branch to list its divisions, then choose an academic year."
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
                d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1"
              />
            </svg>
          }
        />
      ) : visibleDivisions.length === 0 ? (
        <EmptyState
          title="No divisions yet"
          description="Academic divisions partition classes for timetabling (e.g., 2nd Year IT - Division A). Create your first division to begin setup."
          actionLabel="Add Division"
          onAction={handleOpenCreateModal}
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
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Year</TableHead>
              <TableHead>Semester</TableHead>
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleDivisions.map((division) => (
              <TableRow key={division.id}>
                <TableCell isName>{division.name}</TableCell>
                <TableCell>{branchName(division.branch_id)}</TableCell>
                <TableCell>{division.year}</TableCell>
                <TableCell>{division.semester}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(division)}
                      title={`Edit ${division.name}`}
                      aria-label={`Edit ${division.name}`}
                      className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteClick(division)}
                      title={`Delete ${division.name}`}
                      aria-label={`Delete ${division.name}`}
                      className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fillRule="evenodd"
                          d="M8.75 1A2.75 2.75 0 006 3.75V4H3.5a.75.75 0 000 1.5h.443l.752 11.279A2.75 2.75 0 007.44 19.5h5.12a2.75 2.75 0 002.745-2.721L16.057 5.5h.443a.75.75 0 000-1.5H14v-.25A2.75 2.75 0 0011.25 1h-2.5zM7.5 4v-.25c0-.69.56-1.25 1.25-1.25h2.5c.69 0 1.25.56 1.25 1.25V4h-5z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Add / Edit Division Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSubmitting && setIsModalOpen(false)}
        title={isEditing ? 'Edit Academic Division' : 'Add Academic Division'}
        subtitle={
          isEditing
            ? 'Update the details for this academic division'
            : 'Define a new academic division scoped to a branch and term'
        }
        maxWidth="md"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit(onSubmit)}
              isLoading={isSubmitting}
            >
              {isEditing ? 'Update Division' : 'Create Division'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {apiError && (
            <div className="p-3 bg-danger-subtle border border-danger-border rounded text-xs text-danger flex items-start gap-2">
              <svg className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p className="font-semibold">
                  {isEditing ? 'Could not update division' : 'Could not create division'}
                </p>
                <p className="mt-0.5">{apiError}</p>
              </div>
            </div>
          )}

          {/* Form fields - DivisionCreate schema: name, semester.
              Branch and year come from the page-level selectors above. */}
          <div>
            <Input
              label="Division Name"
              placeholder="e.g. Division A"
              required
              error={errors.name?.message}
              {...register('name', { required: 'Division name is required' })}
            />
          </div>

          <div className="border border-slate-200 rounded bg-slate-50 p-3 text-xs text-slate-600">
            <p>
              This division is scoped under{' '}
              <span className="font-semibold text-slate-800">
                {branchName(selectedBranchId === '' ? 0 : selectedBranchId)}
              </span>{' '}
              for the <span className="font-semibold text-slate-800">{selectedYear}</span> academic
              year.
            </p>
          </div>

          <div>
            <Input
              label="Semester"
              type="number"
              placeholder="e.g. 3"
              required
              error={errors.semester?.message}
              {...register('semester', {
                required: 'Semester number is required',
                valueAsNumber: true,
                min: { value: 1, message: 'Semester must be at least 1' },
                max: { value: 8, message: 'Semester must be at most 8' },
              })}
            />
          </div>

          {!isEditing && (
            <div>
              <Input
                label="Batches (comma separated)"
                placeholder="e.g. A1, A2, A3"
                helperText="Optional. These batches will be created automatically under this division."
                error={errors.batches?.message}
                {...register('batches')}
              />
            </div>
          )}
        </form>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={divisionToDelete !== null}
        title="Delete Division"
        message="Are you sure you want to delete this record? This action cannot be undone."
        confirmLabel="Yes / Confirm"
        cancelLabel="Cancel"
        variant="danger"
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDivisionToDelete(null)}
      />
    </div>
  );
};
