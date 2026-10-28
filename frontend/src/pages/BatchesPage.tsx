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
import { useToast } from '../components/ui/useToast';
import { apiClient } from '../api/client';
import type { components } from '../api/schema';

type Batch = components['schemas']['BatchRead'];
type BatchCreate = components['schemas']['BatchCreate'];
type Division = components['schemas']['DivisionRead'];

interface BatchFormData {
  name: string;
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

export const BatchesPage: React.FC = () => {
  const [batches, setBatches] = useState<Batch[]>([]);
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
  } = useForm<BatchFormData>({
    defaultValues: {
      name: '',
      division_id: '',
    },
  });

  useEffect(() => {
    let mounted = true;
    const loadBatches = async () => {
      setIsLoading(true);
      try {
        const [batchesRes, divisionsRes] = await Promise.all([
          apiClient.GET('/api/batches'),
          apiClient.GET('/api/divisions'),
        ]);
        if (!mounted) {
          return;
        }
        setBatches(batchesRes.data ?? []);
        setDivisions(divisionsRes.data ?? []);
      } catch (_err: unknown) {
        if (mounted) {
          setBatches([]);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    loadBatches();
    return () => {
      mounted = false;
    };
  }, []);

  const divisionName = (divisionId: number): string => {
    const division = divisions.find((item) => item.id === divisionId);
    return division ? division.name : `Division #${divisionId}`;
  };

  const onSubmit = async (data: BatchFormData) => {
    setIsSubmitting(true);
    setApiError(null);
    if (data.division_id === '') {
      const message = 'Division is required.';
      setApiError(message);
      setIsSubmitting(false);
      return;
    }
    const payload: BatchCreate = {
      name: data.name,
      division_id: data.division_id,
    };
    try {
      const { error } = await apiClient.POST('/api/batches', {
        body: payload,
      });
      if (error) {
        const message = extractErrorMessage(error, 'Could not create batch.');
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
        title: 'Batch Created',
        message: `Batch ${data.name} created successfully.`,
      });
      setIsModalOpen(false);
      reset();
      // Reload so the new row appears in the table.
      const { data: refreshed } = await apiClient.GET('/api/batches');
      setBatches(refreshed ?? []);
    } catch (_err: unknown) {
      const message = 'Could not create batch.';
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
        title="Batches"
        subtitle="Setup / Lab Practical Batches"
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
            Add Batch
          </Button>
        }
      />

      {/* Main Content Viewport */}
      {isLoading ? (
        <div className="flex items-center justify-center p-16 bg-surface border border-slate-200 rounded">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <LoadingSpinner size="md" />
            <span>Loading batches...</span>
          </div>
        </div>
      ) : batches.length === 0 ? (
        <EmptyState
          title="No batches yet"
          description="Batches split a division into smaller lab practical groups. Create your first batch to begin setup."
          actionLabel="Add Batch"
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
              <TableHead>Name</TableHead>
              <TableHead>Division</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.map((batch) => (
              <TableRow key={batch.id}>
                <TableCell isName>{batch.name}</TableCell>
                <TableCell>{divisionName(batch.division_id)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Add Batch Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSubmitting && setIsModalOpen(false)}
        title="Add Batch"
        subtitle="Define a lab practical batch scoped to a division"
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
              Create Batch
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
                <p className="font-semibold">Could not create batch</p>
                <p className="mt-0.5">{apiError}</p>
              </div>
            </div>
          )}

          {/* Form fields - BatchCreate schema: name, division_id */}
          <div>
            <Input
              label="Batch Name"
              placeholder="e.g. A1"
              required
              error={errors.name?.message}
              {...register('name', { required: 'Batch name is required' })}
            />
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
                  {division.name}
                </option>
              ))}
            </Select>
          </div>
        </form>
      </Modal>
    </div>
  );
};
