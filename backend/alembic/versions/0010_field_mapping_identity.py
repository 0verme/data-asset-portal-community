"""Replace the source-only field-mapping key with the full mapping identity.

``target_table_name`` and ``load_mode`` intentionally remain nullable. Since
SQLite, PostgreSQL, MySQL, and DWS do not provide one portable UNIQUE + NULL
contract for the five-part identity, the database keeps a non-unique lookup
index and the import service validates the complete identity before writing.
This revision never rewrites or deletes existing mapping rows.
"""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0010_field_mapping_identity"
down_revision = "0009_upstream_option_contract"
branch_labels = None
depends_on = None

TABLE_NAME = "p_field_mapping_table"
OBSOLETE_INDEX = "idx_p_field_mapping_table_uk_01"
IDENTITY_INDEX = "idx_p_field_mapping_table_identity"
IDENTITY_COLUMNS = (
    "upstream_system_id",
    "source_table_name",
    "target_layer_code",
    "target_table_name",
    "load_mode",
)
OBSOLETE_COLUMNS = ("upstream_system_id", "source_table_name")


def _schema() -> str | None:
    return op.get_context().opts.get("version_table_schema")


def _indexes() -> list[dict]:
    return sa.inspect(op.get_bind()).get_indexes(TABLE_NAME, schema=_schema())


def _has_table() -> bool:
    return sa.inspect(op.get_bind()).has_table(TABLE_NAME, schema=_schema())


def _drop_obsolete_index() -> None:
    for index in _indexes():
        if str(index.get("name") or "").lower() == OBSOLETE_INDEX.lower():
            op.drop_index(index["name"], table_name=TABLE_NAME, schema=_schema())
            break


def _reject_other_source_only_uniqueness() -> None:
    """Never leave an alternate UNIQUE(source-system, source-table) in place."""
    for index in _indexes():
        columns = tuple(
            str(column).lower() for column in index.get("column_names") or ()
        )
        if columns == OBSOLETE_COLUMNS and index.get("unique"):
            raise RuntimeError(
                "p_field_mapping_table still has a source-only unique index "
                f"{index.get('name')!r}; remove it explicitly before retrying"
            )

    inspector = sa.inspect(op.get_bind())
    for constraint in inspector.get_unique_constraints(TABLE_NAME, schema=_schema()):
        columns = tuple(
            str(column).lower() for column in constraint.get("column_names") or ()
        )
        if columns == OBSOLETE_COLUMNS:
            raise RuntimeError(
                "p_field_mapping_table still has a source-only unique constraint "
                f"{constraint.get('name')!r}; remove it explicitly before retrying"
            )


def _ensure_identity_index() -> None:
    for index in _indexes():
        if str(index.get("name") or "").lower() != IDENTITY_INDEX.lower():
            continue
        columns = tuple(
            str(column).lower() for column in index.get("column_names") or ()
        )
        if columns != IDENTITY_COLUMNS or index.get("unique"):
            raise RuntimeError(
                f"{IDENTITY_INDEX} exists with an unexpected definition: "
                f"columns={columns!r}, unique={index.get('unique')!r}"
            )
        return

    op.create_index(
        IDENTITY_INDEX,
        TABLE_NAME,
        list(IDENTITY_COLUMNS),
        unique=False,
        schema=_schema(),
    )


def upgrade() -> None:
    if not _has_table():
        return
    _drop_obsolete_index()
    _reject_other_source_only_uniqueness()
    _ensure_identity_index()


def downgrade() -> None:
    raise NotImplementedError("Database downgrades are intentionally unsupported")
