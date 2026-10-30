"""Seed platform upstream database-type options for the system forms.

The application stores display values such as ``PostgreSQL`` while the code
item remains the stable identifier. This ordinary profile migration adds only
the platform ``UPSTREAM_DB_TYPE`` category/items; retail ``UPSTREAM_DEPT``
values belong to the explicit Community Demo seed or to a separately configured
business directory. Existing dictionary and system rows are never rewritten.
"""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.migrations.revision_logic import (
    PLATFORM_OPTION_CATEGORY_SPECS,
    plan_code_option_seed,
)

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
        specs=PLATFORM_OPTION_CATEGORY_SPECS,
    )

    for values in plan.categories:
        bind.execute(sa.insert(category_table).values(**dict(values)))
    for values in plan.items:
        bind.execute(sa.insert(item_table).values(**dict(values)))


def downgrade() -> None:
    raise NotImplementedError("Database downgrades are intentionally unsupported")
