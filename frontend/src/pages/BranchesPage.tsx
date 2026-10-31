import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
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

type Branch = components['schemas']['BranchRead'];
type BranchCreate = components['schemas']['BranchCreate'];

interface BranchFormData {
  name: string;
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
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (first && typeof first.msg === 'string') {
        return first.msg;
      }
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

export const BranchesPage: React.FC = () => {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const { showToast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BranchFormData>({
    defaultValues: {
      name: '',
    },
  });

  useEffect(() => {
    let mounted = true;
    const loadBranches = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await apiClient.GET('/api/branches');
        if (!mounted) {
          return;
        }
        if (error) {
          setBranches([]);
          return;
        }
        setBranches(data ?? []);
      } catch (_err: unknown) {
        if (mounted) {
          setBranches([]);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    loadBranches();
    return () => {
      mounted = false;
    };
  }, []);

  const onSubmit = async (data: BranchFormData) => {
    setIsSubmitting(true);
    setApiError(null);
    const payload: BranchCreate = {
      name: data.name,
    };
    try {
      const { error } = await apiClient.POST('/api/branches', {
        body: payload,
      });
      if (error) {
        const message = extractErrorMessage(error, 'Could not create branch.');
        setApiError(message);
        showToast({
          type: 'error',
          title: 'Submission Failed',
          message,
        });
        return;
      }
      showToast({
        type: 'success',
        title: 'Branch Created',
        message: `Branch ${data.name} created successfully.`,
      });
      setIsModalOpen(false);
      reset();
      // Reload so the new row appears in the table.
      const { data: refreshed } = await apiClient.GET('/api/branches');
      setBranches(refreshed ?? []);
    } catch (_err: unknown) {
      const message = 'Could not create branch.';
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
    setIsModalOpen(true);
  };

  const handleDelete = async (branch: Branch) => {
    const confirmed = window.confirm(
      `Are you sure? This will delete "${branch.name}". This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }
    try {
      const { error } = await apiClient.DELETE('/api/branches/{branch_id}', {
        params: { path: { branch_id: branch.id } },
      });
      if (error) {
        const message = extractErrorMessage(error, 'Could not delete branch.');
        showToast({
          type: 'error',
          title: 'Delete Failed',
          message,
        });
        return;
      }
      showToast({
        type: 'success',
        title: 'Branch Deleted',
        message: `Branch ${branch.name} was deleted.`,
      });
      const { data: refreshed } = await apiClient.GET('/api/branches');
      setBranches(refreshed ?? []);
    } catch (_err: unknown) {
      showToast({
        type: 'error',
        title: 'Delete Failed',
        message: 'Could not delete branch.',
      });
    }
  };

  const [searchQuery, setSearchQuery] = useState<string>('');

  const getBranchMeta = (name: string) => {
    const key = name.toUpperCase().trim();
    const directory: Record<string, { fullName: string; hod: string; intake: string }> = {
      IT: { fullName: 'Information Technology', hod: 'Dr. S. K. Shinde', intake: '120 Seats' },
      COMP: { fullName: 'Computer Engineering', hod: 'Dr. A. P. Patil', intake: '180 Seats' },
      CSE: { fullName: 'Computer Science & Engineering', hod: 'Dr. A. P. Patil', intake: '180 Seats' },
      MECH: { fullName: 'Mechanical Engineering', hod: 'Dr. C. M. Choudhari', intake: '120 Seats' },
      EXTC: { fullName: 'Electronics & Telecommunication', hod: 'Dr. S. D. Joshi', intake: '60 Seats' },
      CIVIL: { fullName: 'Civil Engineering', hod: 'Dr. P. R. Nalawade', intake: '120 Seats' },
      AIDS: { fullName: 'Artificial Intelligence & Data Science', hod: 'Dr. N. M. Rao', intake: '60 Seats' },
    };
    return (
      directory[key] ?? {
        fullName: `${name} Academic Division`,
        hod: 'Head of Department',
        intake: '60 Seats',
      }
    );
  };

  const filteredBranches = branches.filter(
    (b) =>
      b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      getBranchMeta(b.name).fullName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <PageHeader
        title="Branches"
        subtitle="Setup / Academic Branches & Departments"
        action={
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
            Add Branch
          </Button>
        }
      />

      {/* Top Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
        <div className="relative w-full sm:w-72">
          <svg
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter branches..."
            className="w-full pl-9 pr-3 py-1.5 text-xs text-slate-800 bg-slate-50 border border-slate-200 rounded-lg placeholder-slate-400 focus:outline-hidden focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
          />
        </div>
        <div className="text-xs text-slate-500 font-medium self-end sm:self-center">
          Showing {filteredBranches.length} of {branches.length} departments
        </div>
      </div>

      {/* Main Content Viewport */}
      {isLoading ? (
        <div className="flex items-center justify-center p-16 bg-white border border-slate-200 rounded-xl shadow-xs">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <LoadingSpinner size="md" />
            <span>Loading branches...</span>
          </div>
        </div>
      ) : branches.length === 0 ? (
        <EmptyState
          title="No branches yet"
          description="Branches are the top level of the academic hierarchy (e.g. IT, CSE). Create your first branch to begin setup."
          actionLabel="Add Branch"
          onAction={handleOpenModal}
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
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Branch Code</TableHead>
                <TableHead>Full Branch Name</TableHead>
                <TableHead>Head of Department</TableHead>
                <TableHead className="w-36">Total Intake</TableHead>
                <TableHead className="w-20 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredBranches.map((branch) => {
                const meta = getBranchMeta(branch.name);
                return (
                  <TableRow key={branch.id} className="h-14">
                    <TableCell>
                      <span className="font-mono text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-md">
                        {branch.name.toUpperCase()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-slate-900 text-sm">{meta.fullName}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-slate-600 text-xs">{meta.hod}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-medium text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
                        {meta.intake}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(branch)}
                        title={`Delete ${branch.name}`}
                        aria-label={`Delete ${branch.name}`}
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
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Branch Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSubmitting && setIsModalOpen(false)}
        title="Add Branch"
        subtitle="Create a new academic branch (e.g. IT, CSE)"
        maxWidth="sm"
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
              Create Branch
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
                <p className="font-semibold">Could not create branch</p>
                <p className="mt-0.5">{apiError}</p>
              </div>
            </div>
          )}

          {/* Form fields - BranchCreate schema: name */}
          <div>
            <Input
              label="Branch Name"
              placeholder="e.g. IT"
              required
              error={errors.name?.message}
              {...register('name', { required: 'Branch name is required' })}
            />
          </div>
        </form>
      </Modal>
    </div>
  );
};
