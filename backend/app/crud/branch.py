from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.branch import Branch
from app.models.division import Division
from app.models.room import Room
from app.models.subject import Subject
from app.schemas.branch import BranchCreate, BranchUpdate


async def create_branch(db: AsyncSession, data: BranchCreate) -> Branch:
    branch = Branch(**data.model_dump())
    db.add(branch)
    await db.commit()
    await db.refresh(branch)
    return branch


async def get_branch(db: AsyncSession, branch_id: int) -> Branch:
    stmt = select(Branch).where(Branch.id == branch_id)
    result = await db.execute(stmt)
    branch = result.scalar_one_or_none()
    if branch is None:
        raise NotFoundError("Branch", branch_id)
    return branch


async def list_branches(db: AsyncSession) -> list[Branch]:
    stmt = select(Branch).order_by(Branch.name)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def update_branch(db: AsyncSession, branch_id: int, data: BranchUpdate) -> Branch:
    branch = await get_branch(db, branch_id)
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(branch, field, value)
    await db.commit()
    await db.refresh(branch)
    return branch


async def delete_branch(db: AsyncSession, branch_id: int) -> None:
    branch = await get_branch(db, branch_id)

    # Remove dependent rows first. divisions.branch_id is NOT NULL, so the
    # divisions of this branch have to go before the branch itself. Subjects
    # and rooms only reference the branch optionally, so they are detached
    # (set to NULL) rather than deleted.
    await db.execute(delete(Division).where(Division.branch_id == branch_id))
    await db.execute(
        update(Subject).where(Subject.branch_id == branch_id).values(branch_id=None)
    )
    await db.execute(
        update(Room).where(Room.branch_id == branch_id).values(branch_id=None)
    )

    await db.delete(branch)
    await db.commit()
