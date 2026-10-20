import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.division import Division
from app.models.subject import Subject


@pytest.fixture
async def weekly_requirement_seed(db_session: AsyncSession) -> dict[str, int]:
    """Seed a Division and a Subject so the weekly-requirement FKs resolve."""
    subject = Subject(name="Operating Systems", code="CS301")
    division = Division(department="IT", year="3", name="B", semester=5)
    db_session.add_all([subject, division])
    await db_session.commit()
    await db_session.refresh(subject)
    await db_session.refresh(division)

    return {
        "division_id": division.id,
        "subject_id": subject.id,
    }


def _payload(seed: dict[str, int]) -> dict[str, int]:
    return {
        "division_id": seed["division_id"],
        "subject_id": seed["subject_id"],
        "theory_periods_per_week": 3,
        "practical_sessions_per_week": 1,
        "tutorial_periods_per_week": 0,
    }


async def test_create_weekly_requirement_success(
    client: AsyncClient, weekly_requirement_seed: dict[str, int]
) -> None:
    resp = await client.post("/api/weekly-requirement", json=_payload(weekly_requirement_seed))
    assert resp.status_code == 201
    data = resp.json()
    assert "id" in data
    assert data["division_id"] == weekly_requirement_seed["division_id"]
    assert data["subject_id"] == weekly_requirement_seed["subject_id"]
    assert data["theory_periods_per_week"] == 3
    assert data["practical_sessions_per_week"] == 1
    assert data["tutorial_periods_per_week"] == 0
    assert "created_at" in data


async def test_create_weekly_requirement_duplicate_conflict(
    client: AsyncClient, weekly_requirement_seed: dict[str, int]
) -> None:
    first = await client.post("/api/weekly-requirement", json=_payload(weekly_requirement_seed))
    assert first.status_code == 201

    dup = await client.post("/api/weekly-requirement", json=_payload(weekly_requirement_seed))
    assert dup.status_code == 409


async def test_get_weekly_requirement_success(
    client: AsyncClient, weekly_requirement_seed: dict[str, int]
) -> None:
    created = await client.post("/api/weekly-requirement", json=_payload(weekly_requirement_seed))
    assert created.status_code == 201
    requirement_id: int = created.json()["id"]

    resp = await client.get(f"/api/weekly-requirement/{requirement_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == requirement_id
    assert data["subject_id"] == weekly_requirement_seed["subject_id"]


async def test_get_weekly_requirement_not_found(client: AsyncClient) -> None:
    resp = await client.get("/api/weekly-requirement/999999")
    assert resp.status_code == 404


async def test_list_weekly_requirements(
    client: AsyncClient, weekly_requirement_seed: dict[str, int]
) -> None:
    created = await client.post("/api/weekly-requirement", json=_payload(weekly_requirement_seed))
    assert created.status_code == 201
    requirement_id: int = created.json()["id"]

    resp = await client.get("/api/weekly-requirement")
    assert resp.status_code == 200
    data: list[dict[str, object]] = resp.json()
    ids = [row["id"] for row in data]
    assert requirement_id in ids


async def test_update_weekly_requirement_partial(
    client: AsyncClient, weekly_requirement_seed: dict[str, int]
) -> None:
    created = await client.post("/api/weekly-requirement", json=_payload(weekly_requirement_seed))
    assert created.status_code == 201
    requirement_id: int = created.json()["id"]

    resp = await client.patch(
        f"/api/weekly-requirement/{requirement_id}",
        json={"theory_periods_per_week": 4},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == requirement_id
    assert data["theory_periods_per_week"] == 4
    # untouched fields keep their previous values
    assert data["practical_sessions_per_week"] == 1
    assert data["division_id"] == weekly_requirement_seed["division_id"]


async def test_delete_weekly_requirement(
    client: AsyncClient, weekly_requirement_seed: dict[str, int]
) -> None:
    created = await client.post("/api/weekly-requirement", json=_payload(weekly_requirement_seed))
    assert created.status_code == 201
    requirement_id: int = created.json()["id"]

    resp = await client.delete(f"/api/weekly-requirement/{requirement_id}")
    assert resp.status_code == 204


async def test_get_after_delete_not_found(
    client: AsyncClient, weekly_requirement_seed: dict[str, int]
) -> None:
    created = await client.post("/api/weekly-requirement", json=_payload(weekly_requirement_seed))
    assert created.status_code == 201
    requirement_id: int = created.json()["id"]

    delete_resp = await client.delete(f"/api/weekly-requirement/{requirement_id}")
    assert delete_resp.status_code == 204

    resp = await client.get(f"/api/weekly-requirement/{requirement_id}")
    assert resp.status_code == 404
