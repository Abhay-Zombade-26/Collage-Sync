from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.batch import Batch
from app.models.division import Division
from app.models.eligibility import TeacherSubjectDivision
from app.models.timetable_slot import TimetableSlot
from app.models.weekly_requirement import WeeklyRequirement
from app.schemas.division import DivisionCreate, DivisionUpdate


async def create_division(db: AsyncSession, data: DivisionCreate) -> Division:
    division = Division(**data.model_dump())
    db.add(division)
    await db.commit()
    await db.refresh(division)
    return division


async def get_division(db: AsyncSession, division_id: int) -> Division:
    stmt = select(Division).where(Division.id == division_id)
    result = await db.execute(stmt)
    division = result.scalar_one_or_none()
    if division is None:
        raise NotFoundError("Division", division_id)
    return division


async def list_divisions(db: AsyncSession) -> list[Division]:
    stmt = select(Division)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def update_division(db: AsyncSession, division_id: int, data: DivisionUpdate) -> Division:
    division = await get_division(db, division_id)
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(division, field, value)
    await db.commit()
    await db.refresh(division)
    return division


async def delete_division(db: AsyncSession, division_id: int) -> None:
    division = await get_division(db, division_id)

    # Remove dependent rows first: the FKs on batches/weekly_requirements/
    # teacher_subject_division/timetable_slots are NOT NULL with no ON DELETE
    # clause, so deleting the division first would violate them.
    await db.execute(delete(TimetableSlot).where(TimetableSlot.division_id == division_id))
    await db.execute(
        delete(TeacherSubjectDivision).where(
            TeacherSubjectDivision.division_id == division_id
        )
    )
    await db.execute(
        delete(WeeklyRequirement).where(WeeklyRequirement.division_id == division_id)
    )
    await db.execute(delete(Batch).where(Batch.division_id == division_id))

    await db.delete(division)
    await db.commit()
