from httpx import AsyncClient


async def test_create_division_success(client: AsyncClient) -> None:
    payload = {
        "department": "IT",
        "year": "2",
        "name": "A",
        "semester": 3,
    }
    response = await client.post("/api/divisions", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert "id" in data
    assert data["department"] == "IT"
    assert data["year"] == "2"
    assert data["name"] == "A"
    assert data["semester"] == 3
    assert "created_at" in data


async def test_create_division_duplicate_conflict(client: AsyncClient) -> None:
    payload = {
        "department": "IT",
        "year": "3",
        "name": "B",
        "semester": 5,
    }
    first_resp = await client.post("/api/divisions", json=payload)
    assert first_resp.status_code == 201

    duplicate_resp = await client.post("/api/divisions", json=payload)
    assert duplicate_resp.status_code == 409
    assert (
        duplicate_resp.json()["detail"]
        == "Division with this department/year/name/semester already exists"
    )


async def test_get_division_by_id_success(client: AsyncClient) -> None:
    payload = {
        "department": "IT",
        "year": "1",
        "name": "C",
        "semester": 1,
    }
    create_resp = await client.post("/api/divisions", json=payload)
    assert create_resp.status_code == 201
    division_id = create_resp.json()["id"]

    get_resp = await client.get(f"/api/divisions/{division_id}")
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert data["id"] == division_id
    assert data["name"] == "C"


async def test_get_division_by_id_not_found(client: AsyncClient) -> None:
    response = await client.get("/api/divisions/999999")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"]


async def test_list_divisions(client: AsyncClient) -> None:
    payload_1 = {
        "department": "IT",
        "year": "4",
        "name": "D",
        "semester": 7,
    }
    payload_2 = {
        "department": "IT",
        "year": "4",
        "name": "E",
        "semester": 7,
    }
    await client.post("/api/divisions", json=payload_1)
    await client.post("/api/divisions", json=payload_2)

    response = await client.get("/api/divisions")
    assert response.status_code == 200
    divisions: list[dict[str, object]] = response.json()
    assert isinstance(divisions, list)
    names = [d["name"] for d in divisions]
    assert "D" in names
    assert "E" in names


async def test_update_division_partial(client: AsyncClient) -> None:
    payload = {
        "department": "IT",
        "year": "2",
        "name": "F",
        "semester": 4,
    }
    create_resp = await client.post("/api/divisions", json=payload)
    division_id = create_resp.json()["id"]

    update_payload = {"name": "F_UPDATED"}
    patch_resp = await client.patch(f"/api/divisions/{division_id}", json=update_payload)
    assert patch_resp.status_code == 200
    updated_data = patch_resp.json()
    assert updated_data["name"] == "F_UPDATED"
    # Unchanged fields
    assert updated_data["department"] == "IT"
    assert updated_data["year"] == "2"
    assert updated_data["semester"] == 4


async def test_delete_division(client: AsyncClient) -> None:
    payload = {
        "department": "IT",
        "year": "3",
        "name": "G",
        "semester": 6,
    }
    create_resp = await client.post("/api/divisions", json=payload)
    division_id = create_resp.json()["id"]

    delete_resp = await client.delete(f"/api/divisions/{division_id}")
    assert delete_resp.status_code == 204


async def test_get_after_delete_not_found(client: AsyncClient) -> None:
    payload = {
        "department": "IT",
        "year": "1",
        "name": "H",
        "semester": 2,
    }
    create_resp = await client.post("/api/divisions", json=payload)
    division_id = create_resp.json()["id"]

    delete_resp = await client.delete(f"/api/divisions/{division_id}")
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"/api/divisions/{division_id}")
    assert get_resp.status_code == 404
    assert "not found" in get_resp.json()["detail"]
