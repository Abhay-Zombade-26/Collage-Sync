from datetime import time

from pydantic import BaseModel, ConfigDict

from app.models.enums import DayOfWeek


class GenerateRequest(BaseModel):
    division_id: int


class TimetableSlotRead(BaseModel):
    id: int
    division_id: int
    batch_id: int | None = None
    day_of_week: DayOfWeek
    start_time: time
    end_time: time
    subject_id: int
    teacher_id: int
    room_id: int
    is_lab: bool
    locked: bool

    model_config = ConfigDict(from_attributes=True)


class SlotUpdate(BaseModel):
    teacher_id: int | None = None
    room_id: int | None = None
