"""add subject_id to rooms

Revision ID: 27faec1636b9
Revises: be5eecd41e6a
Create Date: 2026-10-22 01:52:13.506856

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '27faec1636b9'
down_revision: Union[str, None] = 'be5eecd41e6a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('rooms', sa.Column('subject_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_rooms_subject_id', 'rooms', 'subjects', 
        ['subject_id'], ['id'], 
        ondelete='SET NULL'
    )


def downgrade() -> None:
    op.drop_constraint('fk_rooms_subject_id', 'rooms', type_='foreignkey')
    op.drop_column('rooms', 'subject_id')