"""Timetable generator service — Google OR-Tools CP-SAT solver.

Constraints enforced:
1. Global Batch Generation: Generate multiple divisions at once (SE, TE, BE)
   so shared teachers and rooms are never double-booked across divisions.
2. Batch-level Lab Scheduling:
   - Labs are scheduled by Batch (e.g., A1, A2, A3) occupying 2 consecutive periods.
   - Parallel Scheduling: Batches can be scheduled in different labs/teachers at the
     same time when available.
   - Labs cannot span across the lunch break.
3. Compact Scheduling (soft objective):
   - Push classes to earlier periods to eliminate mid-day gaps.
4. Hard constraints:
   - Global teacher no double-booking
   - Global room no double-booking
   - Division no double-booking (theory occupies entire division)
   - Batch no double-booking
   - No back-to-back Theory (same subject cannot be in adjacent periods)
   - Teacher daily lecture cap
   - Visiting faculty day/time availability
   - Lab room matching via room_subjects junction
   - Max 1 lab session per division per day
   - Weekly quota satisfaction (theory_periods_per_week, practical_sessions_per_week)
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import time

from ortools.sat.python import cp_model
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

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helper data-classes
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _Period:
    """One teaching period with clock boundaries (in seconds-since-midnight)."""
    index: int          # 1-based period number
    start_seconds: int
    end_seconds: int


@dataclass(frozen=True)
class _SlotPlan:
    """Represents a single placed slot to be persisted to the DB."""
    division_id: int
    batch_id: int | None
    subject_id: int
    teacher_id: int
    room_id: int
    day: DayOfWeek
    start: time
    end: time
    is_lab: bool


# ---------------------------------------------------------------------------
# Utility functions
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
# CP-SAT Solver Core
# ---------------------------------------------------------------------------

def _solve_cpsat(
    division_ids: list[int],
    division_map: dict[int, Division],
    division_batches: dict[int, list[Batch]],
    periods: list[_Period],
    school_days: list[DayOfWeek],
    division_teachers: dict[tuple[int, int], list[int]],
    batch_teachers: dict[tuple[int, int], list[int]],
    active_teachers: dict[int, Teacher],
    rooms: list[Room],
    subject_rooms: dict[int, list[int]],
    requirements: list[WeeklyRequirement],
    existing_slots: list[TimetableSlot],
) -> list[_SlotPlan]:
    """Build and solve a CP-SAT model for timetable generation."""

    model = cp_model.CpModel()
    N = len(periods)  # total teaching periods per day
    day_list = list(school_days)
    period_indices = list(range(N))  # 0-based indices into `periods`

    # Pre-compute contiguous 2-period lab blocks (cannot span lunch)
    valid_lab_starts: list[int] = []
    for pi in range(N - 1):
        if periods[pi].end_seconds == periods[pi + 1].start_seconds:
            valid_lab_starts.append(pi)

    # -------------------------------------------------------------------
    # Pre-compute locked slot occupancy from existing_slots
    # These are slots from OTHER divisions or locked overrides that we must
    # respect but cannot change.
    # -------------------------------------------------------------------
    locked_teacher: dict[tuple[DayOfWeek, int], set[int]] = {}   # (day, period_0idx) -> {teacher_ids}
    locked_room: dict[tuple[DayOfWeek, int], set[int]] = {}      # (day, period_0idx) -> {room_ids}

    for slot in existing_slots:
        slot_start = _to_seconds(slot.start_time)
        for pi, p in enumerate(periods):
            if p.start_seconds == slot_start:
                locked_teacher.setdefault((slot.day_of_week, pi), set()).add(slot.teacher_id)
                locked_room.setdefault((slot.day_of_week, pi), set()).add(slot.room_id)
                # If it's a lab, also block the next period
                if (
                    slot.is_lab
                    and pi + 1 < N
                    and periods[pi].end_seconds == periods[pi + 1].start_seconds
                ):
                    locked_teacher.setdefault((slot.day_of_week, pi + 1), set()).add(slot.teacher_id)
                    locked_room.setdefault((slot.day_of_week, pi + 1), set()).add(slot.room_id)
                break

    # -------------------------------------------------------------------
    # Build decision variables
    # -------------------------------------------------------------------

    # Theory variables: x_theory[(div, subj, req_instance, tch, room, day, pi)]
    # where req_instance differentiates multiple weekly slots of the same subject.
    theory_vars: dict[tuple, cp_model.IntVar] = {}
    # Lab variables: x_lab[(div, batch_or_none, subj, req_instance, tch, room, day, pi)]
    lab_vars: dict[tuple, cp_model.IntVar] = {}

    # Tracking structures for constraints
    # teacher -> list of (var, day, pi, span) where span=1 for theory, 2 for lab
    teacher_slot_vars: dict[int, list[tuple[cp_model.IntVar, DayOfWeek, int, int]]] = {}
    # room -> list of (var, day, pi, span)
    room_slot_vars: dict[int, list[tuple[cp_model.IntVar, DayOfWeek, int, int]]] = {}
    # (div, day, pi) -> list of vars occupying that slot for the whole division (theory)
    div_period_vars: dict[tuple[int, DayOfWeek, int], list[cp_model.IntVar]] = {}
    # (batch, day, pi) -> list of vars occupying that slot for a batch (lab)
    batch_period_vars: dict[tuple[int, DayOfWeek, int], list[cp_model.IntVar]] = {}
    # For no back-to-back theory: (div, subj, day, pi) -> list of theory vars
    theory_subj_period: dict[tuple[int, int, DayOfWeek, int], list[cp_model.IntVar]] = {}
    # For weekly quota: group vars by (div, subj, kind)
    theory_quota_vars: dict[tuple[int, int, str], list[cp_model.IntVar]] = {}  # kind = "theory" | "tutorial"
    lab_quota_vars: dict[tuple[int, int | None, int], list[cp_model.IntVar]] = {}  # (div, batch, subj)
    # For max 1 lab per division per day
    lab_div_day_vars: dict[tuple[int, DayOfWeek], list[cp_model.IntVar]] = {}
    # For teacher daily load
    teacher_day_vars: dict[tuple[int, DayOfWeek], list[tuple[cp_model.IntVar, int]]] = {}  # (var, periods_used)
    # For objective: (var, weight) to push assignments to earlier periods
    objective_terms: list[tuple[cp_model.IntVar, int]] = []

    var_count = 0

    for req in requirements:
        div_id = req.division_id
        subj_id = req.subject_id
        div = division_map[div_id]
        div_bs = division_batches.get(div_id, [])

        # ---- THEORY VARIABLES ----
        theory_total = req.theory_periods_per_week + req.tutorial_periods_per_week
        eligible_theory_teachers = [
            t_id for t_id in division_teachers.get((div_id, subj_id), [])
            if t_id in active_teachers
        ]
        theory_room_candidates = _get_lecture_room_candidates(div, rooms)

        for inst in range(theory_total):
            kind = "theory" if inst < req.theory_periods_per_week else "tutorial"
            inst_vars: list[cp_model.IntVar] = []

            for tch_id in eligible_theory_teachers:
                teacher = active_teachers[tch_id]
                for room_id in theory_room_candidates:
                    for di, day in enumerate(day_list):
                        # Visiting faculty day check
                        if teacher.employment_type == EmploymentType.VISITING:
                            avail_days = teacher.available_days or []
                            if day.value not in avail_days:
                                continue

                        for pi in period_indices:
                            p_obj = periods[pi]
                            # Visiting faculty time check
                            if teacher.employment_type == EmploymentType.VISITING:
                                if (
                                    teacher.available_start is not None
                                    and p_obj.start_seconds < _to_seconds(teacher.available_start)
                                ):
                                    continue
                                if (
                                    teacher.available_end is not None
                                    and p_obj.end_seconds > _to_seconds(teacher.available_end)
                                ):
                                    continue

                            # Teacher is locked by existing slot
                            if tch_id in locked_teacher.get((day, pi), set()):
                                continue
                            # Room is locked by existing slot
                            if room_id in locked_room.get((day, pi), set()):
                                continue

                            key = (div_id, subj_id, inst, tch_id, room_id, day, pi)
                            v = model.new_bool_var(f"th_{var_count}")
                            var_count += 1
                            theory_vars[key] = v
                            inst_vars.append(v)

                            # Register for constraints
                            teacher_slot_vars.setdefault(tch_id, []).append((v, day, pi, 1))
                            room_slot_vars.setdefault(room_id, []).append((v, day, pi, 1))
                            div_period_vars.setdefault((div_id, day, pi), []).append(v)
                            # All batches are busy when a theory slot is placed
                            for b in div_bs:
                                batch_period_vars.setdefault((b.id, day, pi), []).append(v)
                            theory_subj_period.setdefault((div_id, subj_id, day, pi), []).append(v)
                            teacher_day_vars.setdefault((tch_id, day), []).append((v, 1))

                            # Objective: prefer earlier periods (lower weight = preferred)
                            # Weight = period_index so period 0 costs 0, period N-1 costs N-1
                            objective_terms.append((v, pi))

            # Add instance vars to quota tracking
            theory_quota_vars.setdefault((div_id, subj_id, kind), []).extend(inst_vars)

            # Each instance must be placed exactly once
            if inst_vars:
                model.add_exactly_one(inst_vars)
            else:
                logger.warning(
                    "No feasible assignment for %s inst=%d div=%d subj=%d. "
                    "Check teacher eligibility and room availability.",
                    kind, inst, div_id, subj_id,
                )

        # ---- LAB VARIABLES ----
        if req.practical_sessions_per_week > 0:
            if div_bs:
                # Schedule per batch
                for batch in div_bs:
                    eligible_lab_teachers = [
                        t_id
                        for t_id in (
                            batch_teachers.get((subj_id, batch.id))
                            or division_teachers.get((div_id, subj_id), [])
                        )
                        if t_id in active_teachers
                    ]
                    lab_room_candidates = _get_lab_room_candidates(
                        subj_id, div, rooms, subject_rooms
                    )

                    for inst in range(req.practical_sessions_per_week):
                        inst_vars: list[cp_model.IntVar] = []

                        for tch_id in eligible_lab_teachers:
                            teacher = active_teachers[tch_id]
                            for room_id in lab_room_candidates:
                                for di, day in enumerate(day_list):
                                    if teacher.employment_type == EmploymentType.VISITING:
                                        avail_days = teacher.available_days or []
                                        if day.value not in avail_days:
                                            continue

                                    for pi in valid_lab_starts:
                                        p_obj_start = periods[pi]
                                        p_obj_end = periods[pi + 1]

                                        # Visiting faculty time check (both periods)
                                        if teacher.employment_type == EmploymentType.VISITING:
                                            if (
                                                teacher.available_start is not None
                                                and p_obj_start.start_seconds < _to_seconds(teacher.available_start)
                                            ):
                                                continue
                                            if (
                                                teacher.available_end is not None
                                                and p_obj_end.end_seconds > _to_seconds(teacher.available_end)
                                            ):
                                                continue

                                        # Teacher locked by existing slots (both periods)
                                        if (
                                            tch_id in locked_teacher.get((day, pi), set())
                                            or tch_id in locked_teacher.get((day, pi + 1), set())
                                        ):
                                            continue
                                        # Room locked by existing slots (both periods)
                                        if (
                                            room_id in locked_room.get((day, pi), set())
                                            or room_id in locked_room.get((day, pi + 1), set())
                                        ):
                                            continue

                                        key = (div_id, batch.id, subj_id, inst, tch_id, room_id, day, pi)
                                        v = model.new_bool_var(f"lab_{var_count}")
                                        var_count += 1
                                        lab_vars[key] = v
                                        inst_vars.append(v)

                                        # Register for BOTH periods
                                        for p_offset in (0, 1):
                                            teacher_slot_vars.setdefault(tch_id, []).append(
                                                (v, day, pi + p_offset, 1)
                                            )
                                            room_slot_vars.setdefault(room_id, []).append(
                                                (v, day, pi + p_offset, 1)
                                            )
                                            batch_period_vars.setdefault(
                                                (batch.id, day, pi + p_offset), []
                                            ).append(v)
                                            # Lab also blocks the division slot for that period
                                            # (since the batch belongs to the division)
                                            # We DON'T block the WHOLE division here — other batches
                                            # can run parallel labs. We only block the batch.

                                        teacher_day_vars.setdefault((tch_id, day), []).append((v, 2))
                                        lab_div_day_vars.setdefault((div_id, day), []).append(v)
                                        objective_terms.append((v, pi))

                        lab_quota_vars.setdefault((div_id, batch.id, subj_id), []).extend(inst_vars)

                        if inst_vars:
                            model.add_exactly_one(inst_vars)
                        else:
                            logger.warning(
                                "No feasible lab assignment div=%d batch=%d subj=%d inst=%d.",
                                div_id, batch.id, subj_id, inst,
                            )
            else:
                # Whole-division labs (no batches defined)
                eligible_lab_teachers = [
                    t_id
                    for t_id in division_teachers.get((div_id, subj_id), [])
                    if t_id in active_teachers
                ]
                lab_room_candidates = _get_lab_room_candidates(
                    subj_id, div, rooms, subject_rooms
                )

                for inst in range(req.practical_sessions_per_week):
                    inst_vars: list[cp_model.IntVar] = []

                    for tch_id in eligible_lab_teachers:
                        teacher = active_teachers[tch_id]
                        for room_id in lab_room_candidates:
                            for di, day in enumerate(day_list):
                                if teacher.employment_type == EmploymentType.VISITING:
                                    avail_days = teacher.available_days or []
                                    if day.value not in avail_days:
                                        continue

                                for pi in valid_lab_starts:
                                    p_obj_start = periods[pi]
                                    p_obj_end = periods[pi + 1]

                                    if teacher.employment_type == EmploymentType.VISITING:
                                        if (
                                            teacher.available_start is not None
                                            and p_obj_start.start_seconds < _to_seconds(teacher.available_start)
                                        ):
                                            continue
                                        if (
                                            teacher.available_end is not None
                                            and p_obj_end.end_seconds > _to_seconds(teacher.available_end)
                                        ):
                                            continue

                                    if (
                                        tch_id in locked_teacher.get((day, pi), set())
                                        or tch_id in locked_teacher.get((day, pi + 1), set())
                                    ):
                                        continue
                                    if (
                                        room_id in locked_room.get((day, pi), set())
                                        or room_id in locked_room.get((day, pi + 1), set())
                                    ):
                                        continue

                                    key = (div_id, None, subj_id, inst, tch_id, room_id, day, pi)
                                    v = model.new_bool_var(f"lab_{var_count}")
                                    var_count += 1
                                    lab_vars[key] = v
                                    inst_vars.append(v)

                                    for p_offset in (0, 1):
                                        teacher_slot_vars.setdefault(tch_id, []).append(
                                            (v, day, pi + p_offset, 1)
                                        )
                                        room_slot_vars.setdefault(room_id, []).append(
                                            (v, day, pi + p_offset, 1)
                                        )
                                        div_period_vars.setdefault(
                                            (div_id, day, pi + p_offset), []
                                        ).append(v)

                                    teacher_day_vars.setdefault((tch_id, day), []).append((v, 2))
                                    lab_div_day_vars.setdefault((div_id, day), []).append(v)
                                    objective_terms.append((v, pi))

                    lab_quota_vars.setdefault((div_id, None, subj_id), []).extend(inst_vars)

                    if inst_vars:
                        model.add_exactly_one(inst_vars)
                    else:
                        logger.warning(
                            "No feasible whole-division lab assignment div=%d subj=%d inst=%d.",
                            div_id, subj_id, inst,
                        )

    logger.info(
        "CP-SAT model: %d theory vars, %d lab vars, %d total.",
        len(theory_vars), len(lab_vars), var_count,
    )

    # -------------------------------------------------------------------
    # HARD CONSTRAINTS
    # -------------------------------------------------------------------

    # C1: Teacher no-clash — at most 1 assignment per (teacher, day, period)
    teacher_day_period: dict[tuple[int, DayOfWeek, int], list[cp_model.IntVar]] = {}
    for tch_id, entries in teacher_slot_vars.items():
        for v, day, pi, _ in entries:
            teacher_day_period.setdefault((tch_id, day, pi), []).append(v)
    for key, vs in teacher_day_period.items():
        if len(vs) > 1:
            model.add(sum(vs) <= 1)

    # C2: Room no-clash — at most 1 assignment per (room, day, period)
    room_day_period: dict[tuple[int, DayOfWeek, int], list[cp_model.IntVar]] = {}
    for room_id, entries in room_slot_vars.items():
        for v, day, pi, _ in entries:
            room_day_period.setdefault((room_id, day, pi), []).append(v)
    for key, vs in room_day_period.items():
        if len(vs) > 1:
            model.add(sum(vs) <= 1)

    # C3: Division no-clash — at most 1 whole-division class per (div, day, period)
    for key, vs in div_period_vars.items():
        if len(vs) > 1:
            model.add(sum(vs) <= 1)

    # C4: Batch no-clash — at most 1 assignment per (batch, day, period)
    for key, vs in batch_period_vars.items():
        if len(vs) > 1:
            model.add(sum(vs) <= 1)

    # C5: Division-batch mutual exclusion
    # When a theory (whole-division) class is placed at (div, day, pi), no batch
    # of that division can have a lab at that same slot, and vice versa.
    # We already registered theory vars in both div_period_vars AND batch_period_vars
    # for all batches, so the batch no-clash constraint (C4) handles this.
    # For whole-division labs, we registered in div_period_vars.
    # So C3+C4 together enforce mutual exclusion.

    # C6: No back-to-back Theory — same subject in adjacent periods
    for pi in range(N - 1):
        # Only if these two periods are actually consecutive on the clock
        # (i.e., not separated by lunch)
        if periods[pi].end_seconds != periods[pi + 1].start_seconds:
            continue
        for div_id in division_ids:
            # Collect all subjects with theory in this division
            subjects_in_div = set()
            for (d, s, k), _ in theory_quota_vars.items():
                if d == div_id:
                    subjects_in_div.add(s)

            for subj_id in subjects_in_div:
                for day in day_list:
                    vars_at_pi = theory_subj_period.get((div_id, subj_id, day, pi), [])
                    vars_at_pi1 = theory_subj_period.get((div_id, subj_id, day, pi + 1), [])
                    if vars_at_pi and vars_at_pi1:
                        # sum(vars_at_pi) + sum(vars_at_pi1) <= 1
                        model.add(sum(vars_at_pi) + sum(vars_at_pi1) <= 1)

    # C7: Max 1 lab session per division per day
    for key, vs in lab_div_day_vars.items():
        if len(vs) > 1:
            model.add(sum(vs) <= 1)

    # C8: Teacher daily lecture cap
    for (tch_id, day), entries in teacher_day_vars.items():
        if not entries:
            continue
        teacher = active_teachers.get(tch_id)
        if teacher is None:
            continue
        max_load = teacher.max_lectures_per_day
        # Sum of (var * periods_used) <= max_load
        model.add(
            sum(v * periods_used for v, periods_used in entries) <= max_load
        )

    # -------------------------------------------------------------------
    # SOLVE
    # -------------------------------------------------------------------
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 300.0
    solver.parameters.num_workers = 8  # use multiple cores
    solver.parameters.log_search_progress = False

    print(f"--- SOLVER START ---")
    print(f"Variables: {len(model.Proto().variables)}")
    print(f"Constraints: {len(model.Proto().constraints)}")
    print(f"Time limit: {solver.parameters.max_time_in_seconds}s")

    logger.info("Starting CP-SAT solver...")
    status = solver.Solve(model)

    print(f"--- SOLVER RESULT ---")
    print(f"Status: {solver.StatusName(status)}")
    print(f"Wall time: {solver.WallTime()}s")

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        status_name = solver.StatusName(status)
        raise ValueError(
            f"No valid timetable could be generated (solver status: {status_name}). "
            f"Check teacher eligibility, room capacity, and weekly requirements."
        )

    logger.info(
        "CP-SAT solved: status=%s, wall_time=%.2fs",
        solver.StatusName(status),
        solver.WallTime(),
    )

    # -------------------------------------------------------------------
    # EXTRACT SOLUTION
    # -------------------------------------------------------------------
    plans: list[_SlotPlan] = []

    # Extract theory slots
    for key, v in theory_vars.items():
        if solver.value(v):
            div_id, subj_id, inst, tch_id, room_id, day, pi = key
            p_obj = periods[pi]
            plans.append(
                _SlotPlan(
                    division_id=div_id,
                    batch_id=None,
                    subject_id=subj_id,
                    teacher_id=tch_id,
                    room_id=room_id,
                    day=day,
                    start=_from_seconds(p_obj.start_seconds),
                    end=_from_seconds(p_obj.end_seconds),
                    is_lab=False,
                )
            )

    # Extract lab slots (each lab covers 2 periods → 2 TimetableSlot rows)
    for key, v in lab_vars.items():
        if solver.value(v):
            div_id, batch_id, subj_id, inst, tch_id, room_id, day, pi = key
            for p_offset in (0, 1):
                p_obj = periods[pi + p_offset]
                plans.append(
                    _SlotPlan(
                        division_id=div_id,
                        batch_id=batch_id,
                        subject_id=subj_id,
                        teacher_id=tch_id,
                        room_id=room_id,
                        day=day,
                        start=_from_seconds(p_obj.start_seconds),
                        end=_from_seconds(p_obj.end_seconds),
                        is_lab=True,
                    )
                )

    return plans


# ---------------------------------------------------------------------------
# Public API (async entry points used by the REST layer)
# ---------------------------------------------------------------------------

async def generate_timetable(
    db: AsyncSession,
    division_ids: list[int] | int,
) -> list[TimetableSlot]:
    """Generate timetables for one or more divisions using the CP-SAT solver."""
    if isinstance(division_ids, int):
        division_ids = [division_ids]
    else:
        division_ids = list(dict.fromkeys(division_ids))

    if not division_ids:
        return []

    # Step 1: Data Loading
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

    # Step 1b: Pre-flight check — validate teacher mappings and room mappings
    teacher_subject_divisions = list(
        (await db.execute(select(TeacherSubjectDivision))).scalars().all()
    )
    room_subjects = list(
        (await db.execute(select(RoomSubject))).scalars().all()
    )
    subjects = list(
        (await db.execute(select(Subject))).scalars().all()
    )
    subject_map = {s.id: s for s in subjects}

    teacher_mappings = {(r.division_id, r.subject_id) for r in teacher_subject_divisions}
    room_mappings = {r.subject_id for r in room_subjects}

    errors: list[str] = []
    for req in requirements:
        subj = subject_map.get(req.subject_id)
        subj_name = subj.name if subj else f"Subject #{req.subject_id}"
        div = division_map.get(req.division_id)
        div_name = f"{div.year} {div.name}" if div else f"Division #{req.division_id}"

        is_lab = (subj is not None and subj.subject_type.upper() == "LAB") or req.practical_sessions_per_week > 0

        has_teacher = (req.division_id, req.subject_id) in teacher_mappings
        has_room = req.subject_id in room_mappings

        if is_lab:
            if not (has_teacher and has_room):
                errors.append(f"Missing Lab Room or Teacher: {subj_name} for {div_name}")
        else:
            if not has_teacher:
                errors.append(f"Missing Teacher: {subj_name} for {div_name}")

    if errors:
        raise ValueError(
            "Cannot generate timetable. Please fix the following:\n"
            + "\n".join(errors[:10])
        )

    eligibilities = [
        e for e in teacher_subject_divisions if e.division_id in division_ids
    ]

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
    batch_teachers_map: dict[tuple[int, int], list[int]] = {}
    for e in eligibilities:
        if e.teacher_id not in active_teachers:
            continue
        if e.batch_id is None:
            division_teachers.setdefault((e.division_id, e.subject_id), []).append(e.teacher_id)
        else:
            batch_teachers_map.setdefault((e.subject_id, e.batch_id), []).append(e.teacher_id)

    rooms = list((await db.execute(select(Room))).scalars().all())
    room_ids = [r.id for r in rooms]
    subject_rooms: dict[int, list[int]] = {}
    if room_ids:
        links = [link for link in room_subjects if link.room_id in room_ids]
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

    # Run solver in worker thread so event loop stays free
    plans = await asyncio.to_thread(
        _solve_cpsat,
        division_ids,
        division_map,
        division_batches,
        periods,
        school_days,
        division_teachers,
        batch_teachers_map,
        active_teachers,
        rooms,
        subject_rooms,
        requirements,
        existing_slots,
    )

    # Step 3: Save — delete existing unlocked slots and persist generated slots
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
    print(
        f"Successfully generated and saved {len(final_slots)} slots for {len(division_ids)} division(s)."
    )
    return final_slots


async def list_slots(db: AsyncSession, division_id: int) -> list[TimetableSlot]:
    """Return stored slots of a division, ordered by day and start time."""
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
    """Apply manual teacher/room override to a slot and lock it."""
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
