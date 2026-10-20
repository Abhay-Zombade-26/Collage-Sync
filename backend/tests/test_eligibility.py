import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.batch import Batch
from app.models.division import Division
from app.models.subject import Subject
from app.models.teacher import Teacher


@pytest.fixture
async def eligibility_seed(
    db_session: AsyncSession,
    seed_active_teacher: Teacher,
) -> dict[str, int]:
    """Seed a Subject, Division and Batch so the eligibility FKs resolve."""
    subject = Subject(name="Data Structures", code="CS201")
    division = Division(department="IT", year="2", name="A", semester=3)
    db_session.add_all([subject, division])
    await db_session.commit()
    await db_session.refresh(subject)
    await db_session.refresh(division)

    batch = Batch(division_id=division.id, name="A1")
    db_session.add(batch)
    await db_session.commit()
    await db_session.refresh(batch)

    return {
        "teacher_id": seed_active_teacher.id,
        "subject_id": subject.id,
        "division_id": division.id,
        "batch_id": batch.id,
    }


def _payload(seed: dict[str, int]) -> dict[str, int]:
    return {
        "teacher_id": seed["teacher_id"],
        "subject_id": seed["subject_id"],
        "division_id": seed["division_id"],
        "batch_id": seed["batch_id"],
    }


async def test_create_eligibility_success(
    client: AsyncClient, eligibility_seed: dict[str, int]
) -> None:
    resp = await client.post("/api/eligibility", json=_payload(eligibility_seed))
    assert resp.status_code == 201
    data = resp.json()
    assert "id" in data
    assert data["teacher_id"] == eligibility_seed["teacher_id"]
    assert data["subject_id"] == eligibility_seed["subject_id"]
    assert data["division_id"] == eligibility_seed["division_id"]
    assert data["batch_id"] == eligibility_seed["batch_id"]
    assert "created_at" in data


async def test_create_eligibility_duplicate_conflict(
    client: AsyncClient, eligibility_seed: dict[str, int]
) -> None:
    first = await client.post("/api/eligibility", json=_payload(eligibility_seed))
    assert first.status_code == 201

    dup = await client.post("/api/eligibility", json=_payload(eligibility_seed))
    assert dup.status_code == 409


async def test_get_eligibility_success(
    client: AsyncClient, eligibility_seed: dict[str, int]
) -> None:
    created = await client.post("/api/eligibility", json=_payload(eligibility_seed))
    assert created.status_code == 201
    eligibility_id: int = created.json()["id"]

    resp = await client.get(f"/api/eligibility/{eligibility_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == eligibility_id
    assert data["subject_id"] == eligibility_seed["subject_id"]


async def test_get_eligibility_not_found(client: AsyncClient) -> None:
    resp = await client.get("/api/eligibility/999999")
    assert resp.status_code == 404


async def test_list_eligibilities(client: AsyncClient, eligibility_seed: dict[str, int]) -> None:
    created = await client.post("/api/eligibility", json=_payload(eligibility_seed))
    assert created.status_code == 201
    eligibility_id: int = created.json()["id"]

    resp = await client.get("/api/eligibility")
    assert resp.status_code == 200
    data: list[dict[str, object]] = resp.json()
    ids = [row["id"] for row in data]
    assert eligibility_id in ids


async def test_update_eligibility_partial(
    client: AsyncClient, eligibility_seed: dict[str, int]
) -> None:
    created = await client.post("/api/eligibility", json=_payload(eligibility_seed))
    assert created.status_code == 201
    eligibility_id: int = created.json()["id"]

    resp = await client.patch(
        f"/api/eligibility/{eligibility_id}",
        json={"batch_id": None},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == eligibility_id
    assert data["batch_id"] is None
    assert data["teacher_id"] == eligibility_seed["teacher_id"]


async def test_delete_eligibility(client: AsyncClient, eligibility_seed: dict[str, int]) -> None:
    created = await client.post("/api/eligibility", json=_payload(eligibility_seed))
    assert created.status_code == 201
    eligibility_id: int = created.json()["id"]

    resp = await client.delete(f"/api/eligibility/{eligibility_id}")
    assert resp.status_code == 204


async def test_get_after_delete_not_found(
    client: AsyncClient, eligibility_seed: dict[str, int]
) -> None:
    created = await client.post("/api/eligibility", json=_payload(eligibility_seed))
    assert created.status_code == 201
    eligibility_id: int = created.json()["id"]

    delete_resp = await client.delete(f"/api/eligibility/{eligibility_id}")
    assert delete_resp.status_code == 204

    resp = await client.get(f"/api/eligibility/{eligibility_id}")
    assert resp.status_code == 404
