from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

import app.models  # noqa: F401 - ensure all tables are registered  # pyright: ignore[reportUnusedImport]
from app.db.base import Base
from app.db.session import engine, get_session
from app.main import app as fastapi_app


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
