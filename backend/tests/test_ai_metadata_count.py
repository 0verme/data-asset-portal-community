from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.contracts.ai_ask import AiAskRequest
from backend.app.contracts.rag_search import RagRecommendation, RagRecommendationsResponse
from backend.app.db.facade import clear_engine_cache, connect_with_profile
from backend.app.migrations.schema import initialize, verify_database
from backend.app.services.ai_ask_service import AIAskService
from backend.app.services.ai_metadata_count import (
    is_metadata_count_query,
    resolve_metadata_count_intent,
)
from backend.app.services.assets_service import AssetsService

ROOT = Path(__file__).resolve().parents[1]
COMMUNITY_CONFIG = ROOT / "configs" / "database.community.yaml"


class MetadataCountIntentTests(unittest.TestCase):
    def setUp(self):
        self.catalog = {
            "domains": [
                {"code": "FIN", "name": "财务"},
                {"code": "OPS", "name": "运营"},
            ],
            "layers": [
                {"code": "MART", "name": "数据集市层"},
                {"code": "DETAIL", "name": "数据明细层"},
            ],
        }

    def test_count_phrases_are_separated_from_asset_location_questions(self):
        for query in (
            "财务集市有几张表？",
            "财务主题域有多少张数据表？",
            "MART 层表数量是多少？",
            "共有多少张数据表？",
            "How many tables are in the catalog?",
        ):
            with self.subTest(query=query):
                self.assertTrue(is_metadata_count_query(query))
        for query in (
            "贷款余额在哪张表？",
            "哪个字段表示总数？",
            "某张表有多少个字段？",
            "解释一下表的用途",
        ):
            with self.subTest(query=query):
                self.assertFalse(is_metadata_count_query(query))

    def test_dimensions_are_resolved_only_from_live_catalog_values_and_aliases(self):
        intent = resolve_metadata_count_intent("财务集市有几张表？", self.catalog)
        self.assertEqual("FIN", intent.domain.code)
        self.assertEqual("财务", intent.domain.display_name)
        self.assertFalse(intent.domain.inferred)
        self.assertEqual("MART", intent.layer.code)
        self.assertEqual("数据集市层", intent.layer.display_name)
        self.assertTrue(intent.layer.inferred)

        layer_only = resolve_metadata_count_intent("某个集市有几张表？", self.catalog)
        self.assertIsNone(layer_only.domain)
        self.assertEqual("MART", layer_only.layer.code)
        global_count = resolve_metadata_count_intent("共有多少张数据表？", self.catalog)
        self.assertIsNone(global_count.domain)
        self.assertIsNone(global_count.layer)

    def test_unknown_conflicting_and_cross_dimension_ambiguous_scopes_fail_closed(self):
        self.assertIsNone(
            resolve_metadata_count_intent("未知主题域有几张表？", self.catalog)
        )
        self.assertIsNone(
            resolve_metadata_count_intent("某个主题域有几张表？", self.catalog)
        )
        self.assertIsNone(
            resolve_metadata_count_intent("数据有多少表？", self.catalog)
        )
        self.assertIsNone(
            resolve_metadata_count_intent("几个集市有几张表？", self.catalog)
        )
        self.assertIsNone(
            resolve_metadata_count_intent("财务和运营共有多少张表？", self.catalog)
        )
        overlapping_catalog = {
            "domains": [{"code": "MART_DOMAIN", "name": "财务集市"}],
            "layers": [{"code": "MART", "name": "数据集市层"}],
        }
        self.assertIsNone(
            resolve_metadata_count_intent("财务集市有几张表？", overlapping_catalog)
        )


class AssetCountCatalogIntegrationTests(unittest.TestCase):
    """Exercise authoritative COUNT and list totals on an isolated synthetic DB."""

    def setUp(self):
        root = os.environ.get("DAP_521_TEST_DIR")
        if root:
            Path(root).mkdir(parents=True, exist_ok=True)
        self.temp_dir = tempfile.TemporaryDirectory(dir=root)
        self.addCleanup(self.temp_dir.cleanup)
        self.database = Path(self.temp_dir.name) / "issue-521.sqlite"
        self.env = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(COMMUNITY_CONFIG),
                "ASSET_DB_PROFILE": "community_sqlite",
                "ASSET_DB_DATABASE": str(self.database),
            },
            clear=False,
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(clear_engine_cache)
        connection = connect_with_profile("community_sqlite")
        try:
            config = {"type": "sqlite", "database": str(self.database)}
            self.assertTrue(initialize(connection, config, "sqlite"))
            self.assertEqual("0001_baseline", verify_database(connection, config, "sqlite"))
        finally:
            connection.close()
        self._insert_synthetic_assets()
        self.service = AssetsService()

    def _insert_synthetic_assets(self):
        connection = sqlite3.connect(self.database)
        try:
            connection.execute(
                "INSERT INTO p_asset_domain "
                "(domain_code, domain_name, display_order, is_active, is_deleted) "
                "VALUES (?, ?, ?, ?, ?)",
                ("SYN521", "合成主题域", 1, "Y", "N"),
            )
            connection.execute(
                "INSERT INTO p_asset_domain "
                "(domain_code, domain_name, display_order, is_active, is_deleted) "
                "VALUES (?, ?, ?, ?, ?)",
                ("OTHER521", "其他合成域", 2, "Y", "N"),
            )
            connection.execute(
                "INSERT INTO p_asset_layer "
                "(layer_code, layer_name, display_order, is_active, is_deleted) "
                "VALUES (?, ?, ?, ?, ?)",
                ("DM", "数据集市层", 1, "Y", "N"),
            )
            for asset_id in range(1, 74):
                name = "SYNTHETIC_DUPLICATE" if asset_id in {1, 2} else f"SYNTHETIC_TABLE_{asset_id}"
                connection.execute(
                    "INSERT INTO p_asset_table "
                    "(asset_id, table_name, table_cn_name, schema_name, source_key, asset_type, "
                    "external_id, layer_code, domain_code, field_count, is_deleted, created_by, updated_by) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        asset_id, name, f"合成表{asset_id}", "dwp", f"SOURCE_{asset_id}",
                        "table", f"EXT_{asset_id}", "DM", "SYN521", 0, "N", "test", "test",
                    ),
                )
            # Same display name in a different source is a distinct stable asset.
            connection.execute(
                "INSERT INTO p_asset_table "
                "(asset_id, table_name, schema_name, source_key, asset_type, external_id, "
                "layer_code, domain_code, field_count, is_deleted) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (119, "OTHER_DOMAIN_TABLE", "dwp", "SOURCE_119", "table", "EXT_119", "DM", "OTHER521", 0, "N"),
            )
            # A deleted table must remain excluded by the same asset-list contract.
            connection.execute(
                "INSERT INTO p_asset_table "
                "(asset_id, table_name, schema_name, source_key, asset_type, external_id, "
                "layer_code, domain_code, field_count, is_deleted) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (120, "DELETED_TABLE", "dwp", "SOURCE_120", "table", "EXT_120", "DM", "SYN521", 0, "Y"),
            )
            connection.commit()
        finally:
            connection.close()

    def test_count_matches_asset_page_and_is_independent_of_page_size(self):
        count = self.service.count_asset_tables(
            domain_code="SYN521",
            domain_name="合成主题域",
            layer_code="DM",
            layer_name="数据集市层",
        )
        page_20 = self.service.get_asset_table_page(
            domain="合成主题域", layer="DM", page=1, page_size=20
        )
        page_100 = self.service.get_asset_table_page(
            domain="合成主题域", layer="DM", page=1, page_size=100
        )

        domain_count = self.service.count_asset_tables(
            domain_code="SYN521", domain_name="合成主题域"
        )
        layer_count = self.service.count_asset_tables(
            layer_code="DM", layer_name="数据集市层"
        )
        self.assertEqual(73, count)
        self.assertEqual(73, domain_count)
        self.assertEqual(74, layer_count)
        self.assertEqual((73, 20), (page_20["total"], len(page_20["items"])))
        self.assertEqual((73, 73), (page_100["total"], len(page_100["items"])))
        self.assertEqual(74, self.service.count_asset_tables())

    def test_ai_question_uses_authoritative_count_not_four_rag_candidates(self):
        class FourCandidateRag:
            def __init__(self):
                self.calls = 0

            def is_configured(self):
                return True

            def recommend(self, query, *, profile, top_k=None, cancel_event=None):
                self.calls += 1
                return RagRecommendationsResponse(
                    query=query,
                    status="available",
                    recommendations=[
                        RagRecommendation(
                            assetId=asset_id,
                            assetType="table",
                            name=f"SYNTHETIC_TABLE_{asset_id}",
                            displayName=f"合成表{asset_id}",
                            domain="合成主题域",
                            layer="DM",
                            evidence=["synthetic candidate"],
                        )
                        for asset_id in range(1, 5)
                    ],
                    count=4,
                )

        class DisabledLlm:
            def is_enabled(self):
                return False

            def complete_json(self, **_kwargs):
                raise AssertionError("metadata COUNT must not call the LLM")

        rag = FourCandidateRag()
        ai_service = AIAskService(rag, DisabledLlm(), assets_service=self.service)
        response = ai_service.ask(
            AiAskRequest(query="合成主题域集市有几张表？"),
            profile="strict",
        )

        self.assertEqual("metadata_count_answered", response.status)
        self.assertEqual(73, response.metadata_count.value)
        self.assertEqual([], response.citations)
        self.assertEqual("not_run", response.generation_status)
        self.assertEqual(0, rag.calls)

    def test_same_named_assets_from_distinct_sources_keep_distinct_identity(self):
        page = self.service.get_asset_table_page(
            domain="合成主题域", layer="DM", page=1, page_size=200
        )
        same_named = [item for item in page["items"] if item["name"] == "SYNTHETIC_DUPLICATE"]
        self.assertEqual(2, len(same_named))
        self.assertEqual({1, 2}, {item["assetId"] for item in same_named})
        self.assertEqual(73, page["total"])

    def test_filter_catalog_exposes_only_current_page_facets(self):
        catalog = self.service.get_asset_count_filter_catalog()
        self.assertIn({"code": "SYN521", "name": "合成主题域"}, catalog["domains"])
        self.assertIn({"code": "DM", "name": "数据集市层"}, catalog["layers"])


if __name__ == "__main__":
    unittest.main()
