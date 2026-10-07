from httpx import AsyncClient

from app.models.teacher import Teacher


async def test_register_creates_pending_teacher(client: AsyncClient) -> None:
    payload = {
        "name": "Prof. Marie Curie",
        "email": "curie@college.edu",
        "password": "password123",
    }
    resp = await client.post("/api/auth/register", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Prof. Marie Curie"
    assert data["email"] == "curie@college.edu"
    assert data["status"] == "PENDING"
    assert "id" in data
    assert "created_at" in data
    assert "password" not in data
    assert "hashed_password" not in data


async def test_register_duplicate_email_conflict(client: AsyncClient) -> None:
    payload = {
        "name": "Prof. Marie Curie",
        "email": "curie_dup@college.edu",
        "password": "password123",
    }
    first_resp = await client.post("/api/auth/register", json=payload)
    assert first_resp.status_code == 201

    dup_resp = await client.post("/api/auth/register", json=payload)
    assert dup_resp.status_code == 409
    assert dup_resp.json()["detail"] == "Email already registered"


async def test_login_pending_teacher_forbidden(client: AsyncClient) -> None:
    payload = {
        "name": "Prof. Pending",
        "email": "pending@college.edu",
        "password": "password123",
    }
    reg_resp = await client.post("/api/auth/register", json=payload)
    assert reg_resp.status_code == 201

    login_resp = await client.post(
        "/api/auth/login",
        json={"email": "pending@college.edu", "password": "password123"},
    )
    assert login_resp.status_code == 403
    assert login_resp.json()["detail"] == "Account pending admin approval"


async def test_login_unknown_email_unauthorized(client: AsyncClient) -> None:
    login_resp = await client.post(
        "/api/auth/login",
        json={"email": "unknown@college.edu", "password": "password123"},
    )
    assert login_resp.status_code == 401
    assert login_resp.json()["detail"] == "Invalid credentials"


async def test_login_wrong_password_unauthorized(
    client: AsyncClient, seed_active_teacher: Teacher
) -> None:
    login_resp = await client.post(
        "/api/auth/login",
        json={"email": seed_active_teacher.email, "password": "wrongpassword"},
    )
    assert login_resp.status_code == 401
    assert login_resp.json()["detail"] == "Invalid credentials"


async def test_login_success_returns_token_and_sets_cookie(
    client: AsyncClient, seed_active_teacher: Teacher
) -> None:
    login_resp = await client.post(
        "/api/auth/login",
        json={"email": seed_active_teacher.email, "password": "teacherpw123"},
    )
    assert login_resp.status_code == 200
    data = login_resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["expires_in"] == 15 * 60
    assert "refresh_token" in login_resp.cookies


async def test_me_requires_auth(client: AsyncClient) -> None:
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401


async def test_me_returns_current_user(client: AsyncClient, seed_active_teacher: Teacher) -> None:
    login_resp = await client.post(
        "/api/auth/login",
        json={"email": seed_active_teacher.email, "password": "teacherpw123"},
    )
    assert login_resp.status_code == 200
    token: str = login_resp.json()["access_token"]

    me_resp = await client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert me_resp.status_code == 200
    data = me_resp.json()
    assert data["id"] == seed_active_teacher.id
    assert data["email"] == seed_active_teacher.email
    assert data["name"] == seed_active_teacher.name
    assert data["is_admin"] is False


async def test_me_rejects_garbage_token(client: AsyncClient) -> None:
    resp = await client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer not-a-real-jwt"},
    )
    assert resp.status_code == 401


async def test_refresh_rotates_token(client: AsyncClient, seed_active_teacher: Teacher) -> None:
    login_resp = await client.post(
        "/api/auth/login",
        json={"email": seed_active_teacher.email, "password": "teacherpw123"},
    )
    assert login_resp.status_code == 200
    initial_refresh = login_resp.cookies.get("refresh_token")
    assert initial_refresh is not None

    refresh_resp = await client.post("/api/auth/refresh")
    assert refresh_resp.status_code == 200
    data = refresh_resp.json()
    assert "access_token" in data
    new_refresh = refresh_resp.cookies.get("refresh_token")
    assert new_refresh is not None
    assert new_refresh != initial_refresh

    # Reusing the old refresh token must be rejected
    client.cookies.set("refresh_token", initial_refresh)
    reused_resp = await client.post("/api/auth/refresh")
    assert reused_resp.status_code == 401


async def test_refresh_missing_cookie_unauthorized(client: AsyncClient) -> None:
    client.cookies.clear()
    resp = await client.post("/api/auth/refresh")
    assert resp.status_code == 401


async def test_logout_revokes_refresh(client: AsyncClient, seed_active_teacher: Teacher) -> None:
    login_resp = await client.post(
        "/api/auth/login",
        json={"email": seed_active_teacher.email, "password": "teacherpw123"},
    )
    assert login_resp.status_code == 200
    token: str = login_resp.json()["access_token"]
    refresh_val = login_resp.cookies.get("refresh_token")
    assert refresh_val is not None

    logout_resp = await client.post(
        "/api/auth/logout",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert logout_resp.status_code == 204

    # Refresh with revoked token must fail
    client.cookies.set("refresh_token", refresh_val)
    refresh_resp = await client.post("/api/auth/refresh")
    assert refresh_resp.status_code == 401


async def test_registrations_requires_admin(
    client: AsyncClient, seed_active_teacher: Teacher
) -> None:
    login_resp = await client.post(
        "/api/auth/login",
        json={"email": seed_active_teacher.email, "password": "teacherpw123"},
    )
    token: str = login_resp.json()["access_token"]

    resp = await client.get(
        "/api/auth/registrations",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Admin privileges required"


async def test_registrations_lists_pending(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    payload = {
        "name": "Prof. Pending List",
        "email": "pending_list@college.edu",
        "password": "password123",
    }
    await client.post("/api/auth/register", json=payload)

    resp = await client.get("/api/auth/registrations", headers=admin_headers)
    assert resp.status_code == 200
    data: list[dict[str, object]] = resp.json()
    assert isinstance(data, list)
    emails = [r["email"] for r in data]
    assert "pending_list@college.edu" in emails


async def test_admin_approve_allows_login(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    payload = {
        "name": "Prof. To Approve",
        "email": "to_approve@college.edu",
        "password": "password123",
    }
    reg_resp = await client.post("/api/auth/register", json=payload)
    assert reg_resp.status_code == 201
    teacher_id: int = reg_resp.json()["id"]

    approve_resp = await client.post(
        f"/api/auth/registrations/{teacher_id}/approve",
        headers=admin_headers,
    )
    assert approve_resp.status_code == 200
    assert approve_resp.json()["status"] == "ACTIVE"

    login_resp = await client.post(
        "/api/auth/login",
        json={"email": "to_approve@college.edu", "password": "password123"},
    )
    assert login_resp.status_code == 200
    assert "access_token" in login_resp.json()


async def test_admin_reject_blocks_login(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    payload = {
        "name": "Prof. To Reject",
        "email": "to_reject@college.edu",
        "password": "password123",
    }
    reg_resp = await client.post("/api/auth/register", json=payload)
    assert reg_resp.status_code == 201
    teacher_id: int = reg_resp.json()["id"]

    reject_resp = await client.post(
        f"/api/auth/registrations/{teacher_id}/reject",
        headers=admin_headers,
    )
    assert reject_resp.status_code == 200
    assert reject_resp.json()["status"] == "REJECTED"

    login_resp = await client.post(
        "/api/auth/login",
        json={"email": "to_reject@college.edu", "password": "password123"},
    )
    assert login_resp.status_code == 403
    assert login_resp.json()["detail"] == "Registration request was rejected"
