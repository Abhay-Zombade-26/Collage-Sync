from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import NotFoundError
from app.models.room import Room
from app.models.room_subject import RoomSubject
from app.models.timetable_slot import TimetableSlot
from app.schemas.room import RoomCreate, RoomUpdate


async def create_room(db: AsyncSession, data: RoomCreate) -> Room:
    # subject_ids is a link table concern, not a Room column.
    room_data = data.model_dump(exclude={"subject_ids"})
    room = Room(**room_data)
    db.add(room)
    await db.flush()

    # Link the room to the subjects it can host (many-to-many).
    for subject_id in dict.fromkeys(data.subject_ids):
        db.add(RoomSubject(room_id=room.id, subject_id=subject_id))

    await db.commit()
    # Re-read with the relationship eagerly loaded: after a commit the ORM
    # expires the instance, and a lazy load would fail under asyncio
    # (MissingGreenlet) when Pydantic validates RoomRead.
    return await _reload_room(db, room.id)


async def _reload_room(db: AsyncSession, room_id: int) -> Room:
    """Fetch a room with its subjects eagerly loaded."""
    stmt = select(Room).options(selectinload(Room.subjects)).where(Room.id == room_id)
    result = await db.execute(stmt)
    room = result.scalar_one_or_none()
    if room is None:
        raise NotFoundError("Room", room_id)
    return room


async def get_room(db: AsyncSession, room_id: int) -> Room:
    stmt = select(Room).options(selectinload(Room.subjects)).where(Room.id == room_id)
    result = await db.execute(stmt)
    room = result.scalar_one_or_none()
    if room is None:
        raise NotFoundError("Room", room_id)
    return room


async def list_rooms(db: AsyncSession) -> list[Room]:
    stmt = select(Room).options(selectinload(Room.subjects))
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def update_room(db: AsyncSession, room_id: int, data: RoomUpdate) -> Room:
    room = await get_room(db, room_id)
    update_data = data.model_dump(exclude_unset=True)

    # subject_ids replaces the whole set of linked subjects.
    subject_ids = update_data.pop("subject_ids", None)
    for field, value in update_data.items():
        setattr(room, field, value)

    if subject_ids is not None:
        await db.execute(delete(RoomSubject).where(RoomSubject.room_id == room_id))
        for subject_id in dict.fromkeys(subject_ids):
            db.add(RoomSubject(room_id=room.id, subject_id=subject_id))

    await db.commit()
    # Re-read so the linked subjects are loaded eagerly (see create_room).
    return await _reload_room(db, room_id)


async def delete_room(db: AsyncSession, room_id: int) -> None:
    room = await get_room(db, room_id)

    # timetable_slots.room_id is NOT NULL, so the scheduled slots that use
    # this room have to be removed before the room itself. The room_subjects
    # links are removed by the FK's ON DELETE CASCADE.
    await db.execute(delete(TimetableSlot).where(TimetableSlot.room_id == room_id))

    await db.delete(room)
    await db.commit()
