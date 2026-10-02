"""Create and seed configurable portal search recommendations.

The rows are administrator-preconfigured recommendations, not a search-log
ranking. Seed rows are additive and preserve any existing customization.
"""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.migrations.search_hot_keyword_seed import plan_search_hot_keyword_seed

revision = "0012_search_hot_keywords"
down_revision = "0011_push_job_freq_desc_capacity"
branch_labels = None
depends_on = None

TABLE_NAME = "p_search_hot_keyword"


def _schema() -> str | None:
    return op.get_context().opts.get("version_table_schema")


def _table_exists() -> bool:
    return sa.inspect(op.get_bind()).has_table(TABLE_NAME, schema=_schema())


def _create_table() -> None:
    # Match the canonical SQLite baseline's unbounded TEXT declarations. The
    # other supported dialects use bounded VARCHAR columns.
    is_sqlite = op.get_bind().dialect.name == "sqlite"
    text_type = sa.Text() if is_sqlite else sa.String(length=255)
    short_text_type = sa.Text() if is_sqlite else sa.String(length=32)
    flag_type = sa.Text() if is_sqlite else sa.String(length=1)
    op.create_table(
        TABLE_NAME,
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("keyword", text_type, nullable=False),
        sa.Column(
            "category",
            short_text_type,
            nullable=False,
            server_default=sa.text("'all'"),
        ),
        sa.Column(
            "sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column(
            "enabled", flag_type, nullable=False, server_default=sa.text("'Y'")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.CheckConstraint(
            "keyword <> ''", name="ck_p_search_hot_keyword_keyword_nonempty"
        ),
        sa.UniqueConstraint(
            "keyword", "category", name="uq_p_search_hot_keyword_category"
        ),
        schema=_schema(),
    )


def _table(bind):
    return sa.Table(TABLE_NAME, sa.MetaData(), autoload_with=bind, schema=_schema())


def upgrade() -> None:
    if not _table_exists():
        _create_table()

    bind = op.get_bind()
    table = _table(bind)
    existing_rows = [
        dict(row)
        for row in bind.execute(
            sa.select(table.c.id, table.c.keyword, table.c.category)
        ).mappings()
    ]
    for values in plan_search_hot_keyword_seed(existing_rows):
        bind.execute(sa.insert(table).values(**values))


def downgrade() -> None:
    raise NotImplementedError("Database downgrades are intentionally unsupported")
