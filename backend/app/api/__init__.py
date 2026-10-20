from app.api.auth import router as auth_router
from app.api.batches import router as batches_router
from app.api.divisions import router as divisions_router
from app.api.eligibility import router as eligibility_router
from app.api.rooms import router as rooms_router
from app.api.subjects import router as subjects_router
from app.api.teachers import router as teachers_router
from app.api.timetable import router as timetable_router
from app.api.timetable_settings import router as timetable_settings_router
from app.api.weekly_requirement import router as weekly_requirement_router

__all__ = [
    "auth_router",
    "batches_router",
    "divisions_router",
    "eligibility_router",
    "rooms_router",
    "subjects_router",
    "teachers_router",
    "timetable_router",
    "timetable_settings_router",
    "weekly_requirement_router",
]
