from datetime import datetime, time

from pydantic import BaseModel, ConfigDict, Field


class TimetableSettingsBase(BaseModel):
    academic_year: str
    semester: int = Field(ge=1)
    start_time: time
    end_time: time
    period_minutes: int = Field(ge=1)
    lunch_start: time
    lunch_minutes: int = Field(ge=1)
    # DayOfWeek string values, e.g. ["MONDAY", "TUESDAY", ...]
    school_days: list[str] = Field(min_length=1)


class TimetableSettingsCreate(TimetableSettingsBase):
    pass


class TimetableSettingsUpdate(BaseModel):
    academic_year: str | None = None
    semester: int | None = Field(default=None, ge=1)
    start_time: time | None = None
    end_time: time | None = None
    period_minutes: int | None = Field(default=None, ge=1)
    lunch_start: time | None = None
    lunch_minutes: int | None = Field(default=None, ge=1)
    school_days: list[str] | None = Field(default=None, min_length=1)


class TimetableSettingsRead(TimetableSettingsBase):
    id: int
    created_at: datetime
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
