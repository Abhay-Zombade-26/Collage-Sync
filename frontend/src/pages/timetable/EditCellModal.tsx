import React, { useEffect, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { useToast } from '../../components/ui/useToast';
import { apiClient } from '../../api/client';
import type { components } from '../../api/schema';
import type { Teacher, TimetableSlot } from './WizardContext';
import { hasConflictWith } from './conflictChecker';

type Room = components['schemas']['RoomRead'];

export interface EditCellModalProps {
  slot: TimetableSlot | null;
  teachers: Teacher[];
  rooms: Room[];
  allSlots: TimetableSlot[];
  onClose: () => void;
  onSaved: (slot: TimetableSlot) => void;
}

/**
 * Manual override of a single slot's teacher and/or room.
 *
 * PATCH /api/timetable/slots/{slot_id} applies the change and locks the
 * slot, so a later re-generation will not move it.
 */
export const EditCellModal: React.FC<EditCellModalProps> = ({
  slot,
  teachers,
  rooms,
  allSlots,
  onClose,
  onSaved,
}) => {
  const { showToast } = useToast();
  const [teacherId, setTeacherId] = useState<number | ''>('');
  const [roomId, setRoomId] = useState<number | ''>('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (slot) {
      setTeacherId(slot.teacher_id);
      setRoomId(slot.room_id);
    }
  }, [slot]);

  if (!slot) {
    return null;
  }

  const handleSave = async () => {
    if (teacherId === '' || roomId === '') {
      showToast({
        type: 'error',
        title: 'Incomplete Change',
        message: 'Pick both a teacher and a room.',
      });
      return;
    }

    const candidate: TimetableSlot = {
      ...slot,
      teacher_id: teacherId,
      room_id: roomId,
    };

    if (hasConflictWith(allSlots, candidate)) {
      showToast({
        type: 'error',
        title: 'Conflict Detected',
        message: 'That teacher or room is already booked in this time slot.',
      });
      return;
    }

    setIsSaving(true);
    try {
      const { data, error } = await apiClient.PATCH('/api/timetable/slots/{slot_id}', {
        params: { path: { slot_id: slot.id } },
        body: { teacher_id: teacherId, room_id: roomId },
      });
      if (error || !data) {
        showToast({
          type: 'error',
          title: 'Update Failed',
          message: 'Could not update the slot.',
        });
        return;
      }
      showToast({
        type: 'success',
        title: 'Slot Updated',
        message: 'The slot was updated and is now locked.',
      });
      onSaved(data);
    } catch (_err: unknown) {
      showToast({
        type: 'error',
        title: 'Update Failed',
        message: 'Could not update the slot.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={Boolean(slot)}
      onClose={onClose}
      title="Edit Slot"
      subtitle="Override the teacher and room for this period. The slot becomes locked."
      maxWidth="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} isLoading={isSaving}>
            Save & Lock
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="border border-blue-500/20 rounded-xl bg-blue-50/50 dark:bg-blue-950/30 p-3 text-xs text-slate-600 dark:text-slate-300">
          <p className="font-semibold text-slate-900 dark:text-slate-100">
            {slot.day_of_week} · {slot.start_time.slice(0, 5)} – {slot.end_time.slice(0, 5)}
          </p>
          {slot.is_lab && <p className="mt-0.5 text-blue-600 dark:text-blue-400 font-mono text-[11px]">Practical session (2 periods)</p>}
        </div>

        <Select
          label="Teacher"
          required
          value={teacherId}
          onChange={(event) =>
            setTeacherId(event.target.value === '' ? '' : Number(event.target.value))
          }
        >
          <option value="">-- Select a teacher --</option>
          {teachers.map((teacher) => (
            <option key={teacher.id} value={teacher.id}>
              {teacher.name} ({teacher.status})
            </option>
          ))}
        </Select>

        <Select
          label="Room"
          required
          value={roomId}
          onChange={(event) =>
            setRoomId(event.target.value === '' ? '' : Number(event.target.value))
          }
        >
          <option value="">-- Select a room --</option>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name} ({room.room_type})
            </option>
          ))}
        </Select>
      </div>
    </Modal>
  );
};
