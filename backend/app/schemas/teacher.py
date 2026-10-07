from datetime import datetime, time

from pydantic import BaseModel, ConfigDict

from app.models.enums import EmploymentType, TeacherRole, TeacherStatus


class TeacherBase(BaseModel):
    name: str
    email: str
    google_sub: str
    role: TeacherRole = TeacherRole.TEACHER
    status: TeacherStatus = TeacherStatus.PENDING
    employment_type: EmploymentType = EmploymentType.REGULAR
    max_lectures_per_day: int = 6
    available_days: list[str] | None = None
    available_start: time | None = None
    available_end: time | None = None


class TeacherCreate(TeacherBase):
    pass


class TeacherUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    google_sub: str | None = None
    role: TeacherRole | None = None
    status: TeacherStatus | None = None
    employment_type: EmploymentType | None = None
    max_lectures_per_day: int | None = None
    available_days: list[str] | None = None
    available_start: time | None = None
    available_end: time | None = None


class TeacherRead(TeacherBase):
    id: int
    created_at: datetime
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
