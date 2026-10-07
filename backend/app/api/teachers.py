from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.crud.teacher import (
    delete_teacher,
    get_teacher,
    list_teachers,
    update_teacher,
)
from app.db.session import get_session
from app.schemas.teacher import TeacherRead, TeacherUpdate

router = APIRouter(prefix="/teachers", tags=["teachers"])


@router.get("", response_model=list[TeacherRead])
async def list_teachers_endpoint(
    db: AsyncSession = Depends(get_session),
) -> list[TeacherRead]:
    teachers = await list_teachers(db)
    return [TeacherRead.model_validate(t) for t in teachers]


@router.get("/{teacher_id}", response_model=TeacherRead)
async def get_teacher_endpoint(
    teacher_id: int,
    db: AsyncSession = Depends(get_session),
) -> TeacherRead:
    try:
        teacher = await get_teacher(db, teacher_id)
        return TeacherRead.model_validate(teacher)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@router.patch("/{teacher_id}", response_model=TeacherRead)
async def update_teacher_endpoint(
    teacher_id: int,
    data: TeacherUpdate,
    db: AsyncSession = Depends(get_session),
) -> TeacherRead:
    try:
        teacher = await update_teacher(db, teacher_id, data)
        return TeacherRead.model_validate(teacher)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Teacher with this email already exists",
        ) from exc


@router.delete("/{teacher_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_teacher_endpoint(
    teacher_id: int,
    db: AsyncSession = Depends(get_session),
) -> None:
    try:
        await delete_teacher(db, teacher_id)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
