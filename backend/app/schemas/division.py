from datetime import datetime

from pydantic import BaseModel, ConfigDict


class DivisionBase(BaseModel):
    branch_id: int
    year: str
    name: str
    semester: int


class DivisionCreate(DivisionBase):
    pass


class DivisionUpdate(BaseModel):
    branch_id: int | None = None
    year: str | None = None
    name: str | None = None
    semester: int | None = None


class DivisionRead(DivisionBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
