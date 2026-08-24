# Copyright 2025 Jearhe
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from __future__ import annotations

import json
import os
import re
import threading
import time

from sqlalchemy import and_, case, func, select

from ..db.facade import resolve_db_profile_name
from ..db.service import CoreAccess
from ..db.tables import code_category, code_item
from ..settings import get_int_env
CATEGORY_CODE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
MAX_BATCH_CATEGORIES = 50


class CommonCodeCategoryNotFoundError(Exception):
    def __init__(self, category_code: str):
        self.category_code = category_code
        super().__init__(f"Common code category not found: {category_code}")

    def to_dict(self):
        return {
            "code": "COMMON_CODE_CATEGORY_NOT_FOUND",
            "message": f"Common code category not found: {self.category_code}",
        }


class CommonCodeDataSourceError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)

    def to_dict(self):
        return {
            "code": "COMMON_CODE_DATA_SOURCE_ERROR",
            "message": self.message,
        }


class CommonCodeValidationError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)

    def to_dict(self):
        return {
            "code": "COMMON_CODE_VALIDATION_FAILED",
            "message": self.message,
        }


class CommonCodeService:
    def __init__(self):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()
        self._cache_ttl = get_int_env("COMMON_CODE_CACHE_TTL_SECONDS", 300, minimum=1)
        self._cache_lock = threading.Lock()
        self._item_cache = {}
        self._category_cache = {}
        self._db = CoreAccess(
            profile_getter=lambda: self._db_profile,
            error_factory=CommonCodeDataSourceError,
        )

    def _profile(self):
        return self._db_profile or resolve_db_profile_name()

    def _cache_namespace(self):
        return self._profile(), os.getenv("ASSET_DB_CONFIG_PATH", "").strip()

    def _clone_items(self, items):
        return [{**item, "ext": dict(item.get("ext") or {})} for item in (items or [])]

    def _get_cached_items(self, category_code):
        key = (*self._cache_namespace(), category_code)
        now = time.monotonic()
        with self._cache_lock:
            entry = self._item_cache.get(key)
            if not entry:
                return None
            if entry["expiresAt"] <= now:
                self._item_cache.pop(key, None)
                return None
            return {
                "exists": entry["exists"],
                "items": self._clone_items(entry["items"]),
            }

    def _set_cached_items(self, category_code, exists, items):
        key = (*self._cache_namespace(), category_code)
        with self._cache_lock:
            self._item_cache[key] = {
                "exists": bool(exists),
                "items": self._clone_items(items),
                "expiresAt": time.monotonic() + self._cache_ttl,
            }

    def invalidate(self, category_codes=None):
        target_codes = {
            str(code or "").strip()
            for code in (category_codes or [])
            if str(code or "").strip()
        }
        with self._cache_lock:
            if target_codes:
                self._item_cache = {
                    key: value
                    for key, value in self._item_cache.items()
                    if key[-1] not in target_codes
                }
            else:
                self._item_cache.clear()
            self._category_cache.clear()

    def _fetch_rows(self, statement):
        return self._db.fetch_rows(statement)

    def get_categories(self):
        namespace = self._cache_namespace()
        now = time.monotonic()
        with self._cache_lock:
            entry = self._category_cache.get(namespace)
            if entry and entry["expiresAt"] > now:
                return [dict(item) for item in entry["items"]]
            self._category_cache.pop(namespace, None)

        statement = (
            select(
                code_category.c.category_code,
                code_category.c.category_name,
                code_category.c.category_desc,
                code_category.c.display_order,
                code_category.c.is_active,
                func.coalesce(
                    func.sum(
                        case((code_item.c.is_active == "Y", 1), else_=0)
                    ),
                    0,
                ).label("item_count"),
            )
            .select_from(
                code_category.outerjoin(
                    code_item,
                    code_category.c.category_code == code_item.c.category_code,
                )
            )
            .where(code_category.c.is_active == "Y")
            .group_by(
                code_category.c.category_code,
                code_category.c.category_name,
                code_category.c.category_desc,
                code_category.c.display_order,
                code_category.c.is_active,
            )
            .order_by(code_category.c.display_order, code_category.c.category_code)
        )
        items = [
            {
                "code": row["category_code"],
                "name": row["category_name"],
                "desc": row.get("category_desc") or "",
                "active": str(row.get("is_active") or "").upper() == "Y",
                "count": int(row.get("item_count") or 0),
            }
            for row in self._fetch_rows(statement)
        ]
        with self._cache_lock:
            self._category_cache[namespace] = {
                "items": [dict(item) for item in items],
                "expiresAt": time.monotonic() + self._cache_ttl,
            }
        return items

    def _row_to_item(self, row):
        ext = {}
        if row.get("ext_json"):
            try:
                ext = json.loads(row["ext_json"])
            except json.JSONDecodeError:
                ext = {"raw": row["ext_json"]}
        return {
            "categoryCode": row["category_code"],
            "code": row["item_code"],
            "name": row["item_name"],
            "value": row.get("item_value") or row["item_name"],
            "desc": row.get("item_desc") or "",
            "order": int(row.get("display_order") or 0),
            "active": str(row.get("is_active") or "").upper() == "Y",
            "ext": ext,
        }

    def _load_item_groups(self, category_codes):
        cached = {}
        uncached = []
        for category_code in category_codes:
            entry = self._get_cached_items(category_code)
            if entry is None:
                uncached.append(category_code)
            else:
                cached[category_code] = entry

        if uncached:
            statement = (
                select(
                    code_category.c.category_code,
                    code_item.c.item_code,
                    code_item.c.item_name,
                    code_item.c.item_value,
                    code_item.c.item_desc,
                    code_item.c.display_order,
                    code_item.c.ext_json,
                    code_item.c.is_active,
                )
                .select_from(
                    code_category.outerjoin(
                        code_item,
                        and_(
                            code_category.c.category_code == code_item.c.category_code,
                            code_item.c.is_active == "Y",
                        ),
                    )
                )
                .where(
                    code_category.c.category_code.in_(uncached),
                    code_category.c.is_active == "Y",
                )
                .order_by(
                    code_category.c.display_order,
                    code_category.c.category_code,
                    code_item.c.display_order,
                    code_item.c.item_code,
                )
            )
            rows = self._fetch_rows(statement)
            loaded = {code: {"exists": False, "items": []} for code in uncached}
            for row in rows:
                category_code = row["category_code"]
                loaded[category_code]["exists"] = True
                if row.get("item_code") is not None:
                    loaded[category_code]["items"].append(self._row_to_item(row))
            for category_code, entry in loaded.items():
                self._set_cached_items(category_code, entry["exists"], entry["items"])
                cached[category_code] = entry

        return cached

    def get_items(self, category_code: str):
        target_code = (category_code or "").strip()
        if not target_code:
            raise CommonCodeCategoryNotFoundError(category_code)
        entry = self._load_item_groups([target_code])[target_code]
        if not entry["exists"]:
            raise CommonCodeCategoryNotFoundError(target_code)
        return self._clone_items(entry["items"])

    def get_items_batch(self, category_codes):
        codes = []
        for raw_code in category_codes or []:
            code = str(raw_code or "").strip()
            if not code:
                continue
            if not CATEGORY_CODE_RE.fullmatch(code):
                raise CommonCodeValidationError(f"Invalid common code category: {code}")
            if code not in codes:
                codes.append(code)
        if not codes:
            raise CommonCodeValidationError("At least one common code category is required")
        if len(codes) > MAX_BATCH_CATEGORIES:
            raise CommonCodeValidationError(f"At most {MAX_BATCH_CATEGORIES} common code categories are allowed")

        loaded = self._load_item_groups(codes)
        existing_codes = [code for code in codes if loaded[code]["exists"]]
        return {
            "categoryCodes": existing_codes,
            "items": [
                item
                for code in existing_codes
                for item in self._clone_items(loaded[code]["items"])
            ],
            "missingCodes": [code for code in codes if not loaded[code]["exists"]],
        }

    def get_item_values(self, category_code: str):
        return [item.get("value") or item.get("name") for item in self.get_items(category_code)]


common_code_service = CommonCodeService()
