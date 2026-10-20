from datetime import time
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.batch import Batch
from app.models.division import Division
from app.models.eligibility import TeacherSubjectDivision
from app.models.enums import (
    EmploymentType,
    RoomType,
    TeacherRole,
    TeacherStatus,
)
from app.models.room import Room
from app.models.subject import Subject
from app.models.teacher import Teacher
from app.models.timetable_settings import TimetableSettings
from app.models.weekly_requirement import WeeklyRequirement


@pytest.fixture
async def timetable_seed(db_session: AsyncSession) -> dict[str, int]:
    """Seed a full division with subjects, requirements, teachers, rooms and settings."""
    division = Division(department="IT", year="2", name="A", semester=3)
    db_session.add(division)
    await db_session.commit()
    await db_session.refresh(division)

    theory_subject = Subject(name="Data Structures", code="CS201")
    lab_subject = Subject(name="DBMS Lab", code="CS202L")
    db_session.add_all([theory_subject, lab_subject])
    await db_session.commit()
    await db_session.refresh(theory_subject)
    await db_session.refresh(lab_subject)

    batch_a1 = Batch(division_id=division.id, name="A1")
    batch_a2 = Batch(division_id=division.id, name="A2")
    db_session.add_all([batch_a1, batch_a2])
    await db_session.commit()
    await db_session.refresh(batch_a1)
    await db_session.refresh(batch_a2)

    db_session.add_all(
        [
            WeeklyRequirement(
                division_id=division.id,
                subject_id=theory_subject.id,
                theory_periods_per_week=2,
                practical_sessions_per_week=0,
                tutorial_periods_per_week=0,
            ),
            WeeklyRequirement(
                division_id=division.id,
                subject_id=lab_subject.id,
                theory_periods_per_week=0,
                practical_sessions_per_week=1,
                tutorial_periods_per_week=0,
            ),
        ]
    )

    teacher_a = Teacher(
        email="solver.a@college.edu",
        name="Solver Teacher A",
        hashed_password="x",
        status=TeacherStatus.ACTIVE,
        is_admin=False,
        role=TeacherRole.TEACHER,
        employment_type=EmploymentType.REGULAR,
        max_lectures_per_day=6,
    )
    teacher_b = Teacher(
        email="solver.b@college.edu",
        name="Solver Teacher B",
        hashed_password="x",
        status=TeacherStatus.ACTIVE,
        is_admin=False,
        role=TeacherRole.TEACHER,
        employment_type=EmploymentType.REGULAR,
        max_lectures_per_day=6,
    )
    db_session.add_all([teacher_a, teacher_b])
    await db_session.commit()
    await db_session.refresh(teacher_a)
    await db_session.refresh(teacher_b)

    db_session.add_all(
        [
            TeacherSubjectDivision(
                teacher_id=teacher_a.id,
                subject_id=theory_subject.id,
                division_id=division.id,
                batch_id=None,
            ),
            TeacherSubjectDivision(
                teacher_id=teacher_b.id,
                subject_id=theory_subject.id,
                division_id=division.id,
                batch_id=None,
            ),
            TeacherSubjectDivision(
                teacher_id=teacher_a.id,
                subject_id=lab_subject.id,
                division_id=division.id,
                batch_id=batch_a1.id,
            ),
            TeacherSubjectDivision(
                teacher_id=teacher_b.id,
                subject_id=lab_subject.id,
                division_id=division.id,
                batch_id=batch_a2.id,
            ),
        ]
    )

    db_session.add_all(
        [
            Room(
                name="LT-1",
                room_type=RoomType.LECTURE,
                division_id=division.id,
            ),
            Room(
                name="LAB-1",
                room_type=RoomType.LAB,
                division_id=division.id,
            ),
            # a second lab room: both batches lab in parallel, so they need
            # two distinct rooms in the same time block
            Room(
                name="LAB-2",
                room_type=RoomType.LAB,
                division_id=division.id,
            ),
        ]
    )

    db_session.add(
        TimetableSettings(
            academic_year="2026-27",
            semester=3,
            start_time=time(9, 0),
            end_time=time(16, 0),
            period_minutes=50,
            lunch_start=time(13, 0),
            lunch_minutes=45,
            school_days=["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
        )
    )
    await db_session.commit()

    return {
        "division_id": division.id,
        "batch_a1_id": batch_a1.id,
        "batch_a2_id": batch_a2.id,
        "subject_id": theory_subject.id,
        "lab_subject_id": lab_subject.id,
        "teacher_a_id": teacher_a.id,
        "teacher_b_id": teacher_b.id,
    }


async def test_generate_timetable_returns_slots(
    client: AsyncClient, timetable_seed: dict[str, int]
) -> None:
    resp = await client.post(
        "/api/timetable/generate",
        json={"division_id": timetable_seed["division_id"]},
    )
    assert resp.status_code == 200
    data: list[dict[str, Any]] = resp.json()
    assert isinstance(data, list)
    assert len(data) > 0

    for slot in data:
        assert slot["id"] is not None
        assert slot["division_id"] == timetable_seed["division_id"]
        assert slot["locked"] is False
        assert slot["teacher_id"] in (
            timetable_seed["teacher_a_id"],
            timetable_seed["teacher_b_id"],
        )


async def test_generate_timetable_lab_is_batch_parallel(
    client: AsyncClient, timetable_seed: dict[str, int]
) -> None:
    resp = await client.post(
        "/api/timetable/generate",
        json={"division_id": timetable_seed["division_id"]},
    )
    assert resp.status_code == 200
    data: list[dict[str, Any]] = resp.json()

    lab_slots = [s for s in data if s["is_lab"]]
    assert len(lab_slots) > 0
    # every batch of the division must have a lab in the same time block
    lab_batches = {s["batch_id"] for s in lab_slots}
    assert lab_batches == {
        timetable_seed["batch_a1_id"],
        timetable_seed["batch_a2_id"],
    }
    # and a lab occupies two consecutive slots
    assert len(lab_slots) % 2 == 0


async def test_generate_timetable_is_persisted(
    client: AsyncClient, timetable_seed: dict[str, int]
) -> None:
    gen = await client.post(
        "/api/timetable/generate",
        json={"division_id": timetable_seed["division_id"]},
    )
    assert gen.status_code == 200

    listed = await client.get(f"/api/timetable/{timetable_seed['division_id']}")
    assert listed.status_code == 200
    data: list[dict[str, Any]] = listed.json()
    generated: list[dict[str, Any]] = gen.json()
    assert len(data) == len(generated)


async def test_generate_timetable_unknown_division(client: AsyncClient) -> None:
    resp = await client.post("/api/timetable/generate", json={"division_id": 999999})
    assert resp.status_code == 404


async def test_list_timetable_slots_for_division(
    client: AsyncClient, timetable_seed: dict[str, int]
) -> None:
    await client.post(
        "/api/timetable/generate",
        json={"division_id": timetable_seed["division_id"]},
    )
    resp = await client.get(f"/api/timetable/{timetable_seed['division_id']}")
    assert resp.status_code == 200
    data: list[dict[str, Any]] = resp.json()
    assert isinstance(data, list)
    for slot in data:
        assert slot["division_id"] == timetable_seed["division_id"]


async def test_patch_slot_sets_locked_and_updates_teacher(
    client: AsyncClient, timetable_seed: dict[str, int]
) -> None:
    gen = await client.post(
        "/api/timetable/generate",
        json={"division_id": timetable_seed["division_id"]},
    )
    assert gen.status_code == 200
    slots: list[dict[str, Any]] = gen.json()
    assert len(slots) > 0
    slot_id: int = slots[0]["id"]

    new_teacher = (
        timetable_seed["teacher_b_id"]
        if slots[0]["teacher_id"] == timetable_seed["teacher_a_id"]
        else timetable_seed["teacher_a_id"]
    )
    resp = await client.patch(
        f"/api/timetable/slots/{slot_id}",
        json={"teacher_id": new_teacher},
    )
    assert resp.status_code == 200
    data: dict[str, Any] = resp.json()
    assert data["id"] == slot_id
    assert data["teacher_id"] == new_teacher
    assert data["locked"] is True


async def test_patch_slot_not_found(client: AsyncClient) -> None:
    resp = await client.patch(
        "/api/timetable/slots/999999",
        json={"teacher_id": 1},
    )
    assert resp.status_code == 404


async def test_locked_slot_survives_regeneration(
    client: AsyncClient, timetable_seed: dict[str, int]
) -> None:
    gen = await client.post(
        "/api/timetable/generate",
        json={"division_id": timetable_seed["division_id"]},
    )
    assert gen.status_code == 200
    slots: list[dict[str, Any]] = gen.json()
    slot_id: int = slots[0]["id"]
    locked_teacher = (
        timetable_seed["teacher_b_id"]
        if slots[0]["teacher_id"] == timetable_seed["teacher_a_id"]
        else timetable_seed["teacher_a_id"]
    )

    patched = await client.patch(
        f"/api/timetable/slots/{slot_id}",
        json={"teacher_id": locked_teacher},
    )
    assert patched.status_code == 200

    regenerated = await client.post(
        "/api/timetable/generate",
        json={"division_id": timetable_seed["division_id"]},
    )
    assert regenerated.status_code == 200

    listed = await client.get(f"/api/timetable/{timetable_seed['division_id']}")
    assert listed.status_code == 200
    listed_slots: list[dict[str, Any]] = listed.json()
    by_id: dict[int, dict[str, Any]] = {s["id"]: s for s in listed_slots}
    assert slot_id in by_id
    assert by_id[slot_id]["locked"] is True
    assert by_id[slot_id]["teacher_id"] == locked_teacher
