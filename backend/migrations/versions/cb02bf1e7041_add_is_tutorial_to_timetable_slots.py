"""add is_tutorial to timetable_slots

Revision ID: cb02bf1e7041
Revises: d999f68796db
Create Date: 2026-10-29 02:41:45.699650

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cb02bf1e7041'
down_revision: Union[str, None] = 'd999f68796db'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # We add server_default='false' so existing rows in the table get a value
    op.add_column('timetable_slots', sa.Column('is_tutorial', sa.Boolean(), server_default=sa.text('false'), nullable=False))


def downgrade() -> None:
    op.drop_column('timetable_slots', 'is_tutorial')