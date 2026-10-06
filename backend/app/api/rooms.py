from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.crud.room import (
    create_room,
    delete_room,
    get_room,
    list_rooms,
    update_room,
)
from app.db.session import get_session
from app.schemas.room import RoomCreate, RoomRead, RoomUpdate

router = APIRouter(prefix="/rooms", tags=["rooms"])


@router.post("", response_model=RoomRead, status_code=status.HTTP_201_CREATED)
async def create_room_endpoint(
    data: RoomCreate,
    db: AsyncSession = Depends(get_session),
) -> RoomRead:
    try:
        room = await create_room(db, data)
        return RoomRead.model_validate(room)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Room with this name already exists in this division",
        ) from exc


@router.get("", response_model=list[RoomRead])
async def list_rooms_endpoint(
    db: AsyncSession = Depends(get_session),
) -> list[RoomRead]:
    rooms = await list_rooms(db)
    return [RoomRead.model_validate(r) for r in rooms]


@router.get("/{room_id}", response_model=RoomRead)
async def get_room_endpoint(
    room_id: int,
    db: AsyncSession = Depends(get_session),
) -> RoomRead:
    try:
        room = await get_room(db, room_id)
        return RoomRead.model_validate(room)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@router.patch("/{room_id}", response_model=RoomRead)
async def update_room_endpoint(
    room_id: int,
    data: RoomUpdate,
    db: AsyncSession = Depends(get_session),
) -> RoomRead:
    try:
        room = await update_room(db, room_id, data)
        return RoomRead.model_validate(room)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Room with this name already exists in this division",
        ) from exc


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room_endpoint(
    room_id: int,
    db: AsyncSession = Depends(get_session),
) -> None:
    try:
        await delete_room(db, room_id)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
