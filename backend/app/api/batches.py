from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.crud.batch import (
    create_batch,
    delete_batch,
    get_batch,
    list_batches,
    update_batch,
)
from app.db.session import get_session
from app.schemas.batch import BatchCreate, BatchRead, BatchUpdate

router = APIRouter(prefix="/batches", tags=["batches"])


@router.post("", response_model=BatchRead, status_code=status.HTTP_201_CREATED)
async def create_batch_endpoint(
    data: BatchCreate,
    db: AsyncSession = Depends(get_session),
) -> BatchRead:
    try:
        batch = await create_batch(db, data)
        return BatchRead.model_validate(batch)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Batch with this name already exists in this division",
        ) from exc


@router.get("", response_model=list[BatchRead])
async def list_batches_endpoint(
    db: AsyncSession = Depends(get_session),
) -> list[BatchRead]:
    batches = await list_batches(db)
    return [BatchRead.model_validate(b) for b in batches]


@router.get("/{batch_id}", response_model=BatchRead)
async def get_batch_endpoint(
    batch_id: int,
    db: AsyncSession = Depends(get_session),
) -> BatchRead:
    try:
        batch = await get_batch(db, batch_id)
        return BatchRead.model_validate(batch)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@router.patch("/{batch_id}", response_model=BatchRead)
async def update_batch_endpoint(
    batch_id: int,
    data: BatchUpdate,
    db: AsyncSession = Depends(get_session),
) -> BatchRead:
    try:
        batch = await update_batch(db, batch_id, data)
        return BatchRead.model_validate(batch)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Batch with this name already exists in this division",
        ) from exc


@router.delete("/{batch_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_batch_endpoint(
    batch_id: int,
    db: AsyncSession = Depends(get_session),
) -> None:
    try:
        await delete_batch(db, batch_id)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
