"""Additive, conflict-detecting seed for the reserved daily LLM quota setting."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Mapping

from ..contracts.ai_llm_quota import (
    AI_LLM_DAILY_LIMIT_CODE,
    AI_LLM_QUOTA_CATEGORY_CODE,
    AI_LLM_QUOTA_CATEGORY_NAME,
    AI_LLM_QUOTA_ITEM_NAME,
    AI_LLM_QUOTA_LEGACY_ITEM_NAMES,
    DEFAULT_AI_LLM_DAILY_LIMIT,
    parse_daily_limit,
)


@dataclass(frozen=True)
class AILlmQuotaSeedPlan:
    categories: tuple[dict[str, Any], ...] = ()
    items: tuple[dict[str, Any], ...] = ()
    error: str | None = None

    @property
    def safe(self) -> bool:
        return self.error is None


def _value(row: Mapping[str, Any], *keys: str, default=None):
    for key in keys:
        if key in row:
            return row.get(key)
    return default


def _next_id(rows: Iterable[Mapping[str, Any]], *keys: str) -> int:
    identifiers: list[int] = []
    for row in rows:
        try:
            identifiers.append(int(_value(row, *keys, default=0) or 0))
        except (TypeError, ValueError):
            continue
    return max(identifiers, default=0) + 1


def plan_ai_llm_quota_seed(
    category_rows: Iterable[Mapping[str, Any]],
    item_rows: Iterable[Mapping[str, Any]],
) -> AILlmQuotaSeedPlan:
    """Seed missing reserved rows and preserve valid administrator values."""
    categories = list(category_rows)
    items = list(item_rows)
    matching_categories = [
        row for row in categories
        if str(_value(row, "category_code", "categoryCode", default="") or "").strip()
        == AI_LLM_QUOTA_CATEGORY_CODE
    ]
    matching_items = [
        row for row in items
        if str(_value(row, "category_code", "categoryCode", default="") or "").strip()
        == AI_LLM_QUOTA_CATEGORY_CODE
        and str(_value(row, "item_code", "code", default="") or "").strip()
        == AI_LLM_DAILY_LIMIT_CODE
    ]
    if len(matching_categories) > 1 or len(matching_items) > 1:
        return AILlmQuotaSeedPlan(error="reserved AI LLM quota rows are duplicated")
    if matching_items and not matching_categories:
        return AILlmQuotaSeedPlan(error="reserved AI LLM quota item has no category")
    if matching_categories:
        category = matching_categories[0]
        if str(_value(category, "category_name", "categoryName", default="") or "") != AI_LLM_QUOTA_CATEGORY_NAME:
            return AILlmQuotaSeedPlan(error="reserved AI LLM quota category conflicts with its contract")
        if str(_value(category, "is_active", "status", default="N") or "N").upper() != "N":
            return AILlmQuotaSeedPlan(error="reserved AI LLM quota category must remain inactive")
    if matching_items:
        item = matching_items[0]
        item_name = str(_value(item, "item_name", "name", default="") or "")
        if item_name != AI_LLM_QUOTA_ITEM_NAME and item_name not in AI_LLM_QUOTA_LEGACY_ITEM_NAMES:
            return AILlmQuotaSeedPlan(error="reserved AI LLM quota item conflicts with its contract")
        if str(_value(item, "is_active", "status", default="N") or "N").upper() != "N":
            return AILlmQuotaSeedPlan(error="reserved AI LLM quota item must remain inactive")
        try:
            parse_daily_limit(_value(item, "item_value", "value"))
        except (TypeError, ValueError):
            return AILlmQuotaSeedPlan(error="reserved AI LLM daily limit is invalid")

    planned_categories: list[dict[str, Any]] = []
    if not matching_categories:
        planned_categories.append({
            "category_id": _next_id(categories, "category_id", "id"),
            "category_code": AI_LLM_QUOTA_CATEGORY_CODE,
            "category_name": AI_LLM_QUOTA_CATEGORY_NAME,
            "category_desc": "隐藏的全站每日 AI 问答次数配置；通过系统管理页面维护。",
            "display_order": 999,
            "is_active": "N",
            "remark": "保留给 DAP 内部额度配置，不得作为公共参数字典启用。",
            "created_by": "system",
            "updated_by": "system",
        })

    planned_items: list[dict[str, Any]] = []
    if not matching_items:
        planned_items.append({
            "item_id": _next_id(items, "item_id", "id"),
            "category_code": AI_LLM_QUOTA_CATEGORY_CODE,
            "item_code": AI_LLM_DAILY_LIMIT_CODE,
            "item_name": AI_LLM_QUOTA_ITEM_NAME,
            "item_value": str(DEFAULT_AI_LLM_DAILY_LIMIT),
            "item_desc": "全站共享的每日 AI 问答次数上限；每问最多计一次。",
            "display_order": 1,
            "ext_json": None,
            "is_active": "N",
            "remark": "每日按 Asia/Shanghai 自然日统计；仅由受保护的系统管理接口维护。",
            "created_by": "system",
            "updated_by": "system",
        })

    return AILlmQuotaSeedPlan(tuple(planned_categories), tuple(planned_items))
