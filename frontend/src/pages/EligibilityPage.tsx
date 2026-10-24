import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
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

type Eligibility = components['schemas']['EligibilityRead'];
type EligibilityCreate = components['schemas']['EligibilityCreate'];
type Teacher = components['schemas']['TeacherRead'];
type Subject = components['schemas']['SubjectRead'];
type Division = components['schemas']['DivisionRead'];

interface EligibilityFormData {
  teacher_id: number | '';
  subject_id: number | '';
  division_id: number | '';
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

export const EligibilityPage: React.FC = () => {
  const [eligibilities, setEligibilities] = useState<Eligibility[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
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
  } = useForm<EligibilityFormData>({
    defaultValues: {
      teacher_id: '',
      subject_id: '',
      division_id: '',
    },
  });

  useEffect(() => {
    let mounted = true;
    const loadData = async () => {
      setIsLoading(true);
      try {
        const [eligRes, teachersRes, subjectsRes, divisionsRes] = await Promise.all([
          apiClient.GET('/api/eligibility'),
          apiClient.GET('/api/teachers'),
          apiClient.GET('/api/subjects'),
          apiClient.GET('/api/divisions'),
        ]);
        if (!mounted) {
          return;
        }
        setEligibilities(eligRes.data ?? []);
        setTeachers(teachersRes.data ?? []);
        setSubjects(subjectsRes.data ?? []);
        setDivisions(divisionsRes.data ?? []);
      } catch (_err: unknown) {
        if (mounted) {
          setEligibilities([]);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    loadData();
    return () => {
      mounted = false;
    };
  }, []);

  const teacherName = (id: number): string => {
    const teacher = teachers.find((item) => item.id === id);
    return teacher ? teacher.name : `Teacher #${id}`;
  };

  const subjectLabel = (id: number): string => {
    const subject = subjects.find((item) => item.id === id);
    return subject ? `${subject.code} — ${subject.name}` : `Subject #${id}`;
  };

  const divisionName = (id: number): string => {
    const division = divisions.find((item) => item.id === id);
    return division ? division.name : `Division #${id}`;
  };

  const onSubmit = async (data: EligibilityFormData) => {
    setIsSubmitting(true);
    setApiError(null);

    if (data.teacher_id === '' || data.subject_id === '' || data.division_id === '') {
      const message = 'Teacher, subject and division are all required.';
      setApiError(message);
      setIsSubmitting(false);
      return;
    }

    const payload: EligibilityCreate = {
      teacher_id: data.teacher_id,
      subject_id: data.subject_id,
      division_id: data.division_id,
    };
    try {
      const { error } = await apiClient.POST('/api/eligibility', {
        body: payload,
      });
      if (error) {
        const message = extractErrorMessage(error, 'Could not create mapping.');
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
        title: 'Mapping Created',
        message: `${teacherName(data.teacher_id)} is now mapped to ${subjectLabel(
          data.subject_id
        )}.`,
      });
      setIsModalOpen(false);
      reset();
      // Reload so the new row appears in the table.
      const { data: refreshed } = await apiClient.GET('/api/eligibility');
      setEligibilities(refreshed ?? []);
    } catch (_err: unknown) {
      const message = 'Could not create mapping.';
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

  const handleDelete = async (eligibility: Eligibility) => {
    const confirmed = window.confirm(
      'Are you sure? This will remove the mapping. This cannot be undone.'
    );
    if (!confirmed) {
      return;
    }
    try {
      const { error } = await apiClient.DELETE('/api/eligibility/{eligibility_id}', {
        params: { path: { eligibility_id: eligibility.id } },
      });
      if (error) {
        const message = extractErrorMessage(error, 'Could not remove mapping.');
        showToast({
          type: 'error',
          title: 'Delete Failed',
          message,
        });
        return;
      }
      showToast({
        type: 'success',
        title: 'Mapping Removed',
        message: 'The teacher-subject-division mapping was deleted.',
      });
      const { data: refreshed } = await apiClient.GET('/api/eligibility');
      setEligibilities(refreshed ?? []);
    } catch (_err: unknown) {
      showToast({
        type: 'error',
        title: 'Delete Failed',
        message: 'Could not remove mapping.',
      });
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
        title="Teacher Class Subject"
        subtitle="Setup / Teacher ↔ Subject ↔ Division mapping"
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
            Add Mapping
          </Button>
        }
      />

      {/* Main Content Viewport */}
      {isLoading ? (
        <div className="flex items-center justify-center p-16 bg-surface border border-slate-200 rounded">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <LoadingSpinner size="md" />
            <span>Loading mappings...</span>
          </div>
        </div>
      ) : eligibilities.length === 0 ? (
        <EmptyState
          title="No mappings yet"
          description="Map teachers to the subjects and divisions they teach. The solver uses these mappings when it schedules periods."
          actionLabel="Add Mapping"
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
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Teacher</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Division</TableHead>
              <TableHead className="w-10 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {eligibilities.map((eligibility) => (
              <TableRow key={eligibility.id}>
                <TableCell isName>{teacherName(eligibility.teacher_id)}</TableCell>
                <TableCell>{subjectLabel(eligibility.subject_id)}</TableCell>
                <TableCell>
                  <Badge variant="solid" size="sm">
                    {divisionName(eligibility.division_id)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <button
                    type="button"
                    onClick={() => handleDelete(eligibility)}
                    title="Delete mapping"
                    aria-label="Delete mapping"
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

      {/* Add Mapping Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSubmitting && setIsModalOpen(false)}
        title="Add Teacher Mapping"
        subtitle="Map a teacher to a subject and a division"
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
              Create Mapping
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
                <p className="font-semibold">Could not create mapping</p>
                <p className="mt-0.5">{apiError}</p>
              </div>
            </div>
          )}

          {/* Form fields - EligibilityCreate schema: teacher_id, subject_id, division_id */}
          <div>
            <Select
              label="Teacher"
              required
              error={errors.teacher_id?.message}
              {...register('teacher_id', {
                required: 'Teacher is required',
                setValueAs: (value: string) => (value === '' ? '' : Number(value)),
              })}
            >
              <option value="">-- Select a teacher --</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name} ({teacher.status})
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Select
              label="Subject"
              required
              error={errors.subject_id?.message}
              {...register('subject_id', {
                required: 'Subject is required',
                setValueAs: (value: string) => (value === '' ? '' : Number(value)),
              })}
            >
              <option value="">-- Select a subject --</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.code} — {subject.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Select
              label="Division"
              required
              error={errors.division_id?.message}
              {...register('division_id', {
                required: 'Division is required',
                setValueAs: (value: string) => (value === '' ? '' : Number(value)),
              })}
            >
              <option value="">-- Select a division --</option>
              {divisions.map((division) => (
                <option key={division.id} value={division.id}>
                  {division.name} · Year {division.year} · Sem {division.semester}
                  {division.semester}
                </option>
              ))}
            </Select>
          </div>
        </form>
      </Modal>
    </div>
  );
};
