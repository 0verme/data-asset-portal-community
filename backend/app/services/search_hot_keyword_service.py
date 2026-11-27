"""Service for administrator-preconfigured search recommendations.

This is not a popularity ranking and does not read search logs.
Both hot search keywords (category != 'ai_example') and Ask AI example
questions (category == 'ai_example') are stored in `p_search_hot_keyword`.
"""

from __future__ import annotations

import os
from contextlib import nullcontext
from datetime import datetime
from typing import Any

from ..application import AuditActorMixin, actor_aware
from ..db.service import CoreAccess
from ..migrations.search_hot_keyword_seed import (
    AI_EXAMPLE_CATEGORY,
    DEFAULT_SEARCH_AI_EXAMPLE_SEEDS,
    DEFAULT_SEARCH_HOT_KEYWORD_SEEDS,
    plan_search_ai_example_seed,
    plan_search_hot_keyword_seed,
)
from ..repositories.search_hot_keyword_repository import SearchHotKeywordRepository
from .operation_log_service import (
    OPERATION_TYPE_CREATE,
    OPERATION_TYPE_DELETE,
    OPERATION_TYPE_DISABLE,
    OPERATION_TYPE_ENABLE,
    OPERATION_TYPE_UPDATE,
    operation_log_service,
)

HOT_KEYWORD_CATEGORIES: tuple[str, ...] = (
    "all",
    "asset",
    "system",
    "field",
    "root",
    "metric",
    "report",
    "api",
    "downstream",
    "lineage",
    "code_table",
)
ALLOWED_RECOMMENDATION_CATEGORIES: frozenset[str] = frozenset(
    (*HOT_KEYWORD_CATEGORIES, AI_EXAMPLE_CATEGORY)
)
MAX_KEYWORD_LENGTH = 255
MIN_SORT_ORDER = -9999
MAX_SORT_ORDER = 99999
AUDIT_MODULE_NAME = "首页推荐配置"


class SearchHotKeywordError(Exception):
    code = "SEARCH_HOT_KEYWORD_ERROR"

    def __init__(self, message: str, details: Any = None):
        self.message = message
        self.details = details
        super().__init__(message)

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
        }
        if self.details is not None:
            payload["details"] = self.details
        return payload


class SearchHotKeywordDataSourceError(SearchHotKeywordError):
    code = "SEARCH_HOT_KEYWORD_DATA_SOURCE_ERROR"


class SearchHotKeywordValidationError(SearchHotKeywordError):
    code = "SEARCH_HOT_KEYWORD_VALIDATION_FAILED"


class SearchHotKeywordNotFoundError(SearchHotKeywordError):
    code = "SEARCH_HOT_KEYWORD_NOT_FOUND"


class SearchHotKeywordAlreadyExistsError(SearchHotKeywordError):
    code = "SEARCH_HOT_KEYWORD_ALREADY_EXISTS"


def _format_timestamp(value: Any) -> str:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if value is None:
        return ""
    return str(value)


def _normalize_item_id(raw_id: Any) -> int:
    try:
        value = int(str(raw_id).strip())
    except (TypeError, ValueError) as error:
        raise SearchHotKeywordValidationError(
            "推荐项 ID 无效", [{"field": "id", "message": "必须为正整数"}]
        ) from error
    if value <= 0:
        raise SearchHotKeywordValidationError(
            "推荐项 ID 无效", [{"field": "id", "message": "必须为正整数"}]
        )
    return value


def _normalize_keyword(value: Any) -> str:
    if not isinstance(value, str):
        raise SearchHotKeywordValidationError(
            "推荐内容格式无效", [{"field": "keyword", "message": "必须为非空文本"}]
        )
    normalized = value.replace("\r\n", " ").replace("\r", " ").replace("\n", " ").strip()
    if not normalized:
        raise SearchHotKeywordValidationError(
            "推荐内容不能为空", [{"field": "keyword", "message": "请输入搜索词或 AI 示例问题"}]
        )
    if any(ord(char) < 32 and char != "\t" for char in normalized):
        raise SearchHotKeywordValidationError(
            "推荐内容包含非法控制字符",
            [{"field": "keyword", "message": "请移除控制字符"}],
        )
    if len(normalized) > MAX_KEYWORD_LENGTH:
        raise SearchHotKeywordValidationError(
            "推荐内容超出长度限制",
            [{"field": "keyword", "message": f"最多 {MAX_KEYWORD_LENGTH} 个字符"}],
        )
    return normalized


def _normalize_category(value: Any, *, default: str = "all") -> str:
    if value is None or (isinstance(value, str) and not value.strip()):
        category = default
    elif isinstance(value, str):
        category = value.strip()
    else:
        raise SearchHotKeywordValidationError(
            "分类格式无效", [{"field": "category", "message": "必须为有效分类标识"}]
        )
    if category not in ALLOWED_RECOMMENDATION_CATEGORIES:
        raise SearchHotKeywordValidationError(
            "不支持的推荐分类",
            [
                {
                    "field": "category",
                    "message": f"仅支持 {', '.join(sorted(ALLOWED_RECOMMENDATION_CATEGORIES))}",
                }
            ],
        )
    return category


def _normalize_sort_order(value: Any, *, default: int = 10) -> int:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        raise SearchHotKeywordValidationError(
            "排序值格式无效", [{"field": "sortOrder", "message": "必须为整数"}]
        )
    try:
        number = int(value)
    except (TypeError, ValueError) as error:
        raise SearchHotKeywordValidationError(
            "排序值格式无效", [{"field": "sortOrder", "message": "必须为整数"}]
        ) from error
    if number < MIN_SORT_ORDER or number > MAX_SORT_ORDER:
        raise SearchHotKeywordValidationError(
            "排序值超出范围",
            [
                {
                    "field": "sortOrder",
                    "message": f"排序值需在 {MIN_SORT_ORDER} 到 {MAX_SORT_ORDER} 之间",
                }
            ],
        )
    return number


def _normalize_enabled(payload_or_value: Any, *, default: str = "Y") -> str:
    raw = payload_or_value
    if isinstance(payload_or_value, dict):
        if "enabled" in payload_or_value and payload_or_value["enabled"] is not None:
            raw = payload_or_value["enabled"]
        elif "status" in payload_or_value and payload_or_value["status"] is not None:
            raw = payload_or_value["status"]
        else:
            return default
    if raw is None:
        return default
    if isinstance(raw, bool):
        return "Y" if raw else "N"
    text = str(raw).strip().upper()
    if text in {"Y", "ENABLED", "TRUE", "1"}:
        return "Y"
    if text in {"N", "DISABLED", "FALSE", "0"}:
        return "N"
    raise SearchHotKeywordValidationError(
        "启停状态无效",
        [{"field": "status", "message": "仅支持 enabled/disabled 或 Y/N"}],
    )


class SearchHotKeywordService(AuditActorMixin):
    def __init__(
        self,
        repository: SearchHotKeywordRepository | None = None,
        *,
        auto_seed_ai_examples: bool = False,
    ):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()
        db_access = CoreAccess(
            profile_getter=lambda: self._db_profile,
            error_factory=SearchHotKeywordDataSourceError,
        )
        self._repository = repository or SearchHotKeywordRepository(db_access)
        self._custom_repository = repository is not None
        self._auto_seed_ai_examples = auto_seed_ai_examples
        self._ai_examples_bootstrapped = False

    def _audit(self, **kwargs: Any):
        if self._custom_repository and not (
            self._db_profile or os.getenv("ASSET_DB_PROFILE", "").strip()
        ):
            return nullcontext()
        return operation_log_service.audit(**kwargs)

    @staticmethod
    def _serialize_admin_row(row: dict[str, Any]) -> dict[str, Any]:
        enabled = "Y" if str(row.get("enabled") or "Y").upper() == "Y" else "N"
        category = str(row.get("category") or "all").strip() or "all"
        return {
            "id": int(row["id"]),
            "keyword": str(row.get("keyword") or "").strip(),
            "category": category,
            "itemType": "ai_example" if category == AI_EXAMPLE_CATEGORY else "hot_keyword",
            "sortOrder": int(row.get("sort_order") or 0),
            "enabled": enabled,
            "status": "enabled" if enabled == "Y" else "disabled",
            "createdAt": _format_timestamp(row.get("created_at")),
            "updatedAt": _format_timestamp(row.get("updated_at")),
        }

    def _ensure_ai_example_seeds_once(self) -> None:
        if self._ai_examples_bootstrapped or not self._repository.supports_write:
            return
        self._ai_examples_bootstrapped = True
        all_rows = self._repository.list_all()
        if any(
            str(row.get("category") or "").strip() == AI_EXAMPLE_CATEGORY
            for row in all_rows
        ):
            return
        missing = plan_search_ai_example_seed(all_rows)
        if missing:
            self._repository.insert_seed_rows(missing)

    def get_hot_keywords(self) -> list[dict[str, Any]]:
        """Return enabled recommendations using the stable public wire shape."""
        if self._auto_seed_ai_examples:
            self._ensure_ai_example_seeds_once()
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

    def list_admin_items(self) -> list[dict[str, Any]]:
        """Return all configured hot keywords and AI example questions for admin."""
        self._ensure_ai_example_seeds_once()
        items = []
        for row in self._repository.list_all():
            keyword = str(row.get("keyword") or "").strip()
            if not keyword:
                continue
            items.append(self._serialize_admin_row(row))
        return items

    @actor_aware
    def create_item(self, payload: Any) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise SearchHotKeywordValidationError(
                "请求体格式无效", [{"field": "body", "message": "必须为 JSON 对象"}]
            )
        self._ensure_ai_example_seeds_once()
        keyword = _normalize_keyword(payload.get("keyword"))
        category = _normalize_category(payload.get("category"), default="all")
        raw_sort = (
            payload.get("sortOrder")
            if "sortOrder" in payload
            else payload.get("sort_order")
        )
        sort_order = _normalize_sort_order(raw_sort, default=10)
        enabled = _normalize_enabled(payload, default="Y")

        existing = self._repository.find_by_keyword_and_category(keyword, category)
        if existing is not None:
            raise SearchHotKeywordAlreadyExistsError(
                "相同分类下已存在该推荐内容",
                [{"field": "keyword", "message": "同一分类下不可重复添加相同内容"}],
            )

        with self._audit(
            module_name=AUDIT_MODULE_NAME,
            operation_type=OPERATION_TYPE_CREATE,
            operation_object=f"{category}:{keyword[:48]}",
            operation_desc=f"新增{'AI 示例问题' if category == AI_EXAMPLE_CATEGORY else '热门搜索词'}：{keyword}",
            after={
                "keyword": keyword,
                "category": category,
                "sortOrder": sort_order,
                "enabled": enabled,
            },
        ):
            new_id = self._repository.create(
                keyword=keyword,
                category=category,
                sort_order=sort_order,
                enabled=enabled,
            )

        created = self._repository.get_by_id(new_id)
        if created is None:
            return {
                "id": new_id,
                "keyword": keyword,
                "category": category,
                "itemType": "ai_example" if category == AI_EXAMPLE_CATEGORY else "hot_keyword",
                "sortOrder": sort_order,
                "enabled": enabled,
                "status": "enabled" if enabled == "Y" else "disabled",
                "createdAt": "",
                "updatedAt": "",
            }
        return self._serialize_admin_row(created)

    @actor_aware
    def update_item(self, raw_id: Any, payload: Any) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise SearchHotKeywordValidationError(
                "请求体格式无效", [{"field": "body", "message": "必须为 JSON 对象"}]
            )
        item_id = _normalize_item_id(raw_id)
        current = self._repository.get_by_id(item_id)
        if current is None:
            raise SearchHotKeywordNotFoundError("未找到对应的首页推荐项")

        keyword = (
            _normalize_keyword(payload["keyword"])
            if "keyword" in payload
            else str(current.get("keyword") or "").strip()
        )
        category = (
            _normalize_category(payload["category"])
            if "category" in payload
            else str(current.get("category") or "all").strip() or "all"
        )
        raw_sort = (
            payload["sortOrder"]
            if "sortOrder" in payload
            else payload["sort_order"]
            if "sort_order" in payload
            else current.get("sort_order", 10)
        )
        sort_order = _normalize_sort_order(raw_sort, default=10)
        enabled = _normalize_enabled(
            payload,
            default="Y" if str(current.get("enabled") or "Y").upper() == "Y" else "N",
        )

        duplicate = self._repository.find_by_keyword_and_category(keyword, category)
        if duplicate is not None and int(duplicate["id"]) != item_id:
            raise SearchHotKeywordAlreadyExistsError(
                "相同分类下已存在该推荐内容",
                [{"field": "keyword", "message": "同一分类下不可重复添加相同内容"}],
            )

        before = self._serialize_admin_row(current)
        with self._audit(
            module_name=AUDIT_MODULE_NAME,
            operation_type=OPERATION_TYPE_UPDATE,
            operation_object=str(item_id),
            operation_desc=f"更新首页推荐项 #{item_id}：{keyword}",
            before=before,
            after={
                "id": item_id,
                "keyword": keyword,
                "category": category,
                "sortOrder": sort_order,
                "enabled": enabled,
            },
        ):
            self._repository.update(
                item_id,
                keyword=keyword,
                category=category,
                sort_order=sort_order,
                enabled=enabled,
            )

        updated = self._repository.get_by_id(item_id)
        return self._serialize_admin_row(updated or current)

    @actor_aware
    def update_item_status(self, raw_id: Any, status_or_payload: Any) -> dict[str, Any]:
        item_id = _normalize_item_id(raw_id)
        current = self._repository.get_by_id(item_id)
        if current is None:
            raise SearchHotKeywordNotFoundError("未找到对应的首页推荐项")
        enabled = _normalize_enabled(status_or_payload)
        before = self._serialize_admin_row(current)
        with self._audit(
            module_name=AUDIT_MODULE_NAME,
            operation_type=OPERATION_TYPE_ENABLE if enabled == "Y" else OPERATION_TYPE_DISABLE,
            operation_object=str(item_id),
            operation_desc=f"{'启用' if enabled == 'Y' else '停用'}首页推荐项 #{item_id}：{before['keyword']}",
            before=before,
            after={**before, "enabled": enabled, "status": "enabled" if enabled == "Y" else "disabled"},
        ):
            self._repository.update_enabled(item_id, enabled)
        updated = self._repository.get_by_id(item_id)
        return self._serialize_admin_row(updated or {**current, "enabled": enabled})

    @actor_aware
    def delete_item(self, raw_id: Any) -> None:
        item_id = _normalize_item_id(raw_id)
        current = self._repository.get_by_id(item_id)
        if current is None:
            raise SearchHotKeywordNotFoundError("未找到对应的首页推荐项")
        before = self._serialize_admin_row(current)
        with self._audit(
            module_name=AUDIT_MODULE_NAME,
            operation_type=OPERATION_TYPE_DELETE,
            operation_object=str(item_id),
            operation_desc=f"删除首页推荐项 #{item_id}：{before['keyword']}",
            before=before,
        ):
            self._repository.delete(item_id)

    @actor_aware
    def restore_defaults(self, scope: str | None = None) -> list[dict[str, Any]]:
        normalized_scope = str(scope or "all").strip().lower() or "all"
        if normalized_scope not in {"all", "hot_keyword", "ai_example"}:
            raise SearchHotKeywordValidationError(
                "恢复范围无效",
                [{"field": "scope", "message": "仅支持 all、hot_keyword 或 ai_example"}],
            )
        self._ai_examples_bootstrapped = True
        before_rows = self._repository.list_all()
        target_seeds: list[dict[str, Any]] = []
        if normalized_scope in {"all", "hot_keyword"}:
            target_seeds.extend(DEFAULT_SEARCH_HOT_KEYWORD_SEEDS)
        if normalized_scope in {"all", "ai_example"}:
            target_seeds.extend(DEFAULT_SEARCH_AI_EXAMPLE_SEEDS)

        with self._audit(
            module_name=AUDIT_MODULE_NAME,
            operation_type=OPERATION_TYPE_UPDATE,
            operation_object=f"restore-defaults:{normalized_scope}",
            operation_desc=f"恢复首页推荐默认配置（{normalized_scope}）",
        ):
            if normalized_scope in {"all", "hot_keyword"}:
                missing_hot = plan_search_hot_keyword_seed(self._repository.list_all())
                if missing_hot:
                    self._repository.insert_seed_rows(missing_hot)
            if normalized_scope in {"all", "ai_example"}:
                missing_ai = plan_search_ai_example_seed(self._repository.list_all())
                if missing_ai:
                    self._repository.insert_seed_rows(missing_ai)
            for seed in target_seeds:
                existing = self._repository.find_by_keyword_and_category(
                    str(seed["keyword"]),
                    str(seed["category"]),
                )
                if existing is not None and str(existing.get("enabled") or "Y").upper() != "Y":
                    self._repository.update_enabled(int(existing["id"]), "Y")

        return self.list_admin_items()


search_hot_keyword_service = SearchHotKeywordService(auto_seed_ai_examples=True)
