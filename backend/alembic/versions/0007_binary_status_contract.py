"""Unify manual code-table availability status values.

The manual code-table status is an availability flag, not a workflow state.
Existing rows are copied without loss while ``active`` is normalized to
``enabled`` and ``draft`` to ``disabled``.  The forward-only migration keeps
all table columns and the filter index intact.
"""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007_binary_status_contract"
down_revision = "0006_field_mapping_upstream_id"
branch_labels = None
depends_on = None

TABLE_NAME = "p_manual_code_table"
FILTER_INDEX = "idx_p_manual_code_table_filter"
STATUS_CHECK = "ck_p_manual_code_table_status_code"
TEMP_TABLE_NAME = "p_manual_code_table_status_tmp"
COLUMNS = (
    "table_id",
    "table_code",
    "table_name",
    "table_style",
    "owner_name",
    "status_code",
    "remark",
    "created_by",
    "created_at",
    "updated_by",
    "updated_at",
)


def _dialect() -> str:
    return op.get_bind().dialect.name


def _schema() -> str | None:
    return op.get_context().opts.get("version_table_schema")


def _text(length: int | None = None):
    if _dialect() == "sqlite":
        return sa.Text()
    return sa.String(length) if length else sa.Text()


def _number():
    return sa.Integer() if _dialect() == "sqlite" else sa.BigInteger()


def _timestamp():
    return sa.TIMESTAMP()


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name, schema=_schema())


def _manual_table_columns():
    return [
        sa.Column("table_id", _number(), primary_key=True),
        sa.Column("table_code", _text(64), nullable=False),
        sa.Column("table_name", _text(128), nullable=False),
        sa.Column("table_style", _text(16), nullable=False),
        sa.Column("owner_name", _text(64)),
        sa.Column("status_code", _text(16), nullable=False, server_default=sa.text("'enabled'")),
        sa.Column("remark", _text(1000)),
        sa.Column("created_by", _text(64), nullable=False, server_default=sa.text("'system'")),
        sa.Column("created_at", _timestamp(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_by", _text(64), nullable=False, server_default=sa.text("'system'")),
        sa.Column("updated_at", _timestamp(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("table_code", name="uq_p_manual_code_table_code"),
        sa.CheckConstraint("table_style IN ('enum', 'dim', 'status', 'map', 'custom')"),
        sa.CheckConstraint(
            "status_code IN ('enabled', 'disabled')",
            name=STATUS_CHECK,
        ),
    ]


def _rebuild_sqlite_table() -> None:
    """Replace SQLite's unnamed CHECK constraint while copying rows safely."""
    bind = op.get_bind()
    schema = _schema()
    if _has_table(TEMP_TABLE_NAME):
        op.drop_table(TEMP_TABLE_NAME, schema=schema)

    op.create_table(TEMP_TABLE_NAME, *_manual_table_columns(), schema=schema)
    old_table = sa.Table(TABLE_NAME, sa.MetaData(), autoload_with=bind, schema=schema)
    new_table = sa.Table(TEMP_TABLE_NAME, sa.MetaData(), autoload_with=bind, schema=schema)
    status = sa.case(
        (old_table.c.status_code == "active", "enabled"),
        (old_table.c.status_code == "draft", "disabled"),
        else_=old_table.c.status_code,
    )
    expressions = [
        old_table.c.table_id,
        old_table.c.table_code,
        old_table.c.table_name,
        old_table.c.table_style,
        old_table.c.owner_name,
        status,
        old_table.c.remark,
        old_table.c.created_by,
        old_table.c.created_at,
        old_table.c.updated_by,
        old_table.c.updated_at,
    ]
    op.execute(
        new_table.insert().from_select(
            list(COLUMNS),
            sa.select(*expressions).select_from(old_table),
        )
    )
    op.drop_table(TABLE_NAME, schema=schema)
    op.rename_table(TEMP_TABLE_NAME, TABLE_NAME, schema=schema)
    op.create_index(
        FILTER_INDEX,
        TABLE_NAME,
        ["table_style", "status_code", "updated_at"],
        unique=False,
        schema=schema,
    )


def _status_checks() -> list[dict]:
    try:
        return sa.inspect(op.get_bind()).get_check_constraints(TABLE_NAME, schema=_schema())
    except (NotImplementedError, sa.exc.NoSuchTableError):
        return []


def _replace_server_default_and_check() -> None:
    schema = _schema()
    checks = _status_checks()
    has_canonical_check = False
    for check in checks:
        expression = str(check.get("sqltext") or "").lower()
        if "status_code" not in expression:
            continue
        if "enabled" in expression and "disabled" in expression and "draft" not in expression:
            has_canonical_check = True
            continue
        name = check.get("name")
        if name:
            op.drop_constraint(name, TABLE_NAME, type_="check", schema=schema)

    manual_table = sa.table(TABLE_NAME, sa.column("status_code", _text(16)), schema=schema)
    op.execute(
        sa.update(manual_table)
        .where(manual_table.c.status_code == "active")
        .values(status_code="enabled")
    )
    op.execute(
        sa.update(manual_table)
        .where(manual_table.c.status_code == "draft")
        .values(status_code="disabled")
    )
    op.alter_column(
        TABLE_NAME,
        "status_code",
        existing_type=_text(16),
        existing_nullable=False,
        server_default=sa.text("'enabled'"),
        schema=schema,
    )
    if not has_canonical_check:
        op.create_check_constraint(
            STATUS_CHECK,
            TABLE_NAME,
            "status_code IN ('enabled', 'disabled')",
            schema=schema,
        )


def upgrade() -> None:
    if not _has_table(TABLE_NAME):
        return
    if _dialect() == "sqlite":
        _rebuild_sqlite_table()
    else:
        _replace_server_default_and_check()


def downgrade() -> None:
    raise NotImplementedError("Database downgrades are intentionally unsupported")
