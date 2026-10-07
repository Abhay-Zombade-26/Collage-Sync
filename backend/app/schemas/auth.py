from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import EmploymentType, TeacherRole, TeacherStatus


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class RegistrationRead(BaseModel):
    id: int
    name: str
    email: str
    status: TeacherStatus
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MeRead(BaseModel):
    id: int
    name: str
    email: str
    role: TeacherRole
    status: TeacherStatus
    employment_type: EmploymentType
    is_admin: bool
    max_lectures_per_day: int

    model_config = ConfigDict(from_attributes=True)
