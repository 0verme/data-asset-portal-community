"""Read repository for administrator-configured portal recommendations."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from ..db.tables import search_hot_keyword


class SearchHotKeywordRepository:
    def __init__(self, db_access: Any):
        self._db = db_access

    def list_enabled(self) -> list[dict[str, Any]]:
        statement = (
            select(
                search_hot_keyword.c.id,
                search_hot_keyword.c.keyword,
                search_hot_keyword.c.category,
                search_hot_keyword.c.sort_order,
            )
            .where(search_hot_keyword.c.enabled == "Y")
            .order_by(
                search_hot_keyword.c.sort_order.asc(),
                search_hot_keyword.c.id.asc(),
            )
        )
        return self._db.fetch_rows(statement)
