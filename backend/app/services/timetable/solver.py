"""Heuristic (greedy) timetable generator — Phase 4 placeholder for CP-SAT.

The placement itself is CPU-bound, so it runs in a worker thread via
``asyncio.to_thread`` and the event loop is never blocked (AGENTS.md). All
database access stays async and happens on the event loop.

Hard constraints enforced here (docs/SPEC.md constraint table):
  H1  teacher no double-booking
  H2  room no double-booking
  H3  lab = exactly 2 consecutive period-slots, same room, same teacher
  H4  lab room-type match (lab -> LAB room, theory -> LECTURE room)
  H5  batch tri-parallel rule (a lab slot is division-wide: every batch labs
      in the same time block, never a partial split against division theory)
  H6  no batch overlap (one lab block per time block)
  H7  weekly subject quota (from WeeklyRequirement rows)
  H10 visiting faculty availability (only for employment_type == VISITING)
  H11 teacher daily lecture cap
"""

import asyncio
import random
from dataclasses import dataclass, field
from datetime import time
from typing import Literal

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.batch import Batch
from app.models.division import Division
from app.models.eligibility import TeacherSubjectDivision
from app.models.enums import DayOfWeek, EmploymentType, RoomType, TeacherStatus
from app.models.room import Room
from app.models.room_subject import RoomSubject
from app.models.teacher import Teacher
from app.models.timetable_settings import TimetableSettings
from app.models.timetable_slot import TimetableSlot
from app.models.weekly_requirement import WeeklyRequirement

# Fixed seed keeps a given input set reproducible across runs.
_RANDOM_SEED = 20260201

UnitKind = Literal["theory", "tutorial", "lab"]


@dataclass(frozen=True)
class _Period:
    start_seconds: int
    end_seconds: int


@dataclass(frozen=True)
class _Day:
    day: DayOfWeek
    periods: list[_Period]


@dataclass(frozen=True)
class _Unit:
    subject_id: int
    kind: UnitKind


@dataclass(frozen=True)
class _SlotPlan:
    batch_id: int | None
    subject_id: int
    teacher_id: int
    room_id: int
    day: DayOfWeek
    start: time
    end: time
    is_lab: bool


@dataclass
class _Context:
    """Plain data needed by the solver — no ORM objects, no session access."""

    division_id: int
    days: list[_Day]
    batch_ids: list[int]
    units: list[_Unit]
    # subject_id -> teacher ids eligible division-wide (batch_id is NULL)
    division_teachers: dict[int, list[int]]
    # (subject_id, batch_id) -> teacher ids eligible for that batch
    batch_teachers: dict[tuple[int, int], list[int]]
    lecture_room_ids: list[int]
    lab_room_ids: list[int]
    all_room_ids: list[int]
    # subject_id -> room ids that can host that subject. Only populated for
    # subjects explicitly linked to a room through the room_subjects table.
    subject_rooms: dict[int, list[int]]
    # teacher_id -> daily lecture cap
    teacher_day_cap: dict[int, int]
    # teacher_id -> (available day names, available start, available end);
    # only populated for VISITING teachers so REGULAR is never affected.
    visiting: dict[int, tuple[list[str], time | None, time | None]]
    # locked (day_idx, period_idx, teacher_id, room_id) already occupies time
    # The factory is explicitly parameterized: a bare `default_factory=list`
    # makes pyright infer the field type as `list[Unknown]`.
    locked_occupancy: list[tuple[int, int, int, int]] = field(
        default_factory=lambda: list[tuple[int, int, int, int]]()
    )


def _to_seconds(value: time) -> int:
    return value.hour * 3600 + value.minute * 60 + value.second


def _from_seconds(total: int) -> time:
    total %= 86400
    hours, rest = divmod(total, 3600)
    minutes, seconds = divmod(rest, 60)
    return time(hours, minutes, seconds)


def _build_days(settings: TimetableSettings) -> list[_Day]:
    """Compute the candidate period boundaries for every school day.

    Periods are laid out from start_time in period_minutes steps. Any period
    overlapping the admin-picked lunch window is dropped (constraint H-lunch:
    the lunch slot is blocked globally).
    """
    period_seconds = settings.period_minutes * 60
    start_seconds = _to_seconds(settings.start_time)
    end_seconds = _to_seconds(settings.end_time)
    lunch_start = _to_seconds(settings.lunch_start)
    lunch_end = lunch_start + settings.lunch_minutes * 60

    days: list[_Day] = []
    for day_name in settings.school_days:
        try:
            day = DayOfWeek(day_name)
        except ValueError:
            continue
        periods: list[_Period] = []
        cursor = start_seconds
        while cursor < end_seconds:
            period_end = min(cursor + period_seconds, end_seconds)
            overlaps_lunch = cursor < lunch_end and lunch_start < period_end
            if not overlaps_lunch:
                periods.append(_Period(cursor, period_end))
            cursor += period_seconds
        days.append(_Day(day=day, periods=periods))
    return days


async def _load_context(db: AsyncSession, division_id: int) -> _Context:
    """Fetch everything the solver needs in a single async pass."""
    division = await db.get(Division, division_id)
    if division is None:
        raise NotFoundError("Division", division_id)

    settings = (
        await db.execute(select(TimetableSettings).order_by(TimetableSettings.id.desc()).limit(1))
    ).scalar_one_or_none()
    if settings is None:
        raise NotFoundError("TimetableSettings", 0)

    batches = list(
        (await db.execute(select(Batch).where(Batch.division_id == division_id))).scalars().all()
    )
    requirements = list(
        (
            await db.execute(
                select(WeeklyRequirement).where(WeeklyRequirement.division_id == division_id)
            )
        )
        .scalars()
        .all()
    )
    eligibilities = list(
        (
            await db.execute(
                select(TeacherSubjectDivision).where(
                    TeacherSubjectDivision.division_id == division_id
                )
            )
        )
        .scalars()
        .all()
    )
    # Rooms now belong to a branch and an academic year rather than to a
    # division. A room is usable by this division when it is in the same
    # branch and year, or when it is not pinned to a branch/year yet.
    rooms = list(
        (
            await db.execute(
                select(Room).where(
                    (Room.branch_id == division.branch_id) | (Room.branch_id.is_(None)),
                    (Room.year == division.year) | (Room.year.is_(None)),
                )
            )
        )
        .scalars()
        .all()
    )

    # Which rooms can host which subject (many-to-many through room_subjects).
    # A lab subject may only be scheduled in a room that is linked to it.
    room_ids = [room.id for room in rooms]
    subject_rooms: dict[int, list[int]] = {}
    if room_ids:
        links = list(
            (
                await db.execute(
                    select(RoomSubject).where(RoomSubject.room_id.in_(room_ids))
                )
            )
            .scalars()
            .all()
        )
        for link in links:
            subject_rooms.setdefault(link.subject_id, []).append(link.room_id)

    division_teachers: dict[int, list[int]] = {}
    batch_teachers: dict[tuple[int, int], list[int]] = {}
    eligible_teacher_ids: set[int] = set()
    for row in eligibilities:
        eligible_teacher_ids.add(row.teacher_id)
        if row.batch_id is None:
            division_teachers.setdefault(row.subject_id, []).append(row.teacher_id)
        else:
            batch_teachers.setdefault((row.subject_id, row.batch_id), []).append(row.teacher_id)

    teachers: list[Teacher] = []
    if eligible_teacher_ids:
        teachers = list(
            (await db.execute(select(Teacher).where(Teacher.id.in_(sorted(eligible_teacher_ids)))))
            .scalars()
            .all()
        )
    # Only ACTIVE teachers may be scheduled; a PENDING/REJECTED teacher that
    # still has eligibility rows must never be picked.
    active_teachers = {t.id: t for t in teachers if t.status == TeacherStatus.ACTIVE}
    division_teachers = {
        subject_id: [t for t in ids if t in active_teachers]
        for subject_id, ids in division_teachers.items()
    }
    division_teachers = {k: v for k, v in division_teachers.items() if v}
    batch_teachers = {
        key: [t for t in ids if t in active_teachers] for key, ids in batch_teachers.items()
    }
    batch_teachers = {k: v for k, v in batch_teachers.items() if v}

    teacher_day_cap: dict[int, int] = {
        t.id: t.max_lectures_per_day for t in active_teachers.values()
    }
    visiting: dict[int, tuple[list[str], time | None, time | None]] = {}
    for t in active_teachers.values():
        if t.employment_type == EmploymentType.VISITING:
            visiting[t.id] = (list(t.available_days or []), t.available_start, t.available_end)

    days = _build_days(settings)
    period_index: dict[tuple[DayOfWeek, int], tuple[int, int]] = {}
    for day_idx, day in enumerate(days):
        for period_idx, period in enumerate(day.periods):
            period_index[(day.day, period.start_seconds)] = (day_idx, period_idx)

    locked_slots = list(
        (
            await db.execute(
                select(TimetableSlot).where(
                    TimetableSlot.division_id == division_id,
                    TimetableSlot.locked.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    locked_occupancy: list[tuple[int, int, int, int]] = []
    for slot in locked_slots:
        key = (slot.day_of_week, _to_seconds(slot.start_time))
        located = period_index.get(key)
        if located is None:
            continue
        day_idx, period_idx = located
        locked_occupancy.append((day_idx, period_idx, slot.teacher_id, slot.room_id))
        # A locked lab slot spans two consecutive periods; the second one must
        # also be treated as occupied, otherwise a re-generation could place
        # another class on top of it.
        if slot.is_lab and period_idx + 1 < len(days[day_idx].periods):
            next_period = days[day_idx].periods[period_idx + 1]
            if next_period.start_seconds == _to_seconds(slot.end_time):
                locked_occupancy.append((day_idx, period_idx + 1, slot.teacher_id, slot.room_id))

    units = _build_units(requirements, [b.id for b in batches])

    return _Context(
        division_id=division_id,
        days=days,
        batch_ids=[b.id for b in batches],
        units=units,
        division_teachers=division_teachers,
        batch_teachers=batch_teachers,
        lecture_room_ids=[r.id for r in rooms if r.room_type == RoomType.LECTURE],
        lab_room_ids=[r.id for r in rooms if r.room_type == RoomType.LAB],
        all_room_ids=[r.id for r in rooms],
        subject_rooms=subject_rooms,
        teacher_day_cap=teacher_day_cap,
        visiting=visiting,
        locked_occupancy=locked_occupancy,
    )


def _build_units(requirements: list[WeeklyRequirement], batch_ids: list[int]) -> list[_Unit]:
    """Expand weekly requirements into individual schedulable units.

    Labs are placed first: they need two consecutive period-slots, so they are
    the hardest to fit and should not be starved by theory units.
    """
    labs: list[_Unit] = []
    theory: list[_Unit] = []
    tutorials: list[_Unit] = []
    for req in requirements:
        for _ in range(req.practical_sessions_per_week):
            if batch_ids:
                labs.append(_Unit(subject_id=req.subject_id, kind="lab"))
        for _ in range(req.theory_periods_per_week):
            theory.append(_Unit(subject_id=req.subject_id, kind="theory"))
        for _ in range(req.tutorial_periods_per_week):
            tutorials.append(_Unit(subject_id=req.subject_id, kind="tutorial"))
    return labs + theory + tutorials


class _Planner:
    """Greedy placement over the prepared grid."""

    def __init__(self, ctx: _Context) -> None:
        self.ctx = ctx
        self.busy_division: set[tuple[int, int]] = set()
        self.busy_teachers: dict[tuple[int, int], set[int]] = {}
        self.busy_rooms: dict[tuple[int, int], set[int]] = {}
        self.teacher_day_load: dict[tuple[int, int], int] = {}
        for day_idx, period_idx, teacher_id, room_id in ctx.locked_occupancy:
            self._mark(day_idx, period_idx, teacher_id, room_id)

    # -- occupancy helpers -------------------------------------------------

    def _mark(self, day_idx: int, period_idx: int, teacher_id: int, room_id: int) -> None:
        self.busy_division.add((day_idx, period_idx))
        self.busy_teachers.setdefault((day_idx, period_idx), set()).add(teacher_id)
        self.busy_rooms.setdefault((day_idx, period_idx), set()).add(room_id)
        key = (teacher_id, day_idx)
        self.teacher_day_load[key] = self.teacher_day_load.get(key, 0) + 1

    def _division_free(self, day_idx: int, period_idx: int) -> bool:
        return (day_idx, period_idx) not in self.busy_division

    def _teacher_free(self, teacher_id: int, day_idx: int, period_indices: list[int]) -> bool:
        for period_idx in period_indices:
            if teacher_id in self.busy_teachers.get((day_idx, period_idx), set()):
                return False
        cap = self.ctx.teacher_day_cap.get(teacher_id)
        if cap is not None:
            load = self.teacher_day_load.get((teacher_id, day_idx), 0)
            if load + len(period_indices) > cap:
                return False
        return True

    def _room_free(self, room_id: int, day_idx: int, period_indices: list[int]) -> bool:
        for period_idx in period_indices:
            if room_id in self.busy_rooms.get((day_idx, period_idx), set()):
                return False
        return True

    def _teacher_works(self, teacher_id: int, day: DayOfWeek, periods: list[_Period]) -> bool:
        """Visiting-faculty availability — only applies to VISITING teachers."""
        info = self.ctx.visiting.get(teacher_id)
        if info is None:
            return True
        day_names, available_start, available_end = info
        if day.value not in day_names:
            return False
        if available_start is not None and periods[0].start_seconds < _to_seconds(available_start):
            return False
        if available_end is not None and periods[-1].end_seconds > _to_seconds(available_end):
            return False
        return True

    # -- eligibility helpers -----------------------------------------------

    def _teachers_for(self, subject_id: int, batch_id: int | None) -> list[int]:
        teachers = list(self.ctx.division_teachers.get(subject_id, []))
        if batch_id is not None:
            teachers.extend(self.ctx.batch_teachers.get((subject_id, batch_id), []))
        seen: set[int] = set()
        unique: list[int] = []
        for teacher_id in teachers:
            if teacher_id not in seen:
                seen.add(teacher_id)
                unique.append(teacher_id)
        return unique

    def _rooms_for(self, is_lab: bool, subject_id: int | None = None) -> list[int]:
        """Candidate rooms for a placement.

        A lab may only run in a LAB room that is explicitly linked to the
        subject being scheduled (lab equipment is subject-specific). A theory
        or tutorial period runs in a LECTURE room.
        """
        if is_lab and subject_id is not None:
            linked = self.ctx.subject_rooms.get(subject_id, [])
            # Only rooms that are both linked to the subject and of LAB type.
            candidates = [r for r in linked if r in set(self.ctx.lab_room_ids)]
            if candidates:
                return candidates
            # No linked LAB room for this subject: the lab cannot be placed
            # rather than being put in an unrelated room.
            return []
        preferred = self.ctx.lab_room_ids if is_lab else self.ctx.lecture_room_ids
        return list(preferred) if preferred else list(self.ctx.all_room_ids)

    # -- placement ----------------------------------------------------------

    def place_period(self, unit: _Unit, rng: random.Random) -> list[_SlotPlan]:
        """Place a single whole-division period (theory or tutorial)."""
        candidates: list[tuple[int, int]] = []
        for day_idx, day in enumerate(self.ctx.days):
            for period_idx in range(len(day.periods)):
                if self._division_free(day_idx, period_idx):
                    candidates.append((day_idx, period_idx))
        rng.shuffle(candidates)

        for day_idx, period_idx in candidates:
            day = self.ctx.days[day_idx]
            period = day.periods[period_idx]
            teachers = [
                t
                for t in self._teachers_for(unit.subject_id, None)
                if self._teacher_free(t, day_idx, [period_idx])
                and self._teacher_works(t, day.day, [period])
            ]
            if not teachers:
                continue
            rooms = [
                r
                for r in self._rooms_for(is_lab=False)
                if self._room_free(r, day_idx, [period_idx])
            ]
            if not rooms:
                continue
            teacher_id = rng.choice(teachers)
            room_id = rng.choice(rooms)
            self._mark(day_idx, period_idx, teacher_id, room_id)
            return [
                _SlotPlan(
                    batch_id=None,
                    subject_id=unit.subject_id,
                    teacher_id=teacher_id,
                    room_id=room_id,
                    day=day.day,
                    start=_from_seconds(period.start_seconds),
                    end=_from_seconds(period.end_seconds),
                    is_lab=False,
                )
            ]
        return []

    def place_lab(self, unit: _Unit, rng: random.Random) -> list[_SlotPlan]:
        """Place a lab block: 2 consecutive periods for every batch, in parallel."""
        candidates: list[tuple[int, int]] = []
        for day_idx, day in enumerate(self.ctx.days):
            for period_idx in range(len(day.periods) - 1):
                first = day.periods[period_idx]
                second = day.periods[period_idx + 1]
                # the two periods must be adjacent on the clock, not merely
                # adjacent in the list (a lunch gap breaks the adjacency)
                if first.end_seconds != second.start_seconds:
                    continue
                # a lab is exactly 2 consecutive equal-length periods (SPEC H3)
                if first.end_seconds - first.start_seconds != (
                    second.end_seconds - second.start_seconds
                ):
                    continue
                if not self._division_free(day_idx, period_idx):
                    continue
                if not self._division_free(day_idx, period_idx + 1):
                    continue
                candidates.append((day_idx, period_idx))
        rng.shuffle(candidates)

        for day_idx, period_idx in candidates:
            periods = [
                self.ctx.days[day_idx].periods[period_idx],
                self.ctx.days[day_idx].periods[period_idx + 1],
            ]
            day = self.ctx.days[day_idx].day
            taken_teachers: set[int] = set()
            taken_rooms: set[int] = set()
            assignments: list[tuple[int, int, int]] = []  # (batch, teacher, room)
            feasible = True

            for batch_id in self.ctx.batch_ids:
                teachers = [
                    t
                    for t in self._teachers_for(unit.subject_id, batch_id)
                    if t not in taken_teachers
                    and self._teacher_free(t, day_idx, [period_idx, period_idx + 1])
                    and self._teacher_works(t, day, periods)
                ]
                if not teachers:
                    feasible = False
                    break
                rooms = [
                    r
                    for r in self._rooms_for(is_lab=True, subject_id=unit.subject_id)
                    if r not in taken_rooms
                    and self._room_free(r, day_idx, [period_idx, period_idx + 1])
                ]
                if not rooms:
                    feasible = False
                    break
                teacher_id = rng.choice(teachers)
                room_id = rng.choice(rooms)
                taken_teachers.add(teacher_id)
                taken_rooms.add(room_id)
                assignments.append((batch_id, teacher_id, room_id))

            if not feasible:
                continue

            plans: list[_SlotPlan] = []
            for batch_id, teacher_id, room_id in assignments:
                for offset, period in enumerate(periods):
                    self._mark(day_idx, period_idx + offset, teacher_id, room_id)
                    plans.append(
                        _SlotPlan(
                            batch_id=batch_id,
                            subject_id=unit.subject_id,
                            teacher_id=teacher_id,
                            room_id=room_id,
                            day=day,
                            start=_from_seconds(period.start_seconds),
                            end=_from_seconds(period.end_seconds),
                            is_lab=True,
                        )
                    )
            return plans
        return []


def _solve(ctx: _Context) -> list[_SlotPlan]:
    """Pure CPU placement — runs in a worker thread, never touches the session."""
    planner = _Planner(ctx)
    rng = random.Random(_RANDOM_SEED)
    plans: list[_SlotPlan] = []
    for unit in ctx.units:
        if unit.kind == "lab":
            plans.extend(planner.place_lab(unit, rng))
        else:
            plans.extend(planner.place_period(unit, rng))
    return plans


async def generate_timetable(db: AsyncSession, division_id: int) -> list[TimetableSlot]:
    """Generate a timetable for a division and persist the resulting slots.

    Existing unlocked slots for the division are replaced; locked slots (manual
    admin edits) are kept and treated as already-occupied time.
    """
    ctx = await _load_context(db, division_id)
    plans = await asyncio.to_thread(_solve, ctx)

    await db.execute(
        delete(TimetableSlot).where(
            TimetableSlot.division_id == division_id,
            TimetableSlot.locked.is_(False),
        )
    )

    rows = [
        TimetableSlot(
            division_id=division_id,
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
    if rows:
        db.add_all(rows)
    await db.commit()
    return rows


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
    """Apply a manual teacher/room override to a slot and lock it.

    A locked slot is never touched by a later re-generation.
    """
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
