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
type Branch = components['schemas']['BranchRead'];
type Subject = components['schemas']['SubjectRead'];
type RoomType = components['schemas']['RoomType'];

const ROOM_TYPES: RoomType[] = ['LECTURE', 'LAB'];

const YEARS = ['FE', 'SE', 'TE', 'BE'] as const;

interface RoomFormData {
  name: string;
  room_type: RoomType;
  branch_id: number | '';
  year: string;
  /**
   * Ids of the subjects this room can host; only used for LAB rooms.
   * Driven by a controlled checkbox group, so the values are real numbers.
   */
  subject_ids: number[];
}

/**
 * The fields that are controlled by component state rather than by the form:
 * the room type, the branch, the year and the selected lab subjects.
 */
type RoomFormValues = Pick<RoomFormData, 'name'>;

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
  const [branches, setBranches] = useState<Branch[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Branch / year are controlled inputs: they drive the lab-subject filter
  // and are read straight from the DOM value (a number), so they are kept
  // in component state rather than read back through `watch`.
  const [branchId, setBranchId] = useState<number | ''>('');
  const [year, setYear] = useState<string>('SE');
  const [roomType, setRoomType] = useState<RoomType>('LECTURE');
  const [subjectIds, setSubjectIds] = useState<number[]>([]);

  const { showToast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RoomFormValues>({
    defaultValues: {
      name: '',
    },
  });

  // Switching the room type away from LAB invalidates any linked subjects,
  // so clear the stale selection.
  useEffect(() => {
    if (roomType !== 'LAB' && subjectIds.length > 0) {
      setSubjectIds([]);
    }
  }, [roomType, subjectIds]);

  // Only LAB rooms are linked to subjects, and only to LAB subjects that
  // belong to the same branch and academic year.
  const labSubjects = subjects.filter(
    (subject) =>
      subject.subject_type === 'LAB' &&
      (branchId === '' || subject.branch_id === branchId) &&
      (year === '' || subject.year === year)
  );

  /** Add or remove a subject id from the controlled checkbox group. */
  const toggleSubject = (subjectId: number, checked: boolean) => {
    setSubjectIds((current) =>
      checked
        ? current.includes(subjectId)
          ? current
          : [...current, subjectId]
        : current.filter((id) => id !== subjectId)
    );
  };

  useEffect(() => {
    let mounted = true;
    const loadRooms = async () => {
      setIsLoading(true);
      try {
        const [roomsRes, branchesRes, subjectsRes] = await Promise.all([
          apiClient.GET('/api/rooms'),
          apiClient.GET('/api/branches'),
          apiClient.GET('/api/subjects'),
        ]);
        if (!mounted) {
          return;
        }
        setRooms(roomsRes.data ?? []);
        setBranches(branchesRes.data ?? []);
        setSubjects(subjectsRes.data ?? []);
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

  // Delete Room
  const handleDeleteRoom = async (room: Room) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete this room? "${room.name}" will be removed along with any scheduled slots.`
    );
    if (!confirmed) {
      return;
    }
    try {
      const { error } = await apiClient.DELETE('/api/rooms/{room_id}', {
        params: { path: { room_id: room.id } },
      });
      if (error) {
        showToast({
          type: 'error',
          title: 'Delete Failed',
          message: 'Could not delete the room.',
        });
        return;
      }
      showToast({
        type: 'success',
        title: 'Room Deleted',
        message: `${room.name} was deleted.`,
      });
      const { data: refreshed } = await apiClient.GET('/api/rooms');
      setRooms(refreshed ?? []);
    } catch (_err: unknown) {
      showToast({
        type: 'error',
        title: 'Delete Failed',
        message: 'Could not delete the room.',
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

  /** Room -> the subjects it can host, rendered as pills. */
  const linkedSubjects = (room: Room) => {
    if (!room.subjects || room.subjects.length === 0) {
      return <span className="text-slate-300">—</span>;
    }
    return (
      <div className="flex flex-wrap gap-1">
        {room.subjects.map((subject) => (
          <Badge
            key={subject.id}
            size="sm"
            className="bg-purple-50 text-purple-700 border border-purple-200 font-medium"
          >
            {subject.name}
          </Badge>
        ))}
      </div>
    );
  };

  const onSubmit = async (data: RoomFormValues) => {
    setIsSubmitting(true);
    setApiError(null);
    if (branchId === '') {
      const message = 'Branch is required.';
      setApiError(message);
      setIsSubmitting(false);
      return;
    }
    if (roomType === 'LAB' && subjectIds.length === 0) {
      const message = 'Select the subject this lab is for.';
      setApiError(message);
      setIsSubmitting(false);
      return;
    }
    const payload: RoomCreate = {
      name: data.name,
      room_type: roomType,
      branch_id: branchId,
      year,
      // Only lab rooms are linked to subjects; lecture rooms never are.
      subject_ids: roomType === 'LAB' ? subjectIds : [],
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
      setBranchId('');
      setYear('SE');
      setRoomType('LECTURE');
      setSubjectIds([]);
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

  /** Close the modal and clear every controlled field for the next open. */
  const handleCloseModal = () => {
    if (isSubmitting) {
      return;
    }
    setIsModalOpen(false);
    setBranchId('');
    setYear('SE');
    setRoomType('LECTURE');
    setSubjectIds([]);
    reset();
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
              <TableHead>Branch</TableHead>
              <TableHead>Year</TableHead>
              <TableHead>Linked Subject</TableHead>
              <TableHead className="w-10 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rooms.map((room) => (
              <TableRow key={room.id}>
                <TableCell isName>{room.name}</TableCell>
                <TableCell>
                  <Badge variant="solid" size="sm">
                    {room.room_type}
                  </Badge>
                </TableCell>
                <TableCell>{branchName(room.branch_id)}</TableCell>
                <TableCell>{room.year ?? '—'}</TableCell>
                <TableCell>{linkedSubjects(room)}</TableCell>
                <TableCell className="text-right">
                  <button
                    type="button"
                    onClick={() => handleDeleteRoom(room)}
                    title={`Delete ${room.name}`}
                    aria-label={`Delete ${room.name}`}
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

      {/* Add Room Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title="Add Room"
        subtitle="Define a classroom or laboratory available to timetabling"
        maxWidth="md"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCloseModal}
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

          {/* Form fields - RoomCreate schema: name, room_type, branch_id, year */}
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
                value={roomType}
                onChange={(event) => setRoomType(event.target.value as RoomType)}
              >
                {ROOM_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type === 'LAB' ? 'LAB (laboratory)' : 'LECTURE (classroom)'}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Select
                label="Branch"
                required
                value={branchId}
                onChange={(event) =>
                  setBranchId(event.target.value === '' ? '' : Number(event.target.value))
                }
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
                value={year}
                onChange={(event) => setYear(event.target.value)}
              >
                {YEARS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* Only lab rooms are tied to subjects, and only to LAB subjects
              in the same branch and academic year. A room can host several. */}
          {roomType === 'LAB' && (
            <div>
              <p className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                Linked Lab Subjects
                <span className="text-danger ml-0.5">*</span>
              </p>
              {labSubjects.length === 0 ? (
                <p className="text-[11px] text-slate-500">
                  No LAB subjects for this branch and year. Create one on the Subjects page first.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto border border-slate-200 rounded p-2">
                  {labSubjects.map((subject) => (
                    <label
                      key={subject.id}
                      className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={subjectIds.includes(subject.id)}
                        onChange={(event) => toggleSubject(subject.id, event.target.checked)}
                        className="w-3.5 h-3.5 rounded border-slate-300 text-accent focus:ring-accent"
                      />
                      <span className="font-mono text-[11px] text-slate-500">{subject.code}</span>
                      <span className="truncate">{subject.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </form>
      </Modal>
    </div>
  );
};
