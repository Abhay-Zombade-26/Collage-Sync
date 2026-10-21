from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Enum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import RoomType

if TYPE_CHECKING:
    from app.models.subject import Subject


class Room(Base):
    __tablename__ = "rooms"

    # NOTE: A room belongs to a branch and an academic year, not to a single
    # division. Every division of that branch/year can use it.
    __table_args__ = (
        UniqueConstraint("name", "branch_id", "year", name="uq_rooms_name_branch_year"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    room_type: Mapped[RoomType] = mapped_column(
        Enum(RoomType, name="room_type", native_enum=True),
        nullable=False,
    )
    # Branch the room belongs to; optional so a room can be shared across
    # branches until it is assigned.
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    # Academic year the room is offered to ("FE", "SE", "TE", "BE").
    # Optional so existing rows stay valid; used to map rooms to divisions.
    year: Mapped[str | None] = mapped_column(String, nullable=True)

    # Many-to-many: a lab room can host several lab subjects.
    subjects: Mapped[list["Subject"]] = relationship(
        "Subject",
        secondary="room_subjects",
        backref="rooms",
    )

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(onupdate=func.now())
