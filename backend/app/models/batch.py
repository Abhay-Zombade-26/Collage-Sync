from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.division import Division


class Batch(Base):
    __tablename__ = "batches"

    __table_args__ = (
        UniqueConstraint("division_id", "name", name="uq_batches_division_id_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    division_id: Mapped[int] = mapped_column(ForeignKey("divisions.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    division: Mapped["Division"] = relationship(back_populates="batches")
