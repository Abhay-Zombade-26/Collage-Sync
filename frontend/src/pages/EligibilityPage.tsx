import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { useToast } from '../components/ui/useToast';
import { apiClient } from '../api/client';
import type { components } from '../api/schema';

type Eligibility = components['schemas']['EligibilityRead'];
type EligibilityCreate = components['schemas']['EligibilityCreate'];
type EligibilityUpdate = components['schemas']['EligibilityUpdate'];
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
 * Extract clean 2-letter uppercase initials from faculty name.
 */
const getFacultyInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'FA';
  const clean = parts.filter(
    (p) =>
      !['mr.', 'mr', 'mrs.', 'mrs', 'ms.', 'ms', 'dr.', 'dr', 'prof.', 'prof'].includes(
        p.toLowerCase()
      )
  );
  const pool = clean.length > 0 ? clean : parts;
  const firstWord = pool[0] ?? 'F';
  const lastWord = pool[pool.length - 1] ?? 'A';
  if (pool.length >= 2) {
    const c1 = firstWord.charAt(0);
    const c2 = lastWord.charAt(0);
    return (c1 + c2).toUpperCase() || 'FA';
  }
  return firstWord.slice(0, 2).toUpperCase() || 'FA';
};

/**
 * Detect whether a subject is practical / lab.
 */
const isLabSubject = (subject?: Subject): boolean => {
  if (!subject) return false;
  const type = (subject.subject_type || '').toLowerCase();
  const name = (subject.name || '').toLowerCase();
  const code = (subject.code || '').toLowerCase();
  return (
    type.includes('lab') ||
    type.includes('practical') ||
    name.includes('lab') ||
    name.includes('practical') ||
    code.endsWith('l') ||
    code.includes('lab')
  );
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

  // Edit mode state
  const [editingEligibility, setEditingEligibility] = useState<Eligibility | null>(null);

  // Interactive filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDivisionId, setSelectedDivisionId] = useState<number | 'all'>('all');
  const [subjectTypeFilter, setSubjectTypeFilter] = useState<'all' | 'lab' | 'theory'>('all');

  const searchInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
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

  // Quick lookup dictionaries
  const teacherMap = useMemo(() => {
    const map = new Map<number, Teacher>();
    teachers.forEach((t) => map.set(t.id, t));
    return map;
  }, [teachers]);

  const subjectMap = useMemo(() => {
    const map = new Map<number, Subject>();
    subjects.forEach((s) => map.set(s.id, s));
    return map;
  }, [subjects]);

  const divisionMap = useMemo(() => {
    const map = new Map<number, Division>();
    divisions.forEach((d) => map.set(d.id, d));
    return map;
  }, [divisions]);

  const teacherName = (id: number): string => {
    const teacher = teacherMap.get(id);
    return teacher ? teacher.name : `Teacher #${id}`;
  };

  const subjectLabel = (id: number): string => {
    const subject = subjectMap.get(id);
    return subject ? `${subject.code} — ${subject.name}` : `Subject #${id}`;
  };

  const divisionName = (id: number): string => {
    const division = divisionMap.get(id);
    return division ? division.name : `Division #${id}`;
  };

  // Compute multi-batch indexing to cleanly identify parallel lab/theory sections
  const batchIndices = useMemo(() => {
    const tracker = new Map<string, number>();
    const indices = new Map<number, { index: number; total: number }>();

    eligibilities.forEach((el) => {
      const key = `${el.teacher_id}_${el.subject_id}_${el.division_id}`;
      tracker.set(key, (tracker.get(key) || 0) + 1);
    });

    const currentCounters = new Map<string, number>();
    eligibilities.forEach((el) => {
      const key = `${el.teacher_id}_${el.subject_id}_${el.division_id}`;
      const nextIdx = (currentCounters.get(key) || 0) + 1;
      currentCounters.set(key, nextIdx);
      indices.set(el.id, {
        index: nextIdx,
        total: tracker.get(key) || 1,
      });
    });

    return indices;
  }, [eligibilities]);

  // Client-side filtering
  const filteredEligibilities = useMemo(() => {
    return eligibilities.filter((el) => {
      const teacher = teacherMap.get(el.teacher_id);
      const subject = subjectMap.get(el.subject_id);
      const division = divisionMap.get(el.division_id);

      // Search matching
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const tName = (teacher?.name || '').toLowerCase();
        const sName = (subject?.name || '').toLowerCase();
        const sCode = (subject?.code || '').toLowerCase();
        const dName = (division?.name || '').toLowerCase();

        const matches =
          tName.includes(query) ||
          sName.includes(query) ||
          sCode.includes(query) ||
          dName.includes(query);

        if (!matches) return false;
      }

      // Division filter
      if (selectedDivisionId !== 'all' && el.division_id !== selectedDivisionId) {
        return false;
      }

      // Subject type filter
      if (subjectTypeFilter !== 'all') {
        const isLab = isLabSubject(subject);
        if (subjectTypeFilter === 'lab' && !isLab) return false;
        if (subjectTypeFilter === 'theory' && isLab) return false;
      }

      return true;
    });
  }, [
    eligibilities,
    searchQuery,
    selectedDivisionId,
    subjectTypeFilter,
    teacherMap,
    subjectMap,
    divisionMap,
  ]);

  const activeDivisionIds = useMemo(() => {
    const set = new Set<number>();
    eligibilities.forEach((e) => set.add(e.division_id));
    return Array.from(set);
  }, [eligibilities]);

  const handleOpenAddModal = () => {
    setEditingEligibility(null);
    setApiError(null);
    reset({
      teacher_id: '',
      subject_id: '',
      division_id: '',
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (eligibility: Eligibility) => {
    setEditingEligibility(eligibility);
    setApiError(null);
    setValue('teacher_id', eligibility.teacher_id);
    setValue('subject_id', eligibility.subject_id);
    setValue('division_id', eligibility.division_id);
    setIsModalOpen(true);
  };

  const handleDuplicate = (eligibility: Eligibility) => {
    setEditingEligibility(null);
    setApiError(null);
    setValue('teacher_id', eligibility.teacher_id);
    setValue('subject_id', eligibility.subject_id);
    setValue('division_id', eligibility.division_id);
    setIsModalOpen(true);
    showToast({
      type: 'info',
      title: 'Allocation Prefilled',
      message: 'Select target division or adjust details to duplicate.',
    });
  };

  const onSubmit = async (data: EligibilityFormData) => {
    setIsSubmitting(true);
    setApiError(null);

    if (data.teacher_id === '' || data.subject_id === '' || data.division_id === '') {
      const message = 'Teacher, subject, and division are all required.';
      setApiError(message);
      setIsSubmitting(false);
      return;
    }

    try {
      if (editingEligibility) {
        const patchPayload: EligibilityUpdate = {
          teacher_id: data.teacher_id,
          subject_id: data.subject_id,
          division_id: data.division_id,
        };

        const { error } = await apiClient.PATCH('/api/eligibility/{eligibility_id}', {
          params: { path: { eligibility_id: editingEligibility.id } },
          body: patchPayload,
        });

        if (error) {
          const message = extractErrorMessage(error, 'Could not update allocation.');
          setApiError(message);
          showToast({
            type: 'error',
            title: 'Update Failed',
            message,
          });
          return;
        }

        showToast({
          type: 'success',
          title: 'Allocation Updated',
          message: `Successfully updated allocation for ${teacherName(data.teacher_id)}.`,
        });
      } else {
        const payload: EligibilityCreate = {
          teacher_id: data.teacher_id,
          subject_id: data.subject_id,
          division_id: data.division_id,
        };

        const { error } = await apiClient.POST('/api/eligibility', {
          body: payload,
        });

        if (error) {
          const message = extractErrorMessage(error, 'Could not create allocation.');
          setApiError(message);
          showToast({
            type: 'error',
            title: 'Creation Failed',
            message,
          });
          return;
        }

        showToast({
          type: 'success',
          title: 'Allocation Created',
          message: `${teacherName(data.teacher_id)} is now mapped to ${subjectLabel(
            data.subject_id
          )}.`,
        });
      }

      setIsModalOpen(false);
      reset();
      setEditingEligibility(null);

      const { data: refreshed } = await apiClient.GET('/api/eligibility');
      setEligibilities(refreshed ?? []);
    } catch (_err: unknown) {
      const message = editingEligibility
        ? 'Could not update allocation.'
        : 'Could not create allocation.';
      setApiError(message);
      showToast({
        type: 'error',
        title: 'Action Failed',
        message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (eligibility: Eligibility) => {
    const faculty = teacherName(eligibility.teacher_id);
    const subject = subjectLabel(eligibility.subject_id);
    const confirmed = window.confirm(
      `Remove allocation of "${faculty}" for "${subject}"? This action cannot be undone.`
    );
    if (!confirmed) {
      return;
    }
    try {
      const { error } = await apiClient.DELETE('/api/eligibility/{eligibility_id}', {
        params: { path: { eligibility_id: eligibility.id } },
      });
      if (error) {
        const message = extractErrorMessage(error, 'Could not remove allocation.');
        showToast({
          type: 'error',
          title: 'Delete Failed',
          message,
        });
        return;
      }
      showToast({
        type: 'success',
        title: 'Allocation Removed',
        message: 'The teacher-subject-division mapping was removed.',
      });
      const { data: refreshed } = await apiClient.GET('/api/eligibility');
      setEligibilities(refreshed ?? []);
    } catch (_err: unknown) {
      showToast({
        type: 'error',
        title: 'Delete Failed',
        message: 'Could not remove allocation.',
      });
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 font-sans pb-16">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* ── Standard Professional Breadcrumb & Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <nav className="text-xs text-slate-500 font-medium mb-1 tracking-normal">
              Setup / Teacher Class Subject Mapping
            </nav>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Teacher Class Subject
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Manage faculty allocations to subjects and divisions used by the timetable solver.
            </p>
          </div>

          {/* Trusted Royal Blue Action CTA */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleOpenAddModal}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-sm font-semibold rounded-lg shadow-xs transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 4v16m8-8H4"
                />
              </svg>
              <span>Add Mapping</span>
            </button>
          </div>
        </div>

        {/* ── Table & Filter Container ── */}
        <div className="bg-white border border-[#e2e8f0] rounded-xl shadow-[0_1px_3px_0_rgba(0,0,0,0.05)] overflow-hidden">
          {/* Clean Controls Toolbar */}
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
                placeholder="Search faculty, subject, or code..."
                className="w-full h-9 pl-9 pr-3 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors"
              />
            </div>

            {/* Filter Pills */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Division Selector */}
              <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setSelectedDivisionId('all')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    selectedDivisionId === 'all'
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All Divs
                </button>
                {activeDivisionIds.map((divId) => {
                  const isSelected = selectedDivisionId === divId;
                  return (
                    <button
                      key={divId}
                      type="button"
                      onClick={() => setSelectedDivisionId(divId)}
                      className={`px-2.5 py-1 rounded-md transition-colors ${
                        isSelected
                          ? 'bg-white text-slate-900 shadow-xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {divisionName(divId)}
                    </button>
                  );
                })}
              </div>

              {/* Subject Type Toggle */}
              <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setSubjectTypeFilter('all')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    subjectTypeFilter === 'all'
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setSubjectTypeFilter('lab')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    subjectTypeFilter === 'lab'
                      ? 'bg-white text-blue-700 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Labs
                </button>
                <button
                  type="button"
                  onClick={() => setSubjectTypeFilter('theory')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    subjectTypeFilter === 'theory'
                      ? 'bg-white text-blue-700 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Theory
                </button>
              </div>

              {/* Allocation Count */}
              <span className="text-xs font-medium text-slate-500 pl-1">
                {filteredEligibilities.length} of {eligibilities.length}
              </span>
            </div>
          </div>

          {/* Table Content */}
          {isLoading ? (
            <div className="flex items-center justify-center p-16">
              <div className="flex items-center gap-3 text-slate-500 text-sm">
                <LoadingSpinner size="md" />
                <span>Loading allocations...</span>
              </div>
            </div>
          ) : eligibilities.length === 0 ? (
            <div className="p-8">
              <EmptyState
                title="No allocations found"
                description="Map teachers to subjects and divisions to generate class timetables."
                actionLabel="Add Mapping"
                onAction={handleOpenAddModal}
              />
            </div>
          ) : filteredEligibilities.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <p className="text-sm font-semibold text-slate-800">No matching allocations</p>
              <p className="text-xs text-slate-500 mt-1 mb-3">
                No allocations matched your filter query.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedDivisionId('all');
                  setSubjectTypeFilter('all');
                }}
                className="text-xs font-semibold text-[#2563eb] hover:text-[#1d4ed8]"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider select-none">
                    <th className="px-5 py-3.5">Faculty Member</th>
                    <th className="px-5 py-3.5">Subject</th>
                    <th className="px-5 py-3.5">Division</th>
                    <th className="px-5 py-3.5">Batch / Section</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredEligibilities.map((eligibility) => {
                    const teacher = teacherMap.get(eligibility.teacher_id);
                    const subject = subjectMap.get(eligibility.subject_id);
                    const division = divisionMap.get(eligibility.division_id);

                    const initials = getFacultyInitials(teacher?.name || 'Faculty');
                    const isLab = isLabSubject(subject);

                    const batchInfo = batchIndices.get(eligibility.id);
                    const divLetter = division
                      ? division.name
                          .replace(/[^a-zA-Z]/g, '')
                          .slice(-1)
                          .toUpperCase() || 'A'
                      : 'A';
                    const batchIndex = batchInfo?.index || 1;
                    const hasMultiBatch = (batchInfo?.total || 1) > 1;

                    return (
                      <tr
                        key={eligibility.id}
                        className="transition-colors duration-150 hover:bg-[#f8fafc]"
                        style={{ height: '52px' }}
                      >
                        {/* 1. Faculty Member */}
                        <td className="px-5 py-3.5 text-slate-900">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 border border-slate-200 flex items-center justify-center font-semibold text-xs shrink-0">
                              {initials}
                            </div>
                            <div>
                              <p className="font-semibold text-slate-900 text-sm">
                                {teacher?.name || `Teacher #${eligibility.teacher_id}`}
                              </p>
                              <p className="text-xs text-slate-500">
                                {teacher?.employment_type === 'VISITING'
                                  ? 'Visiting Faculty'
                                  : 'Regular Faculty'}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* 2. Subject */}
                        <td className="px-5 py-3.5 text-slate-900">
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-xs text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                {subject?.code || 'N/A'}
                              </span>
                              {isLab ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                                  Lab
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200">
                                  Theory
                                </span>
                              )}
                            </div>
                            <span className="text-sm font-medium text-slate-800">
                              {subject?.name || `Subject #${eligibility.subject_id}`}
                            </span>
                          </div>
                        </td>

                        {/* 3. Division Tag */}
                        <td className="px-5 py-3.5 text-slate-900">
                          <div className="inline-flex flex-col items-start gap-1">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-[#eff6ff] text-[#2563eb] border border-[#dbeafe]">
                              {divisionName(eligibility.division_id)}
                            </span>
                            {division && (
                              <span className="text-xs text-slate-500">
                                Year {division.year} · Sem {division.semester}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 4. Batch Allocation */}
                        <td className="px-5 py-3.5 text-slate-900">
                          {isLab || hasMultiBatch ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                              Batch {divLetter}
                              {batchIndex}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500">Entire Class</span>
                          )}
                        </td>

                        {/* 5. Clean Actions */}
                        <td className="px-5 py-3.5 text-right">
                          <div className="inline-flex items-center gap-1 justify-end">
                            {/* Edit Button */}
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(eligibility)}
                              title="Edit allocation"
                              aria-label="Edit allocation"
                              className="p-1.5 rounded-md text-slate-400 hover:text-[#2563eb] hover:bg-blue-50 transition-colors"
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
                                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                />
                              </svg>
                            </button>

                            {/* Clone Button */}
                            <button
                              type="button"
                              onClick={() => handleDuplicate(eligibility)}
                              title="Duplicate for another division"
                              aria-label="Duplicate allocation"
                              className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
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
                                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                />
                              </svg>
                            </button>

                            {/* Delete Button */}
                            <button
                              type="button"
                              onClick={() => handleDelete(eligibility)}
                              title="Delete allocation"
                              aria-label="Delete allocation"
                              className="p-1.5 rounded-md text-slate-400 hover:text-[#ef4444] hover:bg-red-50 transition-colors"
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
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Add / Edit Allocation Modal ── */}
        <Modal
          isOpen={isModalOpen}
          onClose={() => !isSubmitting && setIsModalOpen(false)}
          title={editingEligibility ? 'Edit Teacher Allocation' : 'Add Teacher Allocation'}
          subtitle={
            editingEligibility
              ? 'Update the teacher, subject, or division assignment.'
              : 'Assign a faculty member to teach a subject for a specific division.'
          }
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
              <button
                type="button"
                onClick={handleSubmit(onSubmit)}
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-sm font-semibold rounded-lg shadow-xs transition-colors duration-150 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <span>Saving...</span>
                ) : editingEligibility ? (
                  <span>Save Changes</span>
                ) : (
                  <span>Create Allocation</span>
                )}
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
                  <p className="font-semibold text-red-800">Could not save allocation</p>
                  <p className="mt-0.5">{apiError}</p>
                </div>
              </div>
            )}

            {/* Teacher Select */}
            <div>
              <Select
                label="Faculty Member"
                required
                error={errors.teacher_id?.message}
                {...register('teacher_id', {
                  required: 'Teacher is required',
                  setValueAs: (value: string) => (value === '' ? '' : Number(value)),
                })}
              >
                <option value="">-- Select a faculty member --</option>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.name} ({teacher.status})
                  </option>
                ))}
              </Select>
            </div>

            {/* Subject Select */}
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

            {/* Division Select */}
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
                  </option>
                ))}
              </Select>
            </div>
          </form>
        </Modal>
      </div>
    </div>
  );
};
