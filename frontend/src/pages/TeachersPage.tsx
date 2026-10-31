import React, { useState, useEffect, useMemo } from 'react';
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
import { useToast } from '../components/ui/useToast';
import { apiClient } from '../api/client';
import type { components } from '../api/schema';

type Teacher = components['schemas']['TeacherRead'];
type Eligibility = components['schemas']['EligibilityRead'];
type Branch = components['schemas']['BranchRead'];
type Division = components['schemas']['DivisionRead'];
type Subject = components['schemas']['SubjectRead'];

interface TeacherFormData {
  name: string;
  email: string;
  password: string;
}

/**
 * Extract a human-readable message from an openapi-fetch error payload.
 */
const extractErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'object' && error !== null && 'detail' in error) {
    const detail = (error as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (first && typeof first.msg === 'string') return first.msg;
    }
  }
  return fallback;
};

export const TeachersPage: React.FC = () => {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  
  // Add Teacher Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Allocations Modal State
  const [isAllocationOpen, setIsAllocationOpen] = useState(false);
  const [allocationTeacherId, setAllocationTeacherId] = useState<number | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [eligibilities, setEligibilities] = useState<Eligibility[]>([]);
  const [isAddingAllocation, setIsAddingAllocation] = useState(false);

  // Allocation Form State
  const [selectedBranchId, setSelectedBranchId] = useState<number | ''>('');
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | ''>('');
  const [selectedDivisionId, setSelectedDivisionId] = useState<number | ''>('');

  const { showToast } = useToast();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<TeacherFormData>({
    defaultValues: { name: '', email: '', password: '' },
  });

  // Load Teachers
  const loadTeachers = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await apiClient.GET('/api/teachers');
      if (error) {
        setTeachers([]);
        return;
      }
      setTeachers(data ?? []);
    } catch (_err) {
      setTeachers([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadTeachers();
  }, []);

  // Delete Teacher
  const handleDeleteTeacher = async (teacher: Teacher) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete this teacher? "${teacher.name}" will be removed along with their allocations.`
    );
    if (!confirmed) {
      return;
    }
    try {
      const { error } = await apiClient.DELETE('/api/teachers/{teacher_id}', {
        params: { path: { teacher_id: teacher.id } },
      });
      if (error) {
        showToast({
          type: 'error',
          title: 'Delete Failed',
          message: 'Could not delete the teacher.',
        });
        return;
      }
      showToast({
        type: 'success',
        title: 'Teacher Deleted',
        message: `${teacher.name} was deleted.`,
      });
      await loadTeachers();
    } catch (_err: unknown) {
      showToast({
        type: 'error',
        title: 'Delete Failed',
        message: 'Could not delete the teacher.',
      });
    }
  };

  // Create Teacher
  const onSubmitTeacher = async (data: TeacherFormData) => {
    setIsSubmitting(true);
    setApiError(null);
    try {
      const { error } = await apiClient.POST('/api/auth/register', {
        body: { name: data.name, email: data.email, password: data.password },
      });
      
      if (error) {
        const message = extractErrorMessage(error, 'Could not create teacher.');
        setApiError(message);
        showToast({ type: 'error', title: 'Submission Failed', message });
        return;
      }
      
      showToast({
        type: 'success',
        title: 'Teacher Registered',
        message: `Account for ${data.name} created. It stays pending until approved.`,
      });
      setIsModalOpen(false);
      reset();
      loadTeachers();
    } catch (_err) {
      setApiError('Could not create teacher.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open Allocations Modal & Fetch Data
  const handleOpenAllocation = async (teacherId: number) => {
    setAllocationTeacherId(teacherId);
    setIsAllocationOpen(true);
    setSelectedBranchId('');
    setSelectedSubjectId('');
    setSelectedDivisionId('');
    
    // Fetch all prerequisite data in parallel
    try {
      const [branchesRes, subjectsRes, divisionsRes, eligRes] = await Promise.all([
        apiClient.GET('/api/branches'),
        apiClient.GET('/api/subjects'),
        apiClient.GET('/api/divisions'),
        apiClient.GET('/api/eligibility') // Fetch all, we'll filter client side
      ]);

      setBranches(branchesRes.data ?? []);
      setSubjects(subjectsRes.data ?? []);
      setDivisions(divisionsRes.data ?? []);
      
      // Filter eligibilities for this specific teacher
      const teacherEligs = (eligRes.data ?? []).filter(e => e.teacher_id === teacherId);
      setEligibilities(teacherEligs);
    } catch (_err) {
      showToast({ type: 'error', title: 'Error', message: 'Failed to load allocation data.' });
    }
  };

  // Add Eligibility (Teacher -> Subject -> Division)
  const handleAddAllocation = async () => {
    if (!allocationTeacherId || !selectedSubjectId || !selectedDivisionId) {
      showToast({ type: 'error', title: 'Validation', message: 'Please select Subject and Division.' });
      return;
    }

    setIsAddingAllocation(true);
    try {
      const { error } = await apiClient.POST('/api/eligibility', {
        body: {
          teacher_id: allocationTeacherId,
          subject_id: Number(selectedSubjectId),
          division_id: Number(selectedDivisionId),
          batch_id: null
        }
      });

      if (error) {
        showToast({ type: 'error', title: 'Error', message: extractErrorMessage(error, 'Failed to add mapping.') });
        return;
      }

      showToast({ type: 'success', title: 'Success', message: 'Allocation mapped successfully.' });
      
      // Refresh the eligibilities list
      const { data } = await apiClient.GET('/api/eligibility');
      setEligibilities((data ?? []).filter(e => e.teacher_id === allocationTeacherId));
      
      // Reset form
      setSelectedSubjectId('');
      setSelectedDivisionId('');
    } catch (_err) {
      showToast({ type: 'error', title: 'Error', message: 'Failed to add mapping.' });
    } finally {
      setIsAddingAllocation(false);
    }
  };

  // Derived filtered options for the modal
  const filteredSubjects = useMemo(() => {
    if (!selectedBranchId) return [];
    return subjects.filter(s => s.branch_id === selectedBranchId);
  }, [subjects, selectedBranchId]);

  const filteredDivisions = useMemo(() => {
    if (!selectedBranchId) return [];
    return divisions.filter(d => d.branch_id === selectedBranchId);
  }, [divisions, selectedBranchId]);

  const [searchQuery, setSearchQuery] = useState<string>('');

  const getInitials = (name: string): string => {
    const clean = name.replace(/^(Dr\.|Prof\.|Mr\.|Mrs\.|Ms\.)\s+/i, '').trim();
    const parts = clean.split(/\s+/);
    const first = parts[0]?.charAt(0) ?? 'F';
    const second = parts[1]?.charAt(0) ?? parts[0]?.charAt(1) ?? 'A';
    return (first + second).toUpperCase();
  };

  const getDesignation = (teacher: Teacher): string => {
    if (teacher.role === 'ADMIN') return 'Head of Department';
    if (teacher.employment_type === 'VISITING') return 'Visiting Faculty';
    return 'Assistant Professor';
  };

  const getTargetHours = (teacher: Teacher): string => {
    if (teacher.employment_type === 'VISITING') return '12 hrs / wk';
    return '16 hrs / wk';
  };

  const filteredTeachers = teachers.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      getDesignation(t).toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Teachers"
        subtitle="Setup / Faculty Roster & Workload Allocations"
        action={
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setApiError(null);
              setIsModalOpen(true);
            }}
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

      {/* Top Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
        <div className="relative w-full sm:w-72">
          <svg
            className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter faculty by name, email, or designation..."
            className="w-full pl-9 pr-3 py-1.5 text-xs text-slate-800 bg-slate-50 border border-slate-200 rounded-lg placeholder-slate-400 focus:outline-hidden focus:bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
          />
        </div>
        <div className="text-xs text-slate-500 font-medium self-end sm:self-center">
          Showing {filteredTeachers.length} of {teachers.length} faculty members
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-16 bg-white border border-slate-200 rounded-xl shadow-xs">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <LoadingSpinner size="md" />
            <span>Loading teachers...</span>
          </div>
        </div>
      ) : teachers.length === 0 ? (
        <EmptyState
          title="No teachers yet"
          description="Faculty accounts are created here and approved by an administrator."
          actionLabel="Add Teacher"
          onAction={() => setIsModalOpen(true)}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Faculty Name</TableHead>
                <TableHead>Designation</TableHead>
                <TableHead>Email / Staff ID</TableHead>
                <TableHead className="w-36">Target Weekly Hours</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTeachers.map((teacher) => (
                <TableRow key={teacher.id} className="h-14">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-slate-100 border border-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center shrink-0">
                        {getInitials(teacher.name)}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900 text-sm">{teacher.name}</p>
                        <p className="text-[11px] text-slate-400 capitalize">{teacher.status.toLowerCase()}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 px-2.5 py-0.5 rounded-md">
                      {getDesignation(teacher)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-slate-600">{teacher.email}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs font-medium text-slate-600">
                      {getTargetHours(teacher)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleOpenAllocation(teacher.id)}
                      >
                        Allocations
                      </Button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTeacher(teacher)}
                        title={`Delete ${teacher.name}`}
                        aria-label={`Delete ${teacher.name}`}
                        className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 p-1.5 rounded-lg transition-colors inline-flex items-center justify-center"
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
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Teacher Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSubmitting && setIsModalOpen(false)}
        title="Add Teacher"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setIsModalOpen(false)} disabled={isSubmitting}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSubmit(onSubmitTeacher)} isLoading={isSubmitting}>Create Teacher</Button>
          </>
        }
      >
        <form onSubmit={handleSubmit(onSubmitTeacher)} className="space-y-4">
          {apiError && <div className="p-3 bg-rose-50 text-xs text-rose-600 rounded-lg border border-rose-200">{apiError}</div>}
          <Input label="Teacher Name" placeholder="e.g. Dr. A. Sharma" required error={errors.name?.message} {...register('name', { required: 'Name is required' })} />
          <Input label="Email" type="email" placeholder="name@college.edu" required error={errors.email?.message} {...register('email', { required: 'Email is required' })} />
          <Input label="Temporary Password" type="password" placeholder="••••••••" required error={errors.password?.message} {...register('password', { required: 'Password is required', minLength: { value: 8, message: 'Min 8 characters' } })} />
        </form>
      </Modal>

      {/* Allocations Modal */}
      <Modal
        isOpen={isAllocationOpen}
        onClose={() => setIsAllocationOpen(false)}
        title={`Allocations for ${teachers.find(t => t.id === allocationTeacherId)?.name ?? ''}`}
        subtitle="Manage which subject and division this teacher is assigned to."
        maxWidth="lg"
      >
        <div className="space-y-6">
          {/* Add New Mapping Form */}
          <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl space-y-4 shadow-xs">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Add New Allocation</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Branch *</label>
                <select 
                  className="w-full border border-slate-200 bg-white text-slate-800 rounded-lg p-2 text-sm focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  value={selectedBranchId}
                  onChange={(e) => {
                    setSelectedBranchId(Number(e.target.value));
                    setSelectedSubjectId('');
                    setSelectedDivisionId('');
                  }}
                >
                  <option value="">-- Select Branch --</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Subject *</label>
                <select 
                  className="w-full border border-slate-200 bg-white text-slate-800 rounded-lg p-2 text-sm disabled:opacity-50 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  value={selectedSubjectId}
                  onChange={(e) => setSelectedSubjectId(Number(e.target.value))}
                  disabled={!selectedBranchId}
                >
                  <option value="">-- Select Subject --</option>
                  {filteredSubjects.map(s => <option key={s.id} value={s.id}>{s.name} ({s.year})</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Division *</label>
                <select 
                  className="w-full border border-slate-200 bg-white text-slate-800 rounded-lg p-2 text-sm disabled:opacity-50 focus:outline-hidden focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  value={selectedDivisionId}
                  onChange={(e) => setSelectedDivisionId(Number(e.target.value))}
                  disabled={!selectedBranchId}
                >
                  <option value="">-- Select Division --</option>
                  {filteredDivisions.map(d => <option key={d.id} value={d.id}>{d.name} ({d.year})</option>)}
                </select>
              </div>
            </div>

            <div className="flex justify-end">
              <Button 
                variant="primary" 
                size="sm" 
                onClick={handleAddAllocation} 
                isLoading={isAddingAllocation}
                disabled={!selectedSubjectId || !selectedDivisionId}
              >
                Add Mapping
              </Button>
            </div>
          </div>

          {/* Current Mappings List */}
          <div>
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Current Mappings</h4>
            {eligibilities.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No allocations mapped yet.</p>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xs">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subject</TableHead>
                      <TableHead>Division</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {eligibilities.map((elig) => {
                      const sub = subjects.find(s => s.id === elig.subject_id);
                      const div = divisions.find(d => d.id === elig.division_id);
                      return (
                        <TableRow key={elig.id} className="h-12">
                          <TableCell>{sub ? `${sub.name} (${sub.year})` : `Subject #${elig.subject_id}`}</TableCell>
                          <TableCell>{div ? `${div.name} (${div.year})` : `Division #${elig.division_id}`}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
};