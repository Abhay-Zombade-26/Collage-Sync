from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.timetable_settings import TimetableSettings
from app.schemas.timetable_settings import (
    TimetableSettingsCreate,
    TimetableSettingsUpdate,
)


async def create_timetable_settings(
    db: AsyncSession, data: TimetableSettingsCreate
) -> TimetableSettings:
    settings = TimetableSettings(**data.model_dump())
    db.add(settings)
    await db.commit()
    await db.refresh(settings)
    return settings


async def get_timetable_settings(db: AsyncSession, settings_id: int) -> TimetableSettings:
    stmt = select(TimetableSettings).where(TimetableSettings.id == settings_id)
    result = await db.execute(stmt)
    settings = result.scalar_one_or_none()
    if settings is None:
        raise NotFoundError("TimetableSettings", settings_id)
    return settings


async def list_timetable_settings(db: AsyncSession) -> list[TimetableSettings]:
    stmt = select(TimetableSettings)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_timetable_settings_by_period(
    db: AsyncSession, academic_year: str, semester: int
) -> TimetableSettings | None:
    """Return the settings row for a semester, or None if there is none.

    The table is a singleton-style config (one active row per semester) but
    carries no database-level unique constraint, so the conflict is checked
    here rather than by catching IntegrityError.
    """
    stmt = select(TimetableSettings).where(
        TimetableSettings.academic_year == academic_year,
        TimetableSettings.semester == semester,
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def update_timetable_settings(
    db: AsyncSession, settings_id: int, data: TimetableSettingsUpdate
) -> TimetableSettings:
    settings = await get_timetable_settings(db, settings_id)
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(settings, field, value)
    await db.commit()
    await db.refresh(settings)
    return settings


async def delete_timetable_settings(db: AsyncSession, settings_id: int) -> None:
    settings = await get_timetable_settings(db, settings_id)
    await db.delete(settings)
    await db.commit()
