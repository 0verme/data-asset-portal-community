"""Small, neutral starter recommendations for the public search portal.

These are administrator-preconfigured suggestions, not keywords ranked from
search activity. Existing values are never overwritten by an upgrade.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

AI_EXAMPLE_CATEGORY = "ai_example"

DEFAULT_SEARCH_HOT_KEYWORD_SEEDS: tuple[dict[str, Any], ...] = (
    {"keyword": "资产", "category": "all", "sort_order": 10, "enabled": "Y"},
    {"keyword": "系统", "category": "all", "sort_order": 20, "enabled": "Y"},
    {"keyword": "字段", "category": "all", "sort_order": 30, "enabled": "Y"},
)

DEFAULT_SEARCH_AI_EXAMPLE_SEEDS: tuple[dict[str, Any], ...] = (
    {
        "keyword": "我想看每天的销售情况，应该用哪张表哪个指标？",
        "category": AI_EXAMPLE_CATEGORY,
        "sort_order": 10,
        "enabled": "Y",
    },
    {
        "keyword": "销售额怎么算？口径是什么，从哪张表出？",
        "category": AI_EXAMPLE_CATEGORY,
        "sort_order": 20,
        "enabled": "Y",
    },
    {
        "keyword": "活动转化率的定义是什么？用哪张表哪几个字段？",
        "category": AI_EXAMPLE_CATEGORY,
        "sort_order": 30,
        "enabled": "Y",
    },
    {
        "keyword": "可售库存量怎么算？用哪张表哪几个字段？",
        "category": AI_EXAMPLE_CATEGORY,
        "sort_order": 40,
        "enabled": "Y",
    },
    {
        "keyword": "活跃会员数的定义是什么？用哪张表哪几个字段？",
        "category": AI_EXAMPLE_CATEGORY,
        "sort_order": 50,
        "enabled": "Y",
    },
)


def _plan_seeds(
    existing_rows: Iterable[Mapping[str, Any]],
    seeds: tuple[dict[str, Any], ...],
) -> list[dict[str, Any]]:
    existing: set[tuple[str, str]] = set()
    maximum_id = 0
    for row in existing_rows:
        try:
            maximum_id = max(maximum_id, int(row.get("id") or 0))
        except (TypeError, ValueError):
            pass
        keyword = str(row.get("keyword") or "").strip()
        category = str(row.get("category") or "all").strip() or "all"
        if keyword:
            existing.add((keyword, category))

    missing: list[dict[str, Any]] = []
    for seed in seeds:
        key = (seed["keyword"], seed["category"])
        if key in existing:
            continue
        maximum_id += 1
        missing.append({"id": maximum_id, **seed})
        existing.add(key)
    return missing


def plan_search_hot_keyword_seed(
    existing_rows: Iterable[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Return missing seed rows with collision-free, deterministic integer IDs."""
    return _plan_seeds(existing_rows, DEFAULT_SEARCH_HOT_KEYWORD_SEEDS)


def plan_search_ai_example_seed(
    existing_rows: Iterable[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Return missing default AI example rows with collision-free integer IDs."""
    return _plan_seeds(existing_rows, DEFAULT_SEARCH_AI_EXAMPLE_SEEDS)
