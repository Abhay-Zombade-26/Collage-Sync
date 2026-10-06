from fastapi import FastAPI

from app.api.divisions import router as divisions_router
from app.api.rooms import router as rooms_router
from app.api.subjects import router as subjects_router

app = FastAPI(title="MU College Timetable API")
app.include_router(divisions_router, prefix="/api")
app.include_router(subjects_router, prefix="/api")
app.include_router(rooms_router, prefix="/api")
