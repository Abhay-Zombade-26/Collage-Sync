from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.batch import Batch
from app.schemas.batch import BatchCreate, BatchUpdate


async def create_batch(db: AsyncSession, data: BatchCreate) -> Batch:
    batch = Batch(**data.model_dump())
    db.add(batch)
    await db.commit()
    await db.refresh(batch)
    return batch


async def get_batch(db: AsyncSession, batch_id: int) -> Batch:
    stmt = select(Batch).where(Batch.id == batch_id)
    result = await db.execute(stmt)
    batch = result.scalar_one_or_none()
    if batch is None:
        raise NotFoundError("Batch", batch_id)
    return batch


async def list_batches(db: AsyncSession) -> list[Batch]:
    stmt = select(Batch)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def update_batch(db: AsyncSession, batch_id: int, data: BatchUpdate) -> Batch:
    batch = await get_batch(db, batch_id)
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(batch, field, value)
    await db.commit()
    await db.refresh(batch)
    return batch


async def delete_batch(db: AsyncSession, batch_id: int) -> None:
    batch = await get_batch(db, batch_id)
    await db.delete(batch)
    await db.commit()
