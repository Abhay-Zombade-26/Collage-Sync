from httpx import AsyncClient


async def test_create_teacher_success(client: AsyncClient) -> None:
    payload = {
        "name": "Prof. Alan Turing",
        "email": "turing@college.edu",
        "google_sub": "google-sub-turing-1",
    }
    response = await client.post("/api/teachers", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert "id" in data
    assert data["name"] == "Prof. Alan Turing"
    assert data["email"] == "turing@college.edu"
    assert data["google_sub"] == "google-sub-turing-1"
    assert data["role"] == "TEACHER"
    assert data["status"] == "PENDING"
    assert data["employment_type"] == "REGULAR"
    assert data["max_lectures_per_day"] == 6
    assert data["available_days"] is None
    assert data["available_start"] is None
    assert data["available_end"] is None
    assert "created_at" in data


async def test_create_visiting_teacher_success(client: AsyncClient) -> None:
    payload = {
        "name": "Prof. Ada Lovelace",
        "email": "lovelace@college.edu",
        "google_sub": "google-sub-lovelace-2",
        "employment_type": "VISITING",
        "role": "TEACHER",
        "status": "ACTIVE",
        "max_lectures_per_day": 4,
        "available_days": ["MONDAY", "WEDNESDAY", "FRIDAY"],
        "available_start": "09:00:00",
        "available_end": "14:00:00",
    }
    response = await client.post("/api/teachers", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert "id" in data
    assert data["name"] == "Prof. Ada Lovelace"
    assert data["email"] == "lovelace@college.edu"
    assert data["google_sub"] == "google-sub-lovelace-2"
    assert data["role"] == "TEACHER"
    assert data["status"] == "ACTIVE"
    assert data["employment_type"] == "VISITING"
    assert data["max_lectures_per_day"] == 4
    assert data["available_days"] == ["MONDAY", "WEDNESDAY", "FRIDAY"]
    assert data["available_start"] == "09:00:00"
    assert data["available_end"] == "14:00:00"
    assert "created_at" in data


async def test_create_teacher_duplicate_conflict(client: AsyncClient) -> None:
    payload_1 = {
        "name": "Prof. John von Neumann",
        "email": "neumann@college.edu",
        "google_sub": "google-sub-neumann-1",
    }
    first_resp = await client.post("/api/teachers", json=payload_1)
    assert first_resp.status_code == 201

    payload_2 = {
        "name": "Prof. John von Neumann Duplicate",
        "email": "neumann@college.edu",
        "google_sub": "google-sub-neumann-2",
    }
    duplicate_resp = await client.post("/api/teachers", json=payload_2)
    assert duplicate_resp.status_code == 409
    assert (
        duplicate_resp.json()["detail"]
        == "Teacher with this email or Google account already exists"
    )


async def test_get_teacher_by_id_success(client: AsyncClient) -> None:
    payload = {
        "name": "Prof. Claude Shannon",
        "email": "shannon@college.edu",
        "google_sub": "google-sub-shannon-1",
    }
    create_resp = await client.post("/api/teachers", json=payload)
    assert create_resp.status_code == 201
    teacher_id: int = create_resp.json()["id"]

    get_resp = await client.get(f"/api/teachers/{teacher_id}")
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert data["id"] == teacher_id
    assert data["name"] == "Prof. Claude Shannon"
    assert data["email"] == "shannon@college.edu"
    assert data["google_sub"] == "google-sub-shannon-1"


async def test_get_teacher_by_id_not_found(client: AsyncClient) -> None:
    response = await client.get("/api/teachers/999999")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"]


async def test_list_teachers(client: AsyncClient) -> None:
    payload_1 = {
        "name": "Prof. Grace Hopper",
        "email": "hopper@college.edu",
        "google_sub": "google-sub-hopper-1",
    }
    payload_2 = {
        "name": "Prof. Donald Knuth",
        "email": "knuth@college.edu",
        "google_sub": "google-sub-knuth-1",
    }
    await client.post("/api/teachers", json=payload_1)
    await client.post("/api/teachers", json=payload_2)

    response = await client.get("/api/teachers")
    assert response.status_code == 200
    teachers: list[dict[str, object]] = response.json()
    assert isinstance(teachers, list)
    emails = [t["email"] for t in teachers]
    assert "hopper@college.edu" in emails
    assert "knuth@college.edu" in emails


async def test_update_teacher_partial(client: AsyncClient) -> None:
    payload = {
        "name": "Prof. Edsger Dijkstra",
        "email": "dijkstra@college.edu",
        "google_sub": "google-sub-dijkstra-1",
    }
    create_resp = await client.post("/api/teachers", json=payload)
    assert create_resp.status_code == 201
    teacher_id: int = create_resp.json()["id"]

    update_payload = {"name": "Prof. E. W. Dijkstra", "max_lectures_per_day": 5}
    patch_resp = await client.patch(f"/api/teachers/{teacher_id}", json=update_payload)
    assert patch_resp.status_code == 200
    updated_data = patch_resp.json()
    assert updated_data["name"] == "Prof. E. W. Dijkstra"
    assert updated_data["max_lectures_per_day"] == 5
    assert updated_data["email"] == "dijkstra@college.edu"


async def test_delete_teacher(client: AsyncClient) -> None:
    payload = {
        "name": "Prof. Tim Berners-Lee",
        "email": "bernerslee@college.edu",
        "google_sub": "google-sub-tbl-1",
    }
    create_resp = await client.post("/api/teachers", json=payload)
    assert create_resp.status_code == 201
    teacher_id: int = create_resp.json()["id"]

    delete_resp = await client.delete(f"/api/teachers/{teacher_id}")
    assert delete_resp.status_code == 204


async def test_get_after_delete_not_found(client: AsyncClient) -> None:
    payload = {
        "name": "Prof. Barbara Liskov",
        "email": "liskov@college.edu",
        "google_sub": "google-sub-liskov-1",
    }
    create_resp = await client.post("/api/teachers", json=payload)
    assert create_resp.status_code == 201
    teacher_id: int = create_resp.json()["id"]

    delete_resp = await client.delete(f"/api/teachers/{teacher_id}")
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"/api/teachers/{teacher_id}")
    assert get_resp.status_code == 404
    assert "not found" in get_resp.json()["detail"]
