import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { PageHeader } from '../components/ui/PageHeader';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { useToast } from '../components/ui/useToast';
import { apiClient, DivisionDTO, BackendNotConnectedError } from '../api/client';

// TODO: confirm fields against openapi.json
interface DivisionFormData {
  name: string;
  department: string;
  year: string;
  semester: number;
}

export const DivisionsPage: React.FC = () => {
  const [divisions, setDivisions] = useState<DivisionDTO[]>([]);
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
  } = useForm<DivisionFormData>({
    defaultValues: {
      name: '',
      department: 'IT',
      year: 'SE',
      semester: 3,
    },
  });

  useEffect(() => {
    let mounted = true;
    const loadDivisions = async () => {
      setIsLoading(true);
      try {
        const data = await apiClient.divisions.list();
        if (mounted) {
          setDivisions(data);
        }
      } catch (_err: unknown) {
        if (mounted) {
          // In disconnected mode, list starts empty with proper EmptyState
          setDivisions([]);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    loadDivisions();
    return () => {
      mounted = false;
    };
  }, []);

  const onSubmit = async (data: DivisionFormData) => {
    setIsSubmitting(true);
    setApiError(null);
    try {
      await apiClient.divisions.create(data);
      showToast({
        type: 'success',
        title: 'Division Created',
        message: `Division ${data.name} created successfully.`,
      });
      setIsModalOpen(false);
      reset();
    } catch (err: unknown) {
      const message =
        err instanceof BackendNotConnectedError || err instanceof Error
          ? err.message
          : 'Backend not connected yet. Awaiting OpenAPI spec connection.';
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
        title="Divisions"
        subtitle="Setup / Academic Divisions Management"
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
            Add Division
          </Button>
        }
      />

      {/* Main Content Viewport */}
      {isLoading ? (
        <div className="flex items-center justify-center p-16 bg-surface border border-slate-200 rounded">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <LoadingSpinner size="md" />
            <span>Loading divisions...</span>
          </div>
        </div>
      ) : divisions.length === 0 ? (
        <EmptyState
          title="No divisions yet"
          description="Academic divisions partition classes for timetabling (e.g., 2nd Year IT - Division A). Create your first division to begin setup."
          actionLabel="Add Division"
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
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
          }
        />
      ) : null}

      {/* Add Division Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSubmitting && setIsModalOpen(false)}
        title="Add Academic Division"
        subtitle="Define a new academic division scoped to a department and term"
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
            <div className="p-3 bg-danger-subtle border border-danger-border rounded text-xs text-danger flex items-start gap-2">
              <svg className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <p className="font-semibold">Backend Connection Notice</p>
                <p className="mt-0.5">{apiError}</p>
              </div>
            </div>
          )}

          {/* Form fields - TODO: confirm fields against openapi.json */}
          <div>
            <Input
              label="Division Name"
              placeholder="e.g. Division A"
              required
              error={errors.name?.message}
              {...register('name', { required: 'Division name is required' })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Input
                label="Department"
                placeholder="e.g. IT"
                required
                error={errors.department?.message}
                {...register('department', { required: 'Department is required' })}
              />
            </div>
            <div>
              <Input
                label="Academic Year"
                placeholder="e.g. SE, TE, BE"
                required
                error={errors.year?.message}
                {...register('year', { required: 'Academic year is required' })}
              />
            </div>
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
        </form>
      </Modal>
    </div>
  );
};
