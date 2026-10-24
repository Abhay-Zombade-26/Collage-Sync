import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
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
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/useToast';
import { apiClient } from '../api/client';
import type { components } from '../api/schema';

type Subject = components['schemas']['SubjectRead'];
type SubjectCreate = components['schemas']['SubjectCreate'];
type Branch = components['schemas']['BranchRead'];

const YEARS = ['FE', 'SE', 'TE', 'BE'] as const;

/** Subject categories: THEORY lectures vs LAB practicals (2 consecutive periods). */
const SUBJECT_TYPES = ['THEORY', 'LAB'] as const;

interface SubjectFormData {
  name: string;
  code: string;
  year: string;
  branch_id: number | '';
  subject_type: string;
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

export const SubjectsPage: React.FC = () => {
  const [subjects, setSubjects] = useState<Subject[]>([]);
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
  } = useForm<SubjectFormData>({
    defaultValues: {
      name: '',
      code: '',
      year: 'SE',
      branch_id: '',
      subject_type: 'THEORY',
    },
  });

  useEffect(() => {
    let mounted = true;
    const loadSubjects = async () => {
      setIsLoading(true);
      try {
        const [subjectsRes, branchesRes] = await Promise.all([
          apiClient.GET('/api/subjects'),
          apiClient.GET('/api/branches'),
        ]);
        if (!mounted) {
          return;
        }
        if (subjectsRes.error) {
          setSubjects([]);
          return;
        }
        setSubjects(subjectsRes.data ?? []);
        setBranches(branchesRes.data ?? []);
      } catch (_err: unknown) {
        if (mounted) {
          setSubjects([]);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    loadSubjects();
    return () => {
      mounted = false;
    };
  }, []);

  // Delete Subject
  const handleDeleteSubject = async (subject: Subject) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete this subject? "${subject.name}" will be removed along with its requirements and allocations.`
    );
    if (!confirmed) {
      return;
    }
    try {
      const { error } = await apiClient.DELETE('/api/subjects/{subject_id}', {
        params: { path: { subject_id: subject.id } },
      });
      if (error) {
        showToast({
          type: 'error',
          title: 'Delete Failed',
          message: 'Could not delete the subject.',
        });
        return;
      }
      showToast({
        type: 'success',
        title: 'Subject Deleted',
        message: `${subject.name} was deleted.`,
      });
      const { data: refreshed } = await apiClient.GET('/api/subjects');
      setSubjects(refreshed ?? []);
    } catch (_err: unknown) {
      showToast({
        type: 'error',
        title: 'Delete Failed',
        message: 'Could not delete the subject.',
      });
    }
  };

  const branchName = (branchId: number | null | undefined): string => {
    if (branchId === null || branchId === undefined) {
      return '—';
    }
    const branch = branches.find((item) => item.id === branchId);
    return branch ? branch.name : `Branch #${branchId}`;
  };

  const onSubmit = async (data: SubjectFormData) => {
    setIsSubmitting(true);
    setApiError(null);
    const payload: SubjectCreate = {
      name: data.name,
      code: data.code,
      year: data.year,
      branch_id: data.branch_id === '' ? null : data.branch_id,
      subject_type: data.subject_type,
    };
    try {
      const { error } = await apiClient.POST('/api/subjects', {
        body: payload,
      });
      if (error) {
        const message = extractErrorMessage(error, 'Could not create subject.');
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
        title: 'Subject Created',
        message: `Subject ${data.name} created successfully.`,
      });
      setIsModalOpen(false);
      reset();
      // Reload so the new row appears in the table.
      const { data: refreshed } = await apiClient.GET('/api/subjects');
      setSubjects(refreshed ?? []);
    } catch (_err: unknown) {
      const message = 'Could not create subject.';
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

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <PageHeader
        title="Subjects"
        subtitle="Setup / Courses and Subject Codes"
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
            Add Subject
          </Button>
        }
      />

      {/* Main Content Viewport */}
      {isLoading ? (
        <div className="flex items-center justify-center p-16 bg-surface border border-slate-200 rounded">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <LoadingSpinner size="md" />
            <span>Loading subjects...</span>
          </div>
        </div>
      ) : subjects.length === 0 ? (
        <EmptyState
          title="No subjects yet"
          description="Subjects are the courses that timetabling schedules against (e.g., Data Structures, DBMS). Create your first subject to begin setup."
          actionLabel="Add Subject"
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
                d="M12 6.253v13m0-13C10.832 6.253 9.504 6 8 6c-2.5 0-5 1.5-5 4v2c0 2.5 2.5 4 5 4 1.504 0 2.832-.253 4-1V6.253zM19 10v6M22 13h-6"
              />
            </svg>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead>Year</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="w-10 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {subjects.map((subject) => (
              <TableRow key={subject.id}>
                <TableCell isCode>{subject.code}</TableCell>
                <TableCell isName>{subject.name}</TableCell>
                <TableCell>{branchName(subject.branch_id)}</TableCell>
                <TableCell>{subject.year ?? '—'}</TableCell>
                <TableCell>
                  <Badge
                    size="sm"
                    className={
                      subject.subject_type === 'LAB'
                        ? 'bg-purple-50 text-purple-700 border border-purple-200 font-semibold'
                        : 'bg-blue-50 text-blue-700 border border-blue-200 font-semibold'
                    }
                  >
                    {subject.subject_type}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <button
                    type="button"
                    onClick={() => handleDeleteSubject(subject)}
                    title={`Delete ${subject.name}`}
                    aria-label={`Delete ${subject.name}`}
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Add Subject Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSubmitting && setIsModalOpen(false)}
        title="Add Subject"
        subtitle="Define a new course that timetabling can schedule"
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
              Create Subject
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
                <p className="font-semibold">Could not create subject</p>
                <p className="mt-0.5">{apiError}</p>
              </div>
            </div>
          )}

          {/* Form fields - SubjectCreate schema: name, code, year, branch_id */}
          <div>
            <Input
              label="Subject Name"
              placeholder="e.g. Data Structures"
              required
              error={errors.name?.message}
              {...register('name', { required: 'Subject name is required' })}
            />
          </div>

          <div>
            <Input
              label="Subject Code"
              placeholder="e.g. CS201"
              required
              error={errors.code?.message}
              {...register('code', { required: 'Subject code is required' })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Select
                label="Branch"
                error={errors.branch_id?.message}
                {...register('branch_id', {
                  setValueAs: (value: string) => (value === '' ? '' : Number(value)),
                })}
              >
                <option value="">-- Select a branch --</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Select
                label="Year"
                required
                error={errors.year?.message}
                {...register('year', { required: 'Year is required' })}
              >
                {YEARS.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Select
              label="Subject Type"
              required
              error={errors.subject_type?.message}
              {...register('subject_type', { required: 'Subject type is required' })}
            >
              {SUBJECT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type === 'LAB' ? 'LAB (2-period practical)' : 'THEORY (lecture)'}
                </option>
              ))}
            </Select>
          </div>
        </form>
      </Modal>
    </div>
  );
};
