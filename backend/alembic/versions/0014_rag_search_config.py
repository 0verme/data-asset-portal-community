"""Reserve an inactive, non-public storage row for optional RAG settings."""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.migrations.rag_search_config_seed import plan_rag_search_config_seed

revision = "0014_rag_search_config"
down_revision = "0013_field_filter_index"
branch_labels = None
depends_on = None


def _schema() -> str | None:
    return op.get_context().opts.get("version_table_schema")


def _table(name: str, bind):
    return sa.Table(name, sa.MetaData(), autoload_with=bind, schema=_schema())


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    schema = _schema()
    if not (
        inspector.has_table("p_code_category", schema=schema)
        and inspector.has_table("p_code_item", schema=schema)
    ):
        raise RuntimeError("parameter dictionary tables are required for the RAG config seed")

    bind = op.get_bind()
    category_table = _table("p_code_category", bind)
    item_table = _table("p_code_item", bind)
    plan = plan_rag_search_config_seed(
        [dict(row) for row in bind.execute(sa.select(category_table)).mappings()],
        [dict(row) for row in bind.execute(sa.select(item_table)).mappings()],
    )
    if not plan.safe:
        raise RuntimeError(plan.error)
    for values in plan.categories:
        bind.execute(sa.insert(category_table).values(**values))
    for values in plan.items:
        bind.execute(sa.insert(item_table).values(**values))


def downgrade() -> None:
    raise NotImplementedError("Database downgrades are intentionally unsupported")
