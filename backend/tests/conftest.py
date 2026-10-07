from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

import app.models  # noqa: F401 - ensure all tables are registered  # pyright: ignore[reportUnusedImport]
from app.core.security import hash_password
from app.db.base import Base
from app.db.session import engine, get_session
from app.main import app as fastapi_app
from app.models.enums import EmploymentType, TeacherRole, TeacherStatus
from app.models.teacher import Teacher


@pytest.fixture(scope="session", autouse=True)
async def prepare_database() -> AsyncGenerator[None, None]:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


@pytest.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    async with engine.connect() as connection:
        trans = await connection.begin()
        session = AsyncSession(
            bind=connection,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )
        try:
            yield session
        finally:
            await session.close()
            await trans.rollback()


@pytest.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_session() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    fastapi_app.dependency_overrides[get_session] = override_get_session
    transport = ASGITransport(app=fastapi_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    fastapi_app.dependency_overrides.clear()


@pytest.fixture
async def seed_admin(db_session: AsyncSession) -> Teacher:
    teacher = Teacher(
        email="admin@college.edu",
        name="Test Admin",
        hashed_password=await hash_password("adminpw123"),
        status=TeacherStatus.ACTIVE,
        is_admin=True,
        role=TeacherRole.TEACHER,
        employment_type=EmploymentType.REGULAR,
        max_lectures_per_day=6,
    )
    db_session.add(teacher)
    await db_session.commit()
    await db_session.refresh(teacher)
    return teacher


@pytest.fixture
async def seed_active_teacher(db_session: AsyncSession) -> Teacher:
    teacher = Teacher(
        email="teacher@college.edu",
        name="Test Teacher",
        hashed_password=await hash_password("teacherpw123"),
        status=TeacherStatus.ACTIVE,
        is_admin=False,
        role=TeacherRole.TEACHER,
        employment_type=EmploymentType.REGULAR,
        max_lectures_per_day=6,
    )
    db_session.add(teacher)
    await db_session.commit()
    await db_session.refresh(teacher)
    return teacher


@pytest.fixture
async def admin_headers(client: AsyncClient, seed_admin: Teacher) -> dict[str, str]:
    resp = await client.post(
        "/api/auth/login",
        json={"email": seed_admin.email, "password": "adminpw123"},
    )
    assert resp.status_code == 200
    token: str = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
