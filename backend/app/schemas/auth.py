from datetime import datetime, time

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import TeacherStatus


class RegisterRequest(BaseModel):
    name: str = Field(min_length=1)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    shift_start_time: time | None = None
    shift_end_time: time | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class PendingTeacherRead(BaseModel):
    id: int
    name: str
    email: str
    status: TeacherStatus
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CurrentUser(BaseModel):
    id: int
    role: str
    status: str

    model_config = ConfigDict(from_attributes=True)
