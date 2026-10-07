from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SubjectBase(BaseModel):
    name: str
    code: str


class SubjectCreate(SubjectBase):
    pass


class SubjectUpdate(BaseModel):
    name: str | None = None
    code: str | None = None


class SubjectRead(SubjectBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
