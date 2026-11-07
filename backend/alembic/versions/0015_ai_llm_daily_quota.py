"""Persist the shared daily LLM quota counter and seed its default setting."""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

from datetime import date

import sqlalchemy as sa
from alembic import op

from app.migrations.ai_llm_quota_seed import plan_ai_llm_quota_seed

revision = "0015_ai_llm_daily_quota"
down_revision = "0014_rag_search_config"
branch_labels = None
depends_on = None

TABLE_NAME = "p_ai_llm_daily_usage"
INITIAL_BUSINESS_DATE = "1970-01-01"


def _schema() -> str | None:
    return op.get_context().opts.get("version_table_schema")


def _table_exists(bind) -> bool:
    return sa.inspect(bind).has_table(TABLE_NAME, schema=_schema())


def _create_usage_table() -> None:
    op.create_table(
        TABLE_NAME,
        sa.Column("scope_key", sa.String(length=32), nullable=False),
        sa.Column("business_date", sa.String(length=10), nullable=False),
        sa.Column("used_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("scope_key", name="pk_p_ai_llm_daily_usage"),
        sa.CheckConstraint(
            "used_count >= 0", name="ck_p_ai_llm_daily_usage_nonnegative"
        ),
        schema=_schema(),
    )


def _validate_usage_table(bind) -> None:
    inspector = sa.inspect(bind)
    columns = inspector.get_columns(TABLE_NAME, schema=_schema())
    expected = {"scope_key", "business_date", "used_count", "updated_at"}
    observed = {str(column["name"]).lower() for column in columns}
    primary_key = inspector.get_pk_constraint(TABLE_NAME, schema=_schema()).get("constrained_columns") or []
    if observed != expected or [str(column).lower() for column in primary_key] != ["scope_key"]:
        raise RuntimeError("existing daily LLM quota table conflicts with its schema contract")
    by_name = {str(column["name"]).lower(): column for column in columns}
    if any(bool(by_name[name].get("nullable", True)) for name in expected):
        raise RuntimeError("existing daily LLM quota table has nullable contract columns")
    scope_type = by_name["scope_key"]["type"]
    date_type = by_name["business_date"]["type"]
    if (
        not isinstance(scope_type, sa.String)
        or scope_type.length not in (None, 32)
        or not isinstance(date_type, sa.String)
        or date_type.length not in (None, 10)
    ):
        raise RuntimeError("existing daily LLM quota table has incompatible text columns")
    if not isinstance(by_name["used_count"]["type"], sa.Integer):
        raise RuntimeError("existing daily LLM quota table has an incompatible counter type")
    if not isinstance(by_name["updated_at"]["type"], sa.DateTime):
        raise RuntimeError("existing daily LLM quota table has an incompatible timestamp type")


def _seed_config(bind) -> None:
    inspector = sa.inspect(bind)
    schema = _schema()
    if not (inspector.has_table("p_code_category", schema=schema) and inspector.has_table("p_code_item", schema=schema)):
        raise RuntimeError("parameter dictionary tables are required for the daily LLM quota setting")
    category_table = sa.Table("p_code_category", sa.MetaData(), autoload_with=bind, schema=schema)
    item_table = sa.Table("p_code_item", sa.MetaData(), autoload_with=bind, schema=schema)
    plan = plan_ai_llm_quota_seed(
        [dict(row) for row in bind.execute(sa.select(category_table)).mappings()],
        [dict(row) for row in bind.execute(sa.select(item_table)).mappings()],
    )
    if not plan.safe:
        raise RuntimeError(plan.error or "daily LLM quota setting seed is unsafe")
    for values in plan.categories:
        bind.execute(sa.insert(category_table).values(**values))
    for values in plan.items:
        bind.execute(sa.insert(item_table).values(**values))


def _seed_usage(bind) -> None:
    table = sa.Table(TABLE_NAME, sa.MetaData(), autoload_with=bind, schema=_schema())
    rows = [
        dict(row)
        for row in bind.execute(
            sa.select(table.c.scope_key, table.c.business_date, table.c.used_count)
            .where(table.c.scope_key == "GLOBAL")
        ).mappings()
    ]
    if len(rows) > 1:
        raise RuntimeError("global daily LLM quota usage row is ambiguous")
    if rows:
        row = rows[0]
        try:
            stored_date = str(row["business_date"])
            parsed_date = date.fromisoformat(stored_date)
            raw_count = row["used_count"]
            used_count = int(raw_count)
        except (TypeError, ValueError):
            raise RuntimeError("global daily LLM quota usage row is invalid") from None
        if (
            parsed_date.isoformat() != stored_date
            or used_count < 0
            or str(raw_count).strip() != str(used_count)
        ):
            raise RuntimeError("global daily LLM quota usage row is invalid")
        return
    bind.execute(sa.insert(table).values(
        scope_key="GLOBAL",
        business_date=INITIAL_BUSINESS_DATE,
        used_count=0,
    ))


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind):
        _create_usage_table()
    _validate_usage_table(bind)
    _seed_config(bind)
    _seed_usage(bind)


def downgrade() -> None:
    raise NotImplementedError("Database downgrades are intentionally unsupported")
