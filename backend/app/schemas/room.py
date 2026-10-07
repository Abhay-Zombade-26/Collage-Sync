from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import RoomType


class RoomBase(BaseModel):
    name: str
    room_type: RoomType
    division_id: int


class RoomCreate(RoomBase):
    pass


class RoomUpdate(BaseModel):
    name: str | None = None
    room_type: RoomType | None = None
    division_id: int | None = None


class RoomRead(RoomBase):
    id: int
    created_at: datetime
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
