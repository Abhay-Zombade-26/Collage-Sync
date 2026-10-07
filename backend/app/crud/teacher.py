from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.teacher import Teacher
from app.schemas.teacher import TeacherCreate, TeacherUpdate


async def create_teacher(db: AsyncSession, data: TeacherCreate) -> Teacher:
    teacher = Teacher(**data.model_dump())
    db.add(teacher)
    await db.commit()
    await db.refresh(teacher)
    return teacher


async def get_teacher(db: AsyncSession, teacher_id: int) -> Teacher:
    stmt = select(Teacher).where(Teacher.id == teacher_id)
    result = await db.execute(stmt)
    teacher = result.scalar_one_or_none()
    if teacher is None:
        raise NotFoundError("Teacher", teacher_id)
    return teacher


async def list_teachers(db: AsyncSession) -> list[Teacher]:
    stmt = select(Teacher)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def update_teacher(db: AsyncSession, teacher_id: int, data: TeacherUpdate) -> Teacher:
    teacher = await get_teacher(db, teacher_id)
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(teacher, field, value)
    await db.commit()
    await db.refresh(teacher)
    return teacher


async def delete_teacher(db: AsyncSession, teacher_id: int) -> None:
    teacher = await get_teacher(db, teacher_id)
    await db.delete(teacher)
    await db.commit()
