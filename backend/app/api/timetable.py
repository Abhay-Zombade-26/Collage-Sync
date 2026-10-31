from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.db.session import get_session
from app.models.timetable_slot import TimetableSlot
from app.schemas.timetable import (
    CalculateSlotsRequest,
    GenerateRequest,
    SlotUpdate,
    TimetableSlotRead,
)
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
    """Generate a timetable for one or more divisions.

    The solver is CPU-bound, so it is dispatched to a worker thread; the
    session is only touched on the event loop.
    """
    division_ids: list[int] = list(dict.fromkeys(data.division_ids)) if data.division_ids else []
    if data.division_id is not None and data.division_id not in division_ids:
        division_ids.append(data.division_id)
    if not division_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one division_id must be provided in division_ids.",
        )
    try:
        # Remove all existing TimetableSlot rows for the selected division_ids before generating
        await db.execute(
            delete(TimetableSlot).where(
                TimetableSlot.division_id.in_(division_ids),
                TimetableSlot.locked.is_(False),
            )
        )
        await db.commit()

        slots = await generate_timetable(db, division_ids)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e),
        ) from e
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


class CalculateSlotsResponse(BaseModel):
    slots: list[dict]

    model_config = ConfigDict(from_attributes=True)


@router.post("/calculate-slots", response_model=CalculateSlotsResponse)
async def calculate_slots_endpoint(
    data: CalculateSlotsRequest,
    db: AsyncSession = Depends(get_session),
) -> CalculateSlotsResponse:
    """Calculate timetable slots based on start time, end time, period length, and lunch length.

    teaching_periods = (total_minutes - lunch_minutes) // period_minutes
    total_slots = teaching_periods + 1
    """
    from datetime import datetime

    # Parse start and end times (supports "HH:MM" or "HH:MM:SS")
    start_parts = [int(p) for p in data.start_time.split(":")[:2]]
    end_parts = [int(p) for p in data.end_time.split(":")[:2]]

    # Convert times to minutes
    start_min = start_parts[0] * 60 + start_parts[1]
    end_min = end_parts[0] * 60 + end_parts[1]
    total_minutes = end_min - start_min

    # Math
    teaching_minutes = total_minutes - data.lunch_minutes
    teaching_periods = teaching_minutes // data.period_minutes
    total_slots = teaching_periods + 1  # +1 for lunch
    period_minutes = data.period_minutes

    slots: list[dict] = []
    current = start_min
    for i in range(1, total_slots + 1):
        slot_start = current
        slot_end = current + period_minutes

        start_time_obj = datetime.strptime(f"{slot_start // 60:02d}:{slot_start % 60:02d}", "%H:%M").time()
        end_time_obj = datetime.strptime(f"{slot_end // 60:02d}:{slot_end % 60:02d}", "%H:%M").time()

        slots.append(
            {
                "index": i,
                "start_time": start_time_obj.strftime("%H:%M"),
                "end_time": end_time_obj.strftime("%H:%M"),
                "label": f"{start_time_obj.strftime('%I:%M %p')} - {end_time_obj.strftime('%I:%M %p')}",
            }
        )
        current = slot_end

    return CalculateSlotsResponse(slots=slots)
