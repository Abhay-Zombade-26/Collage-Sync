"""Timetable generator service.

Constraints enforced:
1. Global Batch Generation: Generate multiple divisions at once so shared teachers
   and rooms are never double-booked across divisions.
2. Lab Blocks: Scheduled as 2 consecutive periods in the SAME room with the same teacher.
3. Compact Schedule: Fill earliest periods first (Period 1, 2, 3...) so there are no empty
   gaps in the middle of the day. Empty slots only appear at the end of the day.
4. Hard constraints:
   - Teacher no double-booking (global across all divisions)
   - Room no double-booking (global across all divisions)
   - Division no double-booking
   - Labs cannot span across lunch break
   - Teacher daily lecture cap
   - Visiting faculty day/time availability
"""

import asyncio
from dataclasses import dataclass
from datetime import time

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.batch import Batch
from app.models.division import Division
from app.models.eligibility import TeacherSubjectDivision
from app.models.enums import DayOfWeek, EmploymentType, RoomType, TeacherStatus
from app.models.room import Room
from app.models.room_subject import RoomSubject
from app.models.subject import Subject
from app.models.teacher import Teacher
from app.models.timetable_settings import TimetableSettings
from app.models.timetable_slot import TimetableSlot
from app.models.weekly_requirement import WeeklyRequirement


@dataclass(frozen=True)
class _Period:
    index: int
    start_seconds: int
    end_seconds: int


@dataclass
class _SchedulableUnit:
    division_id: int
    subject_id: int
    is_lab: bool
    kind: str  # "lab", "theory", "tutorial"
    eligible_teacher_count: int


@dataclass(frozen=True)
class _SlotPlan:
    division_id: int
    batch_id: int | None
    subject_id: int
    teacher_id: int
    room_id: int
    day: DayOfWeek
    start: time
    end: time
    is_lab: bool


def _to_seconds(value: time) -> int:
    return value.hour * 3600 + value.minute * 60 + value.second


def _from_seconds(total: int) -> time:
    total %= 86400
    hours, rest = divmod(total, 3600)
    minutes, seconds = divmod(rest, 60)
    return time(hours, minutes, seconds)


def _build_periods(settings: TimetableSettings) -> list[_Period]:
    """Compute the candidate period boundaries for each school day."""
    period_seconds = settings.period_minutes * 60
    start_seconds = _to_seconds(settings.start_time)
    end_seconds = _to_seconds(settings.end_time)
    lunch_start = _to_seconds(settings.lunch_start)
    lunch_end = lunch_start + settings.lunch_minutes * 60

    periods: list[_Period] = []
    idx = 1

    # Teaching periods before lunch
    cursor = start_seconds
    while cursor + period_seconds <= lunch_start:
        periods.append(_Period(index=idx, start_seconds=cursor, end_seconds=cursor + period_seconds))
        idx += 1
        cursor += period_seconds

    # Resume after lunch break
    cursor = max(cursor, lunch_end)
    while cursor + period_seconds <= end_seconds:
        periods.append(_Period(index=idx, start_seconds=cursor, end_seconds=cursor + period_seconds))
        idx += 1
        cursor += period_seconds

    # Fallback if no periods were constructed due to zero length / mismatch
    if not periods:
        cursor = start_seconds
        while cursor + period_seconds <= end_seconds:
            periods.append(_Period(index=idx, start_seconds=cursor, end_seconds=cursor + period_seconds))
            idx += 1
            cursor += period_seconds

    return periods


def _teacher_can_teach(
    teacher: Teacher,
    day: DayOfWeek,
    period_objs: list[_Period],
    current_day_load: int,
    slots_needed: int,
) -> bool:
    """Validate daily lecture cap and visiting faculty schedule availability."""
    if current_day_load + slots_needed > teacher.max_lectures_per_day:
        return False
    if teacher.employment_type == EmploymentType.VISITING:
        day_names = teacher.available_days or []
        if day.value not in day_names:
            return False
        if teacher.available_start is not None and period_objs[0].start_seconds < _to_seconds(teacher.available_start):
            return False
        if teacher.available_end is not None and period_objs[-1].end_seconds > _to_seconds(teacher.available_end):
            return False
    return True


def _get_lab_room_candidates(
    subject_id: int,
    division: Division,
    rooms: list[Room],
    subject_rooms: dict[int, list[int]],
) -> list[int]:
    """Candidate rooms for a LAB placement."""
    linked = subject_rooms.get(subject_id, [])
    # 1. Linked lab rooms matching division branch and year
    matches = [
        r.id
        for r in rooms
        if r.id in linked
        and r.room_type == RoomType.LAB
        and (r.branch_id is None or r.branch_id == division.branch_id)
        and (r.year is None or r.year == division.year)
    ]
    if matches:
        return matches
    # 2. Any linked lab rooms
    linked_lab = [r.id for r in rooms if r.id in linked and r.room_type == RoomType.LAB]
    if linked_lab:
        return linked_lab
    # 3. Lab rooms matching division branch and year
    div_lab = [
        r.id
        for r in rooms
        if r.room_type == RoomType.LAB
        and (r.branch_id is None or r.branch_id == division.branch_id)
        and (r.year is None or r.year == division.year)
    ]
    if div_lab:
        return div_lab
    # 4. Any lab room
    any_lab = [r.id for r in rooms if r.room_type == RoomType.LAB]
    if any_lab:
        return any_lab
    # 5. Fallback to any room
    return [r.id for r in rooms]


def _get_lecture_room_candidates(
    division: Division,
    rooms: list[Room],
) -> list[int]:
    """Candidate rooms for a THEORY or TUTORIAL placement."""
    # 1. Lecture rooms matching division branch and year
    matches = [
        r.id
        for r in rooms
        if r.room_type == RoomType.LECTURE
        and (r.branch_id is None or r.branch_id == division.branch_id)
        and (r.year is None or r.year == division.year)
    ]
    if matches:
        return matches
    # 2. Any lecture room
    any_lecture = [r.id for r in rooms if r.room_type == RoomType.LECTURE]
    if any_lecture:
        return any_lecture
    # 3. Fallback to any room
    return [r.id for r in rooms]


def _solve_global(
    division_ids: list[int],
    division_map: dict[int, Division],
    division_batches: dict[int, list[Batch]],
    periods: list[_Period],
    school_days: list[DayOfWeek],
    sorted_units: list[_SchedulableUnit],
    division_teachers: dict[tuple[int, int], list[int]],
    batch_teachers: dict[tuple[int, int], list[int]],
    active_teachers: dict[int, Teacher],
    rooms: list[Room],
    subject_rooms: dict[int, list[int]],
    existing_slots: list[TimetableSlot],
) -> list[_SlotPlan]:
    """Execute heuristic greedy timetable solver with compact period ordering."""
    # Step 2: Global Busy Map
    # format: busy_teachers[(day, period)] = set(teacher_ids)
    # Created ONCE at the start of the function and updated after every slot placed
    busy_teachers: dict[tuple[DayOfWeek, int], set[int]] = {}
    busy_rooms: dict[tuple[DayOfWeek, int], set[int]] = {}
    busy_divisions: dict[tuple[DayOfWeek, int], set[int]] = {}
    teacher_day_load: dict[tuple[int, DayOfWeek], int] = {}

    N = len(periods)

    # Initialize busy maps with existing locked slots or slots from other divisions
    for slot in existing_slots:
        slot_start = _to_seconds(slot.start_time)
        for p_idx, p in enumerate(periods, start=1):
            if p.start_seconds == slot_start:
                busy_teachers.setdefault((slot.day_of_week, p_idx), set()).add(slot.teacher_id)
                busy_rooms.setdefault((slot.day_of_week, p_idx), set()).add(slot.room_id)
                busy_divisions.setdefault((slot.day_of_week, p_idx), set()).add(slot.division_id)
                teacher_day_load[(slot.teacher_id, slot.day_of_week)] = (
                    teacher_day_load.get((slot.teacher_id, slot.day_of_week), 0) + 1
                )
                if (
                    slot.is_lab
                    and p_idx < N
                    and periods[p_idx - 1].end_seconds == periods[p_idx].start_seconds
                ):
                    busy_teachers.setdefault((slot.day_of_week, p_idx + 1), set()).add(slot.teacher_id)
                    busy_rooms.setdefault((slot.day_of_week, p_idx + 1), set()).add(slot.room_id)
                    busy_divisions.setdefault((slot.day_of_week, p_idx + 1), set()).add(slot.division_id)
                    teacher_day_load[(slot.teacher_id, slot.day_of_week)] = (
                        teacher_day_load.get((slot.teacher_id, slot.day_of_week), 0) + 1
                    )
                break

    plans: list[_SlotPlan] = []

    # Step 4: The Global Loop over division_ids
    for div_id in division_ids:
        div = division_map[div_id]
        div_batches = division_batches.get(div_id, [])

        # Filter and sort units for this division: LABs first, then hardest to place first
        div_units = [u for u in sorted_units if u.division_id == div_id]
        div_units.sort(
            key=lambda u: (
                0 if u.is_lab else 1,
                u.eligible_teacher_count,
                u.subject_id,
            )
        )

        for unit in div_units:
            placed = False

            # Search for a slot starting from Period 1 to Period N (to eliminate gaps)
            for period_idx in range(1, N + 1):
                if placed:
                    break

                if unit.is_lab:
                    # Lab blocks require 2 consecutive periods
                    if period_idx >= N:
                        continue
                    p1 = periods[period_idx - 1]
                    p2 = periods[period_idx]
                    # Ensure period + 1 isn't the lunch break (must be contiguous on the clock)
                    if p1.end_seconds != p2.start_seconds:
                        continue

                for day in school_days:
                    if placed:
                        break

                    # Check 1: Division Conflict
                    if unit.division_id in busy_divisions.get((day, period_idx), set()):
                        continue
                    if unit.is_lab and unit.division_id in busy_divisions.get((day, period_idx + 1), set()):
                        continue

                    if unit.is_lab:
                        # Check 2: Lab Logic (2 consecutive periods in the SAME room)
                        p_indices = [period_idx, period_idx + 1]
                        p_objs = [periods[period_idx - 1], periods[period_idx]]
                        lab_room_candidates = _get_lab_room_candidates(unit.subject_id, div, rooms, subject_rooms)

                        if div_batches:
                            # Parallel lab block for all batches of the division (H5 batch tri-parallel rule)
                            batch_assignments: list[tuple[int, int, int]] = []
                            taken_teachers_this_block: set[int] = set()
                            taken_rooms_this_block: set[int] = set()
                            feasible = True

                            for batch in div_batches:
                                eligible_ts = (
                                    batch_teachers.get((unit.subject_id, batch.id))
                                    or division_teachers.get((unit.division_id, unit.subject_id), [])
                                )
                                valid_ts = [
                                    t_id
                                    for t_id in eligible_ts
                                    if t_id not in taken_teachers_this_block
                                    and all(t_id not in busy_teachers.get((day, p), set()) for p in p_indices)
                                    and _teacher_can_teach(
                                        active_teachers[t_id],
                                        day,
                                        p_objs,
                                        teacher_day_load.get((t_id, day), 0),
                                        slots_needed=2,
                                    )
                                ]
                                if not valid_ts:
                                    feasible = False
                                    break

                                picked_t = min(valid_ts, key=lambda t: teacher_day_load.get((t, day), 0))

                                # Must be free for BOTH periods in the SAME room
                                valid_rooms = [
                                    r_id
                                    for r_id in lab_room_candidates
                                    if r_id not in taken_rooms_this_block
                                    and all(r_id not in busy_rooms.get((day, p), set()) for p in p_indices)
                                ]
                                if not valid_rooms:
                                    feasible = False
                                    break

                                picked_r = valid_rooms[0]
                                taken_teachers_this_block.add(picked_t)
                                taken_rooms_this_block.add(picked_r)
                                batch_assignments.append((batch.id, picked_t, picked_r))

                            if not feasible:
                                continue

                            # Step 5: Placement & Immediate busy map update
                            for b_id, t_id, r_id in batch_assignments:
                                for p in p_indices:
                                    busy_teachers.setdefault((day, p), set()).add(t_id)
                                    busy_rooms.setdefault((day, p), set()).add(r_id)
                                    busy_divisions.setdefault((day, p), set()).add(unit.division_id)
                                teacher_day_load[(t_id, day)] = teacher_day_load.get((t_id, day), 0) + 2

                                for p_obj in p_objs:
                                    plans.append(
                                        _SlotPlan(
                                            division_id=unit.division_id,
                                            batch_id=b_id,
                                            subject_id=unit.subject_id,
                                            teacher_id=t_id,
                                            room_id=r_id,
                                            day=day,
                                            start=_from_seconds(p_obj.start_seconds),
                                            end=_from_seconds(p_obj.end_seconds),
                                            is_lab=True,
                                        )
                                    )
                            placed = True
                            break

                        else:
                            # Division has no batches: assign lab to entire division
                            eligible_ts = division_teachers.get((unit.division_id, unit.subject_id), [])
                            valid_ts = [
                                t_id
                                for t_id in eligible_ts
                                if all(t_id not in busy_teachers.get((day, p), set()) for p in p_indices)
                                and _teacher_can_teach(
                                    active_teachers[t_id],
                                    day,
                                    p_objs,
                                    teacher_day_load.get((t_id, day), 0),
                                    slots_needed=2,
                                )
                            ]
                            if not valid_ts:
                                continue

                            picked_t = min(valid_ts, key=lambda t: teacher_day_load.get((t, day), 0))

                            valid_rooms = [
                                r_id
                                for r_id in lab_room_candidates
                                if all(r_id not in busy_rooms.get((day, p), set()) for p in p_indices)
                            ]
                            if not valid_rooms:
                                continue

                            picked_r = valid_rooms[0]

                            # Step 5: Placement & Immediate busy map update
                            for p in p_indices:
                                busy_teachers.setdefault((day, p), set()).add(picked_t)
                                busy_rooms.setdefault((day, p), set()).add(picked_r)
                                busy_divisions.setdefault((day, p), set()).add(unit.division_id)
                            teacher_day_load[(picked_t, day)] = teacher_day_load.get((picked_t, day), 0) + 2

                            for p_obj in p_objs:
                                plans.append(
                                    _SlotPlan(
                                        division_id=unit.division_id,
                                        batch_id=None,
                                        subject_id=unit.subject_id,
                                        teacher_id=picked_t,
                                        room_id=picked_r,
                                        day=day,
                                        start=_from_seconds(p_obj.start_seconds),
                                        end=_from_seconds(p_obj.end_seconds),
                                        is_lab=True,
                                    )
                                )
                            placed = True
                            break

                    else:
                        # Theory or Tutorial: 1 period
                        p_obj = periods[period_idx - 1]
                        eligible_ts = division_teachers.get((unit.division_id, unit.subject_id), [])
                        valid_ts = [
                            t_id
                            for t_id in eligible_ts
                            if t_id not in busy_teachers.get((day, period_idx), set())
                            and _teacher_can_teach(
                                active_teachers[t_id],
                                day,
                                [p_obj],
                                teacher_day_load.get((t_id, day), 0),
                                slots_needed=1,
                            )
                        ]
                        if not valid_ts:
                            continue

                        picked_t = min(valid_ts, key=lambda t: teacher_day_load.get((t, day), 0))

                        lecture_room_candidates = _get_lecture_room_candidates(div, rooms)
                        valid_rooms = [
                            r_id
                            for r_id in lecture_room_candidates
                            if r_id not in busy_rooms.get((day, period_idx), set())
                        ]
                        if not valid_rooms:
                            continue

                        picked_r = valid_rooms[0]

                        # Step 5: Placement & Immediate busy map update
                        busy_teachers.setdefault((day, period_idx), set()).add(picked_t)
                        busy_rooms.setdefault((day, period_idx), set()).add(picked_r)
                        busy_divisions.setdefault((day, period_idx), set()).add(unit.division_id)
                        teacher_day_load[(picked_t, day)] = teacher_day_load.get((picked_t, day), 0) + 1

                        plans.append(
                            _SlotPlan(
                                division_id=unit.division_id,
                                batch_id=None,
                                subject_id=unit.subject_id,
                                teacher_id=picked_t,
                                room_id=picked_r,
                                day=day,
                                start=_from_seconds(p_obj.start_seconds),
                                end=_from_seconds(p_obj.end_seconds),
                                is_lab=False,
                            )
                        )
                        placed = True
                        break

    return plans


async def generate_timetable(
    db: AsyncSession,
    division_ids: list[int] | int,
) -> list[TimetableSlot]:
    """Generate timetables for one or more divisions using the global solver."""
    if isinstance(division_ids, int):
        division_ids = [division_ids]
    else:
        division_ids = list(dict.fromkeys(division_ids))

    if not division_ids:
        return []

    # Step 1: Data Loading - fetch all requirements, eligibilities, rooms, subjects for ALL division_ids
    divisions = list(
        (await db.execute(select(Division).where(Division.id.in_(division_ids)))).scalars().all()
    )
    found_ids = {d.id for d in divisions}
    for did in division_ids:
        if did not in found_ids:
            raise NotFoundError("Division", did)
    division_map = {d.id: d for d in divisions}

    settings = (
        await db.execute(select(TimetableSettings).order_by(TimetableSettings.id.desc()).limit(1))
    ).scalar_one_or_none()
    if settings is None:
        raise NotFoundError("TimetableSettings", 0)

    batches = list(
        (await db.execute(select(Batch).where(Batch.division_id.in_(division_ids)))).scalars().all()
    )
    division_batches: dict[int, list[Batch]] = {}
    for b in batches:
        division_batches.setdefault(b.division_id, []).append(b)

    requirements = list(
        (
            await db.execute(
                select(WeeklyRequirement).where(WeeklyRequirement.division_id.in_(division_ids))
            )
        )
        .scalars()
        .all()
    )

    eligibilities = list(
        (
            await db.execute(
                select(TeacherSubjectDivision).where(
                    TeacherSubjectDivision.division_id.in_(division_ids)
                )
            )
        )
        .scalars()
        .all()
    )

    eligible_teacher_ids = {e.teacher_id for e in eligibilities}
    teachers: list[Teacher] = []
    if eligible_teacher_ids:
        teachers = list(
            (await db.execute(select(Teacher).where(Teacher.id.in_(sorted(eligible_teacher_ids)))))
            .scalars()
            .all()
        )
    active_teachers = {t.id: t for t in teachers if t.status == TeacherStatus.ACTIVE}

    division_teachers: dict[tuple[int, int], list[int]] = {}
    batch_teachers: dict[tuple[int, int], list[int]] = {}
    for e in eligibilities:
        if e.teacher_id not in active_teachers:
            continue
        if e.batch_id is None:
            division_teachers.setdefault((e.division_id, e.subject_id), []).append(e.teacher_id)
        else:
            batch_teachers.setdefault((e.subject_id, e.batch_id), []).append(e.teacher_id)

    rooms = list((await db.execute(select(Room))).scalars().all())
    room_ids = [r.id for r in rooms]
    subject_rooms: dict[int, list[int]] = {}
    if room_ids:
        links = list(
            (await db.execute(select(RoomSubject).where(RoomSubject.room_id.in_(room_ids))))
            .scalars()
            .all()
        )
        for link in links:
            subject_rooms.setdefault(link.subject_id, []).append(link.room_id)

    existing_slots = list(
        (
            await db.execute(
                select(TimetableSlot).where(
                    (~TimetableSlot.division_id.in_(division_ids)) | (TimetableSlot.locked.is_(True))
                )
            )
        )
        .scalars()
        .all()
    )

    periods = _build_periods(settings)
    school_days: list[DayOfWeek] = []
    for day_str in settings.school_days:
        try:
            school_days.append(DayOfWeek(day_str))
        except ValueError:
            pass
    if not school_days:
        school_days = [
            DayOfWeek.MONDAY,
            DayOfWeek.TUESDAY,
            DayOfWeek.WEDNESDAY,
            DayOfWeek.THURSDAY,
            DayOfWeek.FRIDAY,
        ]

    # Step 3: Global Sorting
    # Build list of schedulable units across requirements
    units: list[_SchedulableUnit] = []
    for req in requirements:
        eligible_t_ids = set(division_teachers.get((req.division_id, req.subject_id), []))
        for batch in division_batches.get(req.division_id, []):
            for t_id in batch_teachers.get((req.subject_id, batch.id), []):
                eligible_t_ids.add(t_id)
        count = len(eligible_t_ids)

        for _ in range(req.practical_sessions_per_week):
            units.append(
                _SchedulableUnit(
                    division_id=req.division_id,
                    subject_id=req.subject_id,
                    is_lab=True,
                    kind="lab",
                    eligible_teacher_count=count,
                )
            )
        for _ in range(req.theory_periods_per_week):
            units.append(
                _SchedulableUnit(
                    division_id=req.division_id,
                    subject_id=req.subject_id,
                    is_lab=False,
                    kind="theory",
                    eligible_teacher_count=count,
                )
            )
        for _ in range(req.tutorial_periods_per_week):
            units.append(
                _SchedulableUnit(
                    division_id=req.division_id,
                    subject_id=req.subject_id,
                    is_lab=False,
                    kind="tutorial",
                    eligible_teacher_count=count,
                )
            )

    units.sort(
        key=lambda u: (
            0 if u.is_lab else 1,
            u.eligible_teacher_count,
            u.division_id,
            u.subject_id,
        )
    )

    # Run solver in worker thread so FastAPI event loop is never blocked
    plans = await asyncio.to_thread(
        _solve_global,
        division_ids,
        division_map,
        division_batches,
        periods,
        school_days,
        units,
        division_teachers,
        batch_teachers,
        active_teachers,
        rooms,
        subject_rooms,
        existing_slots,
    )

    # Step 6: Save - delete existing unlocked slots and persist generated slots
    await db.execute(
        delete(TimetableSlot).where(
            TimetableSlot.division_id.in_(division_ids),
            TimetableSlot.locked.is_(False),
        )
    )

    final_slots = [
        TimetableSlot(
            division_id=plan.division_id,
            batch_id=plan.batch_id,
            subject_id=plan.subject_id,
            teacher_id=plan.teacher_id,
            room_id=plan.room_id,
            day_of_week=plan.day,
            start_time=plan.start,
            end_time=plan.end,
            is_lab=plan.is_lab,
            locked=False,
        )
        for plan in plans
    ]

    if final_slots:
        db.add_all(final_slots)
    await db.commit()
    print(f"Successfully generated and saved {len(final_slots)} slots for {len(division_ids)} divisions.")
    return final_slots


async def list_slots(db: AsyncSession, division_id: int) -> list[TimetableSlot]:
    """Return the stored slots of a division, ordered by day and start time."""
    result = await db.execute(
        select(TimetableSlot)
        .where(TimetableSlot.division_id == division_id)
        .order_by(TimetableSlot.day_of_week, TimetableSlot.start_time, TimetableSlot.id)
    )
    return list(result.scalars().all())


async def apply_slot_override(
    db: AsyncSession,
    slot_id: int,
    teacher_id: int | None,
    room_id: int | None,
) -> TimetableSlot:
    """Apply a manual teacher/room override to a slot and lock it."""
    slot = await db.get(TimetableSlot, slot_id)
    if slot is None:
        raise NotFoundError("TimetableSlot", slot_id)
    if teacher_id is not None:
        slot.teacher_id = teacher_id
    if room_id is not None:
        slot.room_id = room_id
    slot.locked = True
    await db.commit()
    await db.refresh(slot)
    return slot
