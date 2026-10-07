from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.crud.division import (
    create_division,
    delete_division,
    get_division,
    list_divisions,
    update_division,
)
from app.db.session import get_session
from app.schemas.division import DivisionCreate, DivisionRead, DivisionUpdate

router = APIRouter(prefix="/divisions", tags=["divisions"])


@router.post("", response_model=DivisionRead, status_code=status.HTTP_201_CREATED)
async def create_division_endpoint(
    data: DivisionCreate,
    db: AsyncSession = Depends(get_session),
) -> DivisionRead:
    try:
        division = await create_division(db, data)
        return DivisionRead.model_validate(division)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Division with this department/year/name/semester already exists",
        ) from exc


@router.get("", response_model=list[DivisionRead])
async def list_divisions_endpoint(
    db: AsyncSession = Depends(get_session),
) -> list[DivisionRead]:
    divisions = await list_divisions(db)
    return [DivisionRead.model_validate(d) for d in divisions]


@router.get("/{division_id}", response_model=DivisionRead)
async def get_division_endpoint(
    division_id: int,
    db: AsyncSession = Depends(get_session),
) -> DivisionRead:
    try:
        division = await get_division(db, division_id)
        return DivisionRead.model_validate(division)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@router.patch("/{division_id}", response_model=DivisionRead)
async def update_division_endpoint(
    division_id: int,
    data: DivisionUpdate,
    db: AsyncSession = Depends(get_session),
) -> DivisionRead:
    try:
        division = await update_division(db, division_id, data)
        return DivisionRead.model_validate(division)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Division with this department/year/name/semester already exists",
        ) from exc


@router.delete("/{division_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_division_endpoint(
    division_id: int,
    db: AsyncSession = Depends(get_session),
) -> None:
    try:
        await delete_division(db, division_id)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
