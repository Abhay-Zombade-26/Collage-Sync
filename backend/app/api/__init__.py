from app.api.auth import router as auth_router
from app.api.batches import router as batches_router
from app.api.divisions import router as divisions_router
from app.api.rooms import router as rooms_router
from app.api.subjects import router as subjects_router
from app.api.teachers import router as teachers_router

__all__ = [
    "auth_router",
    "batches_router",
    "divisions_router",
    "rooms_router",
    "subjects_router",
    "teachers_router",
]
