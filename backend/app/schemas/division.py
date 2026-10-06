from datetime import datetime

from pydantic import BaseModel, ConfigDict


class DivisionBase(BaseModel):
    department: str
    year: str
    name: str
    semester: int


class DivisionCreate(DivisionBase):
    pass


class DivisionUpdate(BaseModel):
    department: str | None = None
    year: str | None = None
    name: str | None = None
    semester: int | None = None


class DivisionRead(DivisionBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
