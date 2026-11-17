"""Add a dedicated example-field column to word roots."""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0016_root_example"
down_revision = "0015_ai_llm_daily_quota"
branch_labels = None
depends_on = None

TABLE_NAME = "p_root_item"
COLUMN_NAME = "root_example"


def _schema() -> str | None:
    return op.get_context().opts.get("version_table_schema")


def upgrade() -> None:
    bind = op.get_bind()
    schema = _schema()
    sqlite_profile = bind.dialect.name == "sqlite"
    expected_type = sa.Text() if sqlite_profile else sa.String(length=2000)
    inspector = sa.inspect(bind)
    if not inspector.has_table(TABLE_NAME, schema=schema):
        raise RuntimeError("word root table is required before adding root examples")

    columns = inspector.get_columns(TABLE_NAME, schema=schema)
    existing = next(
        (column for column in columns if str(column["name"]).lower() == COLUMN_NAME),
        None,
    )
    if existing is not None:
        column_type = existing.get("type")
        compatible_type = (
            isinstance(column_type, sa.Text)
            if sqlite_profile
            else isinstance(column_type, sa.String) and column_type.length == 2000
        )
        if not compatible_type or bool(existing.get("nullable", True)) is False:
            raise RuntimeError("existing p_root_item.root_example conflicts with its schema contract")
        return

    op.add_column(
        TABLE_NAME,
        sa.Column(COLUMN_NAME, expected_type, nullable=True),
        schema=schema,
    )


def downgrade() -> None:
    raise NotImplementedError("Database downgrades are intentionally unsupported")
