from httpx import AsyncClient


async def test_create_batch_success(client: AsyncClient) -> None:
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
        "name": "A1",
        "division_id": division_id,
    }
    response = await client.post("/api/batches", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert "id" in data
    assert data["name"] == "A1"
    assert data["division_id"] == division_id
    assert "created_at" in data


async def test_create_batch_duplicate_conflict(client: AsyncClient) -> None:
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
        "name": "B1",
        "division_id": division_id,
    }
    first_resp = await client.post("/api/batches", json=payload)
    assert first_resp.status_code == 201

    duplicate_resp = await client.post("/api/batches", json=payload)
    assert duplicate_resp.status_code == 409
    assert duplicate_resp.json()["detail"] == "Batch with this name already exists in this division"


async def test_get_batch_by_id_success(client: AsyncClient) -> None:
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
        "name": "C1",
        "division_id": division_id,
    }
    create_resp = await client.post("/api/batches", json=payload)
    assert create_resp.status_code == 201
    batch_id: int = create_resp.json()["id"]

    get_resp = await client.get(f"/api/batches/{batch_id}")
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert data["id"] == batch_id
    assert data["name"] == "C1"
    assert data["division_id"] == division_id


async def test_get_batch_by_id_not_found(client: AsyncClient) -> None:
    response = await client.get("/api/batches/999999")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"]


async def test_list_batches(client: AsyncClient) -> None:
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
        "name": "D1",
        "division_id": division_id,
    }
    payload_2 = {
        "name": "D2",
        "division_id": division_id,
    }
    await client.post("/api/batches", json=payload_1)
    await client.post("/api/batches", json=payload_2)

    response = await client.get("/api/batches")
    assert response.status_code == 200
    batches: list[dict[str, object]] = response.json()
    assert isinstance(batches, list)
    names = [b["name"] for b in batches]
    assert "D1" in names
    assert "D2" in names


async def test_update_batch_partial(client: AsyncClient) -> None:
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
        "name": "E1",
        "division_id": division_id,
    }
    create_resp = await client.post("/api/batches", json=payload)
    batch_id: int = create_resp.json()["id"]

    update_payload = {"name": "E1-Updated"}
    patch_resp = await client.patch(f"/api/batches/{batch_id}", json=update_payload)
    assert patch_resp.status_code == 200
    updated_data = patch_resp.json()
    assert updated_data["name"] == "E1-Updated"
    # Unchanged field
    assert updated_data["division_id"] == division_id


async def test_delete_batch(client: AsyncClient) -> None:
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
        "name": "F1",
        "division_id": division_id,
    }
    create_resp = await client.post("/api/batches", json=payload)
    batch_id: int = create_resp.json()["id"]

    delete_resp = await client.delete(f"/api/batches/{batch_id}")
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
        "name": "G1",
        "division_id": division_id,
    }
    create_resp = await client.post("/api/batches", json=payload)
    batch_id: int = create_resp.json()["id"]

    delete_resp = await client.delete(f"/api/batches/{batch_id}")
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"/api/batches/{batch_id}")
    assert get_resp.status_code == 404
    assert "not found" in get_resp.json()["detail"]
