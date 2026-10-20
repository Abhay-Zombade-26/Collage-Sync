from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.weekly_requirement import WeeklyRequirement
from app.schemas.weekly_requirement import (
    WeeklyRequirementCreate,
    WeeklyRequirementUpdate,
)


async def create_weekly_requirement(
    db: AsyncSession, data: WeeklyRequirementCreate
) -> WeeklyRequirement:
    requirement = WeeklyRequirement(**data.model_dump())
    db.add(requirement)
    await db.commit()
    await db.refresh(requirement)
    return requirement


async def get_weekly_requirement(db: AsyncSession, requirement_id: int) -> WeeklyRequirement:
    stmt = select(WeeklyRequirement).where(WeeklyRequirement.id == requirement_id)
    result = await db.execute(stmt)
    requirement = result.scalar_one_or_none()
    if requirement is None:
        raise NotFoundError("WeeklyRequirement", requirement_id)
    return requirement


async def list_weekly_requirements(db: AsyncSession) -> list[WeeklyRequirement]:
    stmt = select(WeeklyRequirement)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def update_weekly_requirement(
    db: AsyncSession, requirement_id: int, data: WeeklyRequirementUpdate
) -> WeeklyRequirement:
    requirement = await get_weekly_requirement(db, requirement_id)
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(requirement, field, value)
    await db.commit()
    await db.refresh(requirement)
    return requirement


async def delete_weekly_requirement(db: AsyncSession, requirement_id: int) -> None:
    requirement = await get_weekly_requirement(db, requirement_id)
    await db.delete(requirement)
    await db.commit()
