"""#264 asset explore closure: field recall, count/hasMore semantics, scope=asset.

Runs against a real temporary SQLite repository (community profile + demo seed),
so the provider SQL is executed instead of mocked.
"""

# pyright: reportMissingImports=false

from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.db.facade import clear_engine_cache, connect_with_profile
from backend.app.migrations.schema import initialize, verify_database
from backend.app.services.asset_field_match import (
    ASSET_FIELD_ACTIVE_VALUE,
    ASSET_FIELD_MATCH_COLUMNS,
)
from backend.app.services.assets_service import AssetsService
from backend.app.services.providers import list_search_entities
from backend.app.services.search_provider import KeywordSearchProvider
from demo.seed_sqlite import seed

ROOT = Path(__file__).resolve().parents[1]
COMMUNITY_CONFIG = ROOT / "configs" / "database.community.yaml"

# Business words that only exist in p_asset_field for the demo dataset.
FIELD_ONLY_KEYWORD = "包裹数"
MULTI_FIELD_KEYWORD = "会员数"
TRUNCATED_KEYWORD = "商品SKU标识"
SYSTEM_KEYWORD = "up_service"

GROUP_KEYS = {"type", "label", "module", "count", "hasMore", "items"}
ITEM_KEYS = {
    "id",
    "title",
    "subtitle",
    "meta",
    "module",
    "ref",
    "type",
    "category",
    "matchedFields",
}


class AssetExploreSearchTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._temp_dir = tempfile.TemporaryDirectory()
        cls.database = Path(cls._temp_dir.name) / "search264.sqlite"
        cls._environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(COMMUNITY_CONFIG),
                "ASSET_DB_PROFILE": "community_sqlite",
                "ASSET_DB_DATABASE": str(cls.database),
            },
            clear=False,
        )
        cls._environment.start()
        connection = connect_with_profile("community_sqlite")
        try:
            config = {"type": "sqlite", "database": str(cls.database)}
            assert initialize(connection, config, "sqlite")
            assert verify_database(connection, config, "sqlite") == "0001_baseline"
        finally:
            connection.close()
        seed(cls.database)
        cls.addClassCleanup(clear_engine_cache)
        cls.addClassCleanup(cls._environment.stop)
        cls.addClassCleanup(cls._temp_dir.cleanup)

    def setUp(self):
        self.provider = KeywordSearchProvider()
        self.service = AssetsService()

    # --- helpers -----------------------------------------------------------

    def _search(self, query, scope="all", limit=5):
        return self.provider.search(query, scope=scope, limit=limit)

    def _group(self, result, entity_type="asset"):
        return next(group for group in result["groups"] if group["type"] == entity_type)

    def _sqlite(self):
        return sqlite3.connect(self.database)

    def _field_recall_asset_ids(self, keyword):
        """Independent oracle: assets owning an active field that matches keyword."""
        like = f"%{keyword.strip().lower()}%"
        connection = self._sqlite()
        try:
            rows = connection.execute(
                "SELECT DISTINCT asset_id FROM p_asset_field WHERE is_deleted = ? AND ("
                "LOWER(COALESCE(field_name, '')) LIKE ? "
                "OR LOWER(COALESCE(field_cn_name, '')) LIKE ? "
                "OR LOWER(COALESCE(field_desc, '')) LIKE ?)",
                (ASSET_FIELD_ACTIVE_VALUE, like, like, like),
            ).fetchall()
        finally:
            connection.close()
        return {int(row[0]) for row in rows}

    def _asset_id_by_name(self, table_name):
        connection = self._sqlite()
        try:
            row = connection.execute(
                "SELECT asset_id FROM p_asset_table WHERE table_name = ?", (table_name,)
            ).fetchone()
        finally:
            connection.close()
        return int(row[0]) if row else None

    def _insert_field(self, asset_id, name, cn_name=None, desc=None, is_deleted="N"):
        connection = self._sqlite()
        try:
            next_id = connection.execute(
                "SELECT COALESCE(MAX(field_id), 0) + 1 FROM p_asset_field"
            ).fetchone()[0]
            connection.execute(
                "INSERT INTO p_asset_field "
                "(field_id, asset_id, field_name, field_cn_name, field_desc, field_order, is_deleted) "
                "VALUES (?, ?, ?, ?, ?, 0, ?)",
                (next_id, asset_id, name, cn_name, desc, is_deleted),
            )
            connection.commit()
        finally:
            connection.close()

    # --- field recall ------------------------------------------------------

    def test_field_only_keyword_recalls_owning_asset(self):
        expected_ids = self._field_recall_asset_ids(FIELD_ONLY_KEYWORD)
        self.assertEqual(2, len(expected_ids), "demo dataset expectation drifted")

        group = self._group(self._search(FIELD_ONLY_KEYWORD, scope="asset", limit=50))

        self.assertEqual(len(expected_ids), group["count"])
        self.assertEqual(
            expected_ids,
            {int(item["assetId"]) for item in group["items"]},
            "assets must be recalled through their active fields",
        )
        for item in group["items"]:
            self.assertEqual("asset", item["type"])
            self.assertTrue(
                any(match["label"] == "字段" for match in item["matchedFields"]),
                "a field-only hit must be explained by a field matchedFields entry",
            )

    def test_multiple_matching_fields_return_one_asset(self):
        asset_id = self._asset_id_by_name("DWS_MEMBER_ACTIVITY_STAT_1D")
        self.assertIsNotNone(asset_id)
        connection = self._sqlite()
        try:
            matching_fields = connection.execute(
                "SELECT COUNT(*) FROM p_asset_field WHERE asset_id = ? AND is_deleted = ? "
                "AND (LOWER(COALESCE(field_name, '')) LIKE ? "
                "OR LOWER(COALESCE(field_cn_name, '')) LIKE ? "
                "OR LOWER(COALESCE(field_desc, '')) LIKE ?)",
                (asset_id, ASSET_FIELD_ACTIVE_VALUE, f"%{MULTI_FIELD_KEYWORD.lower()}%",
                 f"%{MULTI_FIELD_KEYWORD.lower()}%", f"%{MULTI_FIELD_KEYWORD.lower()}%"),
            ).fetchone()[0]
        finally:
            connection.close()
        self.assertGreaterEqual(matching_fields, 2, "demo dataset expectation drifted")

        group = self._group(self._search(MULTI_FIELD_KEYWORD, scope="asset", limit=50))
        asset_ids = [int(item["assetId"]) for item in group["items"]]

        self.assertEqual(len(asset_ids), len(set(asset_ids)), "asset must not be duplicated")
        self.assertEqual(asset_ids.count(asset_id), 1)
        self.assertEqual(group["count"], len(asset_ids))
        for item in group["items"]:
            self.assertLessEqual(len(item["matchedFields"]), 3, "matchedFields must stay light")

    def test_matched_fields_explain_the_field_hit(self):
        group = self._group(self._search(FIELD_ONLY_KEYWORD, scope="asset", limit=50))
        by_name = {item["title"]: item for item in group["items"]}
        item = by_name["DWM_FULFILLMENT_DELIVERY_1D"]

        field_matches = [match for match in item["matchedFields"] if match["label"] == "字段"]
        self.assertTrue(field_matches)
        self.assertEqual({"label", "value"}, set(field_matches[0].keys()))
        self.assertEqual("package_count 包裹数", field_matches[0]["value"])
        self.assertEqual(
            {"package_count 包裹数", "on_time_count 准时包裹数"},
            {match["value"] for match in field_matches},
        )
        # Field definitions must not leak into the result payload.
        self.assertNotIn("dataType", str(item))
        self.assertNotIn("nullable", str(item))

    def test_deleted_field_never_recalls_asset(self):
        asset_id = self._asset_id_by_name("DWD_PRODUCT_SKU")
        self._insert_field(asset_id, "deleted_only_field", cn_name="已删除专用词", is_deleted="Y")
        self._insert_field(asset_id, "active_only_field", cn_name="有效专用词")

        deleted = self._group(self._search("已删除专用词", scope="asset", limit=50))
        active = self._group(self._search("有效专用词", scope="asset", limit=50))

        self.assertEqual(0, deleted["count"])
        self.assertEqual([], deleted["items"])
        self.assertFalse(deleted["hasMore"])
        self.assertEqual(1, active["count"])
        self.assertEqual(asset_id, int(active["items"][0]["assetId"]))

    # --- count / hasMore ---------------------------------------------------

    def test_count_is_matched_total_and_has_more_reports_truncation(self):
        full = self._group(self._search(TRUNCATED_KEYWORD, scope="asset", limit=50))
        self.assertEqual(10, full["count"], "demo dataset expectation drifted")
        self.assertEqual(10, len(full["items"]))
        self.assertFalse(full["hasMore"])
        self.assertEqual(full["count"], len(full["items"]))

        page = self._group(self._search(TRUNCATED_KEYWORD, scope="asset", limit=3))
        self.assertEqual(full["count"], page["count"], "count must be the matched total")
        self.assertEqual(3, len(page["items"]))
        self.assertTrue(page["hasMore"])

    def test_response_contract_semantics(self):
        result = self._search(TRUNCATED_KEYWORD, scope="all", limit=3)

        self.assertEqual(TRUNCATED_KEYWORD, result["query"])
        self.assertEqual("all", result["scope"])
        self.assertEqual(sum(group["count"] for group in result["groups"]), result["total"])
        self.assertEqual(result["total"], result["estimatedTotal"])
        self.assertEqual(
            any(group["hasMore"] for group in result["groups"]), result["hasMore"]
        )
        for group in result["groups"]:
            self.assertEqual(GROUP_KEYS, set(group.keys()))
            self.assertEqual(group["count"] > len(group["items"]), group["hasMore"])
            for item in group["items"]:
                self.assertTrue(ITEM_KEYS <= set(item.keys()))

    # --- scope -------------------------------------------------------------

    def test_scope_asset_returns_only_asset_group_repeatably(self):
        first = self._search(TRUNCATED_KEYWORD, scope="asset", limit=3)
        second = self._search(TRUNCATED_KEYWORD, scope="asset", limit=3)

        self.assertEqual("asset", first["scope"])
        self.assertEqual(["asset"], [group["type"] for group in first["groups"]])
        self.assertEqual(first, second, "scope=asset must be stable across repeats")
        self.assertTrue(first["hasMore"])

    def test_scope_asset_keeps_empty_group_for_a_non_matching_keyword(self):
        result = self._search("完全不存在的业务词", scope="asset", limit=5)

        self.assertEqual(["asset"], [group["type"] for group in result["groups"]])
        self.assertEqual(0, result["groups"][0]["count"])
        self.assertEqual([], result["groups"][0]["items"])
        self.assertEqual(0, result["total"])

    # --- asset list entry parity ------------------------------------------

    def test_asset_list_entry_recalls_the_same_assets(self):
        for keyword in (FIELD_ONLY_KEYWORD, "商品", "DWD", "D01"):
            with self.subTest(keyword=keyword):
                search_group = self._group(
                    self._search(keyword, scope="asset", limit=50)
                )
                list_page = self.service.get_asset_table_page(
                    keyword=keyword, page=1, page_size=50
                )

                search_ids = {int(item["assetId"]) for item in search_group["items"]}
                list_ids = {int(item["assetId"]) for item in list_page["items"]}

                self.assertEqual(search_ids, list_ids)
                self.assertEqual(search_group["count"], list_page["total"])

    # --- non-asset regression ---------------------------------------------

    def test_non_asset_entities_keep_their_contract(self):
        result = self._search(SYSTEM_KEYWORD, scope="system", limit=5)
        group = self._group(result, "system")

        self.assertEqual(["system"], [item["type"] for item in group["items"]])
        self.assertEqual(1, group["count"])
        self.assertFalse(group["hasMore"])
        item = group["items"][0]
        self.assertEqual("up_service", item["id"])
        self.assertNotIn("assetId", item)
        self.assertEqual(
            [{"label": "系统编码", "value": "up_service"}], item["matchedFields"]
        )
        self.assertEqual(GROUP_KEYS, set(group.keys()))

    def test_asset_group_is_additive_and_keeps_table_metadata_matches(self):
        group = self._group(self._search("全渠道", scope="asset", limit=50))

        self.assertGreaterEqual(group["count"], 1)
        for item in group["items"]:
            self.assertTrue(item["matchedFields"], "table metadata matches stay intact")
            self.assertTrue(
                any(match["label"] != "字段" for match in item["matchedFields"])
            )


class AssetFieldMatchContractTestCase(unittest.TestCase):
    """Both asset read entries must share the same field-match declaration."""

    def _asset_field_match(self):
        config = next(
            item for item in list_search_entities() if item["type"] == "asset"
        )
        return config["field_match"]

    def test_search_entity_declares_the_shared_field_columns(self):
        spec = self._asset_field_match()

        self.assertEqual(
            [f"f.{column}" for column, _label in ASSET_FIELD_MATCH_COLUMNS],
            [matcher["expr"] for matcher in spec["matchers"]],
        )
        self.assertEqual(
            [label for _column, label in ASSET_FIELD_MATCH_COLUMNS],
            [matcher["label"] for matcher in spec["matchers"]],
        )
        self.assertIn(ASSET_FIELD_ACTIVE_VALUE, spec["active_where"])
        self.assertEqual("asset_id", spec["row_key"])

    def test_degraded_group_keeps_the_group_contract(self):
        """Degradation must not change the group shape the frontend consumes."""
        config = next(
            item for item in list_search_entities() if item["type"] == "asset"
        )

        group = KeywordSearchProvider()._empty_group(config)

        self.assertEqual(GROUP_KEYS, set(group.keys()))
        self.assertFalse(group["hasMore"])
        self.assertEqual(0, group["count"])

    def test_asset_list_filter_uses_the_shared_field_columns(self):
        service = AssetsService()
        with patch.object(
            service, "_load_domain_mappings", return_value=({}, {})
        ):
            clauses, _ = service._build_asset_filters(keyword="存款余额")

        from sqlalchemy import select  # pyright: ignore[reportMissingImports]
        from sqlalchemy.dialects import postgresql  # pyright: ignore[reportMissingImports]

        compiled = str(
            select(1).where(*clauses).compile(dialect=postgresql.dialect())
        )
        for column, _label in ASSET_FIELD_MATCH_COLUMNS:
            self.assertIn(f"p_asset_field.{column}", compiled)
        self.assertIn("p_asset_field.is_deleted =", compiled)


if __name__ == "__main__":
    unittest.main()
