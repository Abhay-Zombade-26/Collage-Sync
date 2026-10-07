from fastapi import FastAPI

from app.api.auth import router as auth_router
from app.api.batches import router as batches_router
from app.api.divisions import router as divisions_router
from app.api.rooms import router as rooms_router
from app.api.subjects import router as subjects_router
from app.api.teachers import router as teachers_router

app = FastAPI(title="MU College Timetable API")
app.include_router(auth_router, prefix="/api")
app.include_router(divisions_router, prefix="/api")
app.include_router(subjects_router, prefix="/api")
app.include_router(rooms_router, prefix="/api")
app.include_router(batches_router, prefix="/api")
app.include_router(teachers_router, prefix="/api")
