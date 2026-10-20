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
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/useToast';
import { apiClient } from '../api/client';
import type { components } from '../api/schema';

type Teacher = components['schemas']['TeacherRead'];
type RegisterRequest = components['schemas']['RegisterRequest'];
type TeacherStatus = components['schemas']['TeacherStatus'];

interface TeacherFormData {
  name: string;
  email: string;
  password: string;
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

/** PENDING/REJECTED accounts cannot be scheduled; ACTIVE ones can. */
const statusVariant = (
  status: TeacherStatus
): 'status-active' | 'outline' | 'status-inactive' => {
  if (status === 'ACTIVE') return 'status-active';
  if (status === 'REJECTED') return 'status-inactive';
  return 'outline';
};

export const TeachersPage: React.FC = () => {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
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
  } = useForm<TeacherFormData>({
    defaultValues: {
      name: '',
      email: '',
      password: '',
    },
  });

  useEffect(() => {
    let mounted = true;
    const loadTeachers = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await apiClient.GET('/api/teachers');
        if (!mounted) {
          return;
        }
        if (error) {
          setTeachers([]);
          return;
        }
        setTeachers(data ?? []);
      } catch (_err: unknown) {
        if (mounted) {
          setTeachers([]);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    loadTeachers();
    return () => {
      mounted = false;
    };
  }, []);

  const onSubmit = async (data: TeacherFormData) => {
    setIsSubmitting(true);
    setApiError(null);
    // There is no POST /api/teachers — accounts are created through the
    // registration endpoint and land in PENDING until an admin approves.
    const payload: RegisterRequest = {
      name: data.name,
      email: data.email,
      password: data.password,
    };
    try {
      const { error } = await apiClient.POST('/api/auth/register', {
        body: payload,
      });
      if (error) {
        const message = extractErrorMessage(error, 'Could not create teacher.');
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
        title: 'Teacher Registered',
        message: `Account for ${data.name} created. It stays pending until an admin approves it.`,
      });
      setIsModalOpen(false);
      reset();
      // Reload so the new row appears in the table.
      const { data: refreshed } = await apiClient.GET('/api/teachers');
      setTeachers(refreshed ?? []);
    } catch (_err: unknown) {
      const message = 'Could not create teacher.';
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
        title="Teachers"
        subtitle="Setup / Faculty Roster"
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
            Add Teacher
          </Button>
        }
      />

      {/* Main Content Viewport */}
      {isLoading ? (
        <div className="flex items-center justify-center p-16 bg-surface border border-slate-200 rounded">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <LoadingSpinner size="md" />
            <span>Loading teachers...</span>
          </div>
        </div>
      ) : teachers.length === 0 ? (
        <EmptyState
          title="No teachers yet"
          description="Faculty accounts are created here and approved by an administrator before they can be scheduled. Create your first teacher to begin setup."
          actionLabel="Add Teacher"
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
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Type</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teachers.map((teacher) => (
              <TableRow key={teacher.id}>
                <TableCell>{teacher.name}</TableCell>
                <TableCell>{teacher.email}</TableCell>
                <TableCell>
                  <Badge variant="role" size="sm">
                    {teacher.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(teacher.status)} size="sm">
                    {teacher.status}
                  </Badge>
                </TableCell>
                <TableCell>{teacher.employment_type}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Add Teacher Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSubmitting && setIsModalOpen(false)}
        title="Add Teacher"
        subtitle="Create a faculty account; an administrator approves it before it can be scheduled"
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
              Create Teacher
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
                <p className="font-semibold">Could not create teacher</p>
                <p className="mt-0.5">{apiError}</p>
              </div>
            </div>
          )}

          {/* Form fields - RegisterRequest schema: name, email, password */}
          <div>
            <Input
              label="Teacher Name"
              placeholder="e.g. Dr. A. Sharma"
              required
              error={errors.name?.message}
              {...register('name', { required: 'Teacher name is required' })}
            />
          </div>

          <div>
            <Input
              label="Email"
              type="email"
              placeholder="name@college.edu"
              autoComplete="off"
              required
              error={errors.email?.message}
              {...register('email', {
                required: 'Email is required',
                pattern: {
                  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  message: 'Enter a valid email address',
                },
              })}
            />
          </div>

          <div>
            <Input
              label="Temporary Password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              required
              error={errors.password?.message}
              {...register('password', {
                required: 'Password is required',
                minLength: { value: 8, message: 'Use at least 8 characters' },
              })}
            />
          </div>
        </form>
      </Modal>
    </div>
  );
};
