"""Index active field mappings by owning table for selective list filters.

The non-unique composite index supports table-scoped field pages and lets
source-system filters use the existing table identity index before joining
field rows. It does not change row identity or soft-delete semantics.
"""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0013_field_mapping_field_filter_index"
down_revision = "0012_search_hot_keywords"
branch_labels = None
depends_on = None

TABLE_NAME = "p_field_mapping_field"
INDEX_NAME = "idx_p_field_mapping_field_table_deleted"
INDEX_COLUMNS = ("table_pk", "is_deleted")


def _schema() -> str | None:
    return op.get_context().opts.get("version_table_schema")


def upgrade() -> None:
    bind = op.get_bind()
    schema = _schema()
    inspector = sa.inspect(bind)
    if not inspector.has_table(TABLE_NAME, schema=schema):
        # Older/partial installations may intentionally omit the field-detail
        # table; match earlier field-mapping revisions and keep unrelated
        # upgrades usable without manufacturing that table.
        return

    existing = {
        str(index.get("name") or "").lower(): index
        for index in inspector.get_indexes(TABLE_NAME, schema=schema)
    }.get(INDEX_NAME.lower())
    if existing is not None:
        columns = tuple(
            str(column).lower()
            for column in (existing.get("column_names") or ())
        )
        if columns != INDEX_COLUMNS or bool(existing.get("unique")):
            raise RuntimeError(
                f"{INDEX_NAME} exists with unexpected definition: "
                f"columns={columns!r}, unique={bool(existing.get('unique'))!r}"
            )
        return

    op.create_index(INDEX_NAME, TABLE_NAME, list(INDEX_COLUMNS), schema=schema)


def downgrade() -> None:
    raise NotImplementedError("Database downgrades are intentionally unsupported")
