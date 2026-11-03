from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import NotFoundError
from app.models.enums import RoomType
from app.models.room import Room
from app.models.room_subject import RoomSubject
from app.models.timetable_slot import TimetableSlot
from app.schemas.room import RoomCreate, RoomUpdate


class RoomInUseError(Exception):
    def __init__(self, room_id: int, usage_count: int):
        self.room_id = room_id
        self.usage_count = usage_count
        super().__init__(
            f"Cannot delete room {room_id}: {usage_count} timetable slot(s) are using it"
        )


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
    return await _reload_room(db, room.id)


async def _reload_room(db: AsyncSession, room_id: int) -> Room:
    """Fetch a room with its subjects eagerly loaded."""
    db.expire_all()
    stmt = (
        select(Room)
        .options(selectinload(Room.subjects))
        .where(Room.id == room_id)
        .execution_options(populate_existing=True)
    )
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


async def get_room_usage_count(db: AsyncSession, room_id: int) -> int:
    """Return count of TimetableSlots referencing this room."""
    await get_room(db, room_id)
    stmt = (
        select(func.count())
        .select_from(TimetableSlot)
        .where(TimetableSlot.room_id == room_id)
    )
    result = await db.execute(stmt)
    return result.scalar_one() or 0


async def list_rooms(
    db: AsyncSession,
    q: str | None = None,
    room_type: RoomType | None = None,
    year: str | None = None,
) -> list[Room]:
    stmt = select(Room).options(selectinload(Room.subjects))
    if q and q.strip():
        stmt = stmt.where(Room.name.ilike(f"%{q.strip()}%"))
    if room_type:
        stmt = stmt.where(Room.room_type == room_type)
    if year and year.strip():
        stmt = stmt.where(Room.year == year.strip().upper())
    stmt = stmt.order_by(Room.name.asc())
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
    return await _reload_room(db, room_id)


async def delete_room(db: AsyncSession, room_id: int) -> None:
    room = await get_room(db, room_id)

    # Check whether any timetable slots reference this room.
    usage_count = await get_room_usage_count(db, room_id)
    if usage_count > 0:
        raise RoomInUseError(room_id=room_id, usage_count=usage_count)

    # The room_subjects links are removed by the FK's ON DELETE CASCADE.
    await db.delete(room)
    await db.commit()
