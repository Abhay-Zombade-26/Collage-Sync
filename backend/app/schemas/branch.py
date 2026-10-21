from datetime import datetime

from pydantic import BaseModel, ConfigDict


class BranchBase(BaseModel):
    name: str


class BranchCreate(BranchBase):
    pass


class BranchUpdate(BaseModel):
    name: str | None = None


class BranchRead(BranchBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
