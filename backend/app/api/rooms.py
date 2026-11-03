from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.crud.room import (
    RoomInUseError,
    create_room,
    delete_room,
    get_room,
    get_room_usage_count,
    list_rooms,
    update_room,
)
from app.db.session import get_session
from app.models.enums import RoomType
from app.schemas.room import RoomCreate, RoomRead, RoomUpdate, RoomUsage

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
            detail="Room with this name already exists in this branch and year",
        ) from exc


@router.get("", response_model=list[RoomRead])
async def list_rooms_endpoint(
    q: str | None = Query(default=None, description="Search by room name"),
    room_type: RoomType | None = Query(default=None, description="Filter by room type"),
    year: str | None = Query(default=None, description="Filter by academic year"),
    db: AsyncSession = Depends(get_session),
) -> list[RoomRead]:
    rooms = await list_rooms(db, q=q, room_type=room_type, year=year)
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


@router.get("/{room_id}/usage", response_model=RoomUsage)
async def get_room_usage_endpoint(
    room_id: int,
    db: AsyncSession = Depends(get_session),
) -> RoomUsage:
    try:
        count = await get_room_usage_count(db, room_id)
        return RoomUsage(room_id=room_id, usage_count=count)
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
            detail="Room with this name already exists in this branch and year",
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
    except RoomInUseError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": f"Cannot delete room: {exc.usage_count} timetable slot(s) are using it.",
                "usage_count": exc.usage_count,
            },
        ) from exc
