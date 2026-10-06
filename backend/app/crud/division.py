from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.division import Division
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


async def update_division(
    db: AsyncSession, division_id: int, data: DivisionUpdate
) -> Division:
    division = await get_division(db, division_id)
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(division, field, value)
    await db.commit()
    await db.refresh(division)
    return division


async def delete_division(db: AsyncSession, division_id: int) -> None:
    division = await get_division(db, division_id)
    await db.delete(division)
    await db.commit()
