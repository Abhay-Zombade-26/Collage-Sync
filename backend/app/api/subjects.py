from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.crud.subject import (
    create_subject,
    delete_subject,
    get_subject,
    list_subjects,
    update_subject,
)
from app.db.session import get_session
from app.schemas.subject import SubjectCreate, SubjectRead, SubjectUpdate

router = APIRouter(prefix="/subjects", tags=["subjects"])


@router.post("", response_model=SubjectRead, status_code=status.HTTP_201_CREATED)
async def create_subject_endpoint(
    data: SubjectCreate,
    db: AsyncSession = Depends(get_session),
) -> SubjectRead:
    try:
        subject = await create_subject(db, data)
        return SubjectRead.model_validate(subject)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Subject with this code already exists",
        ) from exc


@router.get("", response_model=list[SubjectRead])
async def list_subjects_endpoint(
    db: AsyncSession = Depends(get_session),
) -> list[SubjectRead]:
    subjects = await list_subjects(db)
    return [SubjectRead.model_validate(s) for s in subjects]


@router.get("/{subject_id}", response_model=SubjectRead)
async def get_subject_endpoint(
    subject_id: int,
    db: AsyncSession = Depends(get_session),
) -> SubjectRead:
    try:
        subject = await get_subject(db, subject_id)
        return SubjectRead.model_validate(subject)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@router.patch("/{subject_id}", response_model=SubjectRead)
async def update_subject_endpoint(
    subject_id: int,
    data: SubjectUpdate,
    db: AsyncSession = Depends(get_session),
) -> SubjectRead:
    try:
        subject = await update_subject(db, subject_id, data)
        return SubjectRead.model_validate(subject)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Subject with this code already exists",
        ) from exc


@router.delete("/{subject_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_subject_endpoint(
    subject_id: int,
    db: AsyncSession = Depends(get_session),
) -> None:
    try:
        await delete_subject(db, subject_id)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
