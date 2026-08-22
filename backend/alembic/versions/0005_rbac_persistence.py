"""Add forward-only RBAC persistence tables.

Fresh baseline files already contain these tables so baseline initialization is
self-contained.  Existing installations that are at 0004 receive the same
structures through this revision.
"""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005_rbac_persistence"
down_revision = "0004_metadata_ingestion_identity"
branch_labels = None
depends_on = None


EXPECTED_COLUMNS = {
    "p_role": {"role_code", "name", "description", "builtin", "enabled", "created_at", "updated_at"},
    "p_permission": {"permission_code", "resource", "action", "name", "description"},
    "p_role_permission": {"role_code", "permission_code"},
}


def _dialect() -> str:
    return op.get_bind().dialect.name


def _schema() -> str | None:
    return op.get_context().opts.get("version_table_schema")


def _text(length: int | None = None):
    if _dialect() == "sqlite":
        return sa.Text()
    return sa.String(length) if length else sa.Text()


def _char(length: int = 1):
    if _dialect() == "sqlite":
        return sa.Text()
    return sa.CHAR(length)


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name, schema=_schema())


def _columns(name: str) -> set[str]:
    return {
        str(column["name"]).lower()
        for column in sa.inspect(op.get_bind()).get_columns(name, schema=_schema())
    }


def _ensure_shape(name: str) -> None:
    missing = EXPECTED_COLUMNS[name] - _columns(name)
    if missing:
        raise RuntimeError(
            f"partial RBAC table {name} detected; missing columns: {', '.join(sorted(missing))}"
        )


def _index_exists(name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    for table in ("p_role_permission",):
        if not _has_table(table):
            continue
        if any(
            str(index.get("name") or "").lower() == name.lower()
            for index in inspector.get_indexes(table, schema=_schema())
        ):
            return True
    return False


def _create_role() -> None:
    op.create_table(
        "p_role",
        sa.Column("role_code", _text(64), primary_key=True),
        sa.Column("name", _text(128), nullable=False),
        sa.Column("description", _text(2000)),
        sa.Column("builtin", _char(), nullable=False, server_default=sa.text("'N'")),
        sa.Column("enabled", _char(), nullable=False, server_default=sa.text("'Y'")),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        schema=_schema(),
    )


def _create_permission() -> None:
    op.create_table(
        "p_permission",
        sa.Column("permission_code", _text(128), primary_key=True),
        sa.Column("resource", _text(64), nullable=False),
        sa.Column("action", _text(32), nullable=False),
        sa.Column("name", _text(128), nullable=False),
        sa.Column("description", _text(2000)),
        schema=_schema(),
    )


def _create_role_permission() -> None:
    op.create_table(
        "p_role_permission",
        sa.Column("role_code", _text(64), nullable=False),
        sa.Column("permission_code", _text(128), nullable=False),
        sa.PrimaryKeyConstraint("role_code", "permission_code"),
        sa.ForeignKeyConstraint(
            ["role_code"],
            [f"{_schema()}.p_role.role_code" if _schema() else "p_role.role_code"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["permission_code"],
            [
                f"{_schema()}.p_permission.permission_code"
                if _schema()
                else "p_permission.permission_code"
            ],
            ondelete="CASCADE",
        ),
        schema=_schema(),
    )


def upgrade() -> None:
    for name, creator in (
        ("p_role", _create_role),
        ("p_permission", _create_permission),
        ("p_role_permission", _create_role_permission),
    ):
        if _has_table(name):
            _ensure_shape(name)
        else:
            creator()

    if not _index_exists("idx_p_role_permission_permission"):
        op.create_index(
            "idx_p_role_permission_permission",
            "p_role_permission",
            ["permission_code"],
            unique=False,
            schema=_schema(),
        )


def downgrade() -> None:
    raise NotImplementedError("Database downgrades are intentionally unsupported")
