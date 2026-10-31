"""Unit tests for solver constraint C7 (max 1 lab period-start per division per day).

Validates:
1. Positive case: All batches of a division can run labs simultaneously at the same
   period-start (tri-parallel lab pattern).
2. Negative case: Multiple lab sessions for the same division scheduled at distinct
   period-starts on the same day are rejected as infeasible.
3. Multi-day distribution: Multiple lab sessions for the same division are placed on
   different days, with at most one distinct period-start used per day.
4. Batch mutual exclusion on timing: Batches of the same division cannot be scattered
   across different period-starts on the same day when parallel placement is blocked.
"""

from __future__ import annotations

from datetime import time

import pytest

from app.models.batch import Batch
from app.models.division import Division
from app.models.enums import DayOfWeek, RoomType, TeacherStatus
from app.models.room import Room
from app.models.teacher import Teacher
from app.models.weekly_requirement import WeeklyRequirement
from app.services.timetable.context import _Period
from app.services.timetable.solver import _SlotPlan, _solve_cpsat


def _build_test_periods(count: int = 4) -> list[_Period]:
    """Build contiguous 1-hour periods starting at 09:00."""
    return [
        _Period(
            index=i + 1,
            start_seconds=(9 + i) * 3600,
            end_seconds=(10 + i) * 3600,
        )
        for i in range(count)
    ]


def _build_teacher(teacher_id: int, name: str) -> Teacher:
    return Teacher(
        id=teacher_id,
        name=name,
        email=f"teacher{teacher_id}@example.com",
        hashed_password="hash",
        status=TeacherStatus.ACTIVE,
        max_lectures_per_day=6,
    )


def _build_room(room_id: int, name: str) -> Room:
    return Room(
        id=room_id,
        name=name,
        room_type=RoomType.LAB,
        branch_id=1,
        year="SE",
    )


def test_c7_positive_tri_parallel_labs() -> None:
    """Positive case: 3 batches run labs simultaneously at the same period-start.

    C7 must permit multiple batches of the same division to run labs at the SAME
    period-start on the same day.
    """
    division = Division(id=1, name="A", year="SE", branch_id=1, semester=3)
    batches = [
        Batch(id=1, name="A1", division_id=1),
        Batch(id=2, name="A2", division_id=1),
        Batch(id=3, name="A3", division_id=1),
    ]
    teachers = [_build_teacher(101, "T1"), _build_teacher(102, "T2"), _build_teacher(103, "T3")]
    rooms = [_build_room(201, "L1"), _build_room(202, "L2"), _build_room(203, "L3")]

    # 1 lab subject with 1 practical session per week for each batch
    lab_subj_id = 10
    req = WeeklyRequirement(
        id=1,
        division_id=1,
        subject_id=lab_subj_id,
        theory_periods_per_week=0,
        practical_sessions_per_week=1,
        tutorial_periods_per_week=0,
    )

    plans: list[_SlotPlan] = _solve_cpsat(
        division_ids=[1],
        division_map={1: division},
        division_batches={1: batches},
        periods=_build_test_periods(4),
        school_days=[DayOfWeek.MONDAY],
        division_teachers={},
        batch_teachers={
            (1, lab_subj_id, 1): [101],
            (1, lab_subj_id, 2): [102],
            (1, lab_subj_id, 3): [103],
        },
        active_teachers={t.id: t for t in teachers},
        rooms=rooms,
        subject_rooms={lab_subj_id: [r.id for r in rooms]},
        requirements=[req],
        existing_slots=[],
    )

    # 3 batches * 2 periods = 6 slot plans
    assert len(plans) == 6
    assert all(slot.day == DayOfWeek.MONDAY for slot in plans)
    assert all(slot.is_lab for slot in plans)

    # All 3 batches must share the exact same start time for their first period
    batch_first_slots: dict[int, _SlotPlan] = {}
    for slot in sorted(plans, key=lambda s: s.start):
        if slot.batch_id is not None and slot.batch_id not in batch_first_slots:
            batch_first_slots[slot.batch_id] = slot

    assert len(batch_first_slots) == 3
    start_times = {slot.start for slot in batch_first_slots.values()}
    # Crucial assertion: exactly one shared start time across all batches
    assert len(start_times) == 1

    # Teachers and rooms must be distinct across batches
    parallel_teachers = {slot.teacher_id for slot in batch_first_slots.values()}
    parallel_rooms = {slot.room_id for slot in batch_first_slots.values()}
    assert len(parallel_teachers) == 3
    assert len(parallel_rooms) == 3


def test_c7_negative_scattered_labs_rejected_on_single_day() -> None:
    """Negative case: Division cannot fit 2 separate lab sessions at different period-starts.

    When only one day is available, scheduling two lab sessions would force them into
    distinct period-starts (e.g. 09:00 and 11:00). C7 must reject this as infeasible.
    """
    division = Division(id=1, name="A", year="SE", branch_id=1, semester=3)
    teachers = [_build_teacher(101, "T1"), _build_teacher(102, "T2")]
    rooms = [_build_room(201, "L1"), _build_room(202, "L2")]

    # Two distinct lab subjects, 1 session each
    req1 = WeeklyRequirement(
        id=1,
        division_id=1,
        subject_id=10,
        theory_periods_per_week=0,
        practical_sessions_per_week=1,
        tutorial_periods_per_week=0,
    )
    req2 = WeeklyRequirement(
        id=2,
        division_id=1,
        subject_id=20,
        theory_periods_per_week=0,
        practical_sessions_per_week=1,
        tutorial_periods_per_week=0,
    )

    with pytest.raises(ValueError, match="No valid timetable could be generated"):
        _solve_cpsat(
            division_ids=[1],
            division_map={1: division},
            division_batches={1: []},
            periods=_build_test_periods(4),
            school_days=[DayOfWeek.MONDAY],  # Only 1 day!
            division_teachers={(1, 10): [101], (1, 20): [102]},
            batch_teachers={},
            active_teachers={t.id: t for t in teachers},
            rooms=rooms,
            subject_rooms={10: [201], 20: [202]},
            requirements=[req1, req2],
            existing_slots=[],
        )


def test_c7_multi_day_places_separate_labs_on_separate_days() -> None:
    """Multi-day case: 2 lab sessions land on separate days, never scattering on one day."""
    division = Division(id=1, name="A", year="SE", branch_id=1, semester=3)
    teachers = [_build_teacher(101, "T1"), _build_teacher(102, "T2")]
    rooms = [_build_room(201, "L1"), _build_room(202, "L2")]

    req1 = WeeklyRequirement(
        id=1,
        division_id=1,
        subject_id=10,
        theory_periods_per_week=0,
        practical_sessions_per_week=1,
        tutorial_periods_per_week=0,
    )
    req2 = WeeklyRequirement(
        id=2,
        division_id=1,
        subject_id=20,
        theory_periods_per_week=0,
        practical_sessions_per_week=1,
        tutorial_periods_per_week=0,
    )

    plans = _solve_cpsat(
        division_ids=[1],
        division_map={1: division},
        division_batches={1: []},
        periods=_build_test_periods(4),
        school_days=[DayOfWeek.MONDAY, DayOfWeek.TUESDAY],
        division_teachers={(1, 10): [101], (1, 20): [102]},
        batch_teachers={},
        active_teachers={t.id: t for t in teachers},
        rooms=rooms,
        subject_rooms={10: [201], 20: [202]},
        requirements=[req1, req2],
        existing_slots=[],
    )

    assert len(plans) == 4  # 2 subjects * 2 periods = 4 slots
    # Must be placed on 2 distinct days
    placed_days = {slot.day for slot in plans}
    assert placed_days == {DayOfWeek.MONDAY, DayOfWeek.TUESDAY}

    # Verify that each day has exactly one lab session (starting at a single period)
    for day in placed_days:
        day_slots = [s for s in plans if s.day == day]
        day_starts = {s.start for s in day_slots}
        # A 2-period lab session has 2 slots with 2 contiguous start times
        assert len(day_slots) == 2
        # Exactly one session start on this day
        min_start = min(day_starts)
        assert min_start in (time(9, 0), time(11, 0))


def test_c7_batches_cannot_scatter_across_periods_on_same_day() -> None:
    """When parallel placement is impossible on a single day, C7 blocks sequential placement.

    If 2 batches of division 1 each need a lab, but only 1 teacher is eligible,
    they cannot run in parallel at the same period-start. Under C7, they also cannot
    run sequentially at different period-starts on that single day, making it infeasible.
    """
    division = Division(id=1, name="A", year="SE", branch_id=1, semester=3)
    batches = [
        Batch(id=1, name="A1", division_id=1),
        Batch(id=2, name="A2", division_id=1),
    ]
    # Only 1 teacher available — parallel execution at same period-start is impossible!
    teachers = [_build_teacher(101, "T1")]
    rooms = [_build_room(201, "L1"), _build_room(202, "L2")]

    lab_subj_id = 10
    req = WeeklyRequirement(
        id=1,
        division_id=1,
        subject_id=lab_subj_id,
        theory_periods_per_week=0,
        practical_sessions_per_week=1,
        tutorial_periods_per_week=0,
    )

    with pytest.raises(ValueError, match="No valid timetable could be generated"):
        _solve_cpsat(
            division_ids=[1],
            division_map={1: division},
            division_batches={1: batches},
            periods=_build_test_periods(4),
            school_days=[DayOfWeek.MONDAY],  # Only 1 day!
        division_teachers={},
        batch_teachers={
            (1, lab_subj_id, 1): [101],
            (1, lab_subj_id, 2): [101],
        },
            active_teachers={101: teachers[0]},
            rooms=rooms,
            subject_rooms={lab_subj_id: [201, 202]},
            requirements=[req],
            existing_slots=[],
        )
