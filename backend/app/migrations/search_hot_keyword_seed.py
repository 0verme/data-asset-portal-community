"""Small, neutral starter recommendations for the public search portal.

These are administrator-preconfigured suggestions, not keywords ranked from
search activity. Existing values are never overwritten by an upgrade.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

DEFAULT_SEARCH_HOT_KEYWORD_SEEDS: tuple[dict[str, Any], ...] = (
    {"keyword": "资产", "category": "all", "sort_order": 10, "enabled": "Y"},
    {"keyword": "系统", "category": "all", "sort_order": 20, "enabled": "Y"},
    {"keyword": "字段", "category": "all", "sort_order": 30, "enabled": "Y"},
)


def plan_search_hot_keyword_seed(
    existing_rows: Iterable[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Return missing seed rows with collision-free, deterministic integer IDs."""
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
    for seed in DEFAULT_SEARCH_HOT_KEYWORD_SEEDS:
        key = (seed["keyword"], seed["category"])
        if key in existing:
            continue
        maximum_id += 1
        missing.append({"id": maximum_id, **seed})
        existing.add(key)
    return missing
