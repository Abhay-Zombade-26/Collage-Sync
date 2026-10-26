"""Shared data loading and context for timetable generation and diagnostics."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import time

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.batch import Batch
from app.models.division import Division
from app.models.eligibility import TeacherSubjectDivision
from app.models.enums import DayOfWeek, RoomType
from app.models.room import Room
from app.models.room_subject import RoomSubject
from app.models.subject import Subject
from app.models.teacher import Teacher
from app.models.timetable_settings import TimetableSettings
from app.models.timetable_slot import TimetableSlot
from app.models.weekly_requirement import WeeklyRequirement


# ---------------------------------------------------------------------------
# Helper data-classes
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _Period:
    """One teaching period with clock boundaries (in seconds-since-midnight)."""
    index: int          # 1-based period number
    start_seconds: int
    end_seconds: int


# ---------------------------------------------------------------------------
# Clock and period utilities
# ---------------------------------------------------------------------------

def _to_seconds(value: time) -> int:
    return value.hour * 3600 + value.minute * 60 + value.second


def _from_seconds(total: int) -> time:
    total %= 86400
    hours, rest = divmod(total, 3600)
    minutes, seconds = divmod(rest, 60)
    return time(hours, minutes, seconds)


def _build_periods(settings: TimetableSettings) -> list[_Period]:
    """Compute candidate period boundaries for each school day."""
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
        periods.append(
            _Period(index=idx, start_seconds=cursor, end_seconds=cursor + period_seconds)
        )
        idx += 1
        cursor += period_seconds

    # Resume after lunch break
    cursor = max(cursor, lunch_end)
    while cursor + period_seconds <= end_seconds:
        periods.append(
            _Period(index=idx, start_seconds=cursor, end_seconds=cursor + period_seconds)
        )
        idx += 1
        cursor += period_seconds

    # Fallback if no periods were constructed due to zero length / mismatch
    if not periods:
        cursor = start_seconds
        while cursor + period_seconds <= end_seconds:
            periods.append(
                _Period(index=idx, start_seconds=cursor, end_seconds=cursor + period_seconds)
            )
            idx += 1
            cursor += period_seconds

    return periods


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


# ---------------------------------------------------------------------------
# Generation Context
# ---------------------------------------------------------------------------

@dataclass
class GenerationContext:
    division_ids: list[int]
    division_map: dict[int, Division]
    division_batches: dict[int, list[Batch]]
    settings: TimetableSettings
    requirements: list[WeeklyRequirement]
    subject_map: dict[int, Subject]
    teacher_subject_divisions: list[TeacherSubjectDivision]   # ALL rows, not pre-filtered
    teachers: dict[int, Teacher]                               # ALL teachers referenced by any eligibility row touching these divisions
    rooms: list[Room]
    room_subjects: list[RoomSubject]
    school_days: list[DayOfWeek]
    periods: list[_Period]
    existing_slots: list[TimetableSlot]

    @property
    def subject_rooms(self) -> dict[int, list[int]]:
        """Map each subject_id to candidate room_ids from room_subjects."""
        mapping: dict[int, list[int]] = {}
        room_ids = {r.id for r in self.rooms}
        for rs in self.room_subjects:
            if rs.room_id in room_ids:
                mapping.setdefault(rs.subject_id, []).append(rs.room_id)
        return mapping


async def load_generation_context(
    db: AsyncSession,
    division_ids: list[int] | int,
) -> GenerationContext:
    """Load all database models and timetable settings required for generation and diagnostics."""
    if isinstance(division_ids, int):
        norm_division_ids = [division_ids]
    else:
        norm_division_ids = list(dict.fromkeys(division_ids))

    if not norm_division_ids:
        raise ValueError("No division IDs provided for timetable generation.")

    # 1. Divisions
    divisions = list(
        (await db.execute(select(Division).where(Division.id.in_(norm_division_ids))))
        .scalars()
        .all()
    )
    found_ids = {d.id for d in divisions}
    for did in norm_division_ids:
        if did not in found_ids:
            raise NotFoundError("Division", did)
    division_map = {d.id: d for d in divisions}

    # 2. Timetable settings
    settings = (
        await db.execute(
            select(TimetableSettings).order_by(TimetableSettings.id.desc()).limit(1)
        )
    ).scalar_one_or_none()
    if settings is None:
        raise NotFoundError("TimetableSettings", 0)

    # 3. Batches
    batches = list(
        (await db.execute(select(Batch).where(Batch.division_id.in_(norm_division_ids))))
        .scalars()
        .all()
    )
    division_batches: dict[int, list[Batch]] = {}
    for b in batches:
        division_batches.setdefault(b.division_id, []).append(b)

    # 4. Weekly requirements
    requirements = list(
        (
            await db.execute(
                select(WeeklyRequirement).where(
                    WeeklyRequirement.division_id.in_(norm_division_ids)
                )
            )
        )
        .scalars()
        .all()
    )

    # 5. Teacher-subject-division eligibility (all rows)
    teacher_subject_divisions = list(
        (await db.execute(select(TeacherSubjectDivision))).scalars().all()
    )

    # 6. Teachers: load ALL teachers referenced by eligibility rows touching these divisions
    eligibilities_for_divisions = [
        e for e in teacher_subject_divisions if e.division_id in norm_division_ids
    ]
    eligible_teacher_ids = {e.teacher_id for e in eligibilities_for_divisions}
    teachers: dict[int, Teacher] = {}
    if eligible_teacher_ids:
        loaded_teachers = list(
            (
                await db.execute(
                    select(Teacher).where(Teacher.id.in_(sorted(eligible_teacher_ids)))
                )
            )
            .scalars()
            .all()
        )
        teachers = {t.id: t for t in loaded_teachers}

    # 7. Subjects
    subjects = list((await db.execute(select(Subject))).scalars().all())
    subject_map = {s.id: s for s in subjects}

    # 8. Rooms and Room-Subject links
    rooms = list((await db.execute(select(Room))).scalars().all())
    room_subjects = list((await db.execute(select(RoomSubject))).scalars().all())

    # 9. School days and periods
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

    periods = _build_periods(settings)

    # 10. Existing locked slots or slots from other divisions
    existing_slots = list(
        (
            await db.execute(
                select(TimetableSlot).where(
                    (~TimetableSlot.division_id.in_(norm_division_ids))
                    | (TimetableSlot.locked.is_(True))
                )
            )
        )
        .scalars()
        .all()
    )

    return GenerationContext(
        division_ids=norm_division_ids,
        division_map=division_map,
        division_batches=division_batches,
        settings=settings,
        requirements=requirements,
        subject_map=subject_map,
        teacher_subject_divisions=teacher_subject_divisions,
        teachers=teachers,
        rooms=rooms,
        room_subjects=room_subjects,
        school_days=school_days,
        periods=periods,
        existing_slots=existing_slots,
    )
