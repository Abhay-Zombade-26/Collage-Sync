from httpx import AsyncClient

from app.models.teacher import Teacher


async def test_register_creates_pending_teacher(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/auth/register",
        json={"name": "A", "email": "new@college.edu", "password": "password123"},
    )
    assert resp.status_code == 201


async def test_login_wrong_email_unauthorized(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/auth/login",
        json={"email": "no@college.edu", "password": "password123"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Incorrect email or password"


async def test_login_wrong_password_unauthorized(
    client: AsyncClient, seed_active_teacher: Teacher
) -> None:
    resp = await client.post(
        "/api/auth/login",
        json={
            "email": seed_active_teacher.email,
            "password": "wrongpassword",
        },
    )
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Incorrect email or password"


async def test_login_pending_forbidden(client: AsyncClient) -> None:
    await client.post(
        "/api/auth/register",
        json={"name": "P", "email": "pend@college.edu", "password": "password123"},
    )
    resp = await client.post(
        "/api/auth/login",
        json={"email": "pend@college.edu", "password": "password123"},
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Account pending admin approval"


async def test_login_success_sets_cookie(client: AsyncClient, seed_active_teacher: Teacher) -> None:
    resp = await client.post(
        "/api/auth/login",
        json={
            "email": seed_active_teacher.email,
            "password": "teacherpw123",
        },
    )
    assert resp.status_code == 200
    assert "access_token" in resp.json()
    assert resp.cookies.get("refresh_token") is not None


async def test_refresh_rotates(client: AsyncClient, seed_active_teacher: Teacher) -> None:
    login_resp = await client.post(
        "/api/auth/login",
        json={
            "email": seed_active_teacher.email,
            "password": "teacherpw123",
        },
    )
    old_refresh = login_resp.cookies.get("refresh_token")
    refresh_resp = await client.post("/api/auth/refresh")
    assert refresh_resp.status_code == 200
    new_refresh = refresh_resp.cookies.get("refresh_token")
    assert new_refresh is not None
    assert new_refresh != old_refresh


async def test_refresh_replay_fails(client: AsyncClient, seed_active_teacher: Teacher) -> None:
    login_resp = await client.post(
        "/api/auth/login",
        json={
            "email": seed_active_teacher.email,
            "password": "teacherpw123",
        },
    )
    old = login_resp.cookies.get("refresh_token")
    assert old is not None
    await client.post("/api/auth/refresh")  # rotate
    client.cookies.set("refresh_token", old)
    reused = await client.post("/api/auth/refresh")
    assert reused.status_code == 401


async def test_refresh_missing_cookie_unauthorized(client: AsyncClient) -> None:
    client.cookies.clear()
    resp = await client.post("/api/auth/refresh")
    assert resp.status_code == 401


async def test_logout_revokes(client: AsyncClient, seed_active_teacher: Teacher) -> None:
    login_resp = await client.post(
        "/api/auth/login",
        json={
            "email": seed_active_teacher.email,
            "password": "teacherpw123",
        },
    )
    token = login_resp.json()["access_token"]
    refresh_val = login_resp.cookies.get("refresh_token")
    assert refresh_val is not None
    logout_resp = await client.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert logout_resp.status_code == 204
    client.cookies.set("refresh_token", refresh_val)
    refresh_resp = await client.post("/api/auth/refresh")
    assert refresh_resp.status_code == 401
