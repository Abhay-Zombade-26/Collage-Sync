from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.crud.eligibility import (
    create_eligibility,
    delete_eligibility,
    get_eligibility,
    list_eligibilities,
    update_eligibility,
)
from app.db.session import get_session
from app.models.subject import Subject
from app.schemas.eligibility import EligibilityCreate, EligibilityRead, EligibilityUpdate

router = APIRouter(prefix="/eligibility", tags=["eligibility"])


@router.post("", response_model=EligibilityRead, status_code=status.HTTP_201_CREATED)
async def create_eligibility_endpoint(
    data: EligibilityCreate,
    db: AsyncSession = Depends(get_session),
) -> EligibilityRead:
    subject = await db.get(Subject, data.subject_id)
    if subject is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Subject {data.subject_id} not found",
        )
    if subject.subject_type == "LAB" and data.batch_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Batch ID is required for Lab subjects.",
        )
    if subject.subject_type == "THEORY":
        data.batch_id = None

    try:
        eligibility = await create_eligibility(db, data)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Eligibility already exists",
        ) from exc
    return EligibilityRead.model_validate(eligibility)


@router.get("", response_model=list[EligibilityRead])
async def list_eligibilities_endpoint(
    db: AsyncSession = Depends(get_session),
) -> list[EligibilityRead]:
    eligibilities = await list_eligibilities(db)
    return [EligibilityRead.model_validate(e) for e in eligibilities]


@router.get("/{eligibility_id}", response_model=EligibilityRead)
async def get_eligibility_endpoint(
    eligibility_id: int,
    db: AsyncSession = Depends(get_session),
) -> EligibilityRead:
    try:
        eligibility = await get_eligibility(db, eligibility_id)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    return EligibilityRead.model_validate(eligibility)


@router.patch("/{eligibility_id}", response_model=EligibilityRead)
async def update_eligibility_endpoint(
    eligibility_id: int,
    data: EligibilityUpdate,
    db: AsyncSession = Depends(get_session),
) -> EligibilityRead:
    try:
        eligibility = await update_eligibility(db, eligibility_id, data)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    return EligibilityRead.model_validate(eligibility)


@router.delete("/{eligibility_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_eligibility_endpoint(
    eligibility_id: int,
    db: AsyncSession = Depends(get_session),
) -> None:
    try:
        await delete_eligibility(db, eligibility_id)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
