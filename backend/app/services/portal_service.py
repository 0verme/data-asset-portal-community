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

from sqlalchemy import and_, case, func, or_, select

from ..db.core import fetch_all_core
from ..db.facade import database_transaction, fetch_all, resolve_db_profile_name
from ..db.tables import (
    api_asset,
    api_relation,
    asset_table,
    data_source,
    indicator_item,
    lineage_node,
    lineage_snapshot,
    manual_code_table,
    mapping_field,
    mapping_table,
    push_job,
    push_system,
    report_asset,
    root_item,
    upstream_system,
)
from .providers import list_portal_stats
from .system_management_service import system_management_service


LOGGER = logging.getLogger(__name__)
PORTAL_STATS_CACHE_TTL_SECONDS = 600

READINESS_SPECS: dict[str, dict[str, str | None]] = {
    "data-warehouse": {
        "metricId": "table_readiness",
        "definition": "计入：有负责人和表说明",
    },
    "mapping": {
        "metricId": "field_mapping_coverage",
        "definition": "计入：已完成目标字段映射",
    },
    "root": {
        "metricId": "root_definition_readiness",
        "definition": "计入：有英文全称和词根说明",
    },
    "indicator": {
        "metricId": "metric_definition",
        "definition": "计入：有口径文本和出数表",
    },
    "codeTable": {
        "metricId": "code_table_readiness",
        "definition": "计入：有负责人和码表说明",
    },
    "report": {
        "metricId": "report_asset_link",
        "definition": "计入：已关联具体表或指标资产",
    },
    "apiAsset": {
        "metricId": "api_asset_link",
        "definition": "计入：已关联具体表或指标资产",
    },
    "push": {
        "metricId": "push_job_readiness",
        "definition": "计入：已填写源/目标路径和作业说明",
    },
    "lineage": {
        "metricId": "lineage_snapshot_coverage",
        "definition": "计入：已导入快照的表占比",
    },
    "system": {
        "metricId": None,
        "definition": None,
    },
}


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
        self._stats_cache_ttl = PORTAL_STATS_CACHE_TTL_SECONDS
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
            raise

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

    @staticmethod
    def normalize_readiness_module_id(module_id: str) -> str:
        normalized = str(module_id or "").strip()
        if normalized == "dwm":
            return "data-warehouse"
        if normalized not in READINESS_SPECS:
            raise ValueError(f"Unsupported readiness module: {normalized}")
        return normalized

    def _fetch_core_rows(self, statement) -> list[dict]:
        columns, rows = fetch_all_core(self._profile(), statement)
        return [dict(zip(columns, row)) for row in rows]

    @staticmethod
    def _non_empty(column):
        return func.trim(func.coalesce(column, "")) != ""

    def _query_module_counts(self, module_id: str) -> tuple[int, int]:
        if module_id == "data-warehouse":
            statement = (
                select(
                    func.count().label("denominator"),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    and_(
                                        self._non_empty(asset_table.c.owner_name),
                                        self._non_empty(asset_table.c.table_desc),
                                    ),
                                    1,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ).label("numerator"),
                )
                .select_from(asset_table)
                .where(asset_table.c.is_deleted == "N")
            )
        elif module_id == "mapping":
            statement = (
                select(
                    func.count(mapping_field.c.field_pk).label("denominator"),
                    func.coalesce(
                        func.sum(
                            case(
                                (self._non_empty(mapping_field.c.target_field_name), 1),
                                else_=0,
                            )
                        ),
                        0,
                    ).label("numerator"),
                )
                .select_from(
                    mapping_field.join(
                        mapping_table,
                        mapping_field.c.table_pk == mapping_table.c.table_pk,
                    )
                    .join(
                        upstream_system,
                        mapping_table.c.upstream_system_id == upstream_system.c.system_pk,
                    )
                    .outerjoin(
                        data_source,
                        and_(
                            data_source.c.source_id
                            == func.coalesce(
                                mapping_table.c.data_source_id,
                                upstream_system.c.data_source_id,
                            ),
                            data_source.c.is_deleted == "N",
                        ),
                    )
                )
                .where(
                    mapping_field.c.is_deleted == "N",
                    mapping_table.c.is_deleted == "N",
                    upstream_system.c.is_deleted == "N",
                )
            )
        elif module_id == "root":
            statement = (
                select(
                    func.count().label("denominator"),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    and_(
                                        self._non_empty(root_item.c.root_en_name),
                                        self._non_empty(root_item.c.root_desc),
                                    ),
                                    1,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ).label("numerator"),
                )
                .select_from(root_item)
                .where(root_item.c.is_deleted == "N")
            )
        elif module_id == "indicator":
            statement = (
                select(
                    func.count().label("denominator"),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    and_(
                                        self._non_empty(indicator_item.c.caliber_desc),
                                        or_(
                                            indicator_item.c.source_asset_id.is_not(None),
                                            self._non_empty(indicator_item.c.result_table_name),
                                        ),
                                    ),
                                    1,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ).label("numerator"),
                )
                .select_from(indicator_item)
                .where(
                    indicator_item.c.is_deleted == "N",
                    indicator_item.c.status_code == "enabled",
                )
            )
        elif module_id == "codeTable":
            statement = (
                select(
                    func.count().label("denominator"),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    and_(
                                        self._non_empty(manual_code_table.c.owner_name),
                                        self._non_empty(manual_code_table.c.remark),
                                    ),
                                    1,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ).label("numerator"),
                )
                .select_from(manual_code_table)
                .where(manual_code_table.c.status_code == "enabled")
            )
        elif module_id == "report":
            statement = (
                select(
                    func.count().label("denominator"),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    or_(
                                        ~func.trim(func.coalesce(report_asset.c.related_tables_json, "")).in_(("", "[]")),
                                        ~func.trim(func.coalesce(report_asset.c.related_indicators_json, "")).in_(("", "[]")),
                                    ),
                                    1,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ).label("numerator"),
                )
                .select_from(report_asset)
                .where(
                    report_asset.c.is_deleted == "N",
                    report_asset.c.status_code == "enabled",
                )
            )
        elif module_id == "apiAsset":
            linked_apis = (
                select(api_relation.c.api_code.label("api_code"))
                .distinct()
                .subquery("linked_apis")
            )
            statement = (
                select(
                    func.count().label("denominator"),
                    func.coalesce(
                        func.sum(
                            case((linked_apis.c.api_code.is_not(None), 1), else_=0)
                        ),
                        0,
                    ).label("numerator"),
                )
                .select_from(
                    api_asset.outerjoin(
                        linked_apis,
                        linked_apis.c.api_code == api_asset.c.api_code,
                    )
                )
                .where(
                    api_asset.c.is_deleted == "N",
                    api_asset.c.status_code == "enabled",
                )
            )
        elif module_id == "push":
            statement = (
                select(
                    func.count().label("denominator"),
                    func.coalesce(
                        func.sum(
                            case(
                                (
                                    and_(
                                        self._non_empty(push_job.c.source_path),
                                        self._non_empty(push_job.c.target_path),
                                        self._non_empty(push_job.c.job_desc),
                                    ),
                                    1,
                                ),
                                else_=0,
                            )
                        ),
                        0,
                    ).label("numerator"),
                )
                .select_from(
                    push_job.join(
                        push_system,
                        push_job.c.system_id == push_system.c.system_id,
                    )
                )
                .where(
                    push_job.c.is_deleted == "N",
                    push_job.c.enabled_flag == "Y",
                    push_system.c.is_deleted == "N",
                    push_system.c.status_code == "enabled",
                )
            )
        elif module_id == "lineage":
            total_rows = self._fetch_core_rows(
                select(func.count().label("total"))
                .select_from(asset_table)
                .where(asset_table.c.is_deleted == "N")
            )
            denominator = int(total_rows[0].get("total") or 0) if total_rows else 0
            if denominator <= 0:
                return 0, 0
            snapshot_rows = self._fetch_core_rows(
                select(lineage_snapshot.c.snapshot_id)
                .where(lineage_snapshot.c.status_code == "ACTIVE")
                .order_by(
                    lineage_snapshot.c.generated_at.desc(),
                    lineage_snapshot.c.snapshot_id.desc(),
                )
                .limit(1)
            )
            if not snapshot_rows:
                return 0, denominator
            snapshot_id = snapshot_rows[0]["snapshot_id"]
            snapshot_tables = (
                select(func.lower(lineage_node.c.node_name).label("table_name"))
                .where(
                    lineage_node.c.snapshot_id == snapshot_id,
                    lineage_node.c.kind_code == "table",
                )
                .distinct()
                .subquery("snapshot_tables")
            )
            matched_rows = self._fetch_core_rows(
                select(func.count().label("matched"))
                .select_from(
                    asset_table.join(
                        snapshot_tables,
                        func.lower(asset_table.c.table_name) == snapshot_tables.c.table_name,
                    )
                )
                .where(asset_table.c.is_deleted == "N")
            )
            matched = int(matched_rows[0].get("matched") or 0) if matched_rows else 0
            if matched > 0:
                return min(matched, denominator), denominator
            table_node_rows = self._fetch_core_rows(
                select(func.count(func.distinct(lineage_node.c.node_id)).label("node_count"))
                .select_from(lineage_node)
                .where(
                    lineage_node.c.snapshot_id == snapshot_id,
                    lineage_node.c.kind_code == "table",
                )
            )
            table_node_count = int(table_node_rows[0].get("node_count") or 0) if table_node_rows else 0
            return min(table_node_count, denominator), denominator
        else:
            return 0, 0

        rows = self._fetch_core_rows(statement)
        row = rows[0] if rows else {}
        return int(row.get("numerator") or 0), int(row.get("denominator") or 0)

    def _build_readiness_item(self, module_id: str) -> dict:
        canonical_id = self.normalize_readiness_module_id(module_id)
        spec = READINESS_SPECS[canonical_id]
        if canonical_id == "system":
            return {
                "moduleId": "system",
                "metricId": None,
                "status": "not_applicable",
                "definition": None,
                "numerator": None,
                "denominator": None,
                "percentage": None,
                "updatedAt": None,
            }
        numerator, denominator = self._query_module_counts(canonical_id)
        if denominator <= 0:
            return {
                "moduleId": canonical_id,
                "metricId": spec["metricId"],
                "status": "unavailable",
                "definition": spec["definition"],
                "numerator": 0,
                "denominator": 0,
                "percentage": None,
                "updatedAt": None,
            }
        clamped = max(0, min(numerator, denominator))
        return {
            "moduleId": canonical_id,
            "metricId": spec["metricId"],
            "status": "ready",
            "definition": spec["definition"],
            "numerator": clamped,
            "denominator": denominator,
            "percentage": round(clamped * 100 / denominator, 1),
            "updatedAt": None,
        }

    def get_readiness(self, module_id: str | None = None):
        with database_transaction():
            if module_id is not None and str(module_id).strip():
                return self._build_readiness_item(module_id)
            return [self._build_readiness_item(code) for code in READINESS_SPECS]


portal_service = PortalService()
