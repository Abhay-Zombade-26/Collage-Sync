from httpx import AsyncClient


def _payload() -> dict[str, object]:
    return {
        "academic_year": "2026-27",
        "semester": 3,
        "start_time": "09:00:00",
        "end_time": "16:00:00",
        "period_minutes": 50,
        "lunch_start": "13:00:00",
        "lunch_minutes": 45,
        "school_days": ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    }


async def test_create_timetable_settings_success(client: AsyncClient) -> None:
    resp = await client.post("/api/timetable-settings", json=_payload())
    assert resp.status_code == 201
    data = resp.json()
    assert "id" in data
    assert data["academic_year"] == "2026-27"
    assert data["semester"] == 3
    assert data["period_minutes"] == 50
    assert data["lunch_minutes"] == 45
    assert len(data["school_days"]) == 5
    assert "created_at" in data


async def test_create_timetable_settings_duplicate_conflict(client: AsyncClient) -> None:
    first = await client.post("/api/timetable-settings", json=_payload())
    assert first.status_code == 201

    dup = await client.post("/api/timetable-settings", json=_payload())
    assert dup.status_code == 409


async def test_get_timetable_settings_success(client: AsyncClient) -> None:
    created = await client.post("/api/timetable-settings", json=_payload())
    assert created.status_code == 201
    settings_id: int = created.json()["id"]

    resp = await client.get(f"/api/timetable-settings/{settings_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == settings_id
    assert data["academic_year"] == "2026-27"


async def test_get_timetable_settings_not_found(client: AsyncClient) -> None:
    resp = await client.get("/api/timetable-settings/999999")
    assert resp.status_code == 404


async def test_list_timetable_settings(client: AsyncClient) -> None:
    created = await client.post("/api/timetable-settings", json=_payload())
    assert created.status_code == 201
    settings_id: int = created.json()["id"]

    resp = await client.get("/api/timetable-settings")
    assert resp.status_code == 200
    data: list[dict[str, object]] = resp.json()
    ids = [row["id"] for row in data]
    assert settings_id in ids


async def test_update_timetable_settings_partial(client: AsyncClient) -> None:
    created = await client.post("/api/timetable-settings", json=_payload())
    assert created.status_code == 201
    settings_id: int = created.json()["id"]

    resp = await client.patch(
        f"/api/timetable-settings/{settings_id}",
        json={"period_minutes": 55},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == settings_id
    assert data["period_minutes"] == 55
    # untouched fields keep their previous values
    assert data["academic_year"] == "2026-27"
    assert data["lunch_minutes"] == 45


async def test_delete_timetable_settings(client: AsyncClient) -> None:
    created = await client.post("/api/timetable-settings", json=_payload())
    assert created.status_code == 201
    settings_id: int = created.json()["id"]

    resp = await client.delete(f"/api/timetable-settings/{settings_id}")
    assert resp.status_code == 204


async def test_get_after_delete_not_found(client: AsyncClient) -> None:
    created = await client.post("/api/timetable-settings", json=_payload())
    assert created.status_code == 201
    settings_id: int = created.json()["id"]

    delete_resp = await client.delete(f"/api/timetable-settings/{settings_id}")
    assert delete_resp.status_code == 204

    resp = await client.get(f"/api/timetable-settings/{settings_id}")
    assert resp.status_code == 404
