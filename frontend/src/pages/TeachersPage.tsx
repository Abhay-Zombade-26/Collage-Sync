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
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/useToast';
import { apiClient } from '../api/client';
import type { components } from '../api/schema';

type Teacher = components['schemas']['TeacherRead'];
type Eligibility = components['schemas']['EligibilityRead'];
type TeacherStatus = components['schemas']['TeacherStatus'];
type Branch = components['schemas']['BranchRead'];
type Division = components['schemas']['DivisionRead'];
type Subject = components['schemas']['SubjectRead'];
type Batch = components['schemas']['BatchRead'];

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
  const [allBatches, setAllBatches] = useState<Batch[]>([]);
  const [divisionBatches, setDivisionBatches] = useState<Batch[]>([]);
  const [eligibilities, setEligibilities] = useState<Eligibility[]>([]);
  const [isAddingAllocation, setIsAddingAllocation] = useState(false);

  // Allocation Form State
  const [selectedBranchId, setSelectedBranchId] = useState<number | ''>('');
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | ''>('');
  const [selectedDivisionId, setSelectedDivisionId] = useState<number | ''>('');
  const [selectedBatchId, setSelectedBatchId] = useState<number | ''>('');

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
    setSelectedBatchId('');
    setDivisionBatches([]);
    
    // Fetch all prerequisite data in parallel
    try {
      const [branchesRes, subjectsRes, divisionsRes, eligRes, batchesRes] = await Promise.all([
        apiClient.GET('/api/branches'),
        apiClient.GET('/api/subjects'),
        apiClient.GET('/api/divisions'),
        apiClient.GET('/api/eligibility'),
        apiClient.GET('/api/batches'),
      ]);

      setBranches(branchesRes.data ?? []);
      setSubjects(subjectsRes.data ?? []);
      setDivisions(divisionsRes.data ?? []);
      setAllBatches(batchesRes.data ?? []);
      
      // Filter eligibilities for this specific teacher
      const teacherEligs = (eligRes.data ?? []).filter((e) => e.teacher_id === teacherId);
      setEligibilities(teacherEligs);
    } catch (_err) {
      showToast({ type: 'error', title: 'Error', message: 'Failed to load allocation data.' });
    }
  };

  const selectedSubject = useMemo(
    () => subjects.find((s) => s.id === selectedSubjectId),
    [subjects, selectedSubjectId]
  );
  const isLabSubject = selectedSubject?.subject_type === 'LAB';

  // When selected division or subject changes, fetch batches for LAB subjects
  useEffect(() => {
    if (isLabSubject && selectedDivisionId) {
      const fetchBatches = async () => {
        try {
          const { data } = await apiClient.GET('/api/batches');
          const batchList = data ?? [];
          setAllBatches(batchList);
          setDivisionBatches(batchList.filter((b) => b.division_id === Number(selectedDivisionId)));
        } catch (_err) {
          setDivisionBatches([]);
        }
      };
      fetchBatches();
    } else {
      setDivisionBatches([]);
      setSelectedBatchId('');
    }
  }, [isLabSubject, selectedDivisionId]);

  // Add Eligibility (Teacher -> Subject -> Division -> [Batch])
  const handleAddAllocation = async () => {
    if (!allocationTeacherId || !selectedSubjectId || !selectedDivisionId) {
      showToast({ type: 'error', title: 'Validation', message: 'Please select Subject and Division.' });
      return;
    }
    if (isLabSubject && !selectedBatchId) {
      showToast({ type: 'error', title: 'Validation', message: 'Batch is required for Lab subjects.' });
      return;
    }

    setIsAddingAllocation(true);
    try {
      const { error } = await apiClient.POST('/api/eligibility', {
        body: {
          teacher_id: allocationTeacherId,
          subject_id: Number(selectedSubjectId),
          division_id: Number(selectedDivisionId),
          batch_id: isLabSubject ? Number(selectedBatchId) : null,
        },
      });

      if (error) {
        showToast({
          type: 'error',
          title: 'Error',
          message: extractErrorMessage(error, 'Failed to add mapping.'),
        });
        return;
      }

      showToast({ type: 'success', title: 'Success', message: 'Allocation mapped successfully.' });
      
      // Refresh the eligibilities list
      const { data } = await apiClient.GET('/api/eligibility');
      setEligibilities((data ?? []).filter((e) => e.teacher_id === allocationTeacherId));
      
      // Reset form
      setSelectedSubjectId('');
      setSelectedDivisionId('');
      setSelectedBatchId('');
    } catch (_err) {
      showToast({ type: 'error', title: 'Error', message: 'Failed to add mapping.' });
    } finally {
      setIsAddingAllocation(false);
    }
  };

  // Derived filtered options for the modal
  const filteredSubjects = useMemo(() => {
    if (!selectedBranchId) return [];
    return subjects.filter((s) => s.branch_id === selectedBranchId);
  }, [subjects, selectedBranchId]);

  const filteredDivisions = useMemo(() => {
    if (!selectedBranchId) return [];
    return divisions.filter((d) => d.branch_id === selectedBranchId);
  }, [divisions, selectedBranchId]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Teachers"
        subtitle="Setup / Faculty Roster & Allocations"
        action={
          <Button variant="primary" size="sm" onClick={() => { setApiError(null); setIsModalOpen(true); }}>
            Add Teacher
          </Button>
        }
      />

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
          description="Faculty accounts are created here and approved by an administrator."
          actionLabel="Add Teacher"
          onAction={() => setIsModalOpen(true)}
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
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teachers.map((teacher) => (
              <TableRow key={teacher.id}>
                <TableCell>{teacher.name}</TableCell>
                <TableCell>{teacher.email}</TableCell>
                <TableCell><Badge variant="role" size="sm">{teacher.role}</Badge></TableCell>
                <TableCell><Badge variant={statusVariant(teacher.status)} size="sm">{teacher.status}</Badge></TableCell>
                <TableCell>{teacher.employment_type}</TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex items-center gap-1.5">
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
                      className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-danger hover:bg-danger-subtle transition-colors duration-75"
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
          {apiError && <div className="p-3 bg-danger-subtle text-xs text-danger rounded">{apiError}</div>}
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
          <div className="bg-slate-50 border border-slate-200 p-4 rounded-lg space-y-4">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Add New Allocation</h4>
            
            <div className={`grid grid-cols-1 ${isLabSubject ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-4`}>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Branch *</label>
                <select 
                  className="w-full border border-slate-300 rounded-md p-2 text-sm"
                  value={selectedBranchId}
                  onChange={(e) => {
                    setSelectedBranchId(Number(e.target.value));
                    setSelectedSubjectId('');
                    setSelectedDivisionId('');
                    setSelectedBatchId('');
                  }}
                >
                  <option value="">-- Select Branch --</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Subject *</label>
                <select 
                  className="w-full border border-slate-300 rounded-md p-2 text-sm disabled:opacity-50"
                  value={selectedSubjectId}
                  onChange={(e) => {
                    setSelectedSubjectId(Number(e.target.value));
                    setSelectedBatchId('');
                  }}
                  disabled={!selectedBranchId}
                >
                  <option value="">-- Select Subject --</option>
                  {filteredSubjects.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.year}) {s.subject_type === 'LAB' ? '[LAB]' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Division *</label>
                <select 
                  className="w-full border border-slate-300 rounded-md p-2 text-sm disabled:opacity-50"
                  value={selectedDivisionId}
                  onChange={(e) => {
                    setSelectedDivisionId(Number(e.target.value));
                    setSelectedBatchId('');
                  }}
                  disabled={!selectedBranchId}
                >
                  <option value="">-- Select Division --</option>
                  {filteredDivisions.map(d => <option key={d.id} value={d.id}>{d.name} ({d.year})</option>)}
                </select>
              </div>

              {isLabSubject && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Batch *</label>
                  <select
                    className="w-full border border-slate-300 rounded-md p-2 text-sm disabled:opacity-50"
                    value={selectedBatchId}
                    onChange={(e) => setSelectedBatchId(Number(e.target.value))}
                    disabled={!selectedDivisionId}
                  >
                    <option value="">-- Select Batch --</option>
                    {divisionBatches.map(b => (
                      <option key={b.id} value={b.id}>
                        Batch {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button 
                variant="primary" 
                size="sm" 
                onClick={handleAddAllocation} 
                isLoading={isAddingAllocation}
                disabled={!selectedSubjectId || !selectedDivisionId || (isLabSubject && !selectedBatchId)}
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
              <div className="border border-slate-200 rounded-md overflow-hidden">
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
                      const batch = allBatches.find(b => b.id === elig.batch_id);
                      const baseSub = sub ? `${sub.name} (${sub.year})` : `Subject #${elig.subject_id}`;
                      const displaySub = batch ? `${baseSub} - Batch ${batch.name}` : baseSub;

                      return (
                        <TableRow key={elig.id}>
                          <TableCell>{displaySub}</TableCell>
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