"""Asset identity regressions: canonical ``asset_id`` reads vs legacy compatibility.

The child issue behind these tests is #258 (parent Epic #257).  The contract
under test is:

* ``asset_id`` is the portal-internal canonical read identity;
* ``(source_key, asset_type, external_id)`` stays the ingestion identity;
* ``table_name`` is a display / compatibility lookup that must never
  silently first-match when multiple assets share the same table name.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app.application import Identity
from backend.app.contracts.metadata_ingestion import AssetMetadataIngestionRequest
from backend.app.db.sqlite_adapter import connect
from backend.app.fastapi_app import create_fastapi_app
from backend.app.migrations.schema import initialize
from backend.app.services.assets_service import AssetsService
from backend.app.services.metadata_ingestion_service import MetadataIngestionService
from backend.app.services.report_service import ReportService, ReportValidationError
from backend.app.services.search_provider import KeywordSearchProvider


def orders_request(
    *,
    source_name: str = "source-a",
    external_id: str = "public.orders",
    name: str = "orders",
    description: str = "订单表",
    field_name: str = "order_id",
):
    return AssetMetadataIngestionRequest.model_validate(
        {
            "contract_version": "1.0",
            "source": {"type": "postgresql", "name": source_name, "namespace": "finance"},
            "collector": {"name": "identity-test-collector", "version": "1.0.0"},
            "assets": [
                {
                    "external_id": external_id,
                    "qualified_name": f"public.{name}",
                    "asset_type": "table",
                    "schema": "public",
                    "name": name,
                    "description": description,
                    "fields": [
                        {
                            "name": field_name,
                            "data_type": "integer",
                            "nullable": False,
                            "primary_key": True,
                            "ordinal_position": 1,
                            "description": "identifier",
                        }
                    ],
                }
            ],
        }
    )


def _asset_ref(row):
    return {
        "assetId": int(row["asset_id"]),
        "tableName": row["table_name"],
        "tableCn": row["table_cn_name"],
        "layer": row["layer_code"],
        "domain": row["domain_code"],
    }


def asset_update_payload(*, name: str = "orders", cn: str = "人工维护订单表"):
    return {
        "name": name,
        "cn": cn,
        "domain": "交易",
        "layer": "DWD",
        "owner": "zhangsan",
        "grain": "一行订单",
        "cycle": "每日",
        "desc": "人工描述",
        "fields": [
            {
                "name": "order_id",
                "cn": "订单编号",
                "type": "integer",
                "nullable": False,
                "pk": True,
                "part": False,
            }
        ],
    }


class AssetIdentityApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.database = Path(self.temp_dir.name) / "asset_identity.sqlite"
        self.config = Path(self.temp_dir.name) / "database.yaml"
        self.config.write_text(
            "profiles:\n  asset_identity_test:\n    type: sqlite\n    database: "
            + self.database.as_posix()
            + "\n",
            encoding="utf-8",
        )
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(self.config),
                "ASSET_DB_PROFILE": "asset_identity_test",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            initialize(
                connection,
                {"type": "sqlite", "database": str(self.database)},
                "sqlite",
            )
            connection.execute(
                "INSERT INTO dwp.p_asset_domain "
                "(domain_code, domain_name, display_order, is_active, is_deleted) "
                "VALUES ('D01', '交易', 1, 'Y', 'N')"
            )
            connection.execute(
                "INSERT INTO dwp.p_asset_layer "
                "(layer_code, layer_name, display_order, is_active, is_deleted) "
                "VALUES ('DWD', '明细层', 1, 'Y', 'N')"
            )
            connection.commit()
        finally:
            connection.close()
        self.ingestion = MetadataIngestionService(db_profile="asset_identity_test")
        self.assets = AssetsService()
        app = create_fastapi_app(
            identity_resolver=lambda _request: Identity(
                "maintainer", "identity-tester", "Identity Tester"
            ),
            assets_service_instance=self.assets,
        )
        self.client = TestClient(app)

    # -- helpers ---------------------------------------------------------

    def _ingest(self, **kwargs):
        return self.ingestion.ingest_assets(orders_request(**kwargs))

    def _asset_rows(self, table_name: str | None = None):
        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            if table_name is None:
                rows = connection.execute(
                    "SELECT asset_id, table_name, source_key, table_cn_name "
                    "FROM dwp.p_asset_table ORDER BY asset_id"
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT asset_id, table_name, source_key, table_cn_name "
                    "FROM dwp.p_asset_table WHERE table_name = ? ORDER BY asset_id",
                    (table_name,),
                ).fetchall()
            return [
                {
                    "asset_id": int(row[0]),
                    "table_name": row[1],
                    "source_key": row[2],
                    "table_cn_name": row[3],
                }
                for row in rows
            ]
        finally:
            connection.close()

    def _asset_id(self, *, table_name: str = "orders", source_name: str) -> int:
        source_key = self.ingestion._source_key(orders_request(source_name=source_name).source)
        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            row = connection.execute(
                "SELECT asset_id FROM dwp.p_asset_table WHERE table_name = ? "
                "AND source_key = ?",
                (table_name, source_key),
            ).fetchone()
            self.assertIsNotNone(row, (table_name, source_name))
            return int(row[0])
        finally:
            connection.close()

    def _insert_legacy_asset(self, *, table_name: str = "orders", cn: str = "历史订单表") -> int:
        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            connection.execute(
                "INSERT INTO dwp.p_asset_table "
                "(asset_id, table_name, table_cn_name, schema_name, layer_code, "
                "domain_code, owner_name, field_count, is_deleted, created_by, updated_by) "
                "VALUES (9001, ?, ?, 'public', 'DWD', 'D01', 'legacy-owner', 0, 'N', "
                "'legacy', 'legacy')",
                (table_name, cn),
            )
            connection.commit()
        finally:
            connection.close()
        return 9001

    # -- Case 1: multi-source same-name assets ---------------------------

    def test_multi_source_same_name_assets_are_addressable_by_asset_id(self):
        self._ingest(source_name="source-a", external_id="public.orders")
        self._ingest(source_name="source-b", external_id="public.orders")

        rows = self._asset_rows("orders")
        self.assertEqual(2, len(rows))
        by_asset_id = {row["asset_id"]: row for row in rows}
        self.assertEqual(2, len(by_asset_id))

        for asset_id, row in by_asset_id.items():
            detail = self.client.get(f"/api/assets/{asset_id}")
            self.assertEqual(200, detail.status_code, detail.text)
            self.assertEqual(asset_id, detail.json()["data"]["assetId"])
            self.assertEqual("orders", detail.json()["data"]["name"])

            fields = self.client.get(f"/api/assets/{asset_id}/fields")
            self.assertEqual(200, fields.status_code, fields.text)
            self.assertEqual(1, len(fields.json()["items"]))

            ddl = self.client.get(f"/api/assets/{asset_id}/ddl")
            self.assertEqual(200, ddl.status_code, ddl.text)
            self.assertIn("order_id", ddl.json()["data"]["ddl"])

        # The two assets resolve to independent rows, not to a shared row.
        first = by_asset_id[rows[0]["asset_id"]]
        second = by_asset_id[rows[1]["asset_id"]]
        self.assertNotEqual(first["source_key"], second["source_key"])

    # -- Case 2: legacy table_name lookup --------------------------------

    def test_single_match_legacy_table_name_lookup_stays_compatible(self):
        self._ingest(source_name="source-a")
        asset_id = self._asset_id(source_name="source-a")

        detail = self.client.get("/api/assets/tables/orders")
        self.assertEqual(200, detail.status_code, detail.text)
        self.assertEqual(asset_id, detail.json()["data"]["assetId"])

        fields = self.client.get("/api/assets/tables/orders/fields")
        self.assertEqual(200, fields.status_code, fields.text)
        self.assertEqual("order_id", fields.json()["items"][0]["name"])

        ddl = self.client.get("/api/assets/tables/orders/ddl")
        self.assertEqual(200, ddl.status_code, ddl.text)

    # -- Case 3: ambiguity is a deterministic failure --------------------

    def test_ambiguous_table_name_lookup_never_first_matches(self):
        self._ingest(source_name="source-a", external_id="public.orders")
        self._ingest(source_name="source-b", external_id="public.orders")

        detail = self.client.get("/api/assets/tables/orders")
        self.assertEqual(409, detail.status_code, detail.text)
        error = detail.json()["error"]
        self.assertEqual("ASSET_AMBIGUOUS", error["code"])
        self.assertEqual(2, len(error["details"]))
        self.assertEqual(2, len({item["sourceKey"] for item in error["details"]}))
        self.assertTrue(all(item["assetId"] for item in error["details"]))

        fields = self.client.get("/api/assets/tables/orders/fields")
        self.assertEqual(409, fields.status_code, fields.text)
        self.assertEqual("ASSET_AMBIGUOUS", fields.json()["error"]["code"])

        ddl = self.client.get("/api/assets/tables/orders/ddl")
        self.assertEqual(409, ddl.status_code, ddl.text)
        self.assertEqual("ASSET_AMBIGUOUS", ddl.json()["error"]["code"])

        update = self.client.put("/api/assets/tables/orders", json=asset_update_payload())
        self.assertEqual(409, update.status_code, update.text)
        self.assertEqual("ASSET_AMBIGUOUS", update.json()["error"]["code"])

        delete = self.client.delete("/api/assets/tables/orders")
        self.assertEqual(409, delete.status_code, delete.text)
        self.assertEqual("ASSET_AMBIGUOUS", delete.json()["error"]["code"])

    # -- Case 4: mutations address the exact asset -----------------------

    def test_mutation_by_asset_id_targets_only_the_named_asset(self):
        self._ingest(source_name="source-a", external_id="public.orders")
        self._ingest(source_name="source-b", external_id="public.orders")
        asset_a = self._asset_id(source_name="source-a")
        asset_b = self._asset_id(source_name="source-b")

        updated = self.client.put(
            f"/api/assets/{asset_a}",
            json=asset_update_payload(cn="A 来源人工编辑"),
        )
        self.assertEqual(200, updated.status_code, updated.text)
        self.assertEqual(asset_a, updated.json()["data"]["assetId"])
        self.assertEqual("A 来源人工编辑", updated.json()["data"]["cn"])

        untouched = self.client.get(f"/api/assets/{asset_b}")
        self.assertEqual(200, untouched.status_code, untouched.text)
        self.assertEqual("订单表", untouched.json()["data"]["cn"])

        deleted = self.client.delete(f"/api/assets/{asset_b}")
        self.assertEqual(200, deleted.status_code, deleted.text)
        self.assertEqual(404, self.client.get(f"/api/assets/{asset_b}").status_code)

        remaining = self.client.get(f"/api/assets/{asset_a}")
        self.assertEqual(200, remaining.status_code, remaining.text)
        self.assertEqual("A 来源人工编辑", remaining.json()["data"]["cn"])

    def test_single_match_legacy_update_and_delete_still_work(self):
        self._ingest(source_name="source-a")
        asset_id = self._asset_id(source_name="source-a")

        updated = self.client.put(
            "/api/assets/tables/orders",
            json=asset_update_payload(cn="兼容入口人工编辑"),
        )
        self.assertEqual(200, updated.status_code, updated.text)
        self.assertEqual(asset_id, updated.json()["data"]["assetId"])
        self.assertEqual("兼容入口人工编辑", updated.json()["data"]["cn"])

        deleted = self.client.delete("/api/assets/tables/orders")
        self.assertEqual(200, deleted.status_code, deleted.text)
        self.assertEqual([], self._asset_rows("orders"))

    # -- Case 5: unknown ids and route ordering --------------------------

    def test_unknown_and_non_numeric_asset_ids_return_not_found(self):
        self.assertEqual(404, self.client.get("/api/assets/999999").status_code)
        self.assertEqual(
            "ASSET_NOT_FOUND",
            self.client.get("/api/assets/999999").json()["error"]["code"],
        )
        self.assertEqual(404, self.client.get("/api/assets/not-a-number").status_code)

        # Literal compatibility routes must win over /{asset_id}.
        self.assertEqual(200, self.client.get("/api/assets/domains").status_code)
        self.assertEqual(200, self.client.get("/api/assets/layers").status_code)
        self.assertEqual(200, self.client.get("/api/assets/tables").status_code)

    # -- Legacy rows: never auto-claimed ---------------------------------

    def test_legacy_rows_are_addressable_but_not_claimed_by_ingestion(self):
        legacy_id = self._insert_legacy_asset()

        legacy_detail = self.client.get(f"/api/assets/{legacy_id}")
        self.assertEqual(200, legacy_detail.status_code, legacy_detail.text)
        self.assertEqual("历史订单表", legacy_detail.json()["data"]["cn"])

        result = self._ingest(source_name="source-a", external_id="public.orders")
        self.assertEqual("create", result["items"][0]["status"])

        rows = self._asset_rows("orders")
        self.assertEqual(2, len(rows))
        legacy_row = next(row for row in rows if row["asset_id"] == legacy_id)
        self.assertIsNone(legacy_row["source_key"])
        imported_row = next(row for row in rows if row["asset_id"] != legacy_id)
        self.assertIsNotNone(imported_row["source_key"])

        # Both canonical identities still work; the shared table name is ambiguous.
        self.assertEqual(200, self.client.get(f"/api/assets/{legacy_id}").status_code)
        self.assertEqual(200, self.client.get(f"/api/assets/{imported_row['asset_id']}").status_code)
        ambiguous = self.client.get("/api/assets/tables/orders")
        self.assertEqual(409, ambiguous.status_code, ambiguous.text)

    # -- Case 6: ingestion identity does not regress ---------------------

    def test_ingestion_source_scoped_identity_is_unchanged(self):
        first = self._ingest(source_name="source-a", external_id="public.orders")
        asset_id = self._asset_id(source_name="source-a")
        self.assertEqual("create", first["items"][0]["status"])

        repeated = self._ingest(source_name="source-a", external_id="public.orders")
        self.assertEqual("unchanged", repeated["items"][0]["status"])
        self.assertEqual(asset_id, self._asset_id(source_name="source-a"))

        changed = self._ingest(
            source_name="source-a",
            external_id="public.orders",
            description="订单表（上游更新）",
        )
        self.assertEqual("update", changed["items"][0]["status"])
        self.assertEqual(asset_id, self._asset_id(source_name="source-a"))

        self._ingest(source_name="source-b", external_id="public.orders")
        self.assertEqual(2, len(self._asset_rows("orders")))


if __name__ == "__main__":
    unittest.main()


class ReportAssetIdentityTests(unittest.TestCase):
    """Report -> asset references must prefer assetId and reject ambiguity."""

    def setUp(self):
        self.service = ReportService()
        self.service._allowed_status_values = MagicMock(return_value={"enabled"})
        self.service._allowed_code_values = MagicMock(
            side_effect=lambda category, fallback: {
                "REPORT_TYPE": {"经营分析"},
                "REPORT_STAT_PERIOD": {"日"},
                "UPSTREAM_DEPT": {"运营管理部"},
            }.get(category, set(fallback))
        )
        self.service._legacy_values = MagicMock(return_value=set())
        self.service._domain_names = MagicMock(return_value={"支付"})
        self.service._indicator_lookup = MagicMock(return_value={})
        row = {
            "asset_id": 7,
            "table_name": "orders",
            "table_cn_name": "订单表",
            "layer_code": "DWD",
            "domain_code": "D01",
        }
        duplicate = {**row, "asset_id": 8, "table_cn_name": "B 来源订单表"}
        self.service._asset_lookup = MagicMock(
            return_value=({7: _asset_ref(row), 8: _asset_ref(duplicate)}, {"orders": [_asset_ref(row), _asset_ref(duplicate)]})
        )

    def _payload(self):
        return {
            "code": "RPT_IDENTITY_1",
            "name": "Identity report",
            "type": "经营分析",
            "domain": "支付",
            "statPeriod": "日",
            "statCaliber": "当日",
            "status": "enabled",
            "ownerDept": "运营管理部",
            "ownerName": "tester",
            "relatedTables": [{"assetId": 7, "tableName": "orders"}],
            "relatedIndicators": [],
        }

    def test_report_reference_resolves_by_asset_id(self):
        normalized = self.service._normalize_payload(self._payload())
        self.assertEqual(7, normalized["relatedTables"][0]["assetId"])
        self.assertEqual("订单表", normalized["relatedTables"][0]["tableCn"])

    def test_report_reference_rejects_ambiguous_table_name(self):
        payload = self._payload()
        payload["relatedTables"] = [{"tableName": "orders"}]
        with self.assertRaises(ReportValidationError) as context:
            self.service._normalize_payload(payload)
        messages = [item["message"] for item in context.exception.details]
        self.assertTrue(any("ambiguous" in message for message in messages), messages)

    def test_report_reference_rejects_unknown_asset_id(self):
        payload = self._payload()
        payload["relatedTables"] = [{"assetId": 999, "tableName": "orders"}]
        with self.assertRaises(ReportValidationError):
            self.service._normalize_payload(payload)


class SearchAssetIdentityTests(unittest.TestCase):
    """Unified search exposes assetId additively while keeping ref = table_name."""

    def setUp(self):
        self.provider = KeywordSearchProvider()

    def _config(self, entity_type):
        return next(config for config in self.provider.ENTITY_CONFIGS if config["type"] == entity_type)

    def test_asset_search_item_carries_canonical_asset_id(self):
        item = self.provider._map_item(
            self._config("asset"),
            {
                "asset_id": 7,
                "table_name": "orders",
                "table_cn_name": "订单表",
                "layer_code": "DWD",
                "domain_name": "交易",
                "owner_name": "zhangsan",
            },
        )
        self.assertEqual(7, item["assetId"])
        self.assertEqual("orders", item["ref"])
        self.assertEqual("orders", item["id"])

    def test_non_asset_search_items_keep_their_existing_shape(self):
        item = self.provider._map_item(
            self._config("indicator"),
            {"indicator_id": "CUST00001", "indicator_name": "个体工商户标识"},
        )
        self.assertNotIn("assetId", item)


if __name__ == "__main__":
    unittest.main()
