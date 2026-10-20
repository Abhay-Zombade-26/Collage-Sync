from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.db.session import get_session
from app.schemas.timetable import GenerateRequest, SlotUpdate, TimetableSlotRead
from app.services.timetable.solver import (
    apply_slot_override,
    generate_timetable,
    list_slots,
)

router = APIRouter(prefix="/timetable", tags=["timetable"])


@router.post("/generate", response_model=list[TimetableSlotRead])
async def generate_timetable_endpoint(
    data: GenerateRequest,
    db: AsyncSession = Depends(get_session),
) -> list[TimetableSlotRead]:
    """Generate a timetable for a division.

    The solver is CPU-bound, so it is dispatched to a worker thread; the
    session is only touched on the event loop.
    """
    try:
        slots = await generate_timetable(db, data.division_id)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    return [TimetableSlotRead.model_validate(slot) for slot in slots]


@router.get("/{division_id}", response_model=list[TimetableSlotRead])
async def list_timetable_slots_endpoint(
    division_id: int,
    db: AsyncSession = Depends(get_session),
) -> list[TimetableSlotRead]:
    slots = await list_slots(db, division_id)
    return [TimetableSlotRead.model_validate(slot) for slot in slots]


@router.patch("/slots/{slot_id}", response_model=TimetableSlotRead)
async def update_timetable_slot_endpoint(
    slot_id: int,
    data: SlotUpdate,
    db: AsyncSession = Depends(get_session),
) -> TimetableSlotRead:
    """Apply a manual teacher/room override; the slot becomes locked."""
    try:
        slot = await apply_slot_override(
            db,
            slot_id,
            teacher_id=data.teacher_id,
            room_id=data.room_id,
        )
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    return TimetableSlotRead.model_validate(slot)
