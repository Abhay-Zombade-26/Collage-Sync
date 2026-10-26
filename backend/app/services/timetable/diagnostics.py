"""Pre-flight diagnostics module for timetable generation.

Performs data audits prior to invoking the CP-SAT solver:
- Audit A: Division grid overload
- Audit B: Missing/inactive teacher eligibility per division & subject
- Audit C: Lab room capacity ("Lab Batch Trap")
- Audit D: Teacher capacity (sole-provider hard check & shared-provider soft warning)
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

from app.models.enums import RoomType, TeacherStatus
from app.services.timetable.context import GenerationContext, _get_lab_room_candidates


@dataclass(frozen=True)
class DiagnosticIssue:
    severity: Literal["error", "warning"]
    message: str


@dataclass
class _TeachingDemand:
    division_id: int
    subject_id: int
    batch_id: int | None
    batch_name: str | None
    periods: int
    eligible_teacher_ids: set[int]


def run_diagnostics(ctx: GenerationContext) -> list[DiagnosticIssue]:
    """Run pre-flight diagnostics audits against the loaded GenerationContext."""
    issues: list[DiagnosticIssue] = []

    # -----------------------------------------------------------------------
    # Audit A — Grid overload (per division)
    # -----------------------------------------------------------------------
    available_periods_per_week = len(ctx.periods) * len(ctx.school_days)
    for div_id in ctx.division_ids:
        division = ctx.division_map.get(div_id)
        if not division:
            continue
        div_reqs = [r for r in ctx.requirements if r.division_id == div_id]
        required_periods = sum(
            (r.theory_periods_per_week or 0)
            + (r.tutorial_periods_per_week or 0)
            + ((r.practical_sessions_per_week or 0) * 2)
            for r in div_reqs
        )
        if required_periods > available_periods_per_week:
            issues.append(
                DiagnosticIssue(
                    severity="error",
                    message=(
                        f"{division.year} {division.name} needs {required_periods} periods/week "
                        f"but the timetable grid only has {available_periods_per_week} periods/week available "
                        f"({len(ctx.periods)} periods × {len(ctx.school_days)} days). "
                        "Reduce weekly requirements or extend the daily/weekly grid in Timetable Settings."
                    ),
                )
            )

    # -----------------------------------------------------------------------
    # Audit B — No eligible teacher at all (per division+subject)
    # -----------------------------------------------------------------------
    for req in ctx.requirements:
        division = ctx.division_map.get(req.division_id)
        subject = ctx.subject_map.get(req.subject_id)
        if not division or not subject:
            continue

        th_tut_periods = (req.theory_periods_per_week or 0) + (req.tutorial_periods_per_week or 0)
        if th_tut_periods > 0:
            matching_theory_rows = [
                e
                for e in ctx.teacher_subject_divisions
                if e.division_id == req.division_id
                and e.subject_id == req.subject_id
                and e.batch_id is None
            ]
            if not matching_theory_rows:
                issues.append(
                    DiagnosticIssue(
                        severity="error",
                        message=(
                            f"No teacher is eligible to teach {subject.name} for "
                            f"{division.year} {division.name} (no row in the eligibility table)."
                        ),
                    )
                )
            else:
                active_theory_teachers = [
                    ctx.teachers[e.teacher_id]
                    for e in matching_theory_rows
                    if e.teacher_id in ctx.teachers
                    and ctx.teachers[e.teacher_id].status == TeacherStatus.ACTIVE
                ]
                if not active_theory_teachers:
                    non_active_teachers = [
                        ctx.teachers[e.teacher_id]
                        for e in matching_theory_rows
                        if e.teacher_id in ctx.teachers
                    ]
                    names = (
                        ", ".join(dict.fromkeys(t.name for t in non_active_teachers))
                        if non_active_teachers
                        else "Unknown"
                    )
                    statuses = (
                        ", ".join(
                            dict.fromkeys(
                                str(getattr(t.status, "value", t.status))
                                for t in non_active_teachers
                            )
                        )
                        if non_active_teachers
                        else "INACTIVE"
                    )
                    issues.append(
                        DiagnosticIssue(
                            severity="error",
                            message=(
                                f"{subject.name} for {division.year} {division.name} is only mapped to "
                                f"teacher(s) {names} who are not yet ACTIVE (status: {statuses}) — "
                                "approve them or assign an active teacher."
                            ),
                        )
                    )

        if (req.practical_sessions_per_week or 0) > 0:
            batches = ctx.division_batches.get(req.division_id, [])
            if batches:
                for batch in batches:
                    matching_lab_rows = [
                        e
                        for e in ctx.teacher_subject_divisions
                        if e.division_id == req.division_id
                        and e.subject_id == req.subject_id
                        and e.batch_id == batch.id
                    ]
                    active_lab_teachers = [
                        ctx.teachers[e.teacher_id]
                        for e in matching_lab_rows
                        if e.teacher_id in ctx.teachers
                        and ctx.teachers[e.teacher_id].status == TeacherStatus.ACTIVE
                    ]
                    if not active_lab_teachers:
                        if not matching_lab_rows:
                            issues.append(
                                DiagnosticIssue(
                                    severity="error",
                                    message=(
                                        f"No teacher is eligible to teach {subject.name} lab for "
                                        f"{division.year} {division.name} batch {batch.name}."
                                    ),
                                )
                            )
                        else:
                            non_active = [
                                ctx.teachers[e.teacher_id]
                                for e in matching_lab_rows
                                if e.teacher_id in ctx.teachers
                            ]
                            names = (
                                ", ".join(dict.fromkeys(t.name for t in non_active))
                                if non_active
                                else "Unknown"
                            )
                            statuses = (
                                ", ".join(
                                    dict.fromkeys(
                                        str(getattr(t.status, "value", t.status))
                                        for t in non_active
                                    )
                                )
                                if non_active
                                else "INACTIVE"
                            )
                            issues.append(
                                DiagnosticIssue(
                                    severity="error",
                                    message=(
                                        f"{subject.name} lab for {division.year} {division.name} batch {batch.name} "
                                        f"is only mapped to teacher(s) {names} who are not yet ACTIVE "
                                        f"(status: {statuses}) — approve them or assign an active teacher."
                                    ),
                                )
                            )
            else:
                matching_lab_rows = [
                    e
                    for e in ctx.teacher_subject_divisions
                    if e.division_id == req.division_id
                    and e.subject_id == req.subject_id
                    and e.batch_id is None
                ]
                active_lab_teachers = [
                    ctx.teachers[e.teacher_id]
                    for e in matching_lab_rows
                    if e.teacher_id in ctx.teachers
                    and ctx.teachers[e.teacher_id].status == TeacherStatus.ACTIVE
                ]
                if not active_lab_teachers:
                    issues.append(
                        DiagnosticIssue(
                            severity="error",
                            message=(
                                f"No teacher is eligible to teach {subject.name} lab for "
                                f"{division.year} {division.name}."
                            ),
                        )
                    )

    # -----------------------------------------------------------------------
    # Audit C — Lab room capacity ("Lab Batch Trap")
    # -----------------------------------------------------------------------
    for req in ctx.requirements:
        if (req.practical_sessions_per_week or 0) <= 0:
            continue
        batches = ctx.division_batches.get(req.division_id, [])
        if not batches:
            continue

        division = ctx.division_map.get(req.division_id)
        subject = ctx.subject_map.get(req.subject_id)
        if not division or not subject:
            continue

        n_batches = len(batches)
        batch_names = [b.name for b in batches]

        candidate_room_ids = _get_lab_room_candidates(
            req.subject_id, division, ctx.rooms, ctx.subject_rooms
        )
        lab_room_ids = {
            r.id for r in ctx.rooms if r.id in candidate_room_ids and r.room_type == RoomType.LAB
        }
        n_rooms = len(lab_room_ids)

        if n_rooms < n_batches:
            deficit = n_batches - n_rooms
            issues.append(
                DiagnosticIssue(
                    severity="error",
                    message=(
                        f"{division.year} {division.name} needs {n_batches} parallel {subject.name} sessions "
                        f"({', '.join(batch_names)}) but only {n_rooms} lab room(s) are mapped to "
                        f"{subject.name} via room_subjects — need {deficit} more."
                    ),
                )
            )

    # -----------------------------------------------------------------------
    # Audit D — Teacher capacity (sole vs shared provider)
    # -----------------------------------------------------------------------
    teaching_units: list[_TeachingDemand] = []
    for req in ctx.requirements:
        th_tut = (req.theory_periods_per_week or 0) + (req.tutorial_periods_per_week or 0)
        if th_tut > 0:
            eligible_ids = {
                e.teacher_id
                for e in ctx.teacher_subject_divisions
                if e.division_id == req.division_id
                and e.subject_id == req.subject_id
                and e.batch_id is None
                and e.teacher_id in ctx.teachers
                and ctx.teachers[e.teacher_id].status == TeacherStatus.ACTIVE
            }
            teaching_units.append(
                _TeachingDemand(
                    division_id=req.division_id,
                    subject_id=req.subject_id,
                    batch_id=None,
                    batch_name=None,
                    periods=th_tut,
                    eligible_teacher_ids=eligible_ids,
                )
            )

        pr_sessions = req.practical_sessions_per_week or 0
        if pr_sessions > 0:
            batches = ctx.division_batches.get(req.division_id, [])
            if batches:
                for b in batches:
                    b_teachers = {
                        e.teacher_id
                        for e in ctx.teacher_subject_divisions
                        if e.division_id == req.division_id
                        and e.subject_id == req.subject_id
                        and e.batch_id == b.id
                        and e.teacher_id in ctx.teachers
                        and ctx.teachers[e.teacher_id].status == TeacherStatus.ACTIVE
                    }
                    if not b_teachers:
                        # Fallback to whole-division mapping if no batch-specific mapping exists
                        b_teachers = {
                            e.teacher_id
                            for e in ctx.teacher_subject_divisions
                            if e.division_id == req.division_id
                            and e.subject_id == req.subject_id
                            and e.batch_id is None
                            and e.teacher_id in ctx.teachers
                            and ctx.teachers[e.teacher_id].status == TeacherStatus.ACTIVE
                        }
                    teaching_units.append(
                        _TeachingDemand(
                            division_id=req.division_id,
                            subject_id=req.subject_id,
                            batch_id=b.id,
                            batch_name=b.name,
                            periods=pr_sessions * 2,
                            eligible_teacher_ids=b_teachers,
                        )
                    )
            else:
                eligible_ids = {
                    e.teacher_id
                    for e in ctx.teacher_subject_divisions
                    if e.division_id == req.division_id
                    and e.subject_id == req.subject_id
                    and e.batch_id is None
                    and e.teacher_id in ctx.teachers
                    and ctx.teachers[e.teacher_id].status == TeacherStatus.ACTIVE
                }
                teaching_units.append(
                    _TeachingDemand(
                        division_id=req.division_id,
                        subject_id=req.subject_id,
                        batch_id=None,
                        batch_name=None,
                        periods=pr_sessions * 2,
                        eligible_teacher_ids=eligible_ids,
                    )
                )

    distinct_teacher_ids = {
        e.teacher_id
        for e in ctx.teacher_subject_divisions
        if e.division_id in ctx.division_ids and e.teacher_id in ctx.teachers
    }

    for t_id in sorted(distinct_teacher_ids):
        teacher = ctx.teachers[t_id]
        if teacher.status != TeacherStatus.ACTIVE:
            continue

        weekly_capacity = (teacher.max_lectures_per_day or 6) * len(ctx.school_days)

        sole_units: list[_TeachingDemand] = []
        sole_periods = 0
        all_units: list[_TeachingDemand] = []
        shared_estimated_periods = 0

        for unit in teaching_units:
            if t_id in unit.eligible_teacher_ids:
                all_units.append(unit)
                num_eligible = len(unit.eligible_teacher_ids)
                share = math.ceil(unit.periods / num_eligible)
                shared_estimated_periods += share

                if num_eligible == 1:
                    sole_units.append(unit)
                    sole_periods += unit.periods

        if sole_periods > weekly_capacity:
            breakdown_entries: list[str] = []
            for unit in sole_units:
                div = ctx.division_map.get(unit.division_id)
                subj = ctx.subject_map.get(unit.subject_id)
                subj_name = subj.name if subj else f"Subject #{unit.subject_id}"
                div_label = (
                    f"{div.year}-{div.name}"
                    if div and div.year and not div.name.startswith(div.year)
                    else (div.name if div else f"Div-{unit.division_id}")
                )
                if unit.batch_name:
                    breakdown_entries.append(
                        f"{subj_name}({div_label} batch {unit.batch_name})"
                    )
                else:
                    breakdown_entries.append(f"{subj_name}({div_label})")

            breakdown = ", ".join(breakdown_entries)
            deficit = sole_periods - weekly_capacity
            issues.append(
                DiagnosticIssue(
                    severity="error",
                    message=(
                        f"Teacher {teacher.name} is overloaded: sole eligible teacher for "
                        f"{breakdown} = {sole_periods} periods/week, but capacity is only "
                        f"{weekly_capacity} periods/week ({teacher.max_lectures_per_day}/day × "
                        f"{len(ctx.school_days)} days). Need {deficit} more periods of capacity — "
                        "raise their daily cap or add another eligible teacher."
                    ),
                )
            )
        elif shared_estimated_periods > weekly_capacity:
            issues.append(
                DiagnosticIssue(
                    severity="warning",
                    message=(
                        f"Teacher {teacher.name} may be stretched thin: estimated "
                        f"{shared_estimated_periods} periods/week demand across {len(all_units)} "
                        f"subject/division pairs vs {weekly_capacity} periods/week capacity. "
                        "This is an estimate assuming even sharing with co-eligible teachers — "
                        "may still be feasible."
                    ),
                )
            )

    return issues
