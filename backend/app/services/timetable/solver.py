from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
type: time

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
from app.services.timetable.context import (
    GenerationContext,
    _Period,
    _build_periods,
    _from_seconds,
    _get_lab_room_candidates,
    _get_lecture_room_candidates,
    _to_seconds,
    load_generation_context,
)
from app.services.timetable.diagnostics import run_diagnostics

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helper data-classes
# ---------------------------------------------------------------------------

dataclass(frozen=True)
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
# CP-SAT Solver Core
# ---------------------------------------------------------------------------

def _solve_cpsat(
    division_ids: list[int],
    division_map: dict[int, Division],
    division_batches: dict[int, list[Batch]],
    periods: list[_Period],
    school_days: list[DayOfWeek],
    division_teachers: dict[tuple[int, int], list[int]],
    batch_teachers: dict[tuple[int, ...], list[int]],
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
    # For C7: (div_id, day) -> { period_start: [lab vars at that period_start] }
    lab_div_day_period_vars: dict[tuple[int, DayOfWeek], dict[int, list[cp_model.IntVar]]] = {}
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

                            # Teacher shift time check
                            if teacher.shift_start_time and p_obj.start_seconds < _to_seconds(teacher.shift_start_time):
                                continue
                            if teacher.shift_end_time and p_obj.end_seconds > _to_seconds(teacher.shift_end_time):
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
                        for t_id in batch_teachers.get(
                            (div_id, subj_id, batch.id), []
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

                                        # Teacher shift time check (both periods)
                                        if teacher.shift_start_time and p_obj_start.start_seconds < _to_seconds(teacher.shift_start_time):
                                            continue
                                        if teacher.shift_end_time and p_obj_end.end_seconds > _to_seconds(teacher.shift_end_time):
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
                                        lab_div_day_period_vars.setdefault((div_id, day), {}).setdefault(pi, []).append(v)
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

                                    # Teacher shift time check (both periods)
                                    if teacher.shift_start_time and p_obj_start.start_seconds < _to_seconds(teacher.shift_start_time):
                                        continue
                                    if teacher.shift_end_time and p_obj_end.end_seconds > _to_seconds(teacher.shift_end_time):
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
                                    lab_div_day_period_vars.setdefault((div_id, day), {}).setdefault(pi, []).append(v)
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

    # C7: at most one DISTINCT period-start used for labs per division per day.
    # Multiple batches/subjects sharing the SAME period-start (tri-parallel labs)
    # are allowed and expected — see docs/SPEC.md "Batch / lab rule". What's
    # disallowed is a division having labs scattered across different times
    # of the same day.
    for (div_id, day), by_period in lab_div_day_period_vars.items():
        period_starts = list(by_period.keys())
        if len(period_starts) <= 1:
            continue  # only one period-start used (or none) — nothing to constrain
        # One boolean per period-start: "labs are running at this period-start today"
        period_used_vars = []
        for pi in period_starts:
            used = model.new_bool_var(f"lab_day_period_used_{div_id}_{day.value}_{pi}")
            # used == 1 iff at least one lab var at this period-start is true
            model.add_max_equality(used, by_period[pi])
            period_used_vars.append(used)
        # At most one distinct period-start may be "used" that day
        model.add(sum(period_used_vars) <= 1)

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

    # Minimize: push assignments to earlier periods (eliminate mid-day gaps)
    # objective_terms already contains (var, period_index) pairs from variable creation
    model.Minimize(sum(var * weight for var, weight in objective_terms))

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

    # Step 1: Load shared generation context
    ctx = await load_generation_context(db, division_ids)

    # Step 2: Run pre-flight diagnostics
    issues = run_diagnostics(ctx)
    errors = [issue.message for issue in issues if issue.severity == "error"]
    if errors:
        raise ValueError("\n".join(errors))

    for issue in issues:
        if issue.severity == "warning":
            logger.warning("Timetable diagnostic warning: %s", issue.message)

    # Step 3: Prepare teacher eligibility maps for CP-SAT solver
    active_teachers = {
        t_id: t for t_id, t in ctx.teachers.items() if t.status == TeacherStatus.ACTIVE
    }

    division_teachers: dict[tuple[int, int], list[int]] = {}
    batch_teachers_map: dict[tuple[int, ...], list[int]] = {}
    for e in ctx.teacher_subject_divisions:
        if e.division_id not in ctx.division_ids:
            continue
        if e.teacher_id not in active_teachers:
            continue
        if e.batch_id is None:
            division_teachers.setdefault((e.division_id, e.subject_id), []).append(e.teacher_id)
        else:
            batch_teachers_map.setdefault((e.division_id, e.subject_id, e.batch_id), []).append(e.teacher_id)

    # Step 4: Run CP-SAT solver in worker thread so event loop stays free
    plans = await asyncio.to_thread(
        _solve_cpsat,
        ctx.division_ids,
        ctx.division_map,
        ctx.division_batches,
        ctx.periods,
        ctx.school_days,
        division_teachers,
        batch_teachers_map,
        active_teachers,
        ctx.rooms,
        ctx.subject_rooms,
        ctx.requirements,
        ctx.existing_slots,
    )

    # Step 5: Save — delete existing unlocked slots and persist generated slots
    await db.execute(
        delete(TimetableSlot).where(
            TimetableSlot.division_id.in_(ctx.division_ids),
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
        f"Successfully generated and saved {len(final_slots)} slots for {len(ctx.division_ids)} division(s)."
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
