from datetime import datetime, time

from sqlalchemy import JSON, String, Time, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TimetableSettings(Base):
    __tablename__ = "timetable_settings"

    # Single active row per semester — admin overwrites it each semester.
    # No foreign keys — intentionally a flat singleton-style configuration table.
    id: Mapped[int] = mapped_column(primary_key=True)
    academic_year: Mapped[str] = mapped_column(String, nullable=False)
    semester: Mapped[int] = mapped_column(nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    period_minutes: Mapped[int] = mapped_column(nullable=False)
    lunch_start: Mapped[time] = mapped_column(Time, nullable=False)
    lunch_minutes: Mapped[int] = mapped_column(nullable=False)
    # Stored as JSON list of DayOfWeek string values (e.g. ["MONDAY", "TUESDAY", ...])
    school_days: Mapped[list[str]] = mapped_column(JSON, nullable=False)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(onupdate=func.now())
