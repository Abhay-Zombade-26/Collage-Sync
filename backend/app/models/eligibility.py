from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.batch import Batch
    from app.models.division import Division
    from app.models.subject import Subject
    from app.models.teacher import Teacher


class TeacherSubjectDivision(Base):
    __tablename__ = "teacher_subject_division"

    __table_args__ = (
        UniqueConstraint(
            "teacher_id",
            "subject_id",
            "division_id",
            "batch_id",
            name="uq_teacher_subject_division_batch",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("teachers.id"), nullable=False)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"), nullable=False)
    division_id: Mapped[int] = mapped_column(ForeignKey("divisions.id"), nullable=False)
    # batch_id is null for whole-division theory eligibility;
    # populated for specific batch lab eligibility.
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("batches.id"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    teacher: Mapped["Teacher"] = relationship()
    subject: Mapped["Subject"] = relationship()
    division: Mapped["Division"] = relationship()
    batch: Mapped["Batch | None"] = relationship()
