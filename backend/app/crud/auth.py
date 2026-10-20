from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.core.security import hash_password, hash_token
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
        role="TEACHER",
        is_admin=False,
    )
    db.add(teacher)
    await db.commit()
    await db.refresh(teacher)
    return teacher


async def list_pending_teachers(db: AsyncSession) -> list[Teacher]:
    stmt = select(Teacher).where(Teacher.status == TeacherStatus.PENDING)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def approve_teacher(db: AsyncSession, teacher_id: int) -> Teacher:
    stmt = select(Teacher).where(Teacher.id == teacher_id)
    result = await db.execute(stmt)
    teacher = result.scalar_one_or_none()
    if teacher is None:
        raise NotFoundError("Teacher", teacher_id)
    teacher.status = TeacherStatus.ACTIVE
    await db.commit()
    await db.refresh(teacher)
    return teacher


async def reject_teacher(db: AsyncSession, teacher_id: int) -> Teacher:
    stmt = select(Teacher).where(Teacher.id == teacher_id)
    result = await db.execute(stmt)
    teacher = result.scalar_one_or_none()
    if teacher is None:
        raise NotFoundError("Teacher", teacher_id)
    teacher.status = TeacherStatus.REJECTED
    await db.commit()
    await db.refresh(teacher)
    return teacher


async def store_refresh_token(
    db: AsyncSession, teacher_id: int, jti: str, expires_at: datetime
) -> None:
    row = RefreshToken(
        teacher_id=teacher_id,
        token_hash=hash_token(jti),
        expires_at=expires_at,
        revoked=False,
    )
    db.add(row)
    await db.commit()


async def get_valid_refresh_token(db: AsyncSession, jti: str) -> RefreshToken | None:
    stmt = select(RefreshToken).where(
        RefreshToken.token_hash == hash_token(jti),
        RefreshToken.revoked.is_(False),
    )
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if row is None:
        return None
    if row.revoked:
        return None
    if row.expires_at < datetime.now().astimezone().replace(tzinfo=None):
        return None
    return row


async def revoke_refresh_token(db: AsyncSession, jti: str) -> None:
    stmt = select(RefreshToken).where(RefreshToken.token_hash == hash_token(jti))
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if row is not None and not row.revoked:
        row.revoked = True
        await db.commit()
