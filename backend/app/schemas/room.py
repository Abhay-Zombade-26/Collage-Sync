from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import RoomType
from app.schemas.subject import SubjectRead


class RoomBase(BaseModel):
    name: str
    room_type: RoomType
    # Branch the room belongs to; optional so a room can be shared across
    # branches until it is assigned.
    branch_id: int | None = None
    # Academic year the room is offered to ("FE", "SE", "TE", "BE").
    year: str | None = None


class RoomCreate(RoomBase):
    # Ids of the subjects this room can host. A lab room may host several
    # lab subjects; a lecture room usually has none.
    subject_ids: list[int] = []


class RoomUpdate(BaseModel):
    name: str | None = None
    room_type: RoomType | None = None
    branch_id: int | None = None
    year: str | None = None
    subject_ids: list[int] | None = None


class RoomRead(RoomBase):
    id: int
    created_at: datetime
    updated_at: datetime | None = None
    # Subjects this room can host.
    subjects: list[SubjectRead] = []

    model_config = ConfigDict(from_attributes=True)
