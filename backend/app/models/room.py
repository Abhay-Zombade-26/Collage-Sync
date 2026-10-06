from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Enum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import RoomType

if TYPE_CHECKING:
    from app.models.division import Division


class Room(Base):
    __tablename__ = "rooms"

    # NOTE: A room row is associated with exactly one division for that semester's pool.
    # If the same physical room is usable by two divisions, that is represented as two rows.
    # Keep assignment explicit and simple; do not deduplicate (deliberate simplification).
    __table_args__ = (
        UniqueConstraint("name", "division_id", name="uq_rooms_name_division_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    room_type: Mapped[RoomType] = mapped_column(
        Enum(RoomType, name="room_type", native_enum=True),
        nullable=False,
    )
    division_id: Mapped[int | None] = mapped_column(
        ForeignKey("divisions.id"),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(onupdate=func.now())

    division: Mapped["Division | None"] = relationship()
