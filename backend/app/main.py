from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.batches import router as batches_router
from app.api.branches import router as branches_router
from app.api.divisions import router as divisions_router
from app.api.eligibility import router as eligibility_router
from app.api.rooms import router as rooms_router
from app.api.subjects import router as subjects_router
from app.api.teachers import router as teachers_router
from app.api.timetable import router as timetable_router
from app.api.timetable_settings import router as timetable_settings_router
from app.api.weekly_requirement import router as weekly_requirement_router

app = FastAPI(title="MU College Timetable API")

# The React/Vite dev server runs on :5173 and calls the API on :8000.
# allow_credentials is required so the httpOnly refresh-token cookie is sent.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(branches_router, prefix="/api")
app.include_router(eligibility_router, prefix="/api")
app.include_router(divisions_router, prefix="/api")
app.include_router(subjects_router, prefix="/api")
app.include_router(rooms_router, prefix="/api")
app.include_router(batches_router, prefix="/api")
app.include_router(teachers_router, prefix="/api")
app.include_router(timetable_router, prefix="/api")
app.include_router(timetable_settings_router, prefix="/api")
app.include_router(weekly_requirement_router, prefix="/api")
