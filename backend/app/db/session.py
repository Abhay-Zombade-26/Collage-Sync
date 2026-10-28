import os
import re
import logging
from collections.abc import AsyncGenerator
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.exc import InterfaceError

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

# Convert sslmode=require to ssl=require and strip channel_binding if present.
# asyncpg does not accept libpq 'sslmode' or 'channel_binding' query parameters.
if "sslmode=" in database_url:
    database_url = database_url.replace("sslmode=require", "ssl=require")
if "channel_binding=" in database_url:
    database_url = re.sub(r"[?&]channel_binding=[^&]+", "", database_url)
    if "?" not in database_url and "&" in database_url:
        database_url = database_url.replace("&", "?", 1)

engine = create_async_engine(database_url, echo=False, pool_pre_ping=True)
async_session_maker = async_sessionmaker(engine, expire_on_commit=False)

logger = logging.getLogger(__name__)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Yield a database session, handling closed/broken connections gracefully."""
    try:
        async with async_session_maker() as session:
            try:
                yield session
            except Exception as e:
                err_msg = str(e).lower()
                if (
                    isinstance(e, InterfaceError)
                    or "connection is closed" in err_msg
                    or "closed connection" in err_msg
                ):
                    logger.warning(
                        "InterfaceError or closed connection during session usage: %s. Ignoring.",
                        e,
                    )
                else:
                    raise
    except InterfaceError as e:
        logger.warning(
            "InterfaceError in get_session: %s. Session connection may be closed, ignoring.", e
        )
    except Exception as e:
        err_msg = str(e).lower()
        if "connection is closed" in err_msg or "closed connection" in err_msg:
            logger.warning("Closed connection in get_session: %s. Ignoring.", e)
        else:
            logger.warning("Unexpected error in get_session: %s", e)
            raise