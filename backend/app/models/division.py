from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.batch import Batch


class Division(Base):
    __tablename__ = "divisions"

    __table_args__ = (
        UniqueConstraint(
            "department",
            "year",
            "name",
            "semester",
            name="uq_divisions_department_year_name_semester",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    department: Mapped[str] = mapped_column(String, default="IT", nullable=False)
    year: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    semester: Mapped[int] = mapped_column(nullable=False)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    batches: Mapped[list["Batch"]] = relationship(back_populates="division")
