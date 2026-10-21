from datetime import datetime

from sqlalchemy import ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RoomSubject(Base):
    """Junction table linking a room to the subjects it can host.

    A single lab room can host several lab subjects (e.g. "System Lab 703"
    can host both the Web Lab and the AI Lab), so the room-subject link is
    many-to-many rather than a single ``subject_id`` on the room.
    """

    __tablename__ = "room_subjects"

    __table_args__ = (
        UniqueConstraint("room_id", "subject_id", name="uq_room_subjects_room_subject"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    room_id: Mapped[int] = mapped_column(
        ForeignKey("rooms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    subject_id: Mapped[int] = mapped_column(
        ForeignKey("subjects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
