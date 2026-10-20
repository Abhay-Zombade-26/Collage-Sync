# pyright: reportUnknownMemberType=false
"""Password hashing (argon2id) and JWT issuing/verification (RS256)."""

import asyncio
import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    JWT_PRIVATE_KEY,
    JWT_PUBLIC_KEY,
    REFRESH_TOKEN_EXPIRE_DAYS,
)

_ph = PasswordHasher()


def _hash_sync(password: str) -> str:
    return _ph.hash(password)


async def hash_password(password: str) -> str:
    """Hash a password with argon2id.

    Argon2 is CPU- and memory-bound, so it runs off the event loop.
    """
    return await asyncio.to_thread(_hash_sync, password)


def _verify_sync(password: str, password_hash: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


async def verify_password(password: str, password_hash: str) -> bool:
    """Check a password against its argon2 hash, returning False on mismatch."""
    return await asyncio.to_thread(_verify_sync, password, password_hash)


def create_access_token(teacher_id: int, role: str) -> str:
    """Build a short-lived access token for a teacher."""
    now = datetime.now(UTC)
    payload = {
        "sub": str(teacher_id),
        "role": role,
        "type": "access",
        "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        "iat": now,
    }
    return jwt.encode(payload, JWT_PRIVATE_KEY, algorithm="RS256")


def create_refresh_token(teacher_id: int) -> str:
    """Build a refresh token carrying a unique jti.

    The jti is what gets hashed and stored server-side, so a specific session
    can be revoked.
    """
    now = datetime.now(UTC)
    payload = {
        "sub": str(teacher_id),
        "type": "refresh",
        "exp": now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        "iat": now,
        "jti": str(uuid.uuid4()),
    }
    return jwt.encode(payload, JWT_PRIVATE_KEY, algorithm="RS256")


def decode_token(token: str) -> dict[str, Any]:
    """Verify a token's signature and return its claims.

    Raises:
        jwt.ExpiredSignatureError: the token has expired.
        jwt.InvalidTokenError: the token is malformed, unsigned or tampered with.
    """
    return jwt.decode(token, JWT_PUBLIC_KEY, algorithms=["RS256"])


def hash_token(token: str) -> str:
    """Hash a token (or a token id) for storage — never store the raw value."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
