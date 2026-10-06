from httpx import AsyncClient


async def test_create_subject_success(client: AsyncClient) -> None:
    payload = {
        "name": "Data Structures",
        "code": "IT301",
    }
    response = await client.post("/api/subjects", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert "id" in data
    assert data["name"] == "Data Structures"
    assert data["code"] == "IT301"
    assert "created_at" in data


async def test_create_subject_duplicate_code_conflict(
    client: AsyncClient,
) -> None:
    payload = {
        "name": "Algorithms",
        "code": "IT302",
    }
    first_resp = await client.post("/api/subjects", json=payload)
    assert first_resp.status_code == 201

    duplicate_resp = await client.post("/api/subjects", json=payload)
    assert duplicate_resp.status_code == 409
    assert duplicate_resp.json()["detail"] == "Subject with this code already exists"


async def test_get_subject_by_id_success(client: AsyncClient) -> None:
    payload = {
        "name": "Operating Systems",
        "code": "IT303",
    }
    create_resp = await client.post("/api/subjects", json=payload)
    assert create_resp.status_code == 201
    subject_id = create_resp.json()["id"]

    get_resp = await client.get(f"/api/subjects/{subject_id}")
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert data["id"] == subject_id
    assert data["name"] == "Operating Systems"


async def test_get_subject_by_id_not_found(client: AsyncClient) -> None:
    response = await client.get("/api/subjects/999999")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"]


async def test_list_subjects(client: AsyncClient) -> None:
    payload_1 = {
        "name": "Database Systems",
        "code": "IT304",
    }
    payload_2 = {
        "name": "Computer Networks",
        "code": "IT305",
    }
    await client.post("/api/subjects", json=payload_1)
    await client.post("/api/subjects", json=payload_2)

    response = await client.get("/api/subjects")
    assert response.status_code == 200
    subjects: list[dict[str, object]] = response.json()
    assert isinstance(subjects, list)
    codes = [s["code"] for s in subjects]
    assert "IT304" in codes
    assert "IT305" in codes


async def test_update_subject_partial(client: AsyncClient) -> None:
    payload = {
        "name": "Software Engineering",
        "code": "IT306",
    }
    create_resp = await client.post("/api/subjects", json=payload)
    subject_id = create_resp.json()["id"]

    update_payload = {"name": "Software Engineering II"}
    patch_resp = await client.patch(f"/api/subjects/{subject_id}", json=update_payload)
    assert patch_resp.status_code == 200
    updated_data = patch_resp.json()
    assert updated_data["name"] == "Software Engineering II"
    # Unchanged field
    assert updated_data["code"] == "IT306"


async def test_delete_subject(client: AsyncClient) -> None:
    payload = {
        "name": "Compiler Design",
        "code": "IT307",
    }
    create_resp = await client.post("/api/subjects", json=payload)
    subject_id = create_resp.json()["id"]

    delete_resp = await client.delete(f"/api/subjects/{subject_id}")
    assert delete_resp.status_code == 204


async def test_get_after_delete_not_found(client: AsyncClient) -> None:
    payload = {
        "name": "Machine Learning",
        "code": "IT308",
    }
    create_resp = await client.post("/api/subjects", json=payload)
    subject_id = create_resp.json()["id"]

    delete_resp = await client.delete(f"/api/subjects/{subject_id}")
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"/api/subjects/{subject_id}")
    assert get_resp.status_code == 404
    assert "not found" in get_resp.json()["detail"]
