from httpx import AsyncClient


async def test_create_room_success(client: AsyncClient) -> None:
    div_resp = await client.post(
        "/api/divisions",
        json={
            "department": "IT",
            "year": "2",
            "name": "A",
            "semester": 3,
        },
    )
    assert div_resp.status_code == 201
    division_id: int = div_resp.json()["id"]

    payload = {
        "name": "Room 101",
        "room_type": "LECTURE",
        "division_id": division_id,
    }
    response = await client.post("/api/rooms", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert "id" in data
    assert data["name"] == "Room 101"
    assert data["room_type"] == "LECTURE"
    assert data["division_id"] == division_id
    assert "created_at" in data


async def test_create_room_duplicate_conflict(client: AsyncClient) -> None:
    div_resp = await client.post(
        "/api/divisions",
        json={
            "department": "IT",
            "year": "3",
            "name": "B",
            "semester": 5,
        },
    )
    assert div_resp.status_code == 201
    division_id: int = div_resp.json()["id"]

    payload = {
        "name": "Lab 201",
        "room_type": "LAB",
        "division_id": division_id,
    }
    first_resp = await client.post("/api/rooms", json=payload)
    assert first_resp.status_code == 201

    duplicate_resp = await client.post("/api/rooms", json=payload)
    assert duplicate_resp.status_code == 409
    assert duplicate_resp.json()["detail"] == "Room with this name already exists in this division"


async def test_get_room_by_id_success(client: AsyncClient) -> None:
    div_resp = await client.post(
        "/api/divisions",
        json={
            "department": "IT",
            "year": "1",
            "name": "C",
            "semester": 1,
        },
    )
    assert div_resp.status_code == 201
    division_id: int = div_resp.json()["id"]

    payload = {
        "name": "Room 102",
        "room_type": "LECTURE",
        "division_id": division_id,
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
    assert data["division_id"] == division_id


async def test_get_room_by_id_not_found(client: AsyncClient) -> None:
    response = await client.get("/api/rooms/999999")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"]


async def test_list_rooms(client: AsyncClient) -> None:
    div_resp = await client.post(
        "/api/divisions",
        json={
            "department": "IT",
            "year": "2",
            "name": "D",
            "semester": 4,
        },
    )
    assert div_resp.status_code == 201
    division_id: int = div_resp.json()["id"]

    payload_1 = {
        "name": "Room 301",
        "room_type": "LECTURE",
        "division_id": division_id,
    }
    payload_2 = {
        "name": "Lab 302",
        "room_type": "LAB",
        "division_id": division_id,
    }
    await client.post("/api/rooms", json=payload_1)
    await client.post("/api/rooms", json=payload_2)

    response = await client.get("/api/rooms")
    assert response.status_code == 200
    rooms: list[dict[str, object]] = response.json()
    assert isinstance(rooms, list)
    names = [r["name"] for r in rooms]
    assert "Room 301" in names
    assert "Lab 302" in names


async def test_update_room_partial(client: AsyncClient) -> None:
    div_resp = await client.post(
        "/api/divisions",
        json={
            "department": "IT",
            "year": "3",
            "name": "E",
            "semester": 6,
        },
    )
    assert div_resp.status_code == 201
    division_id: int = div_resp.json()["id"]

    payload = {
        "name": "Room 401",
        "room_type": "LECTURE",
        "division_id": division_id,
    }
    create_resp = await client.post("/api/rooms", json=payload)
    room_id: int = create_resp.json()["id"]

    update_payload = {"name": "Room 401-A"}
    patch_resp = await client.patch(f"/api/rooms/{room_id}", json=update_payload)
    assert patch_resp.status_code == 200
    updated_data = patch_resp.json()
    assert updated_data["name"] == "Room 401-A"
    # Unchanged fields
    assert updated_data["room_type"] == "LECTURE"
    assert updated_data["division_id"] == division_id


async def test_delete_room(client: AsyncClient) -> None:
    div_resp = await client.post(
        "/api/divisions",
        json={
            "department": "IT",
            "year": "4",
            "name": "F",
            "semester": 7,
        },
    )
    assert div_resp.status_code == 201
    division_id: int = div_resp.json()["id"]

    payload = {
        "name": "Room 501",
        "room_type": "LECTURE",
        "division_id": division_id,
    }
    create_resp = await client.post("/api/rooms", json=payload)
    room_id: int = create_resp.json()["id"]

    delete_resp = await client.delete(f"/api/rooms/{room_id}")
    assert delete_resp.status_code == 204


async def test_get_after_delete_not_found(client: AsyncClient) -> None:
    div_resp = await client.post(
        "/api/divisions",
        json={
            "department": "IT",
            "year": "4",
            "name": "G",
            "semester": 8,
        },
    )
    assert div_resp.status_code == 201
    division_id: int = div_resp.json()["id"]

    payload = {
        "name": "Room 601",
        "room_type": "LECTURE",
        "division_id": division_id,
    }
    create_resp = await client.post("/api/rooms", json=payload)
    room_id: int = create_resp.json()["id"]

    delete_resp = await client.delete(f"/api/rooms/{room_id}")
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"/api/rooms/{room_id}")
    assert get_resp.status_code == 404
    assert "not found" in get_resp.json()["detail"]
