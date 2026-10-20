from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class WeeklyRequirementBase(BaseModel):
    division_id: int
    subject_id: int
    theory_periods_per_week: int = Field(default=0, ge=0)
    # Count of 2-period lab sessions, not raw period count (one session = 2
    # consecutive periods, per SPEC H3).
    practical_sessions_per_week: int = Field(default=0, ge=0)
    tutorial_periods_per_week: int = Field(default=0, ge=0)


class WeeklyRequirementCreate(WeeklyRequirementBase):
    pass


class WeeklyRequirementUpdate(BaseModel):
    division_id: int | None = None
    subject_id: int | None = None
    theory_periods_per_week: int | None = Field(default=None, ge=0)
    practical_sessions_per_week: int | None = Field(default=None, ge=0)
    tutorial_periods_per_week: int | None = Field(default=None, ge=0)


class WeeklyRequirementRead(WeeklyRequirementBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
