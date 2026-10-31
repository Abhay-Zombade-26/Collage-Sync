"""Unit tests for the pre-flight timetable diagnostics module.

These tests run purely in-memory using lightweight domain objects and GenerationContext,
with zero database dependencies or I/O.
"""

from __future__ import annotations

from datetime import time

from app.models.batch import Batch
from app.models.division import Division
from app.models.eligibility import TeacherSubjectDivision
from app.models.enums import DayOfWeek, EmploymentType, RoomType, TeacherStatus
from app.models.room import Room
from app.models.room_subject import RoomSubject
from app.models.subject import Subject
from app.models.teacher import Teacher
from app.models.timetable_settings import TimetableSettings
from app.services.timetable.context import GenerationContext, _Period
from app.services.timetable.diagnostics import DiagnosticIssue, run_diagnostics
from app.models.weekly_requirement import WeeklyRequirement


# ---------------------------------------------------------------------------
# Test Helpers / Fixture Builders
# ---------------------------------------------------------------------------

def _build_test_settings(
    periods_per_day: int = 6,
    days: list[DayOfWeek] | None = None,
) -> tuple[TimetableSettings, list[_Period], list[DayOfWeek]]:
    school_days = days or [
        DayOfWeek.MONDAY,
        DayOfWeek.TUESDAY,
        DayOfWeek.WEDNESDAY,
        DayOfWeek.THURSDAY,
        DayOfWeek.FRIDAY,
    ]
    settings = TimetableSettings(
        id=1,
        academic_year="2026-27",
        semester=3,
        start_time=time(9, 0),
        end_time=time(17, 0),
        period_minutes=60,
        lunch_start=time(13, 0),
        lunch_minutes=60,
        school_days=[d.value for d in school_days],
    )
    periods = [
        _Period(index=i + 1, start_seconds=3600 * (9 + i), end_seconds=3600 * (10 + i))
        for i in range(periods_per_day)
    ]
    return settings, periods, school_days


def _build_context(
    *,
    division: Division,
    batches: list[Batch] | None = None,
    subjects: list[Subject],
    requirements: list[WeeklyRequirement],
    teachers: list[Teacher],
    eligibilities: list[TeacherSubjectDivision],
    rooms: list[Room] | None = None,
    room_subjects: list[RoomSubject] | None = None,
    periods_per_day: int = 6,
    days: list[DayOfWeek] | None = None,
) -> GenerationContext:
    settings, periods, school_days = _build_test_settings(
        periods_per_day=periods_per_day, days=days
    )
    div_batches = {division.id: batches or []}
    return GenerationContext(
        division_ids=[division.id],
        division_map={division.id: division},
        division_batches=div_batches,
        settings=settings,
        requirements=requirements,
        subject_map={s.id: s for s in subjects},
        teacher_subject_divisions=eligibilities,
        teachers={t.id: t for t in teachers},
        rooms=rooms or [],
        room_subjects=room_subjects or [],
        school_days=school_days,
        periods=periods,
        existing_slots=[],
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_audit_a_grid_overload() -> None:
    """Audit A: Requirements exceed total available periods in the timetable grid."""
    division = Division(id=1, name="A", year="SE", branch_id=1, semester=3)
    subject = Subject(id=1, name="Data Structures", code="CS201", subject_type="THEORY")
    # Grid: 6 periods/day * 5 days = 30 available periods/week
    # Requirement: 35 periods/week -> overload by 5
    req = WeeklyRequirement(
        id=1,
        division_id=division.id,
        subject_id=subject.id,
        theory_periods_per_week=35,
        practical_sessions_per_week=0,
        tutorial_periods_per_week=0,
    )
    teacher = Teacher(
        id=1,
        name="Dr. Smith",
        email="smith@example.com",
        hashed_password="hash",
        status=TeacherStatus.ACTIVE,
        max_lectures_per_day=10,
    )
    eligibility = TeacherSubjectDivision(
        id=1, teacher_id=teacher.id, subject_id=subject.id, division_id=division.id, batch_id=None
    )

    ctx = _build_context(
        division=division,
        subjects=[subject],
        requirements=[req],
        teachers=[teacher],
        eligibilities=[eligibility],
        periods_per_day=6,
    )

    issues = run_diagnostics(ctx)
    errors = [i for i in issues if i.severity == "error"]

    assert len(errors) == 1
    assert "SE A needs 35 periods/week" in errors[0].message
    assert "timetable grid only has 30 periods/week available (6 periods × 5 days)" in errors[0].message


def test_audit_b_zero_eligibility_rows() -> None:
    """Audit B: Division + Subject with zero rows in eligibility table."""
    division = Division(id=1, name="A", year="SE", branch_id=1, semester=3)
    subject = Subject(id=1, name="Digital Marketing", code="CS202", subject_type="THEORY")
    req = WeeklyRequirement(
        id=1,
        division_id=division.id,
        subject_id=subject.id,
        theory_periods_per_week=3,
        practical_sessions_per_week=0,
        tutorial_periods_per_week=0,
    )

    ctx = _build_context(
        division=division,
        subjects=[subject],
        requirements=[req],
        teachers=[],
        eligibilities=[],  # Zero rows
    )

    issues = run_diagnostics(ctx)
    errors = [i for i in issues if i.severity == "error"]

    assert any(
        "No teacher is eligible to teach Digital Marketing for SE A (no row in the eligibility table)."
        in e.message
        for e in errors
    )


def test_audit_b_pending_teacher() -> None:
    """Audit B: Teacher exists in eligibility but status is PENDING (not ACTIVE)."""
    division = Division(id=1, name="A", year="SE", branch_id=1, semester=3)
    subject = Subject(id=1, name="Operating Systems", code="CS203", subject_type="THEORY")
    req = WeeklyRequirement(
        id=1,
        division_id=division.id,
        subject_id=subject.id,
        theory_periods_per_week=4,
        practical_sessions_per_week=0,
        tutorial_periods_per_week=0,
    )
    teacher = Teacher(
        id=10,
        name="Prof. Sharma",
        email="sharma@example.com",
        hashed_password="hash",
        status=TeacherStatus.PENDING,
        max_lectures_per_day=6,
    )
    eligibility = TeacherSubjectDivision(
        id=1, teacher_id=teacher.id, subject_id=subject.id, division_id=division.id, batch_id=None
    )

    ctx = _build_context(
        division=division,
        subjects=[subject],
        requirements=[req],
        teachers=[teacher],
        eligibilities=[eligibility],
    )

    issues = run_diagnostics(ctx)
    errors = [i for i in issues if i.severity == "error"]

    assert any(
        "Operating Systems for SE A is only mapped to teacher(s) Prof. Sharma who are not yet ACTIVE (status: PENDING)"
        in e.message
        for e in errors
    )


def test_audit_b_lab_missing_one_batch() -> None:
    """Audit B: Lab subject missing eligible teacher for one specific batch out of three."""
    division = Division(id=1, name="A", year="TE", branch_id=1, semester=5)
    batches = [
        Batch(id=1, division_id=division.id, name="A1"),
        Batch(id=2, division_id=division.id, name="A2"),
        Batch(id=3, division_id=division.id, name="A3"),
    ]
    subject = Subject(id=1, name="DevOps Lab", code="CS501L", subject_type="LAB")
    req = WeeklyRequirement(
        id=1,
        division_id=division.id,
        subject_id=subject.id,
        theory_periods_per_week=0,
        practical_sessions_per_week=1,
        tutorial_periods_per_week=0,
    )
    teacher = Teacher(
        id=1,
        name="Dr. Taylor",
        email="taylor@example.com",
        hashed_password="hash",
        status=TeacherStatus.ACTIVE,
        max_lectures_per_day=6,
    )
    # Map teacher to A1 and A2, but NOT A3
    eligibilities = [
        TeacherSubjectDivision(
            id=1, teacher_id=teacher.id, subject_id=subject.id, division_id=division.id, batch_id=1
        ),
        TeacherSubjectDivision(
            id=2, teacher_id=teacher.id, subject_id=subject.id, division_id=division.id, batch_id=2
        ),
    ]

    ctx = _build_context(
        division=division,
        batches=batches,
        subjects=[subject],
        requirements=[req],
        teachers=[teacher],
        eligibilities=eligibilities,
    )

    issues = run_diagnostics(ctx)
    errors = [i for i in issues if i.severity == "error"]

    assert any(
        "No teacher is eligible to teach DevOps Lab lab for TE A batch A3." in e.message
        for e in errors
    )


def test_audit_c_lab_room_shortage() -> None:
    """Audit C: Lab needing 3 parallel sessions but only 1 room mapped via room_subjects."""
    division = Division(id=1, name="A", year="TE", branch_id=1, semester=5)
    batches = [
        Batch(id=1, division_id=division.id, name="A1"),
        Batch(id=2, division_id=division.id, name="A2"),
        Batch(id=3, division_id=division.id, name="A3"),
    ]
    subject = Subject(id=1, name="Web Lab", code="CS502L", subject_type="LAB")
    req = WeeklyRequirement(
        id=1,
        division_id=division.id,
        subject_id=subject.id,
        theory_periods_per_week=0,
        practical_sessions_per_week=1,
        tutorial_periods_per_week=0,
    )
    teacher = Teacher(
        id=1,
        name="Dr. Taylor",
        email="taylor@example.com",
        hashed_password="hash",
        status=TeacherStatus.ACTIVE,
        max_lectures_per_day=6,
    )
    eligibilities = [
        TeacherSubjectDivision(
            id=i, teacher_id=teacher.id, subject_id=subject.id, division_id=division.id, batch_id=b.id
        )
        for i, b in enumerate(batches, start=1)
    ]
    # Only 1 Lab Room mapped
    room1 = Room(id=101, name="Lab 101", room_type=RoomType.LAB, branch_id=1, year="TE")
    room_subjects = [RoomSubject(id=1, room_id=room1.id, subject_id=subject.id)]

    ctx = _build_context(
        division=division,
        batches=batches,
        subjects=[subject],
        requirements=[req],
        teachers=[teacher],
        eligibilities=eligibilities,
        rooms=[room1],
        room_subjects=room_subjects,
    )

    issues = run_diagnostics(ctx)
    errors = [i for i in issues if i.severity == "error"]

    assert any(
        "TE A needs 3 parallel Web Lab sessions (A1, A2, A3) but only 1 lab room(s) are mapped to Web Lab via room_subjects — need 2 more."
        in e.message
        for e in errors
    )


def test_audit_d_sole_provider_overload() -> None:
    """Audit D: Sole eligible teacher's assigned periods exceed weekly capacity."""
    division = Division(id=1, name="A", year="TE", branch_id=1, semester=5)
    subject1 = Subject(id=1, name="AIML", code="CS503", subject_type="THEORY")
    subject2 = Subject(id=2, name="Cloud Computing", code="CS504", subject_type="THEORY")

    # 12 + 12 = 24 periods/week needed
    req1 = WeeklyRequirement(
        id=1,
        division_id=division.id,
        subject_id=subject1.id,
        theory_periods_per_week=12,
        practical_sessions_per_week=0,
        tutorial_periods_per_week=0,
    )
    req2 = WeeklyRequirement(
        id=2,
        division_id=division.id,
        subject_id=subject2.id,
        theory_periods_per_week=12,
        practical_sessions_per_week=0,
        tutorial_periods_per_week=0,
    )

    # Teacher capacity: 4/day * 5 days = 20 periods/week
    teacher = Teacher(
        id=1,
        name="Khot",
        email="khot@example.com",
        hashed_password="hash",
        status=TeacherStatus.ACTIVE,
        max_lectures_per_day=4,
    )

    # Khot is sole eligible teacher for both
    eligibilities = [
        TeacherSubjectDivision(
            id=1, teacher_id=teacher.id, subject_id=subject1.id, division_id=division.id, batch_id=None
        ),
        TeacherSubjectDivision(
            id=2, teacher_id=teacher.id, subject_id=subject2.id, division_id=division.id, batch_id=None
        ),
    ]

    ctx = _build_context(
        division=division,
        subjects=[subject1, subject2],
        requirements=[req1, req2],
        teachers=[teacher],
        eligibilities=eligibilities,
    )

    issues = run_diagnostics(ctx)
    errors = [i for i in issues if i.severity == "error"]

    assert len(errors) == 1
    assert "Teacher Khot is overloaded: sole eligible teacher for" in errors[0].message
    assert "= 24 periods/week, but capacity is only 20 periods/week (4/day × 5 days)" in errors[0].message
    assert "Need 4 more periods of capacity" in errors[0].message


def test_audit_d_shared_provider_warning() -> None:
    """Audit D: Sole load does not exceed capacity, but estimated shared load exceeds capacity."""
    division = Division(id=1, name="A", year="TE", branch_id=1, semester=5)
    subject_sole = Subject(id=1, name="Cyber Security", code="CS505", subject_type="THEORY")
    subject_shared = Subject(id=2, name="Data Science", code="CS506", subject_type="THEORY")

    # Teacher capacity: 4/day * 5 days = 20 periods/week
    teacher1 = Teacher(
        id=1,
        name="Alice",
        email="alice@example.com",
        hashed_password="hash",
        status=TeacherStatus.ACTIVE,
        max_lectures_per_day=4,
    )
    teacher2 = Teacher(
        id=2,
        name="Bob",
        email="bob@example.com",
        hashed_password="hash",
        status=TeacherStatus.ACTIVE,
        max_lectures_per_day=4,
    )

    # Requirements:
    # Cyber Security: 10 periods (Alice is sole teacher -> sole load = 10, <= 20)
    # Data Science: 24 periods (Shared by Alice & Bob -> 24 / 2 = 12 periods each)
    # Total estimated for Alice = 10 + 12 = 22 periods > 20 capacity
    req1 = WeeklyRequirement(
        id=1,
        division_id=division.id,
        subject_id=subject_sole.id,
        theory_periods_per_week=10,
        practical_sessions_per_week=0,
        tutorial_periods_per_week=0,
    )
    req2 = WeeklyRequirement(
        id=2,
        division_id=division.id,
        subject_id=subject_shared.id,
        theory_periods_per_week=24,
        practical_sessions_per_week=0,
        tutorial_periods_per_week=0,
    )

    eligibilities = [
        # Alice is sole teacher for subject_sole
        TeacherSubjectDivision(
            id=1, teacher_id=teacher1.id, subject_id=subject_sole.id, division_id=division.id, batch_id=None
        ),
        # Alice and Bob share subject_shared
        TeacherSubjectDivision(
            id=2, teacher_id=teacher1.id, subject_id=subject_shared.id, division_id=division.id, batch_id=None
        ),
        TeacherSubjectDivision(
            id=3, teacher_id=teacher2.id, subject_id=subject_shared.id, division_id=division.id, batch_id=None
        ),
    ]

    ctx = _build_context(
        division=division,
        subjects=[subject_sole, subject_shared],
        requirements=[req1, req2],
        teachers=[teacher1, teacher2],
        eligibilities=eligibilities,
    )

    issues = run_diagnostics(ctx)
    errors = [i for i in issues if i.severity == "error"]
    warnings = [i for i in issues if i.severity == "warning"]

    # Sole provider check should NOT error
    assert errors == []

    # Warning for Alice being stretched thin
    alice_warnings = [w for w in warnings if "Teacher Alice may be stretched thin" in w.message]
    assert len(alice_warnings) == 1
    assert "estimated 22 periods/week demand across 2 subject/division pairs vs 20 periods/week capacity" in alice_warnings[0].message


def test_all_clear() -> None:
    """All audits pass without any errors or warnings."""
    division = Division(id=1, name="A", year="SE", branch_id=1, semester=3)
    subject = Subject(id=1, name="Maths III", code="CS301", subject_type="THEORY")
    req = WeeklyRequirement(
        id=1,
        division_id=division.id,
        subject_id=subject.id,
        theory_periods_per_week=4,
        practical_sessions_per_week=0,
        tutorial_periods_per_week=0,
    )
    teacher = Teacher(
        id=1,
        name="Dr. Euler",
        email="euler@example.com",
        hashed_password="hash",
        status=TeacherStatus.ACTIVE,
        max_lectures_per_day=4,
    )
    eligibility = TeacherSubjectDivision(
        id=1, teacher_id=teacher.id, subject_id=subject.id, division_id=division.id, batch_id=None
    )
    room = Room(id=10, name="LH-1", room_type=RoomType.LECTURE, branch_id=1, year="SE")

    ctx = _build_context(
        division=division,
        subjects=[subject],
        requirements=[req],
        teachers=[teacher],
        eligibilities=[eligibility],
        rooms=[room],
    )

    issues = run_diagnostics(ctx)
    assert issues == []
