from datetime import datetime

from sqlalchemy import ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Subject(Base):
    __tablename__ = "subjects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    code: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    # Academic year the subject is offered to ("FE", "SE", "TE", "BE").
    # Optional so existing rows stay valid; used to map subjects to divisions.
    year: Mapped[str | None] = mapped_column(String, nullable=True)
    # Branch the subject belongs to; optional for shared/elective subjects.
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    # Subject type: THEORY (lecture) or LAB (2-period practical)
    subject_type: Mapped[str] = mapped_column(String, nullable=False, server_default="THEORY")

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
