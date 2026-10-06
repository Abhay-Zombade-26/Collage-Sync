import os
import re
from collections.abc import AsyncGenerator
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Load .env from backend directory or parent directories
env_path = Path(__file__).resolve().parents[2] / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)
else:
    load_dotenv()

raw_url = os.getenv("DATABASE_URL", "")

# Normalize driver string for asyncpg
if raw_url.startswith("postgresql://"):
    database_url = raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)
elif raw_url.startswith("postgres://"):
    database_url = raw_url.replace("postgres://", "postgresql+asyncpg://", 1)
else:
    database_url = raw_url

# asyncpg does not accept libpq 'sslmode' or 'channel_binding' query parameters.
# Convert sslmode=require to ssl=require and strip channel_binding if present.
if "sslmode=" in database_url:
    database_url = database_url.replace("sslmode=require", "ssl=require")
if "channel_binding=" in database_url:
    database_url = re.sub(r"[?&]channel_binding=[^&]+", "", database_url)
    if "?" not in database_url and "&" in database_url:
        database_url = database_url.replace("&", "?", 1)

engine = create_async_engine(database_url, echo=False)
async_session_maker = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session
