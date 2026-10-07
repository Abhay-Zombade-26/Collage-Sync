from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.core.security import hash_password
from app.models.enums import TeacherStatus
from app.models.refresh_token import RefreshToken
from app.models.teacher import Teacher
from app.schemas.auth import RegisterRequest


async def get_teacher_by_email(db: AsyncSession, email: str) -> Teacher | None:
    stmt = select(Teacher).where(Teacher.email == email)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def create_pending_teacher(db: AsyncSession, data: RegisterRequest) -> Teacher:
    hashed = await hash_password(data.password)
    teacher = Teacher(
        name=data.name,
        email=str(data.email),
        hashed_password=hashed,
        status=TeacherStatus.PENDING,
        is_admin=False,
    )
    db.add(teacher)
    await db.commit()
    await db.refresh(teacher)
    return teacher


async def update_teacher_status(
    db: AsyncSession, teacher_id: int, new_status: TeacherStatus
) -> Teacher:
    stmt = select(Teacher).where(Teacher.id == teacher_id)
    result = await db.execute(stmt)
    teacher = result.scalar_one_or_none()
    if teacher is None:
        raise NotFoundError("Teacher", teacher_id)
    teacher.status = new_status
    await db.commit()
    await db.refresh(teacher)
    return teacher


async def create_refresh_token_row(
    db: AsyncSession, teacher_id: int, token_hash: str, expires_at: datetime
) -> RefreshToken:
    row = RefreshToken(
        teacher_id=teacher_id,
        token_hash=token_hash,
        expires_at=expires_at,
        revoked=False,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def get_refresh_token_row(db: AsyncSession, token_hash: str) -> RefreshToken | None:
    stmt = select(RefreshToken).where(
        RefreshToken.token_hash == token_hash,
        RefreshToken.revoked.is_(False),
    )
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if row is None:
        return None
    expires_at = row.expires_at
    if expires_at.tzinfo is None:
        is_expired = expires_at <= datetime.now(UTC).replace(tzinfo=None)
    else:
        is_expired = expires_at <= datetime.now(UTC).replace(tzinfo=None)
    if is_expired:
        return None
    return row


async def revoke_refresh_token_row(db: AsyncSession, token_hash: str) -> None:
    stmt = select(RefreshToken).where(RefreshToken.token_hash == token_hash)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if row is not None and not row.revoked:
        row.revoked = True
        await db.commit()


async def revoke_all_refresh_tokens_for_teacher(db: AsyncSession, teacher_id: int) -> None:
    stmt = select(RefreshToken).where(
        RefreshToken.teacher_id == teacher_id,
        RefreshToken.revoked.is_(False),
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()
    for row in rows:
        row.revoked = True
    await db.commit()
