
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import time
from typing import Iterable

from ortools.sat.python import cp_model
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session_maker
from app.core.exceptions import NotFoundError
from app.models.batch import Batch
from app.models.division import Division
from app.models.enums import DayOfWeek, EmploymentType, TeacherStatus
from app.models.room import Room
from app.models.teacher import Teacher
from app.models.timetable_slot import TimetableSlot
from app.models.weekly_requirement import WeeklyRequirement
from app.services.timetable.context import (
    _Period,
    _from_seconds,
    _get_lab_room_candidates,
    _get_lecture_room_candidates,
    _to_seconds,
    load_generation_context,
)
from app.services.timetable.diagnostics import run_diagnostics

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _SlotPlan:
    """One persisted timetable period."""

    division_id: int
    batch_id: int | None
    subject_id: int
    teacher_id: int
    room_id: int
    day: DayOfWeek
    start: time
    end: time
    is_lab: bool
    is_tutorial: bool = False


def _add_exactly_one_or_raise(
    model: cp_model.CpModel,
    variables: list[cp_model.IntVar],
    *,
    kind: str,
    division_id: int,
    subject_id: int,
    instance: int,
    batch_id: int | None = None,
) -> None:
    """Require an instance to have at least one candidate and select one."""

    if not variables:
        raise ValueError(
            "No feasible candidate variables for required timetable instance: "
            f"kind={kind}, division_id={division_id}, subject_id={subject_id}, "
            f"batch_id={batch_id}, instance={instance}. "
            "Check active teacher eligibility, teacher shifts, room compatibility, "
            "room availability, and the generated period grid."
        )

    model.add_exactly_one(variables)


def _or_bool(
    model: cp_model.CpModel,
    variables: list[cp_model.IntVar],
    name: str,
) -> cp_model.IntVar | None:
    """Return a Boolean equivalent to OR(variables), or None for an empty list."""

    if not variables:
        return None

    result = model.new_bool_var(name)
    model.add_max_equality(result, variables)

    return result


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
    light_lab_subject_ids: set[int] | None = None,
) -> list[_SlotPlan]:
    """Build and solve the CP-SAT timetable model for one or more divisions."""

    if not periods:
        raise ValueError("Cannot generate a timetable: no periods are configured.")

    if not school_days:
        raise ValueError("Cannot generate a timetable: no school days are configured.")

    light_lab_subject_ids = light_lab_subject_ids or set()

    model = cp_model.CpModel()

    period_count = len(periods)
    day_list = list(school_days)
    period_indices = range(period_count)

    # A practical occupies two adjacent teaching periods.
    # A pair cannot cross lunch/recess because only clock-contiguous
    # pairs are included here.

    valid_lab_starts = [
        pi
        for pi in range(period_count - 1)
        if periods[pi].end_seconds == periods[pi + 1].start_seconds
    ]

    if not valid_lab_starts:
        raise ValueError(
            "Cannot generate practical sessions: the configured timetable has "
            "no pair of consecutive teaching periods."
        )

    # Existing slots represent one stored period each.
    # The persistence layer stores a two-period lab as two TimetableSlot rows.
    # Locking the next period again for every is_lab row would incorrectly
    # reserve a third slot.

    locked_teacher: dict[tuple[DayOfWeek, int], set[int]] = {}
    locked_room: dict[tuple[DayOfWeek, int], set[int]] = {}

    for slot in existing_slots:
        slot_start = _to_seconds(slot.start_time)

        for pi, period in enumerate(periods):

            if period.start_seconds != slot_start:
                continue

            locked_teacher.setdefault(
                (slot.day_of_week, pi), set()
            ).add(slot.teacher_id)

            locked_room.setdefault(
                (slot.day_of_week, pi), set()
            ).add(slot.room_id)

            break

    # ----------------------------------------------------------------------
    # DECISION VARIABLES
    # ----------------------------------------------------------------------

    theory_vars: dict[tuple, cp_model.IntVar] = {}
    tutorial_vars: dict[tuple, cp_model.IntVar] = {}
    lab_vars: dict[tuple, cp_model.IntVar] = {}

    light_lab_vars: set[cp_model.IntVar] = set()
    heavy_lab_vars: set[cp_model.IntVar] = set()

    iks_vars_by_division_day: dict[
        tuple[int, DayOfWeek], list[cp_model.IntVar]
    ] = {}

    # Teacher occupancy.

    teacher_slot_vars: dict[
        int, list[tuple[cp_model.IntVar, DayOfWeek, int, int]]
    ] = {}

    # Room occupancy.

    room_slot_vars: dict[
        int, list[tuple[cp_model.IntVar, DayOfWeek, int, int]]
    ] = {}

    # Whole-division occupancy.

    div_period_vars: dict[
        tuple[int, DayOfWeek, int], list[cp_model.IntVar]
    ] = {}

    # Batch occupancy.

    batch_period_vars: dict[
        tuple[int, DayOfWeek, int], list[cp_model.IntVar]
    ] = {}

    theory_subj_period: dict[
        tuple[int, int, DayOfWeek, int], list[cp_model.IntVar]
    ] = {}

    theory_quota_vars: dict[
        tuple[int, int, str], list[cp_model.IntVar]
    ] = {}

    lab_quota_vars: dict[
        tuple[int, int | None, int], list[cp_model.IntVar]
    ] = {}

    lab_div_day_period_vars: dict[
        tuple[int, DayOfWeek], dict[int, list[cp_model.IntVar]]
    ] = {}

    teacher_day_vars: dict[
        tuple[int, DayOfWeek], list[tuple[cp_model.IntVar, int]]
    ] = {}

    objective_terms: list[tuple[cp_model.IntVar, int]] = []

    var_count = 0

    # ----------------------------------------------------------------------
    # HELPER FUNCTIONS
    # ----------------------------------------------------------------------

    def register_whole_division_activity(
        variable: cp_model.IntVar,
        division_id: int,
        day: DayOfWeek,
        occupied_period: int,
    ) -> None:
        """Register a whole-division activity against the division and all batches."""

        div_period_vars.setdefault(
            (division_id, day, occupied_period), []
        ).append(variable)

        for batch in division_batches.get(division_id, []):

            batch_period_vars.setdefault(
                (batch.id, day, occupied_period), []
            ).append(variable)

    def teacher_is_available_for_period(
        teacher: Teacher,
        day: DayOfWeek,
        start_seconds: int,
        end_seconds: int,
    ) -> bool:

        if teacher.employment_type == EmploymentType.VISITING:

            available_days = teacher.available_days or []

            if day.value not in available_days:
                return False

            if (
                teacher.available_start is not None
                and start_seconds < _to_seconds(teacher.available_start)
            ):
                return False

            if (
                teacher.available_end is not None
                and end_seconds > _to_seconds(teacher.available_end)
            ):
                return False

        if (
            teacher.shift_start_time is not None
            and start_seconds < _to_seconds(teacher.shift_start_time)
        ):
            return False

        if (
            teacher.shift_end_time is not None
            and end_seconds > _to_seconds(teacher.shift_end_time)
        ):
            return False

        return True

    def is_teacher_or_room_locked(
        teacher_id: int,
        room_id: int,
        day: DayOfWeek,
        occupied_periods: Iterable[int],
    ) -> bool:

        for occupied_period in occupied_periods:

            if teacher_id in locked_teacher.get((day, occupied_period), set()):
                return True

            if room_id in locked_room.get((day, occupied_period), set()):
                return True

        return False

    # ----------------------------------------------------------------------
    # BUILD REQUIREMENT VARIABLES
    # ----------------------------------------------------------------------

    for req in requirements:

        division_id = req.division_id
        subject_id = req.subject_id

        division = division_map[division_id]

        batches = sorted(
            division_batches.get(division_id, []),
            key=lambda batch: batch.name,
        )

        # ==============================================================
        # THEORY
        # ==============================================================

        eligible_theory_teachers = list(
            dict.fromkeys(
                teacher_id
                for teacher_id in division_teachers.get(
                    (division_id, subject_id), []
                )
                if teacher_id in active_teachers
            )
        )

        theory_room_candidates = _get_lecture_room_candidates(
            division, rooms
        )

        for instance in range(req.theory_periods_per_week):

            instance_vars: list[cp_model.IntVar] = []

            for teacher_id in eligible_theory_teachers:

                teacher = active_teachers[teacher_id]

                for room_id in theory_room_candidates:

                    for day in day_list:

                        for pi in period_indices:

                            period = periods[pi]

                            if not teacher_is_available_for_period(
                                teacher,
                                day,
                                period.start_seconds,
                                period.end_seconds,
                            ):
                                continue

                            if is_teacher_or_room_locked(
                                teacher_id,
                                room_id,
                                day,
                                [pi],
                            ):
                                continue

                            key = (
                                division_id,
                                subject_id,
                                instance,
                                teacher_id,
                                room_id,
                                day,
                                pi,
                            )

                            variable = model.new_bool_var(
                                f"theory_{var_count}"
                            )

                            var_count += 1

                            theory_vars[key] = variable
                            instance_vars.append(variable)

                            teacher_slot_vars.setdefault(
                                teacher_id, []
                            ).append((variable, day, pi, 1))

                            room_slot_vars.setdefault(
                                room_id, []
                            ).append((variable, day, pi, 1))

                            register_whole_division_activity(
                                variable,
                                division_id,
                                day,
                                pi,
                            )

                            theory_subj_period.setdefault(
                                (division_id, subject_id, day, pi), []
                            ).append(variable)

                            teacher_day_vars.setdefault(
                                (teacher_id, day), []
                            ).append((variable, 1))

                            objective_terms.append((variable, pi))

            theory_quota_vars.setdefault(
                (division_id, subject_id, "theory"), []
            ).extend(instance_vars)

            _add_exactly_one_or_raise(
                model,
                instance_vars,
                kind="theory",
                division_id=division_id,
                subject_id=subject_id,
                instance=instance,
            )

        # ==============================================================
        # TUTORIALS
        #
        # tutorial_periods_per_week is the division's total number
        # of tutorial sessions.
        #
        # Example:
        # 3 tutorials across A1/A2/A3 = one tutorial per batch.
        # ==============================================================

        tutorial_room_candidates = _get_lecture_room_candidates(
            division, rooms
        )

        if req.tutorial_periods_per_week > 0:

            if batches:

                base_count, remainder = divmod(
                    req.tutorial_periods_per_week,
                    len(batches),
                )

                for batch_index, batch in enumerate(batches):

                    tutorials_for_batch = base_count + (
                        1 if batch_index < remainder else 0
                    )

                    eligible_tutorial_teachers = list(
                        dict.fromkeys(
                            teacher_id
                            for teacher_id in (
                                batch_teachers.get(
                                    (division_id, subject_id, batch.id),
                                    [],
                                )
                                or division_teachers.get(
                                    (division_id, subject_id),
                                    [],
                                )
                            )
                            if teacher_id in active_teachers
                        )
                    )

                    for instance in range(tutorials_for_batch):

                        instance_vars = []

                        for teacher_id in eligible_tutorial_teachers:

                            teacher = active_teachers[teacher_id]

                            for room_id in tutorial_room_candidates:

                                for day in day_list:

                                    for pi in period_indices:

                                        period = periods[pi]

                                        if not teacher_is_available_for_period(
                                            teacher,
                                            day,
                                            period.start_seconds,
                                            period.end_seconds,
                                        ):
                                            continue

                                        if is_teacher_or_room_locked(
                                            teacher_id,
                                            room_id,
                                            day,
                                            [pi],
                                        ):
                                            continue

                                        key = (
                                            division_id,
                                            batch.id,
                                            subject_id,
                                            instance,
                                            teacher_id,
                                            room_id,
                                            day,
                                            pi,
                                        )

                                        variable = model.new_bool_var(
                                            f"tutorial_{var_count}"
                                        )

                                        var_count += 1

                                        tutorial_vars[key] = variable
                                        instance_vars.append(variable)

                                        teacher_slot_vars.setdefault(
                                            teacher_id, []
                                        ).append((variable, day, pi, 1))

                                        room_slot_vars.setdefault(
                                            room_id, []
                                        ).append((variable, day, pi, 1))

                                        batch_period_vars.setdefault(
                                            (batch.id, day, pi), []
                                        ).append(variable)

                                        teacher_day_vars.setdefault(
                                            (teacher_id, day), []
                                        ).append((variable, 1))

                                        objective_terms.append((variable, pi))

                        _add_exactly_one_or_raise(
                            model,
                            instance_vars,
                            kind="tutorial",
                            division_id=division_id,
                            subject_id=subject_id,
                            instance=instance,
                            batch_id=batch.id,
                        )

            else:

                eligible_tutorial_teachers = list(
                    dict.fromkeys(
                        teacher_id
                        for teacher_id in division_teachers.get(
                            (division_id, subject_id), []
                        )
                        if teacher_id in active_teachers
                    )
                )

                for instance in range(req.tutorial_periods_per_week):

                    instance_vars = []

                    for teacher_id in eligible_tutorial_teachers:

                        teacher = active_teachers[teacher_id]

                        for room_id in tutorial_room_candidates:

                            for day in day_list:

                                for pi in period_indices:

                                    period = periods[pi]

                                    if not teacher_is_available_for_period(
                                        teacher,
                                        day,
                                        period.start_seconds,
                                        period.end_seconds,
                                    ):
                                        continue

                                    if is_teacher_or_room_locked(
                                        teacher_id,
                                        room_id,
                                        day,
                                        [pi],
                                    ):
                                        continue

                                    key = (
                                        division_id,
                                        None,
                                        subject_id,
                                        instance,
                                        teacher_id,
                                        room_id,
                                        day,
                                        pi,
                                    )

                                    variable = model.new_bool_var(
                                        f"tutorial_{var_count}"
                                    )

                                    var_count += 1

                                    tutorial_vars[key] = variable
                                    instance_vars.append(variable)

                                    teacher_slot_vars.setdefault(
                                        teacher_id, []
                                    ).append((variable, day, pi, 1))

                                    room_slot_vars.setdefault(
                                        room_id, []
                                    ).append((variable, day, pi, 1))

                                    register_whole_division_activity(
                                        variable,
                                        division_id,
                                        day,
                                        pi,
                                    )

                                    teacher_day_vars.setdefault(
                                        (teacher_id, day), []
                                    ).append((variable, 1))

                                    objective_terms.append((variable, pi))

                    _add_exactly_one_or_raise(
                        model,
                        instance_vars,
                        kind="tutorial",
                        division_id=division_id,
                        subject_id=subject_id,
                        instance=instance,
                    )

        # ==============================================================
        # PRACTICALS
        # ==============================================================

        if req.practical_sessions_per_week > 0:

            is_light_lab = subject_id in light_lab_subject_ids

            # Light IKS practicals use normal classrooms in the reference
            # timetable. Technical/heavy practicals use mapped lab rooms.

            if is_light_lab:

                lab_room_candidates = _get_lecture_room_candidates(
                    division, rooms
                )

            else:

                lab_room_candidates = _get_lab_room_candidates(
                    subject_id,
                    division,
                    rooms,
                    subject_rooms,
                )

            if batches:

                # ------------------------------------------------------
                # BATCH-WISE PRACTICALS
                # ------------------------------------------------------

                for batch in batches:

                    eligible_lab_teachers = list(
                        dict.fromkeys(
                            teacher_id
                            for teacher_id in batch_teachers.get(
                                (division_id, subject_id, batch.id),
                                [],
                            )
                            if teacher_id in active_teachers
                        )
                    )

                    for instance in range(
                        req.practical_sessions_per_week
                    ):

                        instance_vars = []

                        for teacher_id in eligible_lab_teachers:

                            teacher = active_teachers[teacher_id]

                            for room_id in lab_room_candidates:

                                for day in day_list:

                                    for pi in valid_lab_starts:

                                        first_period = periods[pi]
                                        second_period = periods[pi + 1]

                                        if not teacher_is_available_for_period(
                                            teacher,
                                            day,
                                            first_period.start_seconds,
                                            second_period.end_seconds,
                                        ):
                                            continue

                                        if is_teacher_or_room_locked(
                                            teacher_id,
                                            room_id,
                                            day,
                                            [pi, pi + 1],
                                        ):
                                            continue

                                        key = (
                                            division_id,
                                            batch.id,
                                            subject_id,
                                            instance,
                                            teacher_id,
                                            room_id,
                                            day,
                                            pi,
                                        )

                                        variable = model.new_bool_var(
                                            f"lab_{var_count}"
                                        )

                                        var_count += 1

                                        lab_vars[key] = variable
                                        instance_vars.append(variable)

                                        if is_light_lab:

                                            light_lab_vars.add(variable)

                                            iks_vars_by_division_day.setdefault(
                                                (division_id, day), []
                                            ).append(variable)

                                        else:

                                            heavy_lab_vars.add(variable)

                                        # Register both periods of the practical.

                                        for offset in (0, 1):

                                            occupied_period = pi + offset

                                            teacher_slot_vars.setdefault(
                                                teacher_id, []
                                            ).append(
                                                (variable, day, occupied_period, 1)
                                            )

                                            room_slot_vars.setdefault(
                                                room_id, []
                                            ).append(
                                                (variable, day, occupied_period, 1)
                                            )

                                            batch_period_vars.setdefault(
                                                (
                                                    batch.id,
                                                    day,
                                                    occupied_period,
                                                ),
                                                [],
                                            ).append(variable)

                                        teacher_day_vars.setdefault(
                                            (teacher_id, day), []
                                        ).append((variable, 2))

                                        lab_div_day_period_vars.setdefault(
                                            (division_id, day), {}
                                        ).setdefault(pi, []).append(variable)

                                        objective_terms.append((variable, pi))

                        lab_quota_vars.setdefault(
                            (division_id, batch.id, subject_id), []
                        ).extend(instance_vars)

                        _add_exactly_one_or_raise(
                            model,
                            instance_vars,
                            kind="lab",
                            division_id=division_id,
                            subject_id=subject_id,
                            instance=instance,
                            batch_id=batch.id,
                        )

            else:

                # ------------------------------------------------------
                # WHOLE-DIVISION PRACTICALS
                # ------------------------------------------------------

                eligible_lab_teachers = list(
                    dict.fromkeys(
                        teacher_id
                        for teacher_id in division_teachers.get(
                            (division_id, subject_id), []
                        )
                        if teacher_id in active_teachers
                    )
                )

                for instance in range(
                    req.practical_sessions_per_week
                ):

                    instance_vars = []

                    for teacher_id in eligible_lab_teachers:

                        teacher = active_teachers[teacher_id]

                        for room_id in lab_room_candidates:

                            for day in day_list:

                                for pi in valid_lab_starts:

                                    first_period = periods[pi]
                                    second_period = periods[pi + 1]

                                    if not teacher_is_available_for_period(
                                        teacher,
                                        day,
                                        first_period.start_seconds,
                                        second_period.end_seconds,
                                    ):
                                        continue

                                    if is_teacher_or_room_locked(
                                        teacher_id,
                                        room_id,
                                        day,
                                        [pi, pi + 1],
                                    ):
                                        continue

                                    key = (
                                        division_id,
                                        None,
                                        subject_id,
                                        instance,
                                        teacher_id,
                                        room_id,
                                        day,
                                        pi,
                                    )

                                    variable = model.new_bool_var(
                                        f"lab_{var_count}"
                                    )

                                    var_count += 1

                                    lab_vars[key] = variable
                                    instance_vars.append(variable)

                                    if is_light_lab:

                                        light_lab_vars.add(variable)

                                        iks_vars_by_division_day.setdefault(
                                            (division_id, day), []
                                        ).append(variable)

                                    else:

                                        heavy_lab_vars.add(variable)

                                    for offset in (0, 1):

                                        occupied_period = pi + offset

                                        teacher_slot_vars.setdefault(
                                            teacher_id, []
                                        ).append(
                                            (variable, day, occupied_period, 1)
                                        )

                                        room_slot_vars.setdefault(
                                            room_id, []
                                        ).append(
                                            (variable, day, occupied_period, 1)
                                        )

                                        register_whole_division_activity(
                                            variable,
                                            division_id,
                                            day,
                                            occupied_period,
                                        )

                                    teacher_day_vars.setdefault(
                                        (teacher_id, day), []
                                    ).append((variable, 2))

                                    lab_div_day_period_vars.setdefault(
                                        (division_id, day), {}
                                    ).setdefault(pi, []).append(variable)

                                    objective_terms.append((variable, pi))

                    lab_quota_vars.setdefault(
                        (division_id, None, subject_id), []
                    ).extend(instance_vars)

                    _add_exactly_one_or_raise(
                        model,
                        instance_vars,
                        kind="lab",
                        division_id=division_id,
                        subject_id=subject_id,
                        instance=instance,
                    )

    logger.info(
        "CP-SAT model built: %d theory vars, %d tutorial vars, %d lab vars, "
        "%d total decision variables.",
        len(theory_vars),
        len(tutorial_vars),
        len(lab_vars),
        var_count,
    )

    # ----------------------------------------------------------------------
    # HARD CONSTRAINTS
    # ----------------------------------------------------------------------

    # C1: A teacher can teach at most one activity in each period.

    teacher_day_period: dict[
        tuple[int, DayOfWeek, int], list[cp_model.IntVar]
    ] = {}

    for teacher_id, entries in teacher_slot_vars.items():

        for variable, day, pi, _span in entries:

            teacher_day_period.setdefault(
                (teacher_id, day, pi), []
            ).append(variable)

    for variables in teacher_day_period.values():

        if len(variables) > 1:

            model.add(sum(variables) <= 1)

    # C2: A room can host at most one activity in each period.

    room_day_period: dict[
        tuple[int, DayOfWeek, int], list[cp_model.IntVar]
    ] = {}

    for room_id, entries in room_slot_vars.items():

        for variable, day, pi, _span in entries:

            room_day_period.setdefault(
                (room_id, day, pi), []
            ).append(variable)

    for variables in room_day_period.values():

        if len(variables) > 1:

            model.add(sum(variables) <= 1)

    # C3: At most one whole-division activity in a division/period.

    for variables in div_period_vars.values():

        if len(variables) > 1:

            model.add(sum(variables) <= 1)

    # C4: At most one activity for each batch in a period.
    # Whole-division activities are registered against every batch.
    # This prevents batch practicals from overlapping whole-division classes.

    for variables in batch_period_vars.values():

        if len(variables) > 1:

            model.add(sum(variables) <= 1)

    # C6:
    # The source currently keeps consecutive theory periods permitted.
    # Do not add a no-back-to-back rule unless the academic specification
    # explicitly requires it; the reference timetable contains adjacent classes.

    # ==============================================================
    # C7: HEAVY/LIGHT PRACTICAL BLOCK RULE
    # ==============================================================

    # Each division/day may use:
    # - At most one heavy-lab starting block.
    # - At most one light-lab starting block.
    # - Light and heavy blocks must be at different starting times.
    # - A light block must be paired with a heavy block on that day.

    for (division_id, day), by_period in lab_div_day_period_vars.items():

        light_blocks: list[cp_model.IntVar] = []
        heavy_blocks: list[cp_model.IntVar] = []

        for pi, variables_at_start in by_period.items():

            block_light = [
                variable
                for variable in variables_at_start
                if variable in light_lab_vars
            ]

            block_heavy = [
                variable
                for variable in variables_at_start
                if variable in heavy_lab_vars
            ]

            light_used = _or_bool(
                model,
                block_light,
                f"light_block_d{division_id}_{day.value}_p{pi}",
            )

            heavy_used = _or_bool(
                model,
                block_heavy,
                f"heavy_block_d{division_id}_{day.value}_p{pi}",
            )

            if light_used is not None:
                light_blocks.append(light_used)

            if heavy_used is not None:
                heavy_blocks.append(heavy_used)

            if light_used is not None and heavy_used is not None:
                model.add(light_used + heavy_used <= 1)

        total_light_blocks = (
            sum(light_blocks) if light_blocks else 0
        )

        total_heavy_blocks = (
            sum(heavy_blocks) if heavy_blocks else 0
        )

        model.add(total_light_blocks <= 1)
        model.add(total_heavy_blocks <= 1)
        model.add(total_light_blocks <= total_heavy_blocks)

    # ==============================================================
    # IKS FIRST/LAST POSITIONAL CONSTRAINT
    # ==============================================================

    # IKS must be either the first or the last scheduled activity
    # for its own batch on that day.
    #
    # This is relative to that batch's actual timetable.
    # It is NOT tied to the college's first or last clock period.

    for key, iks_variable in lab_vars.items():

        (
            division_id,
            batch_id,
            subject_id,
            instance,
            teacher_id,
            room_id,
            day,
            start_pi,
        ) = key

        if subject_id not in light_lab_subject_ids:
            continue

        if batch_id is None:
            continue

        is_first = model.new_bool_var(
            f"iks_first_d{division_id}_b{batch_id}_{day.value}_p{start_pi}"
        )

        is_last = model.new_bool_var(
            f"iks_last_d{division_id}_b{batch_id}_{day.value}_p{start_pi}"
        )

        # Exactly one orientation is selected when this IKS candidate
        # is selected.

        model.add(is_first + is_last == iks_variable)

        # ----------------------------------------------------------
        # OPTION A: IKS IS THE FIRST ACTIVITY FOR THIS BATCH
        # ----------------------------------------------------------

        activities_before: list[cp_model.IntVar] = []

        for pi in range(start_pi):

            activities_before.extend(
                batch_period_vars.get((batch_id, day, pi), [])
            )

        if activities_before:

            model.add(
                sum(activities_before) == 0
            ).only_enforce_if(is_first)

        # ----------------------------------------------------------
        # OPTION B: IKS IS THE LAST ACTIVITY FOR THIS BATCH
        # ----------------------------------------------------------

        activities_after: list[cp_model.IntVar] = []

        for pi in range(start_pi + 2, period_count):

            activities_after.extend(
                batch_period_vars.get((batch_id, day, pi), [])
            )

        if activities_after:

            model.add(
                sum(activities_after) == 0
            ).only_enforce_if(is_last)

    # At most one IKS/light practical may be scheduled
    # in a division per day.

    for variables in iks_vars_by_division_day.values():

        model.add(sum(variables) <= 1)

    # ==============================================================
    # C8: TEACHER DAILY WORKLOAD
    # ==============================================================

    # Labs consume two teaching periods.

    for (teacher_id, day), entries in teacher_day_vars.items():

        teacher = active_teachers.get(teacher_id)

        if teacher is None or not entries:
            continue

        daily_limit = teacher.max_lectures_per_day

        model.add(
            sum(
                variable * periods_used
                for variable, periods_used in entries
            )
            <= daily_limit
        )

    # ----------------------------------------------------------------------
    # SOLVE
    # ----------------------------------------------------------------------

    solver = cp_model.CpSolver()

    solver.parameters.max_time_in_seconds = 480.0
    solver.parameters.num_workers = 8
    solver.parameters.log_search_progress = True

    model.minimize(
        sum(
            variable * weight
            for variable, weight in objective_terms
        )
    )

    logger.info(
        "Starting CP-SAT: %d variables, %d constraints, time limit %.1fs.",
        len(model.proto.variables),
        len(model.proto.constraints),
        solver.parameters.max_time_in_seconds,
    )

    print("--- SOLVER START ---")
    print(f"Variables: {len(model.proto.variables)}")
    print(f"Constraints: {len(model.proto.constraints)}")
    print(f"Time limit: {solver.parameters.max_time_in_seconds}s")

    status = solver.solve(model)

    status_name = solver.status_name(status)

    print("--- SOLVER RESULT ---")
    print(f"Status: {status_name}")
    print(f"Wall time: {solver.wall_time:.2f}s")

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):

        raise ValueError(
            f"No valid timetable could be generated (solver status: {status_name}). "
            "Check the candidate diagnostics, teacher/room constraints, and weekly requirements."
        )

    logger.info(
        "CP-SAT solved: status=%s, wall_time=%.2fs",
        status_name,
        solver.wall_time,
    )

    # ----------------------------------------------------------------------
    # EXTRACT SOLUTION
    # ----------------------------------------------------------------------

    plans: list[_SlotPlan] = []

    # Extract theory slots.

    for key, variable in theory_vars.items():

        if not solver.value(variable):
            continue

        (
            division_id,
            subject_id,
            instance,
            teacher_id,
            room_id,
            day,
            pi,
        ) = key

        period = periods[pi]

        plans.append(
            _SlotPlan(
                division_id=division_id,
                batch_id=None,
                subject_id=subject_id,
                teacher_id=teacher_id,
                room_id=room_id,
                day=day,
                start=_from_seconds(period.start_seconds),
                end=_from_seconds(period.end_seconds),
                is_lab=False,
                is_tutorial=False,
            )
        )

    # Extract tutorial slots.

    for key, variable in tutorial_vars.items():

        if not solver.value(variable):
            continue

        (
            division_id,
            batch_id,
            subject_id,
            instance,
            teacher_id,
            room_id,
            day,
            pi,
        ) = key

        period = periods[pi]

        plans.append(
            _SlotPlan(
                division_id=division_id,
                batch_id=batch_id,
                subject_id=subject_id,
                teacher_id=teacher_id,
                room_id=room_id,
                day=day,
                start=_from_seconds(period.start_seconds),
                end=_from_seconds(period.end_seconds),
                is_lab=False,
                is_tutorial=True,
            )
        )

    # Extract lab slots.
    # A two-period lab is persisted as two single-period rows.

    for key, variable in lab_vars.items():

        if not solver.value(variable):
            continue

        (
            division_id,
            batch_id,
            subject_id,
            instance,
            teacher_id,
            room_id,
            day,
            start_pi,
        ) = key

        for offset in (0, 1):

            period = periods[start_pi + offset]

            plans.append(
                _SlotPlan(
                    division_id=division_id,
                    batch_id=batch_id,
                    subject_id=subject_id,
                    teacher_id=teacher_id,
                    room_id=room_id,
                    day=day,
                    start=_from_seconds(period.start_seconds),
                    end=_from_seconds(period.end_seconds),
                    is_lab=True,
                )
            )

    # Defensive post-solve teacher-clash validation.

    teacher_occupancy: dict[
        tuple[int, DayOfWeek, int], _SlotPlan
    ] = {}

    for plan in plans:

        covered_periods = [
            pi
            for pi, period in enumerate(periods)
            if period.start_seconds >= _to_seconds(plan.start)
            and period.end_seconds <= _to_seconds(plan.end)
        ]

        for pi in covered_periods:

            occupancy_key = (
                plan.teacher_id,
                plan.day,
                pi,
            )

            previous = teacher_occupancy.get(occupancy_key)

            if previous is not None:

                raise ValueError(
                    "CRITICAL CLASH DETECTED: teacher "
                    f"{plan.teacher_id} is assigned twice on {plan.day} "
                    f"at period index {pi}."
                )

            teacher_occupancy[occupancy_key] = plan

    logger.info(
        "Post-solve validation passed: no teacher clashes in %d generated rows.",
        len(plans),
    )

    return plans


# ---------------------------------------------------------------------------
# DATABASE FUNCTIONS
# ---------------------------------------------------------------------------

async def keep_db_alive(db_session: AsyncSession) -> None:
    """Keep the database session active while the solver runs in a worker thread."""

    try:

        while True:

            await asyncio.sleep(60)

            await db_session.execute(text("SELECT 1"))
            await db_session.commit()

            logger.info("Keep-alive ping sent to database.")

    except asyncio.CancelledError:

        pass

    except Exception as exc:

        logger.warning("Keep-alive ping failed: %s", exc)


async def generate_timetable(
    db: AsyncSession,
    division_ids: list[int] | int,
) -> list[TimetableSlot]:
    """Generate timetables for one or more divisions using the CP-SAT solver."""

    if isinstance(division_ids, int):

        normalized_division_ids = [division_ids]

    else:

        normalized_division_ids = list(dict.fromkeys(division_ids))

    if not normalized_division_ids:
        return []

    # Step 1: Load shared generation context.

    ctx = await load_generation_context(db, normalized_division_ids)

    # Step 2: Run pre-flight diagnostics.

    issues = run_diagnostics(ctx)

    errors = [
        issue.message
        for issue in issues
        if issue.severity == "error"
    ]

    if errors:
        raise ValueError("\n".join(errors))

    for issue in issues:

        if issue.severity == "warning":

            logger.warning(
                "Timetable diagnostic warning: %s",
                issue.message,
            )

    # Step 3: Prepare active teacher mappings.

    active_teachers = {
        teacher_id: teacher
        for teacher_id, teacher in ctx.teachers.items()
        if teacher.status == TeacherStatus.ACTIVE
    }

    division_teachers: dict[tuple[int, int], list[int]] = {}
    batch_teachers_map: dict[tuple[int, ...], list[int]] = {}

    for eligibility in ctx.teacher_subject_divisions:

        if eligibility.division_id not in ctx.division_ids:
            continue

        if eligibility.teacher_id not in active_teachers:
            continue

        if eligibility.batch_id is None:

            division_teachers.setdefault(
                (eligibility.division_id, eligibility.subject_id),
                [],
            ).append(eligibility.teacher_id)

        else:

            batch_teachers_map.setdefault(
                (
                    eligibility.division_id,
                    eligibility.subject_id,
                    eligibility.batch_id,
                ),
                [],
            ).append(eligibility.teacher_id)

    # Step 4: Identify light-lab subjects.

    light_lab_subject_ids = {
        subject.id
        for subject in ctx.subject_map.values()
        if getattr(subject, "is_light_lab", False)
    }

    ping_task = asyncio.create_task(keep_db_alive(db))

    try:

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
            light_lab_subject_ids,
        )

    finally:

        ping_task.cancel()

        try:

            await ping_task

        except asyncio.CancelledError:

            pass

    # Step 5: Save only after a feasible solution has been produced.

    async with async_session_maker() as save_db:

        await save_db.execute(
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
                is_tutorial=plan.is_tutorial,
                locked=False,
            )
            for plan in plans
        ]

        if final_slots:
            save_db.add_all(final_slots)

        await save_db.commit()

    logger.info(
        "Successfully generated and saved %d slots for %d division(s).",
        len(final_slots),
        len(ctx.division_ids),
    )

    return final_slots


async def list_slots(
    db: AsyncSession,
    division_id: int,
) -> list[TimetableSlot]:
    """Return stored slots of a division, ordered by day and start time."""

    result = await db.execute(
        select(TimetableSlot)
        .where(TimetableSlot.division_id == division_id)
        .order_by(
            TimetableSlot.day_of_week,
            TimetableSlot.start_time,
            TimetableSlot.id,
        )
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
