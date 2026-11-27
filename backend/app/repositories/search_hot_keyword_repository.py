"""Repository for administrator-configured portal search recommendations."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import delete, func, insert, select, update

from ..db.tables import search_hot_keyword


class SearchHotKeywordRepository:
    def __init__(self, db_access: Any):
        self._db = db_access

    @property
    def supports_write(self) -> bool:
        return hasattr(self._db, "execute_statements")

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

    def list_all(self) -> list[dict[str, Any]]:
        statement = select(
            search_hot_keyword.c.id,
            search_hot_keyword.c.keyword,
            search_hot_keyword.c.category,
            search_hot_keyword.c.sort_order,
            search_hot_keyword.c.enabled,
            search_hot_keyword.c.created_at,
            search_hot_keyword.c.updated_at,
        ).order_by(
            search_hot_keyword.c.sort_order.asc(),
            search_hot_keyword.c.id.asc(),
        )
        return self._db.fetch_rows(statement)

    def get_by_id(self, item_id: int) -> dict[str, Any] | None:
        statement = select(
            search_hot_keyword.c.id,
            search_hot_keyword.c.keyword,
            search_hot_keyword.c.category,
            search_hot_keyword.c.sort_order,
            search_hot_keyword.c.enabled,
            search_hot_keyword.c.created_at,
            search_hot_keyword.c.updated_at,
        ).where(search_hot_keyword.c.id == item_id)
        rows = self._db.fetch_rows(statement)
        return rows[0] if rows else None

    def find_by_keyword_and_category(
        self, keyword: str, category: str
    ) -> dict[str, Any] | None:
        statement = select(
            search_hot_keyword.c.id,
            search_hot_keyword.c.keyword,
            search_hot_keyword.c.category,
            search_hot_keyword.c.sort_order,
            search_hot_keyword.c.enabled,
            search_hot_keyword.c.created_at,
            search_hot_keyword.c.updated_at,
        ).where(
            search_hot_keyword.c.keyword == keyword,
            search_hot_keyword.c.category == category,
        )
        rows = self._db.fetch_rows(statement)
        return rows[0] if rows else None

    def next_id(self) -> int:
        if hasattr(self._db, "next_pk"):
            return int(self._db.next_pk(search_hot_keyword, search_hot_keyword.c.id))
        rows = self._db.fetch_rows(
            select(func.coalesce(func.max(search_hot_keyword.c.id), 0).label("max_id"))
        )
        max_id = int(rows[0].get("max_id") or 0) if rows else 0
        return max_id + 1

    def create(
        self,
        *,
        keyword: str,
        category: str,
        sort_order: int,
        enabled: str,
    ) -> int:
        new_id = self.next_id()
        statement = insert(search_hot_keyword).values(
            id=new_id,
            keyword=keyword,
            category=category,
            sort_order=sort_order,
            enabled=enabled,
            created_at=func.current_timestamp(),
            updated_at=func.current_timestamp(),
        )
        self._db.execute_statements([statement])
        return new_id

    def update(
        self,
        item_id: int,
        *,
        keyword: str,
        category: str,
        sort_order: int,
        enabled: str,
    ) -> None:
        statement = (
            update(search_hot_keyword)
            .where(search_hot_keyword.c.id == item_id)
            .values(
                keyword=keyword,
                category=category,
                sort_order=sort_order,
                enabled=enabled,
                updated_at=func.current_timestamp(),
            )
        )
        self._db.execute_statements([statement])

    def update_enabled(self, item_id: int, enabled: str) -> None:
        statement = (
            update(search_hot_keyword)
            .where(search_hot_keyword.c.id == item_id)
            .values(
                enabled=enabled,
                updated_at=func.current_timestamp(),
            )
        )
        self._db.execute_statements([statement])

    def delete(self, item_id: int) -> None:
        statement = delete(search_hot_keyword).where(search_hot_keyword.c.id == item_id)
        self._db.execute_statements([statement])

    def insert_seed_rows(self, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        statements = [
            insert(search_hot_keyword).values(
                id=int(row["id"]),
                keyword=str(row["keyword"]),
                category=str(row["category"]),
                sort_order=int(row.get("sort_order") or 0),
                enabled=str(row.get("enabled") or "Y"),
                created_at=func.current_timestamp(),
                updated_at=func.current_timestamp(),
            )
            for row in rows
        ]
        self._db.execute_statements(statements)
