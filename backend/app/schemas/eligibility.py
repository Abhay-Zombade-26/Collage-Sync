from datetime import datetime

from pydantic import BaseModel, ConfigDict


class EligibilityBase(BaseModel):
    teacher_id: int
    subject_id: int
    division_id: int
    batch_id: int | None = None


class EligibilityCreate(EligibilityBase):
    pass


class EligibilityUpdate(BaseModel):
    teacher_id: int | None = None
    subject_id: int | None = None
    division_id: int | None = None
    batch_id: int | None = None


class EligibilityRead(EligibilityBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
