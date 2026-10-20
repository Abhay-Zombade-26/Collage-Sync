from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.crud.timetable_settings import (
    create_timetable_settings,
    delete_timetable_settings,
    get_timetable_settings,
    get_timetable_settings_by_period,
    list_timetable_settings,
    update_timetable_settings,
)
from app.db.session import get_session
from app.schemas.timetable_settings import (
    TimetableSettingsCreate,
    TimetableSettingsRead,
    TimetableSettingsUpdate,
)

router = APIRouter(prefix="/timetable-settings", tags=["timetable-settings"])


@router.post("", response_model=TimetableSettingsRead, status_code=status.HTTP_201_CREATED)
async def create_timetable_settings_endpoint(
    data: TimetableSettingsCreate,
    db: AsyncSession = Depends(get_session),
) -> TimetableSettingsRead:
    existing = await get_timetable_settings_by_period(db, data.academic_year, data.semester)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Timetable settings already exist for this academic year and semester",
        )
    try:
        settings = await create_timetable_settings(db, data)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Timetable settings already exist for this academic year and semester",
        ) from exc
    return TimetableSettingsRead.model_validate(settings)


@router.get("", response_model=list[TimetableSettingsRead])
async def list_timetable_settings_endpoint(
    db: AsyncSession = Depends(get_session),
) -> list[TimetableSettingsRead]:
    settings = await list_timetable_settings(db)
    return [TimetableSettingsRead.model_validate(s) for s in settings]


@router.get("/{settings_id}", response_model=TimetableSettingsRead)
async def get_timetable_settings_endpoint(
    settings_id: int,
    db: AsyncSession = Depends(get_session),
) -> TimetableSettingsRead:
    try:
        settings = await get_timetable_settings(db, settings_id)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    return TimetableSettingsRead.model_validate(settings)


@router.patch("/{settings_id}", response_model=TimetableSettingsRead)
async def update_timetable_settings_endpoint(
    settings_id: int,
    data: TimetableSettingsUpdate,
    db: AsyncSession = Depends(get_session),
) -> TimetableSettingsRead:
    try:
        settings = await update_timetable_settings(db, settings_id, data)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    return TimetableSettingsRead.model_validate(settings)


@router.delete("/{settings_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_timetable_settings_endpoint(
    settings_id: int,
    db: AsyncSession = Depends(get_session),
) -> None:
    try:
        await delete_timetable_settings(db, settings_id)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
