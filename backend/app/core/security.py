# pyright: reportUnknownMemberType=false
import asyncio
import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.config import settings

_ph = PasswordHasher()


def _hash_sync(password: str) -> str:
    return _ph.hash(password)


async def hash_password(password: str) -> str:
    return await asyncio.to_thread(_hash_sync, password)


def _verify_sync(password: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


async def verify_password(password: str, hashed: str) -> bool:
    return await asyncio.to_thread(_verify_sync, password, hashed)


def create_access_token(teacher_id: int) -> str:
    now = datetime.now(UTC)
    exp = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(teacher_id),
        "exp": exp,
        "iat": now,
        "type": "access",
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> int:
    payload = jwt.decode(
        token,
        settings.JWT_SECRET_KEY,
        algorithms=[settings.JWT_ALGORITHM],
    )
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("Invalid token type")
    sub = payload.get("sub")
    if sub is None:
        raise jwt.InvalidTokenError("Missing token subject")
    try:
        return int(sub)
    except (ValueError, TypeError) as exc:
        raise jwt.InvalidTokenError("Invalid token subject") from exc


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def generate_refresh_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(48)
    token_hash = hash_refresh_token(raw)
    return raw, token_hash
