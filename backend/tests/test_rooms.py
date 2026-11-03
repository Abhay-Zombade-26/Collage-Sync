from datetime import time
import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.division import Division
from app.models.enums import DayOfWeek
from app.models.subject import Subject
from app.models.teacher import Teacher
from app.models.timetable_slot import TimetableSlot


async def _create_test_branch(client: AsyncClient, prefix: str = "Branch") -> int:
    name = f"{prefix}_{uuid.uuid4().hex[:6]}"
    resp = await client.post("/api/branches", json={"name": name})
    assert resp.status_code == 201
    return resp.json()["id"]


async def test_create_room_success(client: AsyncClient) -> None:
    branch_id = await _create_test_branch(client, "CS")
    payload = {
        "name": "Room 101",
        "room_type": "LECTURE",
        "branch_id": branch_id,
        "year": "SE",
    }
    response = await client.post("/api/rooms", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert "id" in data
    assert data["name"] == "Room 101"
    assert data["room_type"] == "LECTURE"
    assert data["branch_id"] == branch_id
    assert data["year"] == "SE"
    assert "created_at" in data


async def test_create_room_duplicate_conflict(client: AsyncClient) -> None:
    branch_id = await _create_test_branch(client, "IT")
    payload = {
        "name": "Lab 201",
        "room_type": "LAB",
        "branch_id": branch_id,
        "year": "TE",
    }
    first_resp = await client.post("/api/rooms", json=payload)
    assert first_resp.status_code == 201

    duplicate_resp = await client.post("/api/rooms", json=payload)
    assert duplicate_resp.status_code == 409
    assert "already exists in this branch and year" in duplicate_resp.json()["detail"]


async def test_create_room_validation_errors(client: AsyncClient) -> None:
    branch_id = await _create_test_branch(client, "EXTC")

    # Empty name
    resp = await client.post(
        "/api/rooms",
        json={"name": "   ", "room_type": "LECTURE", "branch_id": branch_id, "year": "SE"},
    )
    assert resp.status_code == 422

    # Invalid year
    resp = await client.post(
        "/api/rooms",
        json={"name": "Room 999", "room_type": "LECTURE", "branch_id": branch_id, "year": "INVALID"},
    )
    assert resp.status_code == 422

    # Invalid room type
    resp = await client.post(
        "/api/rooms",
        json={"name": "Room 999", "room_type": "OFFICE", "branch_id": branch_id, "year": "FE"},
    )
    assert resp.status_code == 422


async def test_get_room_by_id_success(client: AsyncClient) -> None:
    branch_id = await _create_test_branch(client, "Mech")
    payload = {
        "name": "Room 102",
        "room_type": "LECTURE",
        "branch_id": branch_id,
        "year": "FE",
    }
    create_resp = await client.post("/api/rooms", json=payload)
    assert create_resp.status_code == 201
    room_id: int = create_resp.json()["id"]

    get_resp = await client.get(f"/api/rooms/{room_id}")
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert data["id"] == room_id
    assert data["name"] == "Room 102"
    assert data["room_type"] == "LECTURE"
    assert data["branch_id"] == branch_id
    assert data["year"] == "FE"


async def test_get_room_by_id_not_found(client: AsyncClient) -> None:
    response = await client.get("/api/rooms/999999")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"]


async def test_list_rooms_and_filtering(client: AsyncClient) -> None:
    branch_id = await _create_test_branch(client, "Civil")
    await client.post(
        "/api/rooms",
        json={"name": "Lecture 301", "room_type": "LECTURE", "branch_id": branch_id, "year": "FE"},
    )
    await client.post(
        "/api/rooms",
        json={"name": "Lab 302", "room_type": "LAB", "branch_id": branch_id, "year": "BE"},
    )

    # List all
    response = await client.get("/api/rooms")
    assert response.status_code == 200
    rooms = response.json()
    assert isinstance(rooms, list)
    names = [r["name"] for r in rooms]
    assert "Lecture 301" in names
    assert "Lab 302" in names

    # Filter by q
    q_resp = await client.get("/api/rooms?q=Lecture")
    assert q_resp.status_code == 200
    q_rooms = q_resp.json()
    assert any(r["name"] == "Lecture 301" for r in q_rooms)
    assert not any(r["name"] == "Lab 302" for r in q_rooms)

    # Filter by room_type
    type_resp = await client.get("/api/rooms?room_type=LAB")
    assert type_resp.status_code == 200
    assert all(r["room_type"] == "LAB" for r in type_resp.json())

    # Filter by year
    year_resp = await client.get("/api/rooms?year=BE")
    assert year_resp.status_code == 200
    assert all(r["year"] == "BE" for r in year_resp.json())


async def test_update_room_partial(client: AsyncClient) -> None:
    branch_id = await _create_test_branch(client, "AIDS")
    payload = {
        "name": "Room 401",
        "room_type": "LECTURE",
        "branch_id": branch_id,
        "year": "TE",
    }
    create_resp = await client.post("/api/rooms", json=payload)
    room_id: int = create_resp.json()["id"]

    patch_resp = await client.patch(f"/api/rooms/{room_id}", json={"name": "Room 401-A"})
    assert patch_resp.status_code == 200
    updated_data = patch_resp.json()
    assert updated_data["name"] == "Room 401-A"
    assert updated_data["room_type"] == "LECTURE"
    assert updated_data["branch_id"] == branch_id
    assert updated_data["year"] == "TE"


async def test_get_room_usage(client: AsyncClient) -> None:
    branch_id = await _create_test_branch(client, "UsageBranch")
    payload = {
        "name": "Room 501",
        "room_type": "LECTURE",
        "branch_id": branch_id,
        "year": "FE",
    }
    create_resp = await client.post("/api/rooms", json=payload)
    room_id: int = create_resp.json()["id"]

    usage_resp = await client.get(f"/api/rooms/{room_id}/usage")
    assert usage_resp.status_code == 200
    assert usage_resp.json() == {"room_id": room_id, "usage_count": 0}


async def test_delete_room_unused(client: AsyncClient) -> None:
    branch_id = await _create_test_branch(client, "DeleteBranch")
    payload = {
        "name": "Room 601",
        "room_type": "LECTURE",
        "branch_id": branch_id,
        "year": "BE",
    }
    create_resp = await client.post("/api/rooms", json=payload)
    room_id: int = create_resp.json()["id"]

    delete_resp = await client.delete(f"/api/rooms/{room_id}")
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"/api/rooms/{room_id}")
    assert get_resp.status_code == 404


async def test_delete_room_blocked_when_in_use(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    branch_id = await _create_test_branch(client, "BlockedBranch")
    payload = {
        "name": "Room In Use",
        "room_type": "LECTURE",
        "branch_id": branch_id,
        "year": "SE",
    }
    create_resp = await client.post("/api/rooms", json=payload)
    room_id: int = create_resp.json()["id"]

    # Seed required entities for a TimetableSlot
    division = Division(branch_id=branch_id, year="2", name="A", semester=3)
    subject = Subject(name="Operating Systems", code=f"OS_{uuid.uuid4().hex[:4]}", branch_id=branch_id, year="SE")
    teacher = Teacher(
        name="Prof. Smith",
        email=f"smith_{uuid.uuid4().hex[:6]}@college.edu",
        hashed_password="pw",
    )
    db_session.add_all([division, subject, teacher])
    await db_session.flush()

    slot = TimetableSlot(
        division_id=division.id,
        subject_id=subject.id,
        teacher_id=teacher.id,
        room_id=room_id,
        day_of_week=DayOfWeek.MONDAY,
        start_time=time(9, 0),
        end_time=time(10, 0),
        is_lab=False,
    )
    db_session.add(slot)
    await db_session.commit()

    # Check usage endpoint
    usage_resp = await client.get(f"/api/rooms/{room_id}/usage")
    assert usage_resp.status_code == 200
    assert usage_resp.json()["usage_count"] == 1

    # Attempt delete -> 409 Conflict
    delete_resp = await client.delete(f"/api/rooms/{room_id}")
    assert delete_resp.status_code == 409
    err = delete_resp.json()
    assert "usage_count" in err["detail"]
    assert err["detail"]["usage_count"] == 1

    # Ensure room still exists
    get_resp = await client.get(f"/api/rooms/{room_id}")
    assert get_resp.status_code == 200
