"""Service for administrator-preconfigured search recommendations.

This is not a popularity ranking and does not read search logs.
"""

from __future__ import annotations

import os

from ..db.service import CoreAccess
from ..repositories.search_hot_keyword_repository import SearchHotKeywordRepository


class SearchHotKeywordDataSourceError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)

    def to_dict(self):
        return {
            "code": "SEARCH_HOT_KEYWORD_DATA_SOURCE_ERROR",
            "message": self.message,
        }


class SearchHotKeywordService:
    def __init__(self, repository: SearchHotKeywordRepository | None = None):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()
        db_access = CoreAccess(
            profile_getter=lambda: self._db_profile,
            error_factory=SearchHotKeywordDataSourceError,
        )
        self._repository = repository or SearchHotKeywordRepository(db_access)

    def get_hot_keywords(self) -> list[dict]:
        """Return enabled recommendations using the stable public wire shape."""
        items = []
        for row in self._repository.list_enabled():
            keyword = str(row.get("keyword") or "").strip()
            if not keyword:
                continue
            items.append(
                {
                    "id": int(row["id"]),
                    "keyword": keyword,
                    "category": str(row.get("category") or "all"),
                    "sortOrder": int(row.get("sort_order") or 0),
                }
            )
        return items


search_hot_keyword_service = SearchHotKeywordService()
