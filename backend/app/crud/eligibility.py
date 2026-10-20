from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.eligibility import TeacherSubjectDivision
from app.schemas.eligibility import EligibilityCreate, EligibilityUpdate


async def create_eligibility(db: AsyncSession, data: EligibilityCreate) -> TeacherSubjectDivision:
    eligibility = TeacherSubjectDivision(**data.model_dump())
    db.add(eligibility)
    await db.commit()
    await db.refresh(eligibility)
    return eligibility


async def get_eligibility(db: AsyncSession, eligibility_id: int) -> TeacherSubjectDivision:
    stmt = select(TeacherSubjectDivision).where(TeacherSubjectDivision.id == eligibility_id)
    result = await db.execute(stmt)
    eligibility = result.scalar_one_or_none()
    if eligibility is None:
        raise NotFoundError("Eligibility", eligibility_id)
    return eligibility


async def list_eligibilities(db: AsyncSession) -> list[TeacherSubjectDivision]:
    stmt = select(TeacherSubjectDivision)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def update_eligibility(
    db: AsyncSession, eligibility_id: int, data: EligibilityUpdate
) -> TeacherSubjectDivision:
    eligibility = await get_eligibility(db, eligibility_id)
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(eligibility, field, value)
    await db.commit()
    await db.refresh(eligibility)
    return eligibility


async def delete_eligibility(db: AsyncSession, eligibility_id: int) -> None:
    eligibility = await get_eligibility(db, eligibility_id)
    await db.delete(eligibility)
    await db.commit()
