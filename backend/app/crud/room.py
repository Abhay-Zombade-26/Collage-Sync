from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.room import Room
from app.schemas.room import RoomCreate, RoomUpdate


async def create_room(db: AsyncSession, data: RoomCreate) -> Room:
    room = Room(**data.model_dump())
    db.add(room)
    await db.commit()
    await db.refresh(room)
    return room


async def get_room(db: AsyncSession, room_id: int) -> Room:
    stmt = select(Room).where(Room.id == room_id)
    result = await db.execute(stmt)
    room = result.scalar_one_or_none()
    if room is None:
        raise NotFoundError("Room", room_id)
    return room


async def list_rooms(db: AsyncSession) -> list[Room]:
    stmt = select(Room)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def update_room(db: AsyncSession, room_id: int, data: RoomUpdate) -> Room:
    room = await get_room(db, room_id)
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(room, field, value)
    await db.commit()
    await db.refresh(room)
    return room


async def delete_room(db: AsyncSession, room_id: int) -> None:
    room = await get_room(db, room_id)
    await db.delete(room)
    await db.commit()
