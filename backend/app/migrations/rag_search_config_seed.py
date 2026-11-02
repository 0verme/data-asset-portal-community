"""Idempotent seed for the reserved, inactive RAG search configuration item."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Iterable, Mapping

RAG_CONFIG_CATEGORY_CODE = "RAG_SEARCH_CONFIG"
RAG_CONFIG_ITEM_CODE = "DEFAULT"
RAG_CONFIG_CATEGORY_NAME = "RAG 搜索配置"
RAG_CONFIG_ITEM_NAME = "RAG 相关资产推荐"
RAG_CONFIG_DEFAULTS = {
    "enabled": False,
    "strategy": "auto",
    "topK": 5,
    "timeoutMs": 2000,
    "serviceUrl": "",
}
RAG_CONFIG_DEFAULT_JSON = json.dumps(
    RAG_CONFIG_DEFAULTS, ensure_ascii=False, separators=(",", ":")
)


@dataclass(frozen=True)
class RagConfigSeedPlan:
    categories: tuple[dict[str, Any], ...] = ()
    items: tuple[dict[str, Any], ...] = ()
    error: str | None = None

    @property
    def safe(self) -> bool:
        return self.error is None


def plan_rag_search_config_seed(
    category_rows: Iterable[Mapping[str, Any]],
    item_rows: Iterable[Mapping[str, Any]],
) -> RagConfigSeedPlan:
    """Seed one disabled row without rewriting existing configuration."""
    categories = list(category_rows)
    items = list(item_rows)
    matching_categories = [
        row
        for row in categories
        if str(row.get("category_code") or row.get("categoryCode") or "").strip()
        == RAG_CONFIG_CATEGORY_CODE
    ]
    matching_items = [
        row
        for row in items
        if str(row.get("category_code") or row.get("categoryCode") or "").strip()
        == RAG_CONFIG_CATEGORY_CODE
        and str(row.get("item_code") or row.get("code") or "").strip()
        == RAG_CONFIG_ITEM_CODE
    ]
    if len(matching_categories) > 1 or len(matching_items) > 1:
        return RagConfigSeedPlan(error="reserved RAG configuration rows are duplicated")
    if matching_categories and str(matching_categories[0].get("category_name") or "") != RAG_CONFIG_CATEGORY_NAME:
        return RagConfigSeedPlan(error="reserved RAG configuration category name conflicts with its contract")
    if matching_categories and str(matching_categories[0].get("is_active") or "N").upper() != "N":
        return RagConfigSeedPlan(error="reserved RAG configuration category must remain inactive")
    if matching_items and str(matching_items[0].get("item_name") or "") != RAG_CONFIG_ITEM_NAME:
        return RagConfigSeedPlan(error="reserved RAG configuration item name conflicts with its contract")
    if matching_items and str(matching_items[0].get("is_active") or "N").upper() != "N":
        return RagConfigSeedPlan(error="reserved RAG configuration item must remain inactive")

    planned_categories: list[dict[str, Any]] = []
    if not matching_categories:
        ids: list[int] = []
        for row in categories:
            try:
                ids.append(int(row.get("category_id") or row.get("id") or 0))
            except (TypeError, ValueError):
                continue
        planned_categories.append(
            {
                "category_id": max(ids, default=0) + 1,
                "category_code": RAG_CONFIG_CATEGORY_CODE,
                "category_name": RAG_CONFIG_CATEGORY_NAME,
                "category_desc": "内部 RAG 推荐配置；不可作为公共码值。",
                "display_order": 999,
                "is_active": "N",
                "remark": "由数据库迁移保留；请通过 RAG 配置页面维护。",
                "created_by": "system",
                "updated_by": "system",
            }
        )

    planned_items: list[dict[str, Any]] = []
    if not matching_items:
        ids = []
        for row in items:
            try:
                ids.append(int(row.get("item_id") or row.get("id") or 0))
            except (TypeError, ValueError):
                continue
        planned_items.append(
            {
                "item_id": max(ids, default=0) + 1,
                "category_code": RAG_CONFIG_CATEGORY_CODE,
                "item_code": RAG_CONFIG_ITEM_CODE,
                "item_name": RAG_CONFIG_ITEM_NAME,
                "item_value": "reserved-rag-config",
                "item_desc": "保存在 ext_json；该条目必须保持停用。",
                "display_order": 1,
                "ext_json": RAG_CONFIG_DEFAULT_JSON,
                "is_active": "N",
                "remark": "不可作为公共码值，不得通过通用参数字典接口启用。",
                "created_by": "system",
                "updated_by": "system",
            }
        )

    return RagConfigSeedPlan(tuple(planned_categories), tuple(planned_items))
