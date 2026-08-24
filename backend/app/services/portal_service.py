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

"""Portal homepage aggregate stats service."""

from __future__ import annotations

import logging
import os
import time

from ..db.facade import database_transaction, fetch_all, resolve_db_profile_name
from ..settings import get_int_env
from .providers import list_portal_stats
from .system_management_service import system_management_service


LOGGER = logging.getLogger(__name__)


class PortalStatProvider:
    """One portal stat card keyed to a repository module code."""

    def __init__(self, config: dict):
        self.code = str(config.get("module") or "").strip()
        self.config = config

    def get_stat(self) -> dict:
        return dict(self.config)


class PortalService:
    @property
    def STAT_CONFIGS(self):
        """Registered portal stats (compatibility for tests / introspection)."""
        return list_portal_stats()

    def registered_stat_providers(self):
        """Return every repository stat provider; menu state is applied later."""
        return [PortalStatProvider(config) for config in self.STAT_CONFIGS]

    def __init__(self):
        self._db_profile = os.getenv("ASSET_DB_PROFILE", "").strip()
        self._stats_cache_ttl = get_int_env("PORTAL_STATS_CACHE_TTL_SECONDS", 600, minimum=1)
        self._stats_cache = None
        self._stats_cache_expire_at = 0.0
        self._stats_cache_signature = None

    def _profile(self):
        return self._db_profile or resolve_db_profile_name()

    def _clone_items(self, items):
        return [dict(item) for item in (items or [])]

    def _enabled_menu_codes(self):
        return system_management_service.get_enabled_menu_codes()

    def _registered_stat_configs(self):
        """Return all registered stat configs before menu visibility filtering."""
        return [provider.config for provider in self.registered_stat_providers()]

    def _visible_stat_configs(self):
        # Repository modules are open by default; apply menu visibility only.
        registered_configs = self._registered_stat_configs()
        enabled_menu_codes = self._enabled_menu_codes()
        return [
            config for config in registered_configs
            if not config.get("module") or str(config.get("module") or "").strip() in enabled_menu_codes
        ]

    def _count(self, config):
        count_expr = config.get("count_expr", "COUNT(*)")
        where = f" WHERE {config['where']}" if config.get("where") else ""
        sql = f"SELECT {count_expr} AS cnt FROM {config['from']}{where}"
        _columns, rows = fetch_all(self._profile(), sql)
        return int(rows[0][0]) if rows else 0

    def _batch_sql(self, configs):
        parts = []
        for config in configs:
            key = str(config["key"]).replace("'", "''")
            label = str(config["label"]).replace("'", "''")
            count_expr = config.get("count_expr", "COUNT(*)")
            where = f" WHERE {config['where']}" if config.get("where") else ""
            parts.append(
                f"SELECT '{key}' AS stat_key, '{label}' AS stat_label, {count_expr} AS stat_value "
                f"FROM {config['from']}{where}"
            )
        return " UNION ALL ".join(parts)

    def _count_safe(self, config):
        try:
            return self._count(config)
        except Exception:
            LOGGER.exception("portal stat degraded for key=%s (from=%s)", config["key"], config["from"])
            return 0

    def get_stats(self):
        with database_transaction():
            return self._get_stats()

    def _get_stats(self):
        now = time.time()
        configs = self._visible_stat_configs()
        signature = tuple(config["key"] for config in configs)
        if self._stats_cache and now < self._stats_cache_expire_at and self._stats_cache_signature == signature:
            return self._clone_items(self._stats_cache)

        if not configs:
            items = []
            self._stats_cache = []
            self._stats_cache_expire_at = now + self._stats_cache_ttl
            self._stats_cache_signature = signature
            return items

        try:
            columns, rows = fetch_all(self._profile(), self._batch_sql(configs))
            data = [dict(zip(columns, row)) for row in rows]
            items = [
                {
                    "key": row.get("stat_key", ""),
                    "label": row.get("stat_label", ""),
                    "value": int(row.get("stat_value") or 0),
                }
                for row in data
            ]
            self._stats_cache = self._clone_items(items)
            self._stats_cache_expire_at = now + self._stats_cache_ttl
            self._stats_cache_signature = signature
            return items
        except Exception:
            LOGGER.exception("portal stats batch query failed; falling back to per-stat counts")
            if self._stats_cache and self._stats_cache_signature == signature:
                LOGGER.warning("portal stats returning stale cache after batch failure")
                return self._clone_items(self._stats_cache)

            items = [
                {"key": config["key"], "label": config["label"], "value": self._count_safe(config)}
                for config in configs
            ]
            self._stats_cache = self._clone_items(items)
            self._stats_cache_expire_at = now + self._stats_cache_ttl
            self._stats_cache_signature = signature
            return items

    def zero_stats(self):
        try:
            configs = self._visible_stat_configs()
        except Exception:
            try:
                configs = self._registered_stat_configs()
            except Exception:
                configs = []
        return [{"key": config["key"], "label": config["label"], "value": 0} for config in configs]


portal_service = PortalService()
