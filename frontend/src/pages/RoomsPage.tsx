import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
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
  subject_ids: number[];
}

type RoomFormValues = Pick<RoomFormData, 'name'>;

/**
 * Extract a human-readable message from an openapi-fetch error payload.
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

/**
 * Extract a floor label from common room naming conventions (e.g. "705" -> "Floor 7").
 */
const getFloorLabel = (name: string): string | null => {
  const match = name.match(/(\d{3,4})/);
  if (match && match[1]) {
    const num = match[1];
    const floorDigit = num.length === 3 ? num[0] : num.slice(0, 2);
    return `Floor ${floorDigit}`;
  }
  return null;
};

/**
 * Linked subjects cell with compact chip rendering and hover popover to solve the "pill wall".
 */
const LinkedSubjectsCell: React.FC<{ subjects?: Subject[] }> = ({ subjects }) => {
  const [isHovered, setIsHovered] = useState<boolean>(false);

  if (!subjects || subjects.length === 0) {
    return <span className="text-slate-400 text-xs">—</span>;
  }

  const visibleSubjects = subjects.slice(0, 2);
  const remainingSubjects = subjects.slice(2);

  return (
    <div className="flex flex-wrap items-center gap-1.5 relative">
      {visibleSubjects.map((sub) => (
        <span
          key={sub.id}
          className="bg-slate-100 text-slate-700 border border-slate-200 text-xs px-2.5 py-0.5 rounded-md font-medium truncate max-w-[150px]"
          title={`${sub.code} — ${sub.name}`}
        >
          {sub.code || sub.name}
        </span>
      ))}

      {remainingSubjects.length > 0 && (
        <div
          className="relative inline-block"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <button
            type="button"
            className="bg-blue-50 text-blue-700 border border-blue-200 text-xs px-2 py-0.5 rounded-md font-medium hover:bg-blue-100 transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            +{remainingSubjects.length} more
          </button>

          {isHovered && (
            <div className="absolute left-0 bottom-full mb-1.5 z-30 w-72 bg-white border border-slate-200 rounded-lg shadow-lg p-2.5 space-y-1.5 animate-in fade-in zoom-in-95 duration-100">
              <div className="flex items-center justify-between border-b border-slate-100 pb-1">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Additional Subjects
                </span>
                <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-medium">
                  {remainingSubjects.length} subjects
                </span>
              </div>
              <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                {remainingSubjects.map((s) => (
                  <div
                    key={s.id}
                    className="text-xs text-slate-800 flex items-center justify-between gap-2 py-1 px-1 rounded hover:bg-slate-50"
                  >
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="font-mono text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 shrink-0">
                      {s.code}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const RoomsPage: React.FC = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Controlled form state
  const [branchId, setBranchId] = useState<number | ''>('');
  const [year, setYear] = useState<string>('SE');
  const [roomType, setRoomType] = useState<RoomType>('LECTURE');
  const [subjectIds, setSubjectIds] = useState<number[]>([]);

  // Client-side quick filter
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [roomTypeFilter, setRoomTypeFilter] = useState<'all' | 'LECTURE' | 'LAB'>('all');

  const searchInputRef = useRef<HTMLInputElement>(null);
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

  // Clear stale subject IDs when switching away from LAB
  useEffect(() => {
    if (roomType !== 'LAB' && subjectIds.length > 0) {
      setSubjectIds([]);
    }
  }, [roomType, subjectIds]);

  const labSubjects = subjects.filter(
    (subject) =>
      subject.subject_type === 'LAB' &&
      (branchId === '' || subject.branch_id === branchId) &&
      (year === '' || subject.year === year)
  );

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

  const branchName = useCallback(
    (bId: number | null | undefined): string => {
      if (bId === null || bId === undefined) {
        return '—';
      }
      const branch = branches.find((item) => item.id === bId);
      return branch ? branch.name : `Branch #${bId}`;
    },
    [branches]
  );

  const handleDeleteRoom = async (room: Room) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete room "${room.name}"? This action cannot be undone.`
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
        message: `${room.name} was successfully removed.`,
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
      const message = 'Select at least one subject for this lab.';
      setApiError(message);
      setIsSubmitting(false);
      return;
    }
    const payload: RoomCreate = {
      name: data.name,
      room_type: roomType,
      branch_id: branchId,
      year,
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

  // Filtered rooms list
  const filteredRooms = useMemo(() => {
    return rooms.filter((room) => {
      if (roomTypeFilter !== 'all' && room.room_type !== roomTypeFilter) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = room.name.toLowerCase().includes(q);
        const matchesBranch = branchName(room.branch_id).toLowerCase().includes(q);
        const matchesSubject = (room.subjects || []).some(
          (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
        );
        if (!matchesName && !matchesBranch && !matchesSubject) {
          return false;
        }
      }

      return true;
    });
  }, [rooms, roomTypeFilter, searchQuery, branchName]);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 font-sans pb-16">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* ── Standard Professional Breadcrumb & Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <nav className="text-xs text-slate-500 font-medium mb-1 tracking-normal">
              Setup / Classrooms and Laboratories
            </nav>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Classrooms & Laboratories
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Manage instructional spaces, lecture halls, and specialized laboratory rooms.
            </p>
          </div>

          {/* Trusted Royal Blue Action CTA */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleOpenModal}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-xs transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 4v16m8-8H4"
                />
              </svg>
              <span>Add Room</span>
            </button>
          </div>
        </div>

        {/* ── Table & Filter Container ── */}
        <div className="bg-white border border-[#e2e8f0] rounded-xl shadow-[0_1px_3px_0_rgba(0,0,0,0.05)] overflow-hidden">
          {/* Controls Toolbar */}
          <div className="p-4 border-b border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 max-w-sm">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search room name, branch, or subject..."
                className="w-full h-9 pl-9 pr-3 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              />
            </div>

            {/* Room Type Toggle */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setRoomTypeFilter('all')}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    roomTypeFilter === 'all'
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All Types
                </button>
                <button
                  type="button"
                  onClick={() => setRoomTypeFilter('LECTURE')}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    roomTypeFilter === 'LECTURE'
                      ? 'bg-white text-sky-700 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Lecture Halls
                </button>
                <button
                  type="button"
                  onClick={() => setRoomTypeFilter('LAB')}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    roomTypeFilter === 'LAB'
                      ? 'bg-white text-violet-700 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Laboratories
                </button>
              </div>

              {/* Count Badge */}
              <span className="text-xs font-medium text-slate-500 pl-1">
                {filteredRooms.length} of {rooms.length} rooms
              </span>
            </div>
          </div>

          {/* Table Content */}
          {isLoading ? (
            <div className="flex items-center justify-center p-16">
              <div className="flex items-center gap-3 text-slate-500 text-sm">
                <LoadingSpinner size="md" />
                <span>Loading rooms...</span>
              </div>
            </div>
          ) : rooms.length === 0 ? (
            <div className="p-8">
              <EmptyState
                title="No rooms yet"
                description="Rooms are the physical spaces timetabling assigns to classes — lecture halls and laboratories. Create your first room to begin setup."
                actionLabel="Add Room"
                onAction={handleOpenModal}
              />
            </div>
          ) : filteredRooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <p className="text-sm font-semibold text-slate-800">No matching rooms</p>
              <p className="text-xs text-slate-500 mt-1 mb-3">
                No rooms matched your search query.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setRoomTypeFilter('all');
                }}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-[#f1f5f9] text-xs font-semibold text-slate-500 uppercase tracking-wider select-none">
                    <th className="px-5 py-3.5">Room & Space</th>
                    <th className="px-5 py-3.5">Type</th>
                    <th className="px-5 py-3.5">Branch</th>
                    <th className="px-5 py-3.5">Academic Year</th>
                    <th className="px-5 py-3.5">Linked Subjects</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRooms.map((room) => {
                    const floorLabel = getFloorLabel(room.name);
                    const isLab = room.room_type === 'LAB';

                    return (
                      <tr
                        key={room.id}
                        className="transition-colors duration-150 hover:bg-[#f0f7ff] group"
                        style={{ height: '52px' }}
                      >
                        {/* 1. Room Name & Hierarchy */}
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold shrink-0 border ${
                                isLab
                                  ? 'bg-violet-50 text-violet-700 border-violet-200'
                                  : 'bg-sky-50 text-sky-700 border-sky-200'
                              }`}
                            >
                              {isLab ? (
                                <svg
                                  className="w-4 h-4"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth="1.75"
                                    d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
                                  />
                                </svg>
                              ) : (
                                <svg
                                  className="w-4 h-4"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth="1.75"
                                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m0 0h2m-2 0h10m0 0h2m-2 0V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m6-8h3m-3 4h3"
                                  />
                                </svg>
                              )}
                            </div>
                            <div>
                              <p className="font-semibold text-slate-900 text-sm group-hover:text-blue-900 transition-colors">
                                {room.name}
                              </p>
                              {floorLabel && (
                                <p className="text-[11px] text-slate-500 font-medium">
                                  {floorLabel}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* 2. Room Type Badge */}
                        <td className="px-5 py-3.5">
                          {isLab ? (
                            <span className="bg-violet-50 text-violet-700 border border-violet-200 font-semibold text-[11px] px-2.5 py-0.5 rounded-full inline-flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                              LAB
                            </span>
                          ) : (
                            <span className="bg-sky-50 text-sky-700 border border-sky-200 font-semibold text-[11px] px-2.5 py-0.5 rounded-full inline-flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                              LECTURE
                            </span>
                          )}
                        </td>

                        {/* 3. Branch */}
                        <td className="px-5 py-3.5 text-slate-700 font-medium">
                          {branchName(room.branch_id)}
                        </td>

                        {/* 4. Academic Year */}
                        <td className="px-5 py-3.5">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                            {room.year ?? 'All Years'}
                          </span>
                        </td>

                        {/* 5. Linked Subjects (Solved Pill Wall) */}
                        <td className="px-5 py-3.5">
                          <LinkedSubjectsCell subjects={room.subjects} />
                        </td>

                        {/* 6. Clean Actions */}
                        <td className="px-5 py-3.5 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteRoom(room)}
                            title={`Delete ${room.name}`}
                            aria-label={`Delete ${room.name}`}
                            className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="1.75"
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Add Room Modal ── */}
        <Modal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          title="Add Room"
          subtitle="Define a classroom or laboratory available to timetabling"
          maxWidth="md"
          footer={
            <>
              <button
                type="button"
                onClick={handleCloseModal}
                disabled={isSubmitting}
                className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit(onSubmit)}
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-xs transition-colors duration-150 disabled:opacity-50"
              >
                {isSubmitting ? 'Creating Room...' : 'Create Room'}
              </button>
            </>
          }
        >
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {apiError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
                <svg
                  className="w-4 h-4 shrink-0 mt-0.5 text-red-500"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                <div>
                  <p className="font-semibold text-red-800">Could not create room</p>
                  <p className="mt-0.5">{apiError}</p>
                </div>
              </div>
            )}

            <div>
              <Input
                label="Room Name"
                placeholder="e.g. LT-1 or 705"
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
                      {type === 'LAB' ? 'LAB (Laboratory)' : 'LECTURE (Classroom)'}
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

              <div className="col-span-2">
                <Select
                  label="Academic Year"
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

            {/* Linked Lab Subjects (for LAB rooms only) */}
            {roomType === 'LAB' && (
              <div>
                <p className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
                  Linked Lab Subjects
                  <span className="text-red-500 ml-0.5">*</span>
                </p>
                {labSubjects.length === 0 ? (
                  <p className="text-xs text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200">
                    No LAB subjects found for this branch and year. Create one on the Subjects page
                    first.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-44 overflow-y-auto border border-slate-200 rounded-lg p-2.5 bg-slate-50/50">
                    {labSubjects.map((subject) => (
                      <label
                        key={subject.id}
                        className="flex items-center gap-2.5 text-xs text-slate-800 p-1 rounded hover:bg-white cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={subjectIds.includes(subject.id)}
                          onChange={(event) => toggleSubject(subject.id, event.target.checked)}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="font-mono text-[11px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                          {subject.code}
                        </span>
                        <span className="truncate font-medium">{subject.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </form>
        </Modal>
      </div>
    </div>
  );
};
