import React, { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
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

const YEARS = ['FE', 'SE', 'TE', 'BE'] as const;
type AcademicYear = (typeof YEARS)[number];

/** Fixed academic years mapped to their respective semesters (Mumbai University standard). */
const YEAR_CONFIG: Record<
  AcademicYear,
  { label: string; sub: string; fullLabel: string; semesters: number[]; defaultSem: number }
> = {
  FE: { label: 'FE', sub: '1st Year', fullLabel: 'First Year', semesters: [1, 2], defaultSem: 1 },
  SE: { label: 'SE', sub: '2nd Year', fullLabel: 'Second Year', semesters: [3, 4], defaultSem: 3 },
  TE: { label: 'TE', sub: '3rd Year', fullLabel: 'Third Year', semesters: [5, 6], defaultSem: 5 },
  BE: { label: 'BE', sub: 'Final Year', fullLabel: 'Final Year', semesters: [7, 8], defaultSem: 7 },
};

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

/* ── White Card Container ── */
const WhiteCard: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-xs ${className}`}>
      {children}
    </div>
  );
};

/* ── Quick-Select Branch Chips for Empty State ── */
const QUICK_BRANCHES = ['IT', 'CMPN', 'AI&DS', 'EXTC', 'MECH'];

export const DivisionsPage: React.FC = () => {
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<number | ''>('');
  const [selectedYear, setSelectedYear] = useState<AcademicYear>('SE');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const { showToast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
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
          const message = extractErrorMessage(
            batchError,
            `Could not create batch "${batchName}".`
          );
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

  const handleOpenModal = () => {
    setApiError(null);
    setValue('semester', YEAR_CONFIG[selectedYear]?.defaultSem ?? 1);
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

  const handleDelete = async (division: Division) => {
    const confirmed = window.confirm(
      `Are you sure? This will delete "${division.name}". This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }
    try {
      const { error } = await apiClient.DELETE('/api/divisions/{division_id}', {
        params: { path: { division_id: division.id } },
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
        message: `Division ${division.name} was deleted.`,
      });
      // Refresh the table so the row disappears without a reload.
      await loadDivisions();
    } catch (_err: unknown) {
      showToast({
        type: 'error',
        title: 'Delete Failed',
        message: 'Could not delete division.',
      });
    }
  };

  /** Quick-select a branch by name from the chips. */
  const handleQuickBranch = (name: string) => {
    const found = branches.find(
      (b) => b.name.toUpperCase() === name.toUpperCase()
    );
    if (found) {
      setSelectedBranchId(found.id);
    }
  };

  const hasBranch = selectedBranchId !== '';
  const selectedBranchName =
    selectedBranchId !== '' ? branchName(selectedBranchId) : null;

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 leading-tight">
            Divisions
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1 tracking-normal">
            Setup / Academic Divisions
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="primary"
            size="sm"
            onClick={handleOpenModal}
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
        </div>
      </div>

      {/* ── Filter Controls ── */}
      <WhiteCard className="p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-4">
          {/* Branch Selector */}
          <div className="w-full max-w-xs">
            <Select
              label="Branch"
              value={selectedBranchId}
              onChange={(event) =>
                setSelectedBranchId(event.target.value === '' ? '' : Number(event.target.value))
              }
              disabled={isLoading}
            >
              <option value="">— Select a branch —</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          </div>

          {/* Segmented Year Switcher */}
          <div className="flex-1 min-w-0">
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 font-display">
              Academic Year
            </label>
            <div className="bg-slate-100 p-1 rounded-lg inline-flex gap-1 border border-slate-200">
              {YEARS.map((year) => {
                const config = YEAR_CONFIG[year];
                const isSelected = selectedYear === year;
                return (
                  <button
                    key={year}
                    type="button"
                    disabled={!hasBranch}
                    onClick={() => {
                      setSelectedYear(year);
                      setValue('semester', config.defaultSem);
                    }}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs transition-colors duration-150 focus-ring disabled:cursor-not-allowed ${
                      isSelected
                        ? 'bg-white text-blue-700 font-bold shadow-xs border border-slate-200/80'
                        : hasBranch
                        ? 'text-slate-600 hover:text-slate-900 font-medium'
                        : 'text-slate-400 opacity-60'
                    }`}
                  >
                    <span>{config.label}</span>
                    <span
                      className={`text-[10px] hidden sm:inline ${
                        isSelected ? 'text-blue-600 font-medium' : 'text-slate-400'
                      }`}
                    >
                      {config.sub}
                    </span>
                  </button>
                );
              })}
            </div>
            {!hasBranch && (
              <p className="text-[11px] text-amber-600 mt-1 font-medium">
                Select a branch above to unlock academic year tabs
              </p>
            )}
          </div>
        </div>

        {/* Active filter summary chip */}
        {hasBranch && (
          <div className="mt-3 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {selectedBranchName} · {selectedYear} — Sem {YEAR_CONFIG[selectedYear]?.semesters.join('/')}{' '}
              · {visibleDivisions.length} division{visibleDivisions.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </WhiteCard>

      {/* ── Main Content Viewport ── */}
      {isLoading ? (
        <WhiteCard className="p-16">
          <div className="flex flex-col items-center justify-center gap-3 text-slate-500">
            <LoadingSpinner size="lg" />
            <span className="text-sm font-medium">Loading divisions…</span>
          </div>
        </WhiteCard>
      ) : !hasBranch ? (
        /* Empty State: No Branch Selected */
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center min-h-[260px] flex flex-col items-center justify-center">
          <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 mb-4">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1" />
            </svg>
          </div>
          <h3 className="font-display font-bold text-base text-slate-900 mb-1">
            Select an Academic Branch
          </h3>
          <p className="text-xs text-slate-500 max-w-md mb-5 leading-relaxed">
            Choose a branch from the selector above or pick a quick preset below to view configured divisions.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2">
            {QUICK_BRANCHES.map((name) => {
              const exists = branches.some(
                (b) => b.name.toUpperCase() === name.toUpperCase()
              );
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => handleQuickBranch(name)}
                  disabled={!exists}
                  className={`px-3 py-1 rounded-md text-xs font-mono font-medium border transition-colors ${
                    exists
                      ? 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100'
                      : 'text-slate-400 bg-slate-50 border-slate-200 cursor-not-allowed opacity-50'
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      ) : visibleDivisions.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center min-h-[240px] flex flex-col items-center justify-center">
          <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 mb-3">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <h4 className="font-display font-bold text-base text-slate-900 mb-1">
            No divisions found
          </h4>
          <p className="text-xs text-slate-500 max-w-sm mb-4 leading-relaxed">
            No divisions configured for {selectedYear} ({selectedBranchName}). Create your first division to begin setup.
          </p>
          <Button variant="primary" size="sm" onClick={handleOpenModal}>
            Add Division
          </Button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Division Name</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Year</TableHead>
                <TableHead>Semester</TableHead>
                <TableHead className="w-20 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleDivisions.map((division) => (
                <TableRow key={division.id} className="h-14">
                  <TableCell>
                    <span className="font-semibold text-slate-900 text-sm">{division.name}</span>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center text-xs font-mono font-medium text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-md">
                      {branchName(division.branch_id)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-slate-700 text-xs font-medium">{division.year}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-slate-600">Sem {division.semester}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <button
                      type="button"
                      onClick={() => handleDelete(division)}
                      title={`Delete ${division.name}`}
                      aria-label={`Delete ${division.name}`}
                      className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 p-1.5 rounded-lg transition-colors inline-flex items-center justify-center"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                        <path
                          fillRule="evenodd"
                          d="M8.75 1A2.75 2.75 0 006 3.75V4H3.5a.75.75 0 000 1.5h.443l.752 11.279A2.75 2.75 0 007.44 19.5h5.12a2.75 2.75 0 002.745-2.721L16.057 5.5h.443a.75.75 0 000-1.5H14v-.25A2.75 2.75 0 0011.25 1h-2.5zM7.5 4v-.25c0-.69.56-1.25 1.25-1.25h2.5c.69 0 1.25.56 1.25 1.25V4h-5z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Add Division Modal ── */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSubmitting && setIsModalOpen(false)}
        title="Add Academic Division"
        subtitle="Define a new academic division scoped to a branch and term"
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
              Create Division
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {apiError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 rounded-lg text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <svg className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p className="font-semibold">Could not create division</p>
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

          <div className="border border-blue-200 dark:border-blue-800/40 rounded-lg bg-blue-50/80 dark:bg-blue-950/30 p-3 text-xs text-slate-600 dark:text-slate-300">
            <p>
              This division will be created under{' '}
              <span className="font-semibold text-slate-900 dark:text-white">
                {branchName(selectedBranchId === '' ? 0 : selectedBranchId)}
              </span>{' '}
              for the{' '}
              <span className="font-semibold text-blue-600 dark:text-blue-400">
                {selectedYear} ({YEAR_CONFIG[selectedYear]?.sub})
              </span>{' '}
              academic year.
            </p>
          </div>

          <div>
            <Select
              label="Semester"
              required
              error={errors.semester?.message}
              {...register('semester', {
                required: 'Semester is required',
                valueAsNumber: true,
              })}
            >
              {YEAR_CONFIG[selectedYear]?.semesters.map((sem) => (
                <option key={sem} value={sem}>
                  Semester {sem} ({selectedYear} Term)
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Input
              label="Batches (comma separated)"
              placeholder="e.g. A1, A2, A3"
              helperText="Optional. These batches will be created automatically under this division."
              error={errors.batches?.message}
              {...register('batches')}
            />
          </div>
        </form>
      </Modal>
    </div>
  );
};
