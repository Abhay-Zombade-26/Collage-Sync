"""Pre-flight diagnostic checks for timetable generation.

Performs audit checks prior to invoking the CP-SAT solver:
1. Division Capacity Check
2. Teacher Overload Check
3. Subject Teacher Shortage Check
4. Lab Room Shortage (The Batch Trap)
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.batch import Batch
from app.models.division import Division
from app.models.eligibility import TeacherSubjectDivision
from app.models.enums import RoomType
from app.models.room import Room
from app.models.room_subject import RoomSubject
from app.models.subject import Subject
from app.models.teacher import Teacher
from app.models.timetable_settings import TimetableSettings
from app.models.weekly_requirement import WeeklyRequirement


def _calculate_available_slots_per_day(settings: TimetableSettings) -> int:
    """Calculate daily available teaching slots: total_periods_per_day - 1 (for lunch)."""
    start_sec = (
        settings.start_time.hour * 3600
        + settings.start_time.minute * 60
        + settings.start_time.second
    )
    end_sec = (
        settings.end_time.hour * 3600
        + settings.end_time.minute * 60
        + settings.end_time.second
    )
    total_minutes = (end_sec - start_sec) // 60
    teaching_minutes = total_minutes - settings.lunch_minutes
    teaching_periods = teaching_minutes // settings.period_minutes
    return max(teaching_periods, 1)


async def run_pre_flight_check(
    db: AsyncSession,
    division_ids: list[int] | int,
    settings: TimetableSettings,
) -> None:
    """Audit input data for the selected divisions and raise ValueError if unfeasible."""
    if isinstance(division_ids, int):
        division_ids = [division_ids]
    else:
        division_ids = list(dict.fromkeys(division_ids))

    if not division_ids:
        return

    errors: list[str] = []

    # 1. Fetch relevant models for the selected divisions
    divisions = list(
        (await db.execute(select(Division).where(Division.id.in_(division_ids))))
        .scalars()
        .all()
    )

    batches = list(
        (await db.execute(select(Batch).where(Batch.division_id.in_(division_ids))))
        .scalars()
        .all()
    )
    division_batches: dict[int, list[Batch]] = {}
    for b in batches:
        division_batches.setdefault(b.division_id, []).append(b)

    requirements = list(
        (
            await db.execute(
                select(WeeklyRequirement).where(
                    WeeklyRequirement.division_id.in_(division_ids)
                )
            )
        )
        .scalars()
        .all()
    )
    req_map = {(r.division_id, r.subject_id): r for r in requirements}

    subjects = list((await db.execute(select(Subject))).scalars().all())
    subject_map = {s.id: s for s in subjects}

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

    teachers = list((await db.execute(select(Teacher))).scalars().all())
    teacher_map = {t.id: t for t in teachers}

    rooms = list((await db.execute(select(Room))).scalars().all())
    room_map = {r.id: r for r in rooms}

    room_subjects = list((await db.execute(select(RoomSubject))).scalars().all())

    school_days_count = len(settings.school_days) if settings.school_days else 5
    available_slots_per_day = _calculate_available_slots_per_day(settings)
    available_division_slots = school_days_count * available_slots_per_day

    # -----------------------------------------------------------------------
    # 1. Division Capacity Check:
    #    For each division, sum theory_periods_per_week + (practical_sessions_per_week * 2)
    #    available slots = len(settings.school_days) * (total_periods_per_day - 1)
    # -----------------------------------------------------------------------
    for division in divisions:
        div_reqs = [r for r in requirements if r.division_id == division.id]
        required = sum(
            (r.theory_periods_per_week or 0)
            + ((r.practical_sessions_per_week or 0) * 2)
            for r in div_reqs
        )
        if required > available_division_slots:
            errors.append(
                f"Grid Overload: {division.name} requires {required} periods/week, but the grid only has {available_division_slots} slots."
            )

    # -----------------------------------------------------------------------
    # 2. Teacher Overload Check:
    #    Build teacher_demand: Sum all periods (theory + labs) assigned to each teacher_id
    #    Build teacher_capacity: max_lectures_per_day * len(settings.school_days)
    # -----------------------------------------------------------------------
    teacher_demand: dict[int, int] = {}
    has_batch_eligs: set[tuple[int, int]] = {
        (e.division_id, e.subject_id)
        for e in eligibilities
        if e.batch_id is not None
    }

    for e in eligibilities:
        req = req_map.get((e.division_id, e.subject_id))
        if not req:
            continue
        if e.batch_id is not None:
            periods = (req.practical_sessions_per_week or 0) * 2
        else:
            theory_periods = req.theory_periods_per_week or 0
            lab_periods = 0
            if (e.division_id, e.subject_id) not in has_batch_eligs:
                lab_periods = (req.practical_sessions_per_week or 0) * 2
            periods = theory_periods + lab_periods

        teacher_demand[e.teacher_id] = (
            teacher_demand.get(e.teacher_id, 0) + periods
        )

    for teacher_id, demand in teacher_demand.items():
        teacher = teacher_map.get(teacher_id)
        teacher_name = teacher.name if teacher else f"Teacher #{teacher_id}"
        max_per_day = (
            teacher.max_lectures_per_day
            if (teacher and teacher.max_lectures_per_day is not None)
            else 6
        )
        capacity = max_per_day * school_days_count
        if demand > capacity:
            errors.append(
                f"Teacher Overload: {teacher_name} is assigned {demand} periods/week but can only teach {capacity} periods/week. Please reassign some of their subjects."
            )

    # -----------------------------------------------------------------------
    # 3. Subject Teacher Shortage Check:
    #    Group requirements by subject_id. Calculate total_required_hours.
    #    Calculate total_available_capacity across all teachers mapped to subject.
    # -----------------------------------------------------------------------
    subject_reqs: dict[int, list[WeeklyRequirement]] = {}
    for req in requirements:
        subject_reqs.setdefault(req.subject_id, []).append(req)

    for subject_id, reqs in subject_reqs.items():
        required = sum(
            (r.theory_periods_per_week or 0)
            + ((r.practical_sessions_per_week or 0) * 2)
            for r in reqs
        )
        mapped_teacher_ids = {
            e.teacher_id for e in eligibilities if e.subject_id == subject_id
        }
        available = sum(
            (
                teacher_map[t_id].max_lectures_per_day
                if (
                    teacher_map.get(t_id)
                    and teacher_map[t_id].max_lectures_per_day is not None
                )
                else 6
            )
            * school_days_count
            for t_id in mapped_teacher_ids
        )
        if required > available:
            missing_hours = required - available
            subject = subject_map.get(subject_id)
            subject_name = subject.name if subject else f"Subject #{subject_id}"
            errors.append(
                f"Subject Shortage: '{subject_name}' requires {required} total periods across the selected divisions, but the assigned teachers can only cover {available} periods. (Short by {missing_hours} periods). Please map more teachers to '{subject_name}'."
            )

    # -----------------------------------------------------------------------
    # 4. Lab Room Shortage (The Batch Trap):
    #    For each LAB subject, find max batches in any single division taking it.
    #    Count number of Lab Rooms mapped to that subject via room_subjects.
    # -----------------------------------------------------------------------
    for subject_id, reqs in subject_reqs.items():
        subject = subject_map.get(subject_id)
        is_lab = (
            (subject is not None and subject.subject_type.upper() == "LAB")
            or any((r.practical_sessions_per_week or 0) > 0 for r in reqs)
        )
        if not is_lab:
            continue

        lab_reqs = [
            r
            for r in reqs
            if (r.practical_sessions_per_week or 0) > 0
            or (subject and subject.subject_type.upper() == "LAB")
        ]
        if not lab_reqs:
            continue

        max_batches = max(
            (len(division_batches.get(r.division_id, [])) or 1)
            for r in lab_reqs
        )

        mapped_room_ids = {
            rs.room_id for rs in room_subjects if rs.subject_id == subject_id
        }
        available_lab_rooms = sum(
            1
            for r_id in mapped_room_ids
            if room_map.get(r_id) and room_map[r_id].room_type == RoomType.LAB
        )

        if max_batches > available_lab_rooms:
            subject_name = subject.name if subject else f"Subject #{subject_id}"
            errors.append(
                f"Lack of Lab Rooms: '{subject_name}' needs {max_batches} simultaneous lab rooms (for batches), but only {available_lab_rooms} room(s) are mapped to it."
            )

    # -----------------------------------------------------------------------
    # 5. Raise ValueError if any errors found
    # -----------------------------------------------------------------------
    if errors:
        raise ValueError("Pre-Flight Check Failed:\n\n" + "\n\n".join(errors))
