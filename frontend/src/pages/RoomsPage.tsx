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

type Room = components['schemas']['RoomRead'];
type RoomCreate = components['schemas']['RoomCreate'];
type Division = components['schemas']['DivisionRead'];
type RoomType = components['schemas']['RoomType'];

const ROOM_TYPES: RoomType[] = ['LECTURE', 'LAB'];

interface RoomFormData {
  name: string;
  room_type: RoomType;
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

export const RoomsPage: React.FC = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
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
  } = useForm<RoomFormData>({
    defaultValues: {
      name: '',
      room_type: 'LECTURE',
      division_id: '',
    },
  });

  useEffect(() => {
    let mounted = true;
    const loadRooms = async () => {
      setIsLoading(true);
      try {
        const [roomsRes, divisionsRes] = await Promise.all([
          apiClient.GET('/api/rooms'),
          apiClient.GET('/api/divisions'),
        ]);
        if (!mounted) {
          return;
        }
        setRooms(roomsRes.data ?? []);
        setDivisions(divisionsRes.data ?? []);
      } catch (_err: unknown) {
        if (mounted) {
          setRooms([]);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    loadRooms();
    return () => {
      mounted = false;
    };
  }, []);

  const divisionName = (divisionId: number): string => {
    const division = divisions.find((item) => item.id === divisionId);
    return division ? division.name : `Division #${divisionId}`;
  };

  const onSubmit = async (data: RoomFormData) => {
    setIsSubmitting(true);
    setApiError(null);
    if (data.division_id === '') {
      const message = 'Division is required.';
      setApiError(message);
      setIsSubmitting(false);
      return;
    }
    const payload: RoomCreate = {
      name: data.name,
      room_type: data.room_type,
      division_id: data.division_id,
    };
    try {
      const { error } = await apiClient.POST('/api/rooms', {
        body: payload,
      });
      if (error) {
        const message = extractErrorMessage(error, 'Could not create room.');
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
        title: 'Room Created',
        message: `Room ${data.name} created successfully.`,
      });
      setIsModalOpen(false);
      reset();
      // Reload so the new row appears in the table.
      const { data: refreshed } = await apiClient.GET('/api/rooms');
      setRooms(refreshed ?? []);
    } catch (_err: unknown) {
      const message = 'Could not create room.';
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
        title="Rooms"
        subtitle="Setup / Classrooms and Laboratories"
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
            Add Room
          </Button>
        }
      />

      {/* Main Content Viewport */}
      {isLoading ? (
        <div className="flex items-center justify-center p-16 bg-surface border border-slate-200 rounded">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <LoadingSpinner size="md" />
            <span>Loading rooms...</span>
          </div>
        </div>
      ) : rooms.length === 0 ? (
        <EmptyState
          title="No rooms yet"
          description="Rooms are the physical spaces timetabling assigns to classes — lecture halls and laboratories. Create your first room to begin setup."
          actionLabel="Add Room"
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
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m0 0h2m-2 0h10m0 0h2m-2 0V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m6-8h3m-3 4h3"
              />
            </svg>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Division</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rooms.map((room) => (
              <TableRow key={room.id}>
                <TableCell>{room.name}</TableCell>
                <TableCell>
                  <Badge variant="solid" size="sm">
                    {room.room_type}
                  </Badge>
                </TableCell>
                <TableCell>{divisionName(room.division_id)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Add Room Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSubmitting && setIsModalOpen(false)}
        title="Add Room"
        subtitle="Define a classroom or laboratory available to timetabling"
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
              Create Room
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
                <p className="font-semibold">Could not create room</p>
                <p className="mt-0.5">{apiError}</p>
              </div>
            </div>
          )}

          {/* Form fields - RoomCreate schema: name, room_type, division_id */}
          <div>
            <Input
              label="Room Name"
              placeholder="e.g. LT-1"
              required
              error={errors.name?.message}
              {...register('name', { required: 'Room name is required' })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Select
                label="Room Type"
                required
                error={errors.room_type?.message}
                {...register('room_type', { required: 'Room type is required' })}
              >
                {ROOM_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
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
                    {division.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
};
