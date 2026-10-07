from datetime import datetime

from pydantic import BaseModel, ConfigDict


class BatchBase(BaseModel):
    name: str
    division_id: int


class BatchCreate(BatchBase):
    pass


class BatchUpdate(BaseModel):
    name: str | None = None
    division_id: int | None = None


class BatchRead(BatchBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
