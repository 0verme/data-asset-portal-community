"""Dialect-neutral business transformations shared by Alembic and DWS revisions.

The Alembic adapters in ``backend/alembic/versions`` and the GaussDB/DWS JDBC
adapters in :mod:`backend.app.migrations.dws_revisions` must not fork the data
semantics of a revision.  This module keeps the pure decision logic for the
revisions that carry data (``0006``, ``0008`` and ``0009``) in one place:

* every function is a pure transformation over plain row mappings;
* no function opens a connection, writes SQL, or depends on SQLAlchemy;
* failure is reported as data, never as a partial write.

Row inputs are any mapping-like objects with ``.get()`` (SQLAlchemy
``RowMapping`` and plain ``dict`` both qualify).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence

__all__ = [
    "OPTION_CATEGORY_SPECS",
    "UpstreamBackfillPlan",
    "DuplicateMappingKey",
    "IndicatorReferenceUpdate",
    "CodeSeedPlan",
    "plan_upstream_backfill",
    "duplicate_mapping_keys",
    "plan_indicator_reference_backfill",
    "plan_code_option_seed",
]


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _int(value: Any) -> int | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# 0006_field_mapping_upstream_id
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class UpstreamBackfillPlan:
    """Result of planning the legacy field-mapping upstream relation."""

    updates: tuple[tuple[int, int], ...] = ()
    errors: tuple[str, ...] = ()

    @property
    def safe(self) -> bool:
        return not self.errors


@dataclass(frozen=True)
class DuplicateMappingKey:
    upstream_system_id: int | None
    source_table_name: str
    count: int

    def describe(self) -> str:
        return (
            f"upstream_system_id={self.upstream_system_id}, "
            f"source_table={self.source_table_name!r}, count={self.count}"
        )


def _describe_system(row: Mapping[str, Any]) -> str:
    return (
        f"system_pk={row.get('system_pk')}, "
        f"system_id={row.get('system_id')!r}, "
        f"system_abbr={row.get('system_abbr')!r}, "
        f"system_name={row.get('system_name')!r}"
    )


def plan_upstream_backfill(
    mapping_rows: Iterable[Mapping[str, Any]],
    system_rows: Iterable[Mapping[str, Any]],
) -> UpstreamBackfillPlan:
    """Plan the ``0006`` backfill without writing anything.

    A legacy row is assigned from ``data_source_id`` only when exactly one
    upstream system points at that data source.  Missing, conflicting or
    ambiguous rows are reported in ``errors``; the caller must abort before
    writing when ``errors`` is non-empty.
    """
    systems_by_pk: dict[int, Mapping[str, Any]] = {}
    systems_by_data_source: dict[int, list[Mapping[str, Any]]] = {}
    for row in system_rows:
        system_pk = _int(row.get("system_pk"))
        if system_pk is None:
            continue
        systems_by_pk[system_pk] = row
        data_source_id = _int(row.get("data_source_id"))
        if data_source_id is not None:
            systems_by_data_source.setdefault(data_source_id, []).append(row)

    updates: list[tuple[int, int]] = []
    errors: list[str] = []
    for row in mapping_rows:
        table_pk = _int(row.get("table_pk"))
        if table_pk is None:
            errors.append("字段映射行缺少 table_pk，无法安全迁移")
            continue
        source_table = row.get("source_table_name")
        source_id = _int(row.get("data_source_id"))
        current_id = _int(row.get("upstream_system_id"))

        if current_id is not None:
            system = systems_by_pk.get(current_id)
            if system is None:
                errors.append(
                    f"table_pk={table_pk}, source_table={source_table!r}: "
                    f"upstream_system_id={current_id} 不存在"
                )
                continue
            system_source_id = _int(system.get("data_source_id"))
            if (
                source_id is not None
                and system_source_id is not None
                and source_id != system_source_id
            ):
                errors.append(
                    f"table_pk={table_pk}, source_table={source_table!r}: "
                    f"data_source_id={source_id} 与 {_describe_system(system)} 不一致"
                )
            continue

        candidates = systems_by_data_source.get(source_id, []) if source_id is not None else []
        if len(candidates) == 1:
            updates.append((table_pk, int(candidates[0]["system_pk"])))
            continue
        if not candidates:
            reason = "没有可唯一匹配的上游系统"
        else:
            reason = "存在多个候选上游系统：" + "; ".join(
                _describe_system(item) for item in candidates
            )
        errors.append(
            f"table_pk={table_pk}, source_table={source_table!r}, "
            f"data_source_id={source_id}: {reason}"
        )

    return UpstreamBackfillPlan(tuple(updates), tuple(errors))


def duplicate_mapping_keys(
    mapping_rows: Iterable[Mapping[str, Any]],
    updates: Sequence[tuple[int, int]] = (),
) -> tuple[DuplicateMappingKey, ...]:
    """Return duplicate ``(upstream_system_id, source_table_name)`` keys.

    ``updates`` are the planned ``(table_pk, system_pk)`` pairs from
    :func:`plan_upstream_backfill`; they are applied in memory so the caller can
    reject a duplicate before writing the backfill.
    """
    planned = {int(table_pk): int(system_pk) for table_pk, system_pk in updates}
    counts: dict[tuple[int | None, str], int] = {}
    for row in mapping_rows:
        table_pk = _int(row.get("table_pk"))
        upstream_system_id = _int(row.get("upstream_system_id"))
        if upstream_system_id is None and table_pk is not None:
            upstream_system_id = planned.get(table_pk)
        key = (upstream_system_id, _text(row.get("source_table_name")))
        counts[key] = counts.get(key, 0) + 1
    duplicates = [
        DuplicateMappingKey(upstream_system_id, source_table_name, count)
        for (upstream_system_id, source_table_name), count in sorted(
            counts.items(), key=lambda item: (str(item[0][0]), item[0][1])
        )
        if count > 1
    ]
    return tuple(duplicates)


# ---------------------------------------------------------------------------
# 0008_indicator_semantic_contract
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class IndicatorReferenceUpdate:
    indicator_pk: int
    values: Mapping[str, int]


def _asset_keys(row: Mapping[str, Any]) -> set[str]:
    table_name = _text(row.get("table_name"))
    if not table_name:
        return set()
    keys = {table_name}
    qualified_name = _text(row.get("qualified_name"))
    if qualified_name:
        keys.add(qualified_name)
    schema_name = _text(row.get("schema_name"))
    catalog_name = _text(row.get("catalog_name"))
    if schema_name:
        keys.add(f"{schema_name}.{table_name}")
    if catalog_name and schema_name:
        keys.add(f"{catalog_name}.{schema_name}.{table_name}")
    return keys


def plan_indicator_reference_backfill(
    indicator_rows: Iterable[Mapping[str, Any]],
    asset_rows: Iterable[Mapping[str, Any]],
    field_rows: Iterable[Mapping[str, Any]],
) -> tuple[IndicatorReferenceUpdate, ...]:
    """Plan the ``0008`` exact-unique reference backfill.

    Only non-deleted assets/fields participate.  A reference is written only
    when the legacy string resolves to exactly one candidate; ambiguous or
    unresolved values stay ``NULL``.  Existing references are never rewritten.
    """
    asset_by_key: dict[str, set[int]] = {}
    active_asset_ids: set[int] = set()
    for row in asset_rows:
        if _text(row.get("is_deleted")).upper() != "N":
            continue
        asset_id = _int(row.get("asset_id"))
        if asset_id is None:
            continue
        active_asset_ids.add(asset_id)
        for key in _asset_keys(row):
            asset_by_key.setdefault(key, set()).add(asset_id)

    field_by_asset_name: dict[tuple[int, str], set[int]] = {}
    for row in field_rows:
        if _text(row.get("is_deleted")).upper() != "N":
            continue
        asset_id = _int(row.get("asset_id"))
        field_id = _int(row.get("field_id"))
        if asset_id is None or field_id is None or asset_id not in active_asset_ids:
            continue
        field_by_asset_name.setdefault((asset_id, _text(row.get("field_name"))), set()).add(
            field_id
        )

    updates: list[IndicatorReferenceUpdate] = []
    for row in indicator_rows:
        indicator_pk = _int(row.get("indicator_pk"))
        if indicator_pk is None:
            continue
        source_asset_id = _int(row.get("source_asset_id"))
        result_field_id = _int(row.get("result_field_id"))
        values: dict[str, int] = {}

        if source_asset_id is None:
            candidates = asset_by_key.get(_text(row.get("result_table_name")), set())
            if len(candidates) == 1:
                source_asset_id = next(iter(candidates))
                values["source_asset_id"] = source_asset_id

        if (
            result_field_id is None
            and source_asset_id is not None
            and source_asset_id in active_asset_ids
        ):
            candidates = field_by_asset_name.get(
                (source_asset_id, _text(row.get("result_field_name"))), set()
            )
            if len(candidates) == 1:
                values["result_field_id"] = next(iter(candidates))

        if values:
            updates.append(IndicatorReferenceUpdate(indicator_pk, values))
    return tuple(updates)


# ---------------------------------------------------------------------------
# 0009_upstream_option_contract
# ---------------------------------------------------------------------------

OPTION_CATEGORY_SPECS = (
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


@dataclass(frozen=True)
class CodeSeedPlan:
    """Missing option rows that ``0009`` should add, with concrete values."""

    categories: tuple[Mapping[str, Any], ...] = ()
    items: tuple[Mapping[str, Any], ...] = ()

    @property
    def empty(self) -> bool:
        return not self.categories and not self.items


def plan_code_option_seed(
    category_rows: Iterable[Mapping[str, Any]],
    item_rows: Iterable[Mapping[str, Any]],
    specs: Sequence[Mapping[str, Any]] = OPTION_CATEGORY_SPECS,
) -> CodeSeedPlan:
    """Plan missing option categories/items without touching existing rows.

    Existing categories and items are matched by their stable code; a
    customized row (same code, different display value) is never overwritten
    and is never re-inserted.
    """
    existing_categories = {
        _text(row.get("category_code")) for row in category_rows
    }
    existing_items = {
        (_text(row.get("category_code")), _text(row.get("item_code")))
        for row in item_rows
    }
    max_category_id = max(
        (_int(row.get("category_id")) or 0 for row in category_rows), default=0
    )
    max_item_id = max((_int(row.get("item_id")) or 0 for row in item_rows), default=0)

    categories: list[Mapping[str, Any]] = []
    items: list[Mapping[str, Any]] = []
    for spec in specs:
        category_code = spec["code"]
        if category_code not in existing_categories:
            max_category_id += 1
            categories.append(
                {
                    "category_id": max_category_id,
                    "category_code": category_code,
                    "category_name": spec["name"],
                    "category_desc": spec["description"],
                    "display_order": spec["display_order"],
                    "is_active": "Y",
                    "remark": "系统初始化",
                    "created_by": "system",
                    "updated_by": "system",
                }
            )
        for code, name, value, description, display_order in spec["items"]:
            if (category_code, code) in existing_items:
                continue
            max_item_id += 1
            items.append(
                {
                    "item_id": max_item_id,
                    "category_code": category_code,
                    "item_code": code,
                    "item_name": name,
                    "item_value": value,
                    "item_desc": description,
                    "display_order": display_order,
                    "is_active": "Y",
                    "remark": "系统初始化",
                    "created_by": "system",
                    "updated_by": "system",
                }
            )
    return CodeSeedPlan(tuple(categories), tuple(items))
