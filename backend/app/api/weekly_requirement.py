from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.crud.weekly_requirement import (
    create_weekly_requirement,
    delete_weekly_requirement,
    get_weekly_requirement,
    list_weekly_requirements,
    update_weekly_requirement,
)
from app.db.session import get_session
from app.schemas.weekly_requirement import (
    WeeklyRequirementCreate,
    WeeklyRequirementRead,
    WeeklyRequirementUpdate,
)

router = APIRouter(prefix="/weekly-requirement", tags=["weekly-requirement"])


@router.post("", response_model=WeeklyRequirementRead, status_code=status.HTTP_201_CREATED)
async def create_weekly_requirement_endpoint(
    data: WeeklyRequirementCreate,
    db: AsyncSession = Depends(get_session),
) -> WeeklyRequirementRead:
    try:
        requirement = await create_weekly_requirement(db, data)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Weekly requirement already exists for this division and subject",
        ) from exc
    return WeeklyRequirementRead.model_validate(requirement)


@router.get("", response_model=list[WeeklyRequirementRead])
async def list_weekly_requirements_endpoint(
    db: AsyncSession = Depends(get_session),
) -> list[WeeklyRequirementRead]:
    requirements = await list_weekly_requirements(db)
    return [WeeklyRequirementRead.model_validate(r) for r in requirements]


@router.get("/{requirement_id}", response_model=WeeklyRequirementRead)
async def get_weekly_requirement_endpoint(
    requirement_id: int,
    db: AsyncSession = Depends(get_session),
) -> WeeklyRequirementRead:
    try:
        requirement = await get_weekly_requirement(db, requirement_id)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    return WeeklyRequirementRead.model_validate(requirement)


@router.patch("/{requirement_id}", response_model=WeeklyRequirementRead)
async def update_weekly_requirement_endpoint(
    requirement_id: int,
    data: WeeklyRequirementUpdate,
    db: AsyncSession = Depends(get_session),
) -> WeeklyRequirementRead:
    try:
        requirement = await update_weekly_requirement(db, requirement_id, data)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    return WeeklyRequirementRead.model_validate(requirement)


@router.delete("/{requirement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_weekly_requirement_endpoint(
    requirement_id: int,
    db: AsyncSession = Depends(get_session),
) -> None:
    try:
        await delete_weekly_requirement(db, requirement_id)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
