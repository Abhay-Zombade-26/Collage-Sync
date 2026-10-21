"""add branches, refactor subjects rooms divisions

Revision ID: 051e359fcbef
Revises: 065876cc48e1
Create Date: 2026-10-22 00:23:46.704446

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '051e359fcbef'
down_revision: Union[str, None] = '065876cc48e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create the new branches table
    op.create_table('branches',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_branches_name'), 'branches', ['name'], unique=True)

    # Update divisions table
    # Note: nullable=True allows existing rows to survive the migration. The seed script will populate it.
    op.add_column('divisions', sa.Column('branch_id', sa.Integer(), nullable=True))
    op.drop_constraint(op.f('uq_divisions_department_year_name_semester'), 'divisions', type_='unique')
    op.create_unique_constraint('uq_divisions_branch_year_name_semester', 'divisions', ['branch_id', 'year', 'name', 'semester'])
    op.create_foreign_key('fk_divisions_branch_id', 'divisions', 'branches', ['branch_id'], ['id'])
    op.drop_column('divisions', 'department')

    # Update rooms table
    op.add_column('rooms', sa.Column('branch_id', sa.Integer(), nullable=True))
    op.add_column('rooms', sa.Column('year', sa.String(), nullable=True))
    op.drop_constraint(op.f('uq_rooms_name_division_id'), 'rooms', type_='unique')
    op.create_unique_constraint('uq_rooms_name_branch_year', 'rooms', ['name', 'branch_id', 'year'])
    op.drop_constraint(op.f('rooms_division_id_fkey'), 'rooms', type_='foreignkey')
    op.create_foreign_key('fk_rooms_branch_id', 'rooms', 'branches', ['branch_id'], ['id'])
    op.drop_column('rooms', 'division_id')

    # Update subjects table
    op.add_column('subjects', sa.Column('year', sa.String(), nullable=True))
    op.add_column('subjects', sa.Column('branch_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_subjects_branch_id', 'subjects', 'branches', ['branch_id'], ['id'])


def downgrade() -> None:
    # Revert subjects table
    op.drop_constraint('fk_subjects_branch_id', 'subjects', type_='foreignkey')
    op.drop_column('subjects', 'branch_id')
    op.drop_column('subjects', 'year')

    # Revert rooms table
    op.add_column('rooms', sa.Column('division_id', sa.INTEGER(), autoincrement=False, nullable=True))
    op.drop_constraint('fk_rooms_branch_id', 'rooms', type_='foreignkey')
    op.create_foreign_key(op.f('rooms_division_id_fkey'), 'rooms', 'divisions', ['division_id'], ['id'])
    op.drop_constraint('uq_rooms_name_branch_year', 'rooms', type_='unique')
    op.create_unique_constraint(op.f('uq_rooms_name_division_id'), 'rooms', ['name', 'division_id'])
    op.drop_column('rooms', 'year')
    op.drop_column('rooms', 'branch_id')

    # Revert divisions table
    op.add_column('divisions', sa.Column('department', sa.VARCHAR(), autoincrement=False, nullable=True))
    op.drop_constraint('fk_divisions_branch_id', 'divisions', type_='foreignkey')
    op.drop_constraint('uq_divisions_branch_year_name_semester', 'divisions', type_='unique')
    op.create_unique_constraint(op.f('uq_divisions_department_year_name_semester'), 'divisions', ['department', 'year', 'name', 'semester'])
    op.drop_column('divisions', 'branch_id')

    # Drop branches table
    op.drop_index(op.f('ix_branches_name'), table_name='branches')
    op.drop_table('branches')