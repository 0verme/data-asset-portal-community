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

revision = "0009_upstream_option_contract"
down_revision = "0008_indicator_semantic_contract"
branch_labels = None
depends_on = None

OPTION_CATEGORIES = (
    {
        "code": "UPSTREAM_DB_TYPE",
        "name": "上游数据库类型",
        "description": "上游卸数系统数据库类型选项",
        "display_order": 10,
        "items": (
            ("POSTGRESQL", "PostgreSQL", "PostgreSQL", "PostgreSQL 数据库", 10),
            ("MYSQL", "MySQL", "MySQL", "MySQL 数据库", 20),
            ("ORACLE", "Oracle", "Oracle", "Oracle 数据库", 30),
            ("SQL_SERVER", "SQL Server", "SQL Server", "SQL Server 数据库", 40),
            ("MONGODB", "MongoDB", "MongoDB", "MongoDB 数据库", 50),
            ("KAFKA", "Kafka", "Kafka", "Kafka 消息系统", 60),
            ("OBJECT_STORAGE", "Object Storage", "Object Storage", "对象存储", 70),
            ("OTHER", "其他", "其他", "其他数据库类型", 80),
        ),
    },
    {
        "code": "UPSTREAM_DEPT",
        "name": "零售业务部门",
        "description": "上游卸数和下游推送共用的归属部门选项",
        "display_order": 20,
        "items": (
            ("PRODUCT_OPERATIONS", "商品运营部", "商品运营部", "商品运营部", 10),
            ("MEMBER_OPERATIONS", "会员运营部", "会员运营部", "会员运营部", 20),
            ("TRADE_OPERATIONS", "交易运营部", "交易运营部", "交易运营部", 30),
            ("STORE_OPERATIONS", "门店运营部", "门店运营部", "门店运营部", 40),
            ("SUPPLY_CHAIN", "供应链部", "供应链部", "供应链部", 50),
            ("MARKETING", "市场营销部", "市场营销部", "市场营销部", 60),
            ("FULFILLMENT", "履约运营部", "履约运营部", "履约运营部", 70),
            ("CUSTOMER_SERVICE", "客户服务部", "客户服务部", "客户服务部", 80),
        ),
    },
)


def _schema() -> str | None:
    return op.get_context().opts.get("version_table_schema")


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name, schema=_schema())


def _table(name: str, bind):
    return sa.Table(name, sa.MetaData(), autoload_with=bind, schema=_schema())


def _next_id(bind, table, column) -> int:
    value = bind.execute(
        sa.select(sa.func.coalesce(sa.func.max(column), 0) + 1)
    ).scalar_one()
    return int(value)


def _ensure_category(bind, table, spec: dict) -> None:
    existing = bind.execute(
        sa.select(table.c.category_id).where(
            table.c.category_code == spec["code"]
        )
    ).first()
    if existing is not None:
        return

    bind.execute(
        sa.insert(table).values(
            category_id=_next_id(bind, table, table.c.category_id),
            category_code=spec["code"],
            category_name=spec["name"],
            category_desc=spec["description"],
            display_order=spec["display_order"],
            is_active="Y",
            remark="系统初始化",
            created_by="system",
            updated_by="system",
        )
    )


def _ensure_item(bind, table, category_code: str, item: tuple) -> None:
    code, name, value, description, display_order = item
    existing = bind.execute(
        sa.select(table.c.item_id).where(
            table.c.category_code == category_code,
            table.c.item_code == code,
        )
    ).first()
    if existing is not None:
        return

    bind.execute(
        sa.insert(table).values(
            item_id=_next_id(bind, table, table.c.item_id),
            category_code=category_code,
            item_code=code,
            item_name=name,
            item_value=value,
            item_desc=description,
            display_order=display_order,
            is_active="Y",
            remark="系统初始化",
            created_by="system",
            updated_by="system",
        )
    )


def upgrade() -> None:
    if not (_has_table("p_code_category") and _has_table("p_code_item")):
        return

    bind = op.get_bind()
    category_table = _table("p_code_category", bind)
    item_table = _table("p_code_item", bind)
    for category in OPTION_CATEGORIES:
        _ensure_category(bind, category_table, category)
        for item in category["items"]:
            _ensure_item(bind, item_table, category["code"], item)


def downgrade() -> None:
    raise NotImplementedError("Database downgrades are intentionally unsupported")
