"""Backfill the option contract used by upstream and push system forms.

The application stores the existing display values (for example,
``PostgreSQL`` and ``供应链部``), while the code item remains the stable
identifier.  Older installations may have no upstream categories or may have
an older subset, so this migration only adds missing categories/items and never
rewrites existing dictionary or system rows.
"""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.migrations.revision_logic import plan_code_option_seed

revision = "0009_upstream_option_contract"
down_revision = "0008_indicator_semantic_contract"
branch_labels = None
depends_on = None


def _schema() -> str | None:
    return op.get_context().opts.get("version_table_schema")


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name, schema=_schema())


def _table(name: str, bind):
    return sa.Table(name, sa.MetaData(), autoload_with=bind, schema=_schema())


def _column_rows(bind, table) -> list[dict]:
    return [dict(row) for row in bind.execute(sa.select(table)).mappings().all()]


def upgrade() -> None:
    if not (_has_table("p_code_category") and _has_table("p_code_item")):
        return

    bind = op.get_bind()
    category_table = _table("p_code_category", bind)
    item_table = _table("p_code_item", bind)
    plan = plan_code_option_seed(
        _column_rows(bind, category_table),
        _column_rows(bind, item_table),
    )

    for values in plan.categories:
        bind.execute(sa.insert(category_table).values(**dict(values)))
    for values in plan.items:
        bind.execute(sa.insert(item_table).values(**dict(values)))


def downgrade() -> None:
    raise NotImplementedError("Database downgrades are intentionally unsupported")
