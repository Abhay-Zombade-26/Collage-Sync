import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/useToast';
import { apiClient } from '../api/client';
import type { components } from '../api/schema';

type Room = components['schemas']['RoomRead'];
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
  subject_ids: number[];
}

const DEFAULT_FORM_DATA: RoomFormData = {
  name: '',
  room_type: 'LECTURE',
  branch_id: '',
  year: 'SE',
  subject_ids: [],
};

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
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | RoomType>('ALL');
  const [yearFilter, setYearFilter] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'name' | 'year'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Add/Edit Modal
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [formData, setFormData] = useState<RoomFormData>(DEFAULT_FORM_DATA);
  const [initialFormData, setInitialFormData] = useState<RoomFormData>(DEFAULT_FORM_DATA);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [subjectSearch, setSubjectSearch] = useState<string>('');

  // Discard Confirmation Dialog
  const [isDiscardDialogOpen, setIsDiscardDialogOpen] = useState<boolean>(false);

  // Delete State & Confirmation
  const [roomToDelete, setRoomToDelete] = useState<Room | null>(null);
  const [deleteUsageCount, setDeleteUsageCount] = useState<number | null>(null);
  const [isCheckingUsage, setIsCheckingUsage] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const { showToast } = useToast();
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Fetch initial data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const [roomsRes, branchesRes, subjectsRes] = await Promise.all([
        apiClient.GET('/api/rooms'),
        apiClient.GET('/api/branches'),
        apiClient.GET('/api/subjects'),
      ]);
      setRooms(roomsRes.data ?? []);
      setBranches(branchesRes.data ?? []);
      setSubjects(subjectsRes.data ?? []);
    } catch (err: unknown) {
      setFetchError(extractErrorMessage(err, 'Failed to load rooms. Please check your connection.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Autofocus first field when modal opens
  useEffect(() => {
    if (isModalOpen) {
      const timer = setTimeout(() => {
        nameInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isModalOpen]);

  // Calculate dirty state
  const isDirty = useMemo(() => {
    if (formData.name.trim() !== initialFormData.name.trim()) return true;
    if (formData.room_type !== initialFormData.room_type) return true;
    if (formData.branch_id !== initialFormData.branch_id) return true;
    if (formData.year !== initialFormData.year) return true;
    if (formData.room_type === 'LAB') {
      const setA = new Set(formData.subject_ids);
      const setB = new Set(initialFormData.subject_ids);
      if (setA.size !== setB.size) return true;
      for (const id of setA) {
        if (!setB.has(id)) return true;
      }
    }
    return false;
  }, [formData, initialFormData]);

  // Client validation
  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    const trimmedName = formData.name.trim();

    if (!trimmedName) {
      errors.name = 'Room name is required';
    } else if (trimmedName.length > 50) {
      errors.name = 'Room name must be at most 50 characters';
    }

    if (!formData.branch_id) {
      errors.branch_id = 'Branch is required';
    }

    if (!formData.year) {
      errors.year = 'Year is required';
    }

    if (formData.room_type === 'LAB' && formData.subject_ids.length === 0) {
      errors.subject_ids = 'At least one lab subject must be mapped for a LAB room';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Duplicate name check
  const checkDuplicateName = (name: string, branchId: number | '', year: string) => {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) {
      setDuplicateWarning(null);
      return;
    }

    const exists = rooms.some((r) => {
      if (selectedRoom && r.id === selectedRoom.id) return false;
      const sameName = r.name.trim().toLowerCase() === trimmed;
      const sameBranch = branchId === '' ? r.branch_id === null : r.branch_id === branchId;
      const sameYear = (r.year ?? '') === year;
      return sameName && sameBranch && sameYear;
    });

    if (exists) {
      setDuplicateWarning('A room with this name already exists in this branch and year.');
    } else {
      setDuplicateWarning(null);
    }
  };

  // Branch name lookup helper
  const getBranchName = (bId: number | null | undefined): string => {
    if (bId === null || bId === undefined) return '—';
    const b = branches.find((item) => item.id === bId);
    return b ? b.name : `Branch #${bId}`;
  };

  // Filtered lab subjects for Add/Edit
  const availableLabSubjects = useMemo(() => {
    return subjects.filter(
      (s) =>
        s.subject_type === 'LAB' &&
        (formData.branch_id === '' || s.branch_id === formData.branch_id) &&
        (formData.year === '' || s.year === formData.year)
    );
  }, [subjects, formData.branch_id, formData.year]);

  // Search-filtered lab subjects in modal
  const displayedLabSubjects = useMemo(() => {
    if (!subjectSearch.trim()) return availableLabSubjects;
    const q = subjectSearch.toLowerCase();
    return availableLabSubjects.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
    );
  }, [availableLabSubjects, subjectSearch]);

  const toggleSubject = (subjectId: number) => {
    setFormData((prev) => {
      const exists = prev.subject_ids.includes(subjectId);
      const nextIds = exists
        ? prev.subject_ids.filter((id) => id !== subjectId)
        : [...prev.subject_ids, subjectId];

      if (fieldErrors.subject_ids && nextIds.length > 0) {
        setFieldErrors((errs) => {
          const { subject_ids: _, ...rest } = errs;
          return rest;
        });
      }
      return { ...prev, subject_ids: nextIds };
    });
  };

  // Open Create Modal
  const handleOpenCreateModal = () => {
    setIsEditing(false);
    setSelectedRoom(null);
    setApiError(null);
    setFieldErrors({});
    setDuplicateWarning(null);
    setSubjectSearch('');
    const initial: RoomFormData = {
      name: '',
      room_type: 'LECTURE',
      branch_id: branches.length > 0 ? branches[0].id : '',
      year: 'SE',
      subject_ids: [],
    };
    setFormData(initial);
    setInitialFormData(initial);
    setIsModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (room: Room) => {
    setIsEditing(true);
    setSelectedRoom(room);
    setApiError(null);
    setFieldErrors({});
    setDuplicateWarning(null);
    setSubjectSearch('');

    const roomYear = room.year ?? 'SE';
    const roomBranch = room.branch_id ?? '';

    // Mark ONLY the subjects that are mapped to this room for this room's year and branch
    const mappedSubjectIds = (room.subjects ?? [])
      .filter((s) => (!roomYear || s.year === roomYear) && (roomBranch === '' || s.branch_id === roomBranch))
      .map((s) => s.id);

    const initial: RoomFormData = {
      name: room.name,
      room_type: room.room_type,
      branch_id: roomBranch,
      year: roomYear,
      subject_ids: mappedSubjectIds,
    };
    setFormData(initial);
    setInitialFormData(initial);
    setIsModalOpen(true);
  };

  // Handle Modal Close Attempt (with dirty warning)
  const handleRequestClose = () => {
    if (isSubmitting) return;
    if (isDirty) {
      setIsDiscardDialogOpen(true);
    } else {
      setIsModalOpen(false);
    }
  };

  const handleConfirmDiscard = () => {
    setIsDiscardDialogOpen(false);
    setIsModalOpen(false);
  };

  // Reset form to initial in edit mode
  const handleResetForm = () => {
    setFormData(initialFormData);
    setFieldErrors({});
    setDuplicateWarning(null);
    setApiError(null);
  };

  // Submit Handler
  const handleSubmit = async (addAnother: boolean = false) => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    setApiError(null);

    const trimmedName = formData.name.trim();

    if (isEditing && selectedRoom) {
      try {
        const { error, data } = await apiClient.PATCH('/api/rooms/{room_id}', {
          params: { path: { room_id: selectedRoom.id } },
          body: {
            name: trimmedName,
            room_type: formData.room_type,
            branch_id: formData.branch_id === '' ? null : formData.branch_id,
            year: formData.year,
            subject_ids: formData.room_type === 'LAB' ? formData.subject_ids : [],
          },
        });

        if (error) {
          const msg = extractErrorMessage(error, 'Could not update room.');
          setApiError(msg);
          showToast({ type: 'error', title: 'Update Failed', message: msg });
          return;
        }

        showToast({
          type: 'success',
          title: 'Room Updated',
          message: `Room "${trimmedName}" updated successfully.`,
        });

        // Update local list
        setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? (data as Room) : r)));
        setIsModalOpen(false);
      } catch (err: unknown) {
        const msg = extractErrorMessage(err, 'Could not update room.');
        setApiError(msg);
        showToast({ type: 'error', title: 'Update Failed', message: msg });
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Create mode
    try {
      const { error, data } = await apiClient.POST('/api/rooms', {
        body: {
          name: trimmedName,
          room_type: formData.room_type,
          branch_id: formData.branch_id as number,
          year: formData.year,
          subject_ids: formData.room_type === 'LAB' ? formData.subject_ids : [],
        },
      });

      if (error) {
        const msg = extractErrorMessage(error, 'Could not create room.');
        setApiError(msg);
        showToast({ type: 'error', title: 'Creation Failed', message: msg });
        return;
      }

      showToast({
        type: 'success',
        title: 'Room Created',
        message: `Room "${trimmedName}" created successfully.`,
      });

      // Update local list
      if (data) {
        setRooms((prev) => [...prev, data as Room]);
      }

      if (addAnother) {
        const nextData: RoomFormData = {
          name: '',
          room_type: formData.room_type,
          branch_id: formData.branch_id,
          year: formData.year,
          subject_ids: [],
        };
        setFormData(nextData);
        setInitialFormData(nextData);
        setFieldErrors({});
        setDuplicateWarning(null);
        setApiError(null);
        nameInputRef.current?.focus();
      } else {
        setIsModalOpen(false);
      }
    } catch (err: unknown) {
      const msg = extractErrorMessage(err, 'Could not create room.');
      setApiError(msg);
      showToast({ type: 'error', title: 'Creation Failed', message: msg });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete initiation: Fetch usage count
  const handleDeleteClick = async (room: Room) => {
    setRoomToDelete(room);
    setDeleteUsageCount(null);
    setIsCheckingUsage(true);

    try {
      const { data, error } = await apiClient.GET('/api/rooms/{room_id}/usage', {
        params: { path: { room_id: room.id } },
      });
      if (error || !data) {
        setDeleteUsageCount(0);
      } else {
        setDeleteUsageCount(data.usage_count);
      }
    } catch (_err) {
      setDeleteUsageCount(0);
    } finally {
      setIsCheckingUsage(false);
    }
  };

  // Confirm delete with optimistic removal
  const handleConfirmDelete = async () => {
    if (!roomToDelete) return;
    const targetRoom = roomToDelete;
    setIsDeleting(true);

    // Optimistic removal
    const previousRooms = rooms;
    setRooms((prev) => prev.filter((r) => r.id !== targetRoom.id));
    setRoomToDelete(null);

    try {
      const { error } = await apiClient.DELETE('/api/rooms/{room_id}', {
        params: { path: { room_id: targetRoom.id } },
      });

      if (error) {
        setRooms(previousRooms);
        const msg = extractErrorMessage(error, 'Could not delete room.');
        showToast({
          type: 'error',
          title: 'Delete Failed',
          message: msg,
        });
        return;
      }

      showToast({
        type: 'success',
        title: 'Room Deleted',
        message: `Room "${targetRoom.name}" was successfully deleted.`,
      });
    } catch (err: unknown) {
      setRooms(previousRooms);
      const msg = extractErrorMessage(err, 'Could not delete room.');
      showToast({
        type: 'error',
        title: 'Delete Failed',
        message: msg,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // Filtered & Sorted Rooms
  const filteredRooms = useMemo(() => {
    return rooms
      .filter((room) => {
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          if (!room.name.toLowerCase().includes(q)) return false;
        }
        if (typeFilter !== 'ALL' && room.room_type !== typeFilter) return false;
        if (yearFilter !== 'ALL' && room.year !== yearFilter) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'name') {
          const comp = a.name.localeCompare(b.name, undefined, { numeric: true });
          return sortOrder === 'asc' ? comp : -comp;
        } else {
          const comp = (a.year ?? '').localeCompare(b.year ?? '');
          return sortOrder === 'asc' ? comp : -comp;
        }
      });
  }, [rooms, searchQuery, typeFilter, yearFilter, sortBy, sortOrder]);

  const toggleSort = (field: 'name' | 'year') => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
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
            Add Room
          </Button>
        }
      />

      {/* Toolbar: Search, Filters & Sorting */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between bg-surface p-3 border border-slate-200 rounded">
        <div className="flex flex-1 flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          {/* Search Box */}
          <div className="relative min-w-[220px]">
            <input
              type="text"
              placeholder="Search by room name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-8 pl-8 pr-8 text-xs bg-white border border-slate-200 rounded placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-all"
            />
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-slate-400">
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400 hover:text-slate-600"
                aria-label="Clear search"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            )}
          </div>

          {/* Type Filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500 font-medium whitespace-nowrap">Type:</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'ALL' | RoomType)}
              className="h-8 px-2 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent text-slate-800 cursor-pointer"
            >
              <option value="ALL">All Types</option>
              <option value="LECTURE">Lecture</option>
              <option value="LAB">Lab</option>
            </select>
          </div>

          {/* Year Filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500 font-medium whitespace-nowrap">Year:</span>
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="h-8 px-2 text-xs bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent text-slate-800 cursor-pointer"
            >
              <option value="ALL">All Years</option>
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Reset Filters button */}
          {(searchQuery || typeFilter !== 'ALL' || yearFilter !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setTypeFilter('ALL');
                setYearFilter('ALL');
              }}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium underline self-center cursor-pointer"
            >
              Reset filters
            </button>
          )}
        </div>

        {/* Total count badge */}
        <div className="text-xs text-slate-500 self-center">
          Showing <span className="font-semibold text-slate-700">{filteredRooms.length}</span> of{' '}
          {rooms.length} rooms
        </div>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        /* Skeleton Table Loader */
        <div className="border border-slate-200 rounded bg-surface overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <div className="h-4 w-32 bg-slate-200 rounded animate-pulse" />
            <div className="h-4 w-20 bg-slate-200 rounded animate-pulse" />
          </div>
          <div className="divide-y divide-slate-100">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="p-4 flex items-center justify-between gap-4 animate-pulse">
                <div className="h-4 w-24 bg-slate-200 rounded" />
                <div className="h-5 w-16 bg-slate-200 rounded" />
                <div className="h-4 w-32 bg-slate-200 rounded" />
                <div className="h-4 w-12 bg-slate-200 rounded" />
                <div className="h-4 w-28 bg-slate-200 rounded" />
                <div className="h-6 w-14 bg-slate-200 rounded" />
              </div>
            ))}
          </div>
        </div>
      ) : fetchError ? (
        /* Fetch Error State with Retry Button */
        <div className="p-8 text-center bg-surface border border-danger-border rounded">
          <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-danger-subtle flex items-center justify-center text-danger">
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-slate-800">Error Loading Rooms</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">{fetchError}</p>
          <Button variant="secondary" size="sm" onClick={loadData} className="mt-4">
            Retry
          </Button>
        </div>
      ) : rooms.length === 0 ? (
        /* Empty State */
        <EmptyState
          title="No rooms created yet"
          description="Rooms represent physical classrooms and laboratories where timetable classes are scheduled. Create your first room to get started."
          actionLabel="Add Room"
          onAction={handleOpenCreateModal}
          icon={
            <svg
              className="w-6 h-6 text-slate-400"
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
      ) : filteredRooms.length === 0 ? (
        /* No Match State */
        <div className="p-12 text-center bg-surface border border-slate-200 rounded">
          <p className="text-sm text-slate-700 font-medium">No matching rooms found</p>
          <p className="text-xs text-slate-500 mt-1">
            Try adjusting your search query or filter options.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setSearchQuery('');
              setTypeFilter('ALL');
              setYearFilter('ALL');
            }}
            className="mt-3"
          >
            Clear all filters
          </Button>
        </div>
      ) : (
        /* Rooms Table */
        <div className="border border-slate-200 rounded overflow-x-auto bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  onClick={() => toggleSort('name')}
                  className="cursor-pointer hover:text-slate-900 select-none"
                  title="Click to sort by Name"
                >
                  <div className="flex items-center gap-1">
                    <span>Name</span>
                    {sortBy === 'name' && (
                      <span className="text-slate-400 text-xs">
                        {sortOrder === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead
                  onClick={() => toggleSort('year')}
                  className="cursor-pointer hover:text-slate-900 select-none"
                  title="Click to sort by Year"
                >
                  <div className="flex items-center gap-1">
                    <span>Year</span>
                    {sortBy === 'year' && (
                      <span className="text-slate-400 text-xs">
                        {sortOrder === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </TableHead>
                <TableHead>Mapped Subjects</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRooms.map((room) => {
                const subjectNames = room.subjects?.map((s) => `${s.name} (${s.code})`) ?? [];
                const subjectCount = subjectNames.length;

                return (
                  <TableRow
                    key={room.id}
                    onClick={() => handleOpenEditModal(room)}
                    className="cursor-pointer hover:bg-slate-50/80 transition-colors"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleOpenEditModal(room);
                    }}
                  >
                    <TableCell isName>
                      <span className="font-semibold text-slate-900">{room.name}</span>
                    </TableCell>
                    <TableCell>
                      {room.room_type === 'LAB' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
                          Lab
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                          Lecture
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-slate-700 text-xs">{getBranchName(room.branch_id)}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" size="sm">
                        {room.year ?? '—'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {room.room_type === 'LAB' ? (
                        subjectCount > 0 ? (
                          <div
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded text-xs text-slate-700 cursor-help transition-colors"
                            title={subjectNames.join('\n')}
                          >
                            <span className="font-medium">{subjectCount}</span>
                            <span className="text-slate-500">
                              {subjectCount === 1 ? 'subject' : 'subjects'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs italic">None mapped</span>
                        )
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(room)}
                          title={`Edit ${room.name}`}
                          aria-label={`Edit ${room.name}`}
                          className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteClick(room)}
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
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Unified Add / Edit Room Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={handleRequestClose}
        title={isEditing ? 'Edit Room' : 'Add Room'}
        subtitle={
          isEditing
            ? `Modify settings for "${selectedRoom?.name}"`
            : 'Define a classroom or laboratory available for timetabling'
        }
        maxWidth="md"
        footer={
          <div className="flex items-center justify-between w-full">
            <div>
              {isEditing && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleResetForm}
                  disabled={!isDirty || isSubmitting}
                >
                  Reset
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRequestClose}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              {!isEditing && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleSubmit(true)}
                  disabled={isSubmitting}
                >
                  Save &amp; add another
                </Button>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleSubmit(false)}
                isLoading={isSubmitting}
                disabled={isEditing && !isDirty}
              >
                {isEditing ? 'Save Changes' : 'Create Room'}
              </Button>
            </div>
          </div>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(false);
          }}
          className="space-y-4"
        >
          {/* General API error banner */}
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
                <p className="font-semibold">{isEditing ? 'Update Failed' : 'Creation Failed'}</p>
                <p className="mt-0.5">{apiError}</p>
              </div>
            </div>
          )}

          {/* Room Name Input */}
          <div>
            <Input
              ref={nameInputRef}
              label="Room Name"
              placeholder="e.g. Room 101 or Physics Lab"
              required
              maxLength={50}
              value={formData.name}
              onChange={(e) => {
                const val = e.target.value;
                setFormData((prev) => ({ ...prev, name: val }));
                if (fieldErrors.name && val.trim()) {
                  setFieldErrors((prev) => {
                    const { name: _, ...rest } = prev;
                    return rest;
                  });
                }
              }}
              onBlur={() => checkDuplicateName(formData.name, formData.branch_id, formData.year)}
              error={fieldErrors.name}
              helperText={
                duplicateWarning ? (
                  <span className="text-amber-600 font-medium">{duplicateWarning}</span>
                ) : (
                  'Maximum 50 characters.'
                )
              }
            />
          </div>

          {/* Type, Branch, Year Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Room Type */}
            <div>
              <Select
                label="Room Type"
                required
                value={formData.room_type}
                onChange={(e) => {
                  const val = e.target.value as RoomType;
                  setFormData((prev) => ({
                    ...prev,
                    room_type: val,
                    subject_ids: val === 'LAB' ? prev.subject_ids : [],
                  }));
                }}
              >
                {ROOM_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type === 'LAB' ? 'LAB (Laboratory)' : 'LECTURE (Classroom)'}
                  </option>
                ))}
              </Select>
            </div>

            {/* Branch */}
            <div>
              <Select
                label="Branch"
                required
                value={formData.branch_id}
                error={fieldErrors.branch_id}
                onChange={(e) => {
                  const val = e.target.value === '' ? '' : Number(e.target.value);
                  // When changing branch, only mark subjects already mapped to this room for the new branch
                  const mappedIdsForNewBranch = selectedRoom
                    ? (selectedRoom.subjects ?? [])
                        .filter(
                          (s) =>
                            (val === '' || s.branch_id === val) &&
                            (formData.year === '' || s.year === formData.year)
                        )
                        .map((s) => s.id)
                    : [];

                  setFormData((prev) => ({
                    ...prev,
                    branch_id: val,
                    subject_ids: mappedIdsForNewBranch,
                  }));

                  if (fieldErrors.branch_id && val !== '') {
                    setFieldErrors((prev) => {
                      const { branch_id: _, ...rest } = prev;
                      return rest;
                    });
                  }
                  checkDuplicateName(formData.name, val, formData.year);
                }}
              >
                <option value="">-- Select branch --</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>

            {/* Academic Year */}
            <div>
              <Select
                label="Academic Year"
                required
                value={formData.year}
                error={fieldErrors.year}
                onChange={(e) => {
                  const val = e.target.value;
                  // When changing year, mark ONLY subjects already mapped to this room for the new year
                  const mappedIdsForNewYear = selectedRoom
                    ? (selectedRoom.subjects ?? [])
                        .filter(
                          (s) =>
                            s.year === val &&
                            (formData.branch_id === '' || s.branch_id === formData.branch_id)
                        )
                        .map((s) => s.id)
                    : [];

                  setFormData((prev) => ({
                    ...prev,
                    year: val,
                    subject_ids: mappedIdsForNewYear,
                  }));

                  if (fieldErrors.year && val) {
                    setFieldErrors((prev) => {
                      const { year: _, ...rest } = prev;
                      return rest;
                    });
                  }
                  checkDuplicateName(formData.name, formData.branch_id, val);
                }}
              >
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* Mapped Lab Subjects (Only shown if room_type === LAB) */}
          {formData.room_type === 'LAB' && (
            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Mapped Lab Subjects <span className="text-danger ml-0.5">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500">
                    {formData.subject_ids.length} selected
                  </span>
                  {displayedLabSubjects.length > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => {
                          const allIds = Array.from(
                            new Set([...formData.subject_ids, ...displayedLabSubjects.map((s) => s.id)])
                          );
                          setFormData((prev) => ({ ...prev, subject_ids: allIds }));
                          if (fieldErrors.subject_ids) {
                            setFieldErrors((errs) => {
                              const { subject_ids: _, ...rest } = errs;
                              return rest;
                            });
                          }
                        }}
                        className="text-blue-600 hover:text-blue-700 underline font-medium cursor-pointer"
                      >
                        Select all
                      </button>
                      <span className="text-slate-300">|</span>
                      <button
                        type="button"
                        onClick={() => {
                          const displayedIds = new Set(displayedLabSubjects.map((s) => s.id));
                          setFormData((prev) => ({
                            ...prev,
                            subject_ids: prev.subject_ids.filter((id) => !displayedIds.has(id)),
                          }));
                        }}
                        className="text-slate-500 hover:text-slate-700 underline font-medium cursor-pointer"
                      >
                        Deselect all
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {availableLabSubjects.length === 0 ? (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded text-xs text-slate-500">
                  No LAB subjects found for the selected branch and year. Please create lab subjects in the Subjects management screen first.
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Search filter for subjects if list is long */}
                  {availableLabSubjects.length > 4 && (
                    <input
                      type="text"
                      placeholder="Filter subjects..."
                      value={subjectSearch}
                      onChange={(e) => setSubjectSearch(e.target.value)}
                      className="w-full h-7 px-2.5 text-xs bg-white border border-slate-200 rounded placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
                    />
                  )}

                  <div className="space-y-1 max-h-44 overflow-y-auto border border-slate-200 rounded p-2 bg-slate-50/50">
                    {displayedLabSubjects.map((subject) => {
                      const isChecked = formData.subject_ids.includes(subject.id);
                      return (
                        <label
                          key={subject.id}
                          className={`flex items-center gap-2 p-1.5 rounded text-xs cursor-pointer select-none transition-colors ${
                            isChecked ? 'bg-purple-50 text-purple-900 font-medium' : 'hover:bg-slate-100 text-slate-700'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleSubject(subject.id)}
                            className="w-3.5 h-3.5 rounded border-slate-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                          />
                          <span className="font-mono text-[11px] text-slate-500">{subject.code}</span>
                          <span className="truncate">{subject.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {fieldErrors.subject_ids && (
                <p className="text-xs text-danger mt-1">{fieldErrors.subject_ids}</p>
              )}
            </div>
          )}
        </form>
      </Modal>

      {/* Discard Changes Confirmation Dialog */}
      <ConfirmDialog
        isOpen={isDiscardDialogOpen}
        title="Discard Unsaved Changes?"
        message="You have unsaved changes in this form. If you close now, those changes will be lost."
        confirmLabel="Discard & Close"
        cancelLabel="Keep Editing"
        variant="danger"
        onConfirm={handleConfirmDiscard}
        onCancel={() => setIsDiscardDialogOpen(false)}
      />

      {/* Delete Confirmation Dialog with Usage Info */}
      <Modal
        isOpen={roomToDelete !== null}
        onClose={() => {
          if (!isDeleting) setRoomToDelete(null);
        }}
        title={`Delete Room ${roomToDelete?.name ?? ''}`}
        maxWidth="sm"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRoomToDelete(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            {deleteUsageCount === 0 && (
              <Button
                variant="danger"
                size="sm"
                onClick={handleConfirmDelete}
                isLoading={isDeleting}
              >
                Yes, Delete
              </Button>
            )}
          </div>
        }
      >
        <div className="space-y-3">
          {isCheckingUsage ? (
            <div className="flex items-center gap-2 py-4 justify-center text-slate-500 text-xs">
              <LoadingSpinner size="sm" />
              <span>Checking room timetable usage...</span>
            </div>
          ) : deleteUsageCount && deleteUsageCount > 0 ? (
            /* Blocked from delete due to slot FKs */
            <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900 space-y-2">
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                    clipRule="evenodd"
                  />
                </svg>
                <div>
                  <p className="font-semibold text-amber-950">Room cannot be deleted</p>
                  <p className="mt-1">
                    Room <strong>{roomToDelete?.name}</strong> is currently assigned to{' '}
                    <strong>{deleteUsageCount} timetable slot(s)</strong>.
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-amber-800 border-t border-amber-200/60 pt-2">
                To delete this room, please reassign or delete its associated timetable slots first.
              </p>
            </div>
          ) : (
            /* Safe to delete */
            <p className="text-sm text-slate-600 leading-relaxed">
              Are you sure you want to delete room <strong>{roomToDelete?.name}</strong>? This action cannot be undone.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
};
