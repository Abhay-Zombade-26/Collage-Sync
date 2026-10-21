from datetime import datetime

from sqlalchemy import String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Branch(Base):
    """A branch (e.g. "IT", "CSE") is the top of the hierarchy.

    Branch -> Year (FE/SE/TE/BE) -> Division -> Batch.
    """

    __tablename__ = "branches"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
