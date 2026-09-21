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

"""Unified portal search provider.

Entity SQL and row mapping live in `services.providers` (pluggable registry).
This module only normalizes scope/limit, applies instance menu visibility to
registered provider configs, and runs queries. Provider module codes are static
repository identities, not capability or readiness gates.
"""

from __future__ import annotations

import logging
import os
import time
from abc import ABC, abstractmethod
from contextlib import contextmanager

from ..db.facade import _prepare_execute_args, connect_with_profile, fetch_all, resolve_db_profile_name
from ..settings import get_int_env
from .asset_field_match import asset_field_match_value
from .providers import entity_module_codes, list_search_entities, module_scope_aliases
from .system_management_service import system_management_service


LOGGER = logging.getLogger(__name__)

SCOPE_ALL = "all"
SCOPE_ALIASES = {
    "metric": "indicator",
    "apiAsset": "api",
}


class SearchDataSourceError(Exception):
    def __init__(self, message):
        self.message = message
        super().__init__(message)

    def to_dict(self):
        return {"code": "SEARCH_DATA_SOURCE_ERROR", "message": self.message}


class SearchProvider(ABC):
    @abstractmethod
    def search(self, query: str, scope: str = SCOPE_ALL, limit: int = 5) -> dict:
        raise NotImplementedError


class KeywordSearchProvider(SearchProvider):
    LIKE_ESCAPE = "!"

    def __init__(self):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()

    @property
    def ENTITY_CONFIGS(self):
        """Registered search entities (compatibility for tests / introspection)."""
        return list_search_entities()

    @property
    def MODULE_SCOPE_ALIASES(self):
        return module_scope_aliases()

    @property
    def ENTITY_MODULE_CODES(self):
        return entity_module_codes()

    def _profile(self):
        return self._db_profile or resolve_db_profile_name()

    def _fetch_rows(self, sql, params=None):
        try:
            columns, rows = fetch_all(self._profile(), sql, params=params)
        except FileNotFoundError as error:
            raise SearchDataSourceError("数据库配置文件不存在") from error
        except KeyError as error:
            raise SearchDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except RuntimeError as error:
            raise SearchDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except Exception as error:
            raise SearchDataSourceError("数据库查询失败") from error
        return [dict(zip(columns, row)) for row in rows]

    @contextmanager
    def _connection(self):
        conn = None
        try:
            conn = connect_with_profile(self._profile())
            yield conn
        except FileNotFoundError as error:
            raise SearchDataSourceError("数据库配置文件不存在") from error
        except KeyError as error:
            raise SearchDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except RuntimeError as error:
            raise SearchDataSourceError("数据库服务暂不可用，请稍后重试") from error
        except Exception as error:
            raise SearchDataSourceError("数据库查询失败") from error
        finally:
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass

    def _fetch_rows_with_conn(self, conn, sql, params=None):
        curs = None
        try:
            curs = conn.cursor()
            normalized_sql, normalized_params = _prepare_execute_args(self._profile(), sql, params=params)
            if normalized_params is None:
                curs.execute(normalized_sql)
            else:
                curs.execute(normalized_sql, normalized_params)
            columns = [desc[0] for desc in curs.description] if curs.description else []
            rows = curs.fetchall()
            return [dict(zip(columns, row)) for row in rows]
        except SearchDataSourceError:
            raise
        except Exception as error:
            raise SearchDataSourceError("数据库查询失败") from error
        finally:
            try:
                if curs is not None:
                    curs.close()
            except Exception:
                pass

    def _like_pattern(self, raw):
        lowered = str(raw).strip().lower()
        escaped = (
            lowered
            .replace(self.LIKE_ESCAPE, self.LIKE_ESCAPE * 2)
            .replace("%", f"{self.LIKE_ESCAPE}%")
            .replace("_", f"{self.LIKE_ESCAPE}_")
        )
        return f"%{escaped}%"

    def _text_expr(self, expr):
        return f"COALESCE(CAST({expr} AS TEXT), '')"

    def _matcher_condition(self, matcher):
        return f"LOWER({self._text_expr(matcher['expr'])}) LIKE ? ESCAPE ?"

    def _field_match_spec(self, config):
        """Optional child-table matcher (e.g. asset fields) declared by the entity."""
        spec = config.get("field_match")
        return spec if isinstance(spec, dict) else None

    def _field_match_condition(self, spec):
        """Correlated EXISTS clause: the parent row must not be duplicated."""
        conditions = [self._matcher_condition(matcher) for matcher in spec["matchers"]]
        inner = "(" + " OR ".join(conditions) + ")"
        return (
            f"EXISTS (SELECT 1 FROM {spec['table']} "
            f"WHERE {spec['asset_ref']} AND {spec['active_where']} AND {inner})"
        )

    def _build_where(self, config):
        conditions = [self._matcher_condition(matcher) for matcher in config["matchers"]]
        field_match = self._field_match_spec(config)
        if field_match:
            conditions.append(self._field_match_condition(field_match))
        clause = "(" + " OR ".join(conditions) + ")"
        if config.get("base_where"):
            clause = f"{config['base_where']} AND {clause}"
        return clause

    def _build_match_select(self, config):
        label_cases = []
        value_cases = []
        for matcher in config["matchers"]:
            condition = self._matcher_condition(matcher)
            label = matcher["label"].replace("'", "''")
            label_cases.append(f"WHEN {condition} THEN '{label}'")
            value_cases.append(f"WHEN {condition} THEN {self._text_expr(matcher['expr'])}")

        return (
            "CASE "
            + " ".join(label_cases)
            + " ELSE '' END AS matched_field_label, "
            + "CASE "
            + " ".join(value_cases)
            + " ELSE '' END AS matched_field_value"
        )

    def _build_match_params(self, config, pattern):
        params = []
        for _matcher in config["matchers"]:
            params.extend([pattern, self.LIKE_ESCAPE])
        return params

    def _build_where_params(self, config, pattern):
        """Parameters for ``_build_where`` in clause order (entity, then fields)."""
        params = self._build_match_params(config, pattern)
        field_match = self._field_match_spec(config)
        if field_match:
            for _matcher in field_match["matchers"]:
                params.extend([pattern, self.LIKE_ESCAPE])
        return params

    def _normalize_limit(self, limit):
        default_limit = get_int_env("SEARCH_DEFAULT_LIMIT", 5, minimum=1)
        max_limit = get_int_env("SEARCH_MAX_LIMIT", 50, minimum=default_limit)
        try:
            value = int(limit)
        except (TypeError, ValueError):
            value = default_limit
        if value <= 0:
            value = default_limit
        return min(value, max_limit)

    def _normalize_scope(self, scope):
        raw = str(scope or SCOPE_ALL).strip()
        if not raw:
            return SCOPE_ALL
        lowered = raw.lower()
        normalized = SCOPE_ALIASES.get(raw) or SCOPE_ALIASES.get(lowered) or lowered
        aliases = self.MODULE_SCOPE_ALIASES
        normalized = (
            aliases.get(raw)
            or aliases.get(normalized)
            or aliases.get(lowered)
            or normalized
        )
        if normalized == SCOPE_ALL:
            return SCOPE_ALL
        if any(config["type"] == normalized for config in self.ENTITY_CONFIGS):
            return normalized
        return SCOPE_ALL

    def _enabled_menu_codes(self):
        try:
            return system_management_service.get_enabled_menu_codes()
        except Exception as error:
            raise SearchDataSourceError("搜索服务暂不可用，请稍后重试") from error

    def _registered_configs(self):
        """All registered repository entities; menu state controls visibility."""
        return list(self.ENTITY_CONFIGS)

    def _visible_configs(self, scope):
        # Repository entities are open by default; apply only menu UX filtering.
        registered_configs = self._registered_configs()
        enabled_menu_codes = self._enabled_menu_codes()
        configs = (
            registered_configs
            if scope == SCOPE_ALL
            else [config for config in registered_configs if config["type"] == scope]
        )
        return [
            config for config in configs
            if str(config.get("module") or "").strip() in enabled_menu_codes
        ]

    def _matched_fields(self, row):
        label = (row.get("matched_field_label") or "").strip()
        value = (row.get("matched_field_value") or "").strip()
        if not label or not value:
            return []
        return [{"label": label, "value": value}]

    def _map_item(self, config, row, extra_matched_fields=None):
        matched_fields = self._matched_fields(row)
        if extra_matched_fields:
            matched_fields = [*matched_fields, *extra_matched_fields]
        build_item = config["build_item"]
        payload = build_item(row, matched_fields) or {}
        entity_type = config["type"]
        module = config["module"]
        item = {
            "id": payload.get("id"),
            "title": payload.get("title") or "",
            "subtitle": payload.get("subtitle") or "",
            "meta": payload.get("meta") or "",
            "module": module,
            "ref": payload.get("ref"),
            "type": entity_type,
            "category": config.get("label") or entity_type,
            "matchedFields": payload.get("matchedFields") if payload.get("matchedFields") is not None else matched_fields,
        }
        # Additive identity field: only emitted when the entity actually owns
        # a canonical asset identity, so existing item shapes stay unchanged.
        if payload.get("assetId") is not None:
            item["assetId"] = payload["assetId"]
        return item

    def _empty_group(self, config):
        return {
            "type": config["type"],
            "label": config["label"],
            "module": config["module"],
            "count": 0,
            "hasMore": False,
            "items": [],
        }

    def _search_one_safe(self, conn, config, query, limit):
        try:
            return self._search_one(conn, config, query, limit)
        except SearchDataSourceError as error:
            LOGGER.warning("search degraded for type=%s: %s", config["type"], error.message)
            return self._empty_group(config)
        except Exception:  # pragma: no cover
            LOGGER.exception("search unexpected failure for type=%s", config["type"])
            return self._empty_group(config)

    def _count_matches(self, conn, config, query):
        """Exact matched total for one entity (single COUNT, never per-row)."""
        pattern = self._like_pattern(query)
        count_sql = f"SELECT COUNT(*) AS matched_total FROM {config['from']} WHERE {self._build_where(config)}"
        rows = self._fetch_rows_with_conn(
            conn,
            count_sql,
            params=self._build_where_params(config, pattern),
        )
        if not rows:
            return 0
        return int(rows[0].get("matched_total") or 0)

    def _load_field_matches(self, conn, config, rows, pattern):
        """Batch matched child fields for the current page (one query, no N+1)."""
        field_match = self._field_match_spec(config)
        if not field_match or not rows:
            return {}
        row_key = field_match["row_key"]
        keys = []
        for row in rows:
            value = row.get(row_key)
            if value is None or value in keys:
                continue
            keys.append(value)
        if not keys:
            return {}

        conditions = [self._matcher_condition(matcher) for matcher in field_match["matchers"]]
        inner = "(" + " OR ".join(conditions) + ")"
        placeholders = ", ".join("?" for _ in keys)
        select_columns = ", ".join(field_match["display"])
        sql = (
            f"SELECT {field_match['field_key']}, {select_columns} "
            f"FROM {field_match['table']} "
            f"WHERE {field_match['active_where']} "
            f"AND {field_match['field_key']} IN ({placeholders}) "
            f"AND {inner} "
            f"ORDER BY {field_match['order']}"
        )
        params = list(keys) + self._build_match_params(field_match, pattern)
        matches = {}
        max_fields = int(field_match.get("max_fields") or 1)
        for row in self._fetch_rows_with_conn(conn, sql, params=params):
            key = row.get(row_key)
            bucket = matches.setdefault(key, [])
            if len(bucket) >= max_fields:
                continue
            value = asset_field_match_value(row)
            if not value:
                continue
            bucket.append({"label": field_match["label"], "value": value})
        return matches

    def _search_one(self, conn, config, query, limit):
        started_at = time.perf_counter()
        pattern = self._like_pattern(query)
        where = self._build_where(config)
        where_params = self._build_where_params(config, pattern)
        match_select = self._build_match_select(config)
        match_params = self._build_match_params(config, pattern)
        list_sql = (
            "SELECT * FROM ("
            f"SELECT {config['select']}, {match_select} "
            f"FROM {config['from']} "
            f"WHERE {where} "
            f"ORDER BY {config['order']}"
            ") matched "
            "LIMIT ?"
        )
        default_module_limit = get_int_env("SEARCH_MODULE_LIMIT", 10, minimum=1)
        max_limit = get_int_env("SEARCH_MAX_LIMIT", 50, minimum=default_module_limit)
        page_limit = min(max_limit, max(1, int(limit or default_module_limit)))
        list_params = match_params + match_params + where_params + [page_limit]
        rows = self._fetch_rows_with_conn(conn, list_sql, params=list_params)
        total_matches = self._count_matches(conn, config, query)
        field_match = self._field_match_spec(config)
        field_matches = self._load_field_matches(conn, config, rows, pattern)
        row_key = field_match["row_key"] if field_match else None
        items = [
            self._map_item(config, row, field_matches.get(row.get(row_key)) if row_key else None)
            for row in rows
        ]
        # ``count`` is the matched total, so ``hasMore`` only reports whether the
        # current page is truncated instead of re-probing with an extra row.
        has_more = total_matches > len(items)
        elapsed_ms = round((time.perf_counter() - started_at) * 1000, 2)
        LOGGER.info(
            "search module timing type=%s elapsed_ms=%s limit=%s returned=%s matched_total=%s has_more=%s",
            config["type"],
            elapsed_ms,
            page_limit,
            len(items),
            total_matches,
            has_more,
        )

        return {
            "type": config["type"],
            "label": config["label"],
            "module": config["module"],
            "count": total_matches,
            "hasMore": has_more,
            "items": items,
        }

    def search(self, query: str, scope: str = SCOPE_ALL, limit: int = 5) -> dict:
        normalized_scope = self._normalize_scope(scope)
        normalized_limit = self._normalize_limit(limit)
        keyword = (query or "").strip()

        if not keyword:
            return {"query": "", "scope": normalized_scope, "groups": [], "total": 0}

        configs = self._visible_configs(normalized_scope)
        if not configs:
            return {"query": keyword, "scope": normalized_scope, "groups": [], "total": 0}
        with self._connection() as conn:
            groups = [self._search_one_safe(conn, config, keyword, normalized_limit) for config in configs]
        if normalized_scope == SCOPE_ALL:
            groups = [group for group in groups if group["count"] > 0]
        matched_total = sum(group["count"] for group in groups)
        has_more = any(group.get("hasMore") for group in groups)

        return {
            "query": keyword,
            "scope": normalized_scope,
            "groups": groups,
            # ``total`` sums the per-group matched totals; ``estimatedTotal`` is
            # the retained compatibility alias for the same value.
            "total": matched_total,
            "estimatedTotal": matched_total,
            "hasMore": has_more,
        }


keyword_search_provider = KeywordSearchProvider()
search_provider: SearchProvider = keyword_search_provider

# Module-level maps derived from the pluggable registry (import-time snapshot).
MODULE_SCOPE_ALIASES = module_scope_aliases()
ENTITY_MODULE_CODES = entity_module_codes()
