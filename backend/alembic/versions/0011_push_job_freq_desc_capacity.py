"""Widen p_push_job.freq_desc to the legacy DWP VARCHAR(1000) capacity.

Real DWP data contains Chinese push-frequency descriptions up to 84
characters / 225 UTF-8 bytes, which do not fit the previous VARCHAR(200)
baseline and blocked the DWP -> DAP ``p_push_job`` migration with
``value too long for type character varying(200)``.  This forward revision
only widens the column and never truncates, rewrites, or deletes data; it is
idempotent and a no-op when the column already meets the target capacity or
when the dialect stores the value without a length limit (SQLite TEXT).
"""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0011_push_job_freq_desc_capacity"
down_revision = "0010_field_mapping_identity"
branch_labels = None
depends_on = None

TABLE_NAME = "p_push_job"
COLUMN_NAME = "freq_desc"
TARGET_LENGTH = 1000
UNLIMITED_DIALECTS = ("sqlite",)


def _dialect() -> str:
    return op.get_bind().dialect.name


def _schema() -> str | None:
    return op.get_context().opts.get("version_table_schema")


def _column() -> dict | None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(TABLE_NAME, schema=_schema()):
        return None
    for column in inspector.get_columns(TABLE_NAME, schema=_schema()):
        if str(column.get("name") or "").lower() == COLUMN_NAME:
            return column
    return None


def upgrade() -> None:
    if _dialect() in UNLIMITED_DIALECTS:
        return
    column = _column()
    if column is None:
        # Legacy pre-#116 database without p_push_job: 0003 creates the
        # current shape right before this revision, so there is nothing to
        # widen here.
        return
    length = getattr(column.get("type"), "length", None)
    if not isinstance(length, int) or length >= TARGET_LENGTH:
        return
    op.alter_column(
        TABLE_NAME,
        COLUMN_NAME,
        existing_type=sa.String(length),
        type_=sa.String(TARGET_LENGTH),
        existing_nullable=bool(column.get("nullable")),
        existing_server_default=column.get("default"),
        schema=_schema(),
    )


def downgrade() -> None:
    raise NotImplementedError("Database downgrades are intentionally unsupported")
