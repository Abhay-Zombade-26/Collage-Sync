from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.crud.branch import (
    create_branch,
    delete_branch,
    get_branch,
    list_branches,
    update_branch,
)
from app.db.session import get_session
from app.schemas.branch import BranchCreate, BranchRead, BranchUpdate

router = APIRouter(prefix="/branches", tags=["branches"])


@router.post("", response_model=BranchRead, status_code=status.HTTP_201_CREATED)
async def create_branch_endpoint(
    data: BranchCreate,
    db: AsyncSession = Depends(get_session),
) -> BranchRead:
    try:
        branch = await create_branch(db, data)
        return BranchRead.model_validate(branch)
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Branch with this name already exists",
        ) from exc


@router.get("", response_model=list[BranchRead])
async def list_branches_endpoint(
    db: AsyncSession = Depends(get_session),
) -> list[BranchRead]:
    branches = await list_branches(db)
    return [BranchRead.model_validate(b) for b in branches]


@router.get("/{branch_id}", response_model=BranchRead)
async def get_branch_endpoint(
    branch_id: int,
    db: AsyncSession = Depends(get_session),
) -> BranchRead:
    try:
        branch = await get_branch(db, branch_id)
        return BranchRead.model_validate(branch)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc


@router.patch("/{branch_id}", response_model=BranchRead)
async def update_branch_endpoint(
    branch_id: int,
    data: BranchUpdate,
    db: AsyncSession = Depends(get_session),
) -> BranchRead:
    try:
        branch = await update_branch(db, branch_id, data)
        return BranchRead.model_validate(branch)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Branch with this name already exists",
        ) from exc


@router.delete("/{branch_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_branch_endpoint(
    branch_id: int,
    db: AsyncSession = Depends(get_session),
) -> None:
    try:
        await delete_branch(db, branch_id)
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
