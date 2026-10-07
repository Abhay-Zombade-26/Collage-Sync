from datetime import datetime, time

from sqlalchemy import JSON, Boolean, Enum, String, Time, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import EmploymentType, TeacherRole, TeacherStatus


class Teacher(Base):
    __tablename__ = "teachers"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    role: Mapped[TeacherRole] = mapped_column(
        Enum(TeacherRole, name="teacher_role", native_enum=True),
        default=TeacherRole.TEACHER,
        nullable=False,
    )
    status: Mapped[TeacherStatus] = mapped_column(
        Enum(TeacherStatus, name="teacher_status", native_enum=True),
        default=TeacherStatus.PENDING,
        nullable=False,
    )
    employment_type: Mapped[EmploymentType] = mapped_column(
        Enum(EmploymentType, name="employment_type", native_enum=True),
        default=EmploymentType.REGULAR,
        nullable=False,
    )
    max_lectures_per_day: Mapped[int] = mapped_column(default=6, nullable=False)
    # Stored as list of DayOfWeek string values; meaningful only when employment_type == VISITING
    available_days: Mapped[list[str] | None] = mapped_column(JSON, nullable=True, default=None)
    available_start: Mapped[time | None] = mapped_column(Time, nullable=True, default=None)
    available_end: Mapped[time | None] = mapped_column(Time, nullable=True, default=None)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(onupdate=func.now())
