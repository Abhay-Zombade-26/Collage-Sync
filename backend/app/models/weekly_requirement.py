from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.division import Division
    from app.models.subject import Subject


class WeeklyRequirement(Base):
    __tablename__ = "weekly_requirements"

    __table_args__ = (
        UniqueConstraint(
            "division_id",
            "subject_id",
            name="uq_weekly_requirements_division_subject",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    division_id: Mapped[int] = mapped_column(ForeignKey("divisions.id"), nullable=False)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"), nullable=False)

    theory_periods_per_week: Mapped[int] = mapped_column(default=0, nullable=False)
    # Count of 2-period lab sessions, NOT raw period count (one session = 2 consecutive periods, per SPEC H3).
    practical_sessions_per_week: Mapped[int] = mapped_column(default=0, nullable=False)
    tutorial_periods_per_week: Mapped[int] = mapped_column(default=0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    division: Mapped["Division"] = relationship()
    subject: Mapped["Subject"] = relationship()
