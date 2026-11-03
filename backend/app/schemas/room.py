from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator

from app.models.enums import RoomType
from app.schemas.subject import SubjectRead

VALID_YEARS = {"FE", "SE", "TE", "BE"}


class RoomBase(BaseModel):
    name: str
    room_type: RoomType
    # Branch the room belongs to; optional so a room can be shared across
    # branches until it is assigned.
    branch_id: int | None = None
    # Academic year the room is offered to ("FE", "SE", "TE", "BE").
    year: str | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Room name cannot be empty")
        if len(v) > 50:
            raise ValueError("Room name cannot exceed 50 characters")
        return v

    @field_validator("year")
    @classmethod
    def validate_year(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip().upper()
            if not v:
                return None
            if v not in VALID_YEARS:
                raise ValueError("Year must be one of: FE, SE, TE, BE")
        return v


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

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if not v:
                raise ValueError("Room name cannot be empty")
            if len(v) > 50:
                raise ValueError("Room name cannot exceed 50 characters")
        return v

    @field_validator("year")
    @classmethod
    def validate_year(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip().upper()
            if not v:
                return None
            if v not in VALID_YEARS:
                raise ValueError("Year must be one of: FE, SE, TE, BE")
        return v


class RoomRead(RoomBase):
    id: int
    created_at: datetime
    updated_at: datetime | None = None
    # Subjects this room can host.
    subjects: list[SubjectRead] = []

    model_config = ConfigDict(from_attributes=True)


class RoomUsage(BaseModel):
    room_id: int
    usage_count: int
