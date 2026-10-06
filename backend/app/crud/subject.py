from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.subject import Subject
from app.schemas.subject import SubjectCreate, SubjectUpdate


async def create_subject(db: AsyncSession, data: SubjectCreate) -> Subject:
    subject = Subject(**data.model_dump())
    db.add(subject)
    await db.commit()
    await db.refresh(subject)
    return subject


async def get_subject(db: AsyncSession, subject_id: int) -> Subject:
    stmt = select(Subject).where(Subject.id == subject_id)
    result = await db.execute(stmt)
    subject = result.scalar_one_or_none()
    if subject is None:
        raise NotFoundError("Subject", subject_id)
    return subject


async def list_subjects(db: AsyncSession) -> list[Subject]:
    stmt = select(Subject)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def update_subject(
    db: AsyncSession, subject_id: int, data: SubjectUpdate
) -> Subject:
    subject = await get_subject(db, subject_id)
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(subject, field, value)
    await db.commit()
    await db.refresh(subject)
    return subject


async def delete_subject(db: AsyncSession, subject_id: int) -> None:
    subject = await get_subject(db, subject_id)
    await db.delete(subject)
    await db.commit()
