from httpx import AsyncClient

from app.models.teacher import Teacher


async def test_get_teacher_by_id_success(client: AsyncClient, seed_active_teacher: Teacher) -> None:
    teacher_id = seed_active_teacher.id
    get_resp = await client.get(f"/api/teachers/{teacher_id}")
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert data["id"] == teacher_id
    assert data["name"] == seed_active_teacher.name
    assert data["email"] == seed_active_teacher.email


async def test_get_teacher_by_id_not_found(client: AsyncClient) -> None:
    response = await client.get("/api/teachers/999999")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"]


async def test_list_teachers(client: AsyncClient, seed_active_teacher: Teacher) -> None:
    response = await client.get("/api/teachers")
    assert response.status_code == 200
    teachers: list[dict[str, object]] = response.json()
    assert isinstance(teachers, list)
    emails = [t["email"] for t in teachers]
    assert seed_active_teacher.email in emails


async def test_update_teacher_partial(client: AsyncClient, seed_active_teacher: Teacher) -> None:
    teacher_id = seed_active_teacher.id
    update_payload = {"name": "Prof. E. W. Dijkstra", "max_lectures_per_day": 5}
    patch_resp = await client.patch(f"/api/teachers/{teacher_id}", json=update_payload)
    assert patch_resp.status_code == 200
    updated_data = patch_resp.json()
    assert updated_data["name"] == "Prof. E. W. Dijkstra"
    assert updated_data["max_lectures_per_day"] == 5
    assert updated_data["email"] == seed_active_teacher.email


async def test_delete_teacher(client: AsyncClient, seed_active_teacher: Teacher) -> None:
    teacher_id = seed_active_teacher.id
    delete_resp = await client.delete(f"/api/teachers/{teacher_id}")
    assert delete_resp.status_code == 204


async def test_get_after_delete_not_found(
    client: AsyncClient, seed_active_teacher: Teacher
) -> None:
    teacher_id = seed_active_teacher.id
    delete_resp = await client.delete(f"/api/teachers/{teacher_id}")
    assert delete_resp.status_code == 204

    get_resp = await client.get(f"/api/teachers/{teacher_id}")
    assert get_resp.status_code == 404
    assert "not found" in get_resp.json()["detail"]
