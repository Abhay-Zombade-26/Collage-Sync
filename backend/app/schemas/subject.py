from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SubjectBase(BaseModel):
    name: str
    code: str
    # Academic year the subject is offered to ("FE", "SE", "TE", "BE").
    year: str | None = None
    # Branch the subject belongs to; optional for shared/elective subjects.
    branch_id: int | None = None
    # Subject type: THEORY (lecture) or LAB (2-period practical).
    subject_type: str = "THEORY"


class SubjectCreate(SubjectBase):
    pass


class SubjectUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    year: str | None = None
    branch_id: int | None = None
    subject_type: str | None = None


class SubjectRead(SubjectBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
