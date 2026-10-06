from datetime import datetime, time
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Enum, ForeignKey, Index, Time, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import DayOfWeek

if TYPE_CHECKING:
    from app.models.batch import Batch
    from app.models.division import Division
    from app.models.room import Room
    from app.models.subject import Subject
    from app.models.teacher import Teacher


class TimetableSlot(Base):
    __tablename__ = "timetable_slots"

    # NOTE: Do NOT add a lunch-marker row convention (no subject_id=0 hack like the
    # reference project) — lunch is computed from timetable_settings at render/export
    # time, never stored as a slot row.
    __table_args__ = (
        Index("ix_slot_lookup", "division_id", "day_of_week", "start_time"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    division_id: Mapped[int] = mapped_column(ForeignKey("divisions.id"), nullable=False)
    # batch_id is null for whole-division theory slots; populated for batch lab slots
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("batches.id"), nullable=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"), nullable=False)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("teachers.id"), nullable=False)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"), nullable=False)
    day_of_week: Mapped[DayOfWeek] = mapped_column(
        Enum(DayOfWeek, name="day_of_week", native_enum=True),
        nullable=False,
    )
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    is_lab: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    locked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(onupdate=func.now())

    division: Mapped["Division"] = relationship()
    batch: Mapped["Batch | None"] = relationship()
    subject: Mapped["Subject"] = relationship()
    teacher: Mapped["Teacher"] = relationship()
    room: Mapped["Room"] = relationship()
