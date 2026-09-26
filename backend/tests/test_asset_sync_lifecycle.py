"""资产同步生命周期 E2E 验收（Epic #257 / Child D #261）。

Golden Path（#257 AC5）：

    import → asset_id → manual governance → indicator reference
      → upstream metadata change → re-import → read → semantic validation

本文件证明的是一条**真实跨模块生命周期**：写入走真实 HTTP ingestion
route（``POST /api/metadata/assets/ingestions``），读取与人工治理走真实
资产 API，指标引用走真实 ``/api/indicators`` route；数据库是初始化过的
隔离 SQLite，``MetadataIngestionService`` / ``AssetsService`` /
``IndicatorService`` 全部真实注入，不使用 MagicMock。

覆盖范围与去重（不重复 #258 / #259 / #260 已证明的单元级契约）：

* ``#258`` 已证明：多 source 同名 route 隔离、0/1/N 兼容查找、
  ``409 ASSET_AMBIGUOUS``、legacy 行不被 claim、report / search 的
  ``assetId`` 暴露。本文件只补「A 源 re-import 只影响 A」的 source 隔离。
* ``#259`` 已证明：stable ``field_id``、零写入行快照、字段新增 /
  删除 / rename / 不复用 ID、``fields`` 三态、字段级 422。本文件只把
  这些行为串成一条 HTTP ingestion 生命周期，不重测内部 helper。
* ``#260`` 已证明：asset 级 portal-owned preserve、source-owned 三态、
  asset 级 ``422 SOURCE_OWNED_ATTRIBUTE`` 与原子性、change log
  projection。本文件只验证「HTTP ingestion 创建的资产」走同一条契约，
  并补齐业务 change log 与 operation / audit log 的区分。
* ``#274`` 补充整表删除的 stable identity 生命周期：asset 与 fields 保留 tombstone、普通读取隐藏 tombstone、同一 source identity 恢复原 ``asset_id``、deleted indicator refs 确定失败；不重构全局 PK。

因此断言全部落在可以直接对应 #257 / #274 验收目标的生命周期上。

覆盖对照（test 名 → 验收目标）：

| 测试 | 覆盖 |
| --- | --- |
| `test_golden_path_import_govern_indicator_reimport_and_validate` | AC1 / AC2 / AC3 / AC4 / AC5：完整 Golden Path |
| `test_removed_field_breaks_indicator_reference_without_migration` | AC3：引用确定失败、无静默孤儿、无自动迁移 |
| `test_repeat_import_is_unchanged_without_business_write_but_keeps_audit_log` | AC1 / I5：重复同步零业务写入，audit log 语义独立 |
| `test_asset_source_owned_scalar_presence_during_lifecycle` | AC1：absent 保留 / `null` / `""` 清空 |
| `test_field_lifecycle_add_remove_rename_and_recreate_by_http_ingestion` | AC2：新增 / 删除 / rename / recreate 的稳定 ID 契约 |
| `test_reimport_targets_only_the_named_source_and_keeps_lookup_contract` | AC4：多 source 同名、0/1/N 兼容查找、单 source 隔离 |
| `test_portal_only_asset_is_not_claimed_by_ingestion_and_stays_editable` | AC4 / I3：portal-only 不被 claim、不被改写、仍可维护 |
| `test_source_bound_asset_manual_technical_edit_is_rejected_atomically` | AC1 / I3：source-owned 人工修改 422 + 原子性 |
| `test_deleted_ids_stay_reserved_and_old_indicator_never_rebinds` | #274：删除后 IDs 不复用，旧 indicator 读取稳定且 create/update 422 |
| `test_same_source_reimport_restores_asset_but_not_deleted_field_id` | #274 / I1 / I2：同一 source identity 恢复 asset ID、已删除 field ID 不复活 |
| `test_name_id_and_internal_delete_paths_leave_the_same_tombstones` | #274：按名称、按 ID 与内部 helper 统一软删除语义 |
| `test_change_log_distinguishes_business_change_from_audit` | AC1 / AC3：change log 与 operation log 语义分离 |
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app.application import Identity
from backend.app.contracts.metadata_ingestion import MetadataSource
from backend.app.db.sqlite_adapter import connect
from backend.app.fastapi_app import create_fastapi_app
from backend.app.migrations.schema import initialize
from backend.app.services.assets_service import AssetsService
from backend.app.services.indicator_service import IndicatorService
from backend.app.services.metadata_ingestion_service import MetadataIngestionService

_ABSENT = object()

_ASSET_COLUMNS = (
    "asset_id",
    "table_name",
    "table_cn_name",
    "schema_name",
    "catalog_name",
    "database_name",
    "source_key",
    "asset_type",
    "external_id",
    "qualified_name",
    "layer_code",
    "domain_code",
    "owner_name",
    "grain_desc",
    "cycle_desc",
    "table_desc",
    "field_count",
    "is_deleted",
    "created_by",
    "created_at",
    "updated_by",
    "updated_at",
)

_FIELD_COLUMNS = (
    "field_id",
    "asset_id",
    "field_name",
    "field_cn_name",
    "data_type",
    "field_order",
    "nullable_flag",
    "pk_flag",
    "partition_flag",
    "enum_desc",
    "field_desc",
    "is_deleted",
    "created_by",
    "created_at",
    "updated_by",
    "updated_at",
)

_CHANGE_LOG_COLUMNS = (
    "change_id",
    "asset_id",
    "table_name",
    "change_type",
    "before_json",
    "after_json",
    "operator_name",
)

_PORTAL_OWNED_ASSET_COLUMNS = (
    "table_cn_name",
    "layer_code",
    "domain_code",
    "owner_name",
    "grain_desc",
    "cycle_desc",
)


def source_asset(
    *,
    name="orders",
    external_id=None,
    asset_type="table",
    schema="public",
    description=_ABSENT,
    fields=_ABSENT,
    **extra,
):
    payload = {
        "externalId": external_id or f"public.{name}",
        "qualifiedName": f"public.{name}",
        "assetType": asset_type,
        "schema": schema,
        "name": name,
    }
    if description is not _ABSENT:
        payload["description"] = description
    if fields is not _ABSENT:
        payload["fields"] = fields
    payload.update(extra)
    return payload


def source_field(
    name,
    *,
    ordinal=None,
    data_type="integer",
    nullable=True,
    pk=False,
    part=False,
    description=_ABSENT,
):
    value = {
        "name": name,
        "dataType": data_type,
        "nullable": nullable,
        "primaryKey": pk,
        "partitionKey": part,
    }
    if ordinal is not None:
        value["ordinalPosition"] = ordinal
    if description is not _ABSENT:
        value["description"] = description
    return value


def manual_field(name, *, cn, data_type="INTEGER", nullable=True, pk=False, part=False, enum=None):
    return {
        "name": name,
        "cn": cn,
        "type": data_type,
        "nullable": nullable,
        "pk": pk,
        "part": part,
        "enum": enum,
    }


def governed_asset_payload(
    *,
    name="orders",
    cn="订单主表",
    domain="交易",
    layer="DWD",
    owner="alice",
    grain="一行订单",
    cycle="每日",
    desc=_ABSENT,
    fields=_ABSENT,
):
    payload = {
        "name": name,
        "cn": cn,
        "domain": domain,
        "layer": layer,
        "owner": owner,
        "grain": grain,
        "cycle": cycle,
    }
    if desc is not _ABSENT:
        payload["desc"] = desc
    if fields is not _ABSENT:
        payload["fields"] = fields
    return payload


def indicator_body(*, source_asset_id, result_field_id, indicator_id="ORD001", name="订单金额"):
    return {
        "id": indicator_id,
        "name": name,
        "meaning": "有效订单的金额汇总",
        "sourceAssetId": source_asset_id,
        "resultFieldId": result_field_id,
        "aggregation": "SUM",
        "semanticState": "candidate",
        "dimension": "ord",
        "caliber": "有效订单",
        "path": "ORD > 销售分析",
        "status": "enabled",
        "registrar": "lifecycle-tester",
        "registeredAt": "2026-08-01",
    }


class AssetSyncLifecycleTestCase(unittest.TestCase):
    """Shared isolated-DB fixture: real services + real FastAPI routes."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.database = Path(self.temp_dir.name) / "asset_sync_lifecycle.sqlite"
        self.config = Path(self.temp_dir.name) / "database.yaml"
        self.config.write_text(
            "profiles:\n  asset_sync_lifecycle_test:\n    type: sqlite\n    database: "
            + self.database.as_posix()
            + "\n",
            encoding="utf-8",
        )
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(self.config),
                "ASSET_DB_PROFILE": "asset_sync_lifecycle_test",
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
        self.ingestion = MetadataIngestionService(db_profile="asset_sync_lifecycle_test")
        self.assets = AssetsService()
        self.indicators = IndicatorService()
        self.indicators._allowed_status_values = lambda: {"enabled"}
        app = create_fastapi_app(
            identity_resolver=lambda _request: Identity(
                "maintainer", "lifecycle-tester", "Lifecycle Tester"
            ),
            assets_service_instance=self.assets,
            metadata_ingestion_service_instance=self.ingestion,
            indicator_service_instance=self.indicators,
        )
        self.client = TestClient(app)

    # -- database helpers -------------------------------------------------

    def _connect(self):
        return connect({"type": "sqlite", "database": str(self.database)})

    def _source_key(self, source_name="source-a"):
        return self.ingestion._source_key(
            MetadataSource(type="postgresql", name=source_name, namespace="finance")
        )

    def _db_asset_id(self, *, source_name="source-a", table_name="orders"):
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT asset_id FROM dwp.p_asset_table WHERE table_name = ? AND source_key = ?",
                (table_name, self._source_key(source_name)),
            ).fetchone()
            self.assertIsNotNone(row, (table_name, source_name))
            return int(row[0])
        finally:
            connection.close()

    def _db_portal_asset_id(self, table_name):
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT asset_id FROM dwp.p_asset_table "
                "WHERE table_name = ? AND source_key IS NULL",
                (table_name,),
            ).fetchone()
            self.assertIsNotNone(row, table_name)
            return int(row[0])
        finally:
            connection.close()

    def _asset_row(self, asset_id):
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT " + ", ".join(_ASSET_COLUMNS) + " FROM dwp.p_asset_table WHERE asset_id = ?",
                (int(asset_id),),
            ).fetchone()
            self.assertIsNotNone(row, asset_id)
            return dict(zip(_ASSET_COLUMNS, row))
        finally:
            connection.close()

    def _field_rows(self, asset_id):
        connection = self._connect()
        try:
            rows = connection.execute(
                "SELECT " + ", ".join(_FIELD_COLUMNS) + " FROM dwp.p_asset_field "
                "WHERE asset_id = ? ORDER BY field_id",
                (int(asset_id),),
            ).fetchall()
            return [dict(zip(_FIELD_COLUMNS, row)) for row in rows]
        finally:
            connection.close()

    def _active_field_rows(self, asset_id):
        return [row for row in self._field_rows(asset_id) if row["is_deleted"] == "N"]

    def _field_id(self, asset_id, name):
        matches = [
            row
            for row in self._active_field_rows(asset_id)
            if row["field_name"].casefold() == name.casefold()
        ]
        self.assertEqual(1, len(matches), (asset_id, name, matches))
        return int(matches[0]["field_id"])

    def _field_row(self, asset_id, field_id):
        matches = [row for row in self._field_rows(asset_id) if int(row["field_id"]) == int(field_id)]
        self.assertEqual(1, len(matches), (asset_id, field_id))
        return matches[0]

    def _change_log_rows(self, asset_id):
        connection = self._connect()
        try:
            rows = connection.execute(
                "SELECT " + ", ".join(_CHANGE_LOG_COLUMNS) + " FROM dwp.p_asset_change_log "
                "WHERE asset_id = ? ORDER BY change_id",
                (int(asset_id),),
            ).fetchall()
            return [dict(zip(_CHANGE_LOG_COLUMNS, row)) for row in rows]
        finally:
            connection.close()

    def _operation_log_count(self):
        connection = self._connect()
        try:
            return int(
                connection.execute("SELECT COUNT(*) FROM dwp.p_operation_log").fetchone()[0]
            )
        finally:
            connection.close()

    def _snapshot(self, asset_id):
        """Everything a re-import must leave untouched for an unchanged payload."""
        return {
            "asset": self._asset_row(asset_id),
            "fields": self._field_rows(asset_id),
        }

    # -- HTTP helpers -----------------------------------------------------

    def _ingest(self, assets, *, source_name="source-a", expect=201):
        response = self.client.post(
            "/api/metadata/assets/ingestions",
            json={
                "contractVersion": "1.0",
                "source": {"type": "postgresql", "name": source_name, "namespace": "finance"},
                "collector": {"name": "asset-sync-lifecycle", "version": "1.0.0"},
                "assets": assets,
            },
        )
        self.assertEqual(expect, response.status_code, response.text)
        return response

    def _ingest_status(self, assets, *, source_name="source-a"):
        response = self._ingest(assets, source_name=source_name)
        return response.json()["items"][0]["status"]

    def _lookup_by_legacy_table_name(self, table_name):
        """Compatibility lookup: 200 single match / 404 none / 409 ambiguous."""
        return self.client.get(f"/api/assets/tables/{table_name}")

    def _read_asset(self, asset_id):
        response = self.client.get(f"/api/assets/{asset_id}")
        self.assertEqual(200, response.status_code, response.text)
        return response.json()["data"]

    def _read_fields(self, asset_id):
        response = self.client.get(f"/api/assets/{asset_id}/fields")
        self.assertEqual(200, response.status_code, response.text)
        return response.json()["items"]

    def _read_ddl(self, asset_id):
        response = self.client.get(f"/api/assets/{asset_id}/ddl")
        self.assertEqual(200, response.status_code, response.text)
        return response.json()["data"]

    def _read_indicator(self, indicator_id="ORD001"):
        response = self.client.get(f"/api/indicators/{indicator_id}")
        self.assertEqual(200, response.status_code, response.text)
        return response.json()["data"]

    def _two_fields(self):
        return [
            source_field("order_id", ordinal=1, nullable=False, pk=True, description="identifier"),
            source_field("amount", ordinal=2, data_type="decimal", description="金额"),
        ]

    def _matching_manual_fields(self, *, amount_cn="订单金额", amount_enum=None):
        """Manual payload mirroring the source-owned field shape of ``_two_fields``."""
        return [
            manual_field("order_id", cn="订单编号", nullable=False, pk=True),
            manual_field("amount", cn=amount_cn, data_type="DECIMAL", enum=amount_enum),
        ]

    def _govern(self, asset_id, *, desc="订单表", amount_cn="订单金额", amount_enum=None, **overrides):
        payload = governed_asset_payload(
            desc=desc,
            fields=self._matching_manual_fields(amount_cn=amount_cn, amount_enum=amount_enum),
        )
        payload.update(overrides)
        return self.client.put(f"/api/assets/{asset_id}", json=payload)


class AssetSyncLifecycleGoldenPathTests(AssetSyncLifecycleTestCase):
    """AC5：import → edit → indicator → re-import → read → validate。"""

    def test_golden_path_import_govern_indicator_reimport_and_validate(self):
        # [1] Import through the real HTTP ingestion route.
        created = self._ingest([source_asset(description="订单表", fields=self._two_fields())])
        body = created.json()
        self.assertEqual("completed", body["status"])
        self.assertEqual("create", body["items"][0]["status"])
        self.assertEqual(1, body["summary"]["create"])

        # ingestion items are contract-scoped and deliberately carry no
        # canonical identity: ``assetId`` must be resolved through the read
        # path, never inferred from the write response.
        item = body["items"][0]
        self.assertNotIn("assetId", item)
        self.assertNotIn("asset_id", item)

        asset_id = self._db_asset_id()
        lookup = self._lookup_by_legacy_table_name("orders")
        self.assertEqual(200, lookup.status_code, lookup.text)
        self.assertEqual(asset_id, lookup.json()["data"]["assetId"])

        fields_before = {row["field_name"]: int(row["field_id"]) for row in self._active_field_rows(asset_id)}
        self.assertEqual({"order_id", "amount"}, set(fields_before))
        amount_field_id = fields_before["amount"]

        # [2] Manual governance: layer / domain / owner / cn / grain / cycle.
        governed = self._govern(asset_id, amount_enum="CNY,USD")
        self.assertEqual(200, governed.status_code, governed.text)
        row = self._asset_row(asset_id)
        self.assertEqual("订单主表", row["table_cn_name"])
        self.assertEqual("DWD", row["layer_code"])
        self.assertEqual("D01", row["domain_code"])
        self.assertEqual("alice", row["owner_name"])
        self.assertEqual("一行订单", row["grain_desc"])
        self.assertEqual("每日", row["cycle_desc"])

        # [3] Indicator reference through the real route + real DB.
        indicator = self.client.post(
            "/api/indicators",
            json=indicator_body(source_asset_id=asset_id, result_field_id=amount_field_id),
        )
        self.assertEqual(201, indicator.status_code, indicator.text)
        self.assertEqual(amount_field_id, indicator.json()["data"]["resultFieldId"])
        self.assertEqual(asset_id, indicator.json()["data"]["sourceAssetId"])

        # [4] Upstream changes table description only.
        status = self._ingest_status(
            [source_asset(description="订单表（上游更新了注释）", fields=self._two_fields())]
        )
        self.assertEqual("update", status)

        # [5] Read: portal-owned preserved, source-owned updated, IDs stable.
        detail = self._read_asset(asset_id)
        self.assertEqual(asset_id, detail["assetId"])
        self.assertEqual("订单主表", detail["cn"])
        self.assertEqual("DWD", detail["layer"])
        self.assertEqual("交易", detail["domain"])
        self.assertEqual("alice", detail["owner"])
        self.assertEqual("一行订单", detail["grain"])
        self.assertEqual("每日", detail["cycle"])
        self.assertEqual("订单表（上游更新了注释）", detail["desc"])

        row = self._asset_row(asset_id)
        for column in _PORTAL_OWNED_ASSET_COLUMNS:
            self.assertIsNotNone(row[column], column)
        self.assertEqual("订单主表", row["table_cn_name"])

        fields_after = [
            {
                "field_id": int(current["field_id"]),
                "field_name": current["field_name"],
                "field_cn_name": current["field_cn_name"],
                "enum_desc": current["enum_desc"],
            }
            for current in self._active_field_rows(asset_id)
        ]
        self.assertEqual(
            [
                {
                    "field_id": fields_before["order_id"],
                    "field_name": "order_id",
                    "field_cn_name": "订单编号",
                    "enum_desc": None,
                },
                {
                    "field_id": fields_before["amount"],
                    "field_name": "amount",
                    "field_cn_name": "订单金额",
                    "enum_desc": "CNY,USD",
                },
            ],
            fields_after,
        )

        # [6] Semantic validation still resolves the same field.
        indicator_read = self._read_indicator()
        self.assertEqual(amount_field_id, indicator_read["resultFieldId"])
        self.assertEqual(asset_id, indicator_read["sourceAssetId"])
        self.assertEqual("amount", indicator_read["resultFieldName"])

        listed = self.client.get("/api/indicators")
        self.assertEqual(200, listed.status_code, listed.text)
        listed_item = next(
            current for current in listed.json()["items"] if current["id"] == "ORD001"
        )
        self.assertEqual(amount_field_id, listed_item["resultFieldId"])
        self.assertEqual("amount", listed_item["resultFieldName"])

    def test_removed_field_breaks_indicator_reference_without_migration(self):
        self._ingest([source_asset(description="订单表", fields=self._two_fields())])
        asset_id = self._db_asset_id()
        amount_field_id = self._field_id(asset_id, "amount")

        created = self.client.post(
            "/api/indicators",
            json=indicator_body(source_asset_id=asset_id, result_field_id=amount_field_id),
        )
        self.assertEqual(201, created.status_code, created.text)

        # Source removes ``amount``: soft delete, no ID reuse.
        self.assertEqual(
            "update",
            self._ingest_status(
                [
                    source_asset(
                        description="订单表",
                        fields=[
                            source_field(
                                "order_id",
                                ordinal=1,
                                nullable=False,
                                pk=True,
                                description="identifier",
                            )
                        ],
                    )
                ]
            ),
        )
        removed = self._field_row(asset_id, amount_field_id)
        self.assertEqual("Y", removed["is_deleted"])
        self.assertEqual(["order_id"], [row["name"] for row in self._read_fields(asset_id)])
        self.assertNotIn("amount", self._read_ddl(asset_id)["ddl"])
        self.assertEqual(1, self._asset_row(asset_id)["field_count"])

        # The stored reference is deterministic failure, not a silent orphan
        # and not an automatic migration to another field. The client echoes
        # the unchanged indicator (except its name), exactly like a save.
        self.assertEqual(amount_field_id, self._read_indicator()["resultFieldId"])
        rejected = self.client.put(
            "/api/indicators/ORD001",
            json=indicator_body(
                source_asset_id=asset_id,
                result_field_id=amount_field_id,
                name="订单金额 v2",
            ),
        )
        self.assertEqual(422, rejected.status_code, rejected.text)
        details = rejected.json()["error"]["details"]
        self.assertTrue(
            any(item.get("message") == f"result field is deleted: {amount_field_id}" for item in details),
            details,
        )

        # A same-name field reappears with a brand-new ID; the old reference
        # still fails, so nothing was silently re-pointed.
        self.assertEqual("update", self._ingest_status([source_asset(description="订单表", fields=self._two_fields())]))
        recreated_field_id = self._field_id(asset_id, "amount")
        self.assertNotEqual(amount_field_id, recreated_field_id)
        still_rejected = self.client.put(
            "/api/indicators/ORD001",
            json=indicator_body(
                source_asset_id=asset_id,
                result_field_id=amount_field_id,
                name="订单金额 v3",
            ),
        )
        self.assertEqual(422, still_rejected.status_code, still_rejected.text)
        self.assertEqual(amount_field_id, self._read_indicator()["resultFieldId"])
        self.assertEqual("amount", self._read_indicator()["resultFieldName"])

        # Only an explicit human edit may move the reference.
        migrated = self.client.put(
            "/api/indicators/ORD001",
            json=indicator_body(
                source_asset_id=asset_id,
                result_field_id=recreated_field_id,
                name="订单金额 v3",
            ),
        )
        self.assertEqual(200, migrated.status_code, migrated.text)
        self.assertEqual(recreated_field_id, migrated.json()["data"]["resultFieldId"])

    def test_repeat_import_is_unchanged_without_business_write_but_keeps_audit_log(self):
        fields = self._two_fields()
        self._ingest([source_asset(description="订单表", fields=fields)])
        asset_id = self._db_asset_id()
        self.assertEqual(200, self._govern(asset_id).status_code)

        before = self._snapshot(asset_id)
        change_log_before = len(self._change_log_rows(asset_id))
        audit_before = self._operation_log_count()

        repeated = self._ingest([source_asset(description="订单表", fields=fields)])
        body = repeated.json()
        self.assertEqual("unchanged", body["items"][0]["status"])
        self.assertEqual(1, body["summary"]["unchanged"])
        self.assertEqual(0, body["summary"]["update"])
        self.assertEqual(0, body["summary"]["create"])

        # Idempotent replay = zero business write: rows are byte-identical,
        # including ``updated_at`` / ``updated_by`` on asset and fields.
        self.assertEqual(before, self._snapshot(asset_id))
        self.assertEqual(change_log_before, len(self._change_log_rows(asset_id)))

        # The audit / operation log is a different contract: an ingestion
        # attempt is still recorded even when no business row changed.
        self.assertEqual(audit_before + 1, self._operation_log_count())

    def test_asset_source_owned_scalar_presence_during_lifecycle(self):
        fields = self._two_fields()
        self._ingest(
            [
                source_asset(
                    description="订单表",
                    catalog="warehouse",
                    database="analytics",
                    fields=fields,
                )
            ]
        )
        asset_id = self._db_asset_id()
        self.assertEqual(200, self._govern(asset_id).status_code)

        # absent → preserve (and stays ``unchanged``)
        self.assertEqual("unchanged", self._ingest_status([source_asset(fields=fields)]))
        row = self._asset_row(asset_id)
        self.assertEqual("订单表", row["table_desc"])
        self.assertEqual("warehouse", row["catalog_name"])
        self.assertEqual("analytics", row["database_name"])

        # explicit null / "" → clear
        self.assertEqual(
            "update",
            self._ingest_status(
                [
                    source_asset(
                        description=None,
                        catalog="",
                        database="   ",
                        fields=fields,
                    )
                ]
            ),
        )
        row = self._asset_row(asset_id)
        self.assertIsNone(row["table_desc"])
        self.assertIsNone(row["catalog_name"])
        self.assertIsNone(row["database_name"])

        # portal-owned columns never participate in presence semantics
        self.assertEqual("订单主表", row["table_cn_name"])
        self.assertEqual("DWD", row["layer_code"])
        self.assertEqual("D01", row["domain_code"])
        self.assertEqual("alice", row["owner_name"])
        self.assertEqual("一行订单", row["grain_desc"])
        self.assertEqual("每日", row["cycle_desc"])


class AssetSyncLifecycleFieldLifecycleTests(AssetSyncLifecycleTestCase):
    """AC2：字段新增 / 删除 / rename / recreate 的稳定 ID 契约。"""

    def test_field_lifecycle_add_remove_rename_and_recreate_by_http_ingestion(self):
        self._ingest([source_asset(description="订单表", fields=self._two_fields())])
        asset_id = self._db_asset_id()
        order_id = self._field_id(asset_id, "order_id")
        amount = self._field_id(asset_id, "amount")
        self.assertEqual(200, self._govern(asset_id, amount_enum="CNY,USD").status_code)

        issued_ids = [order_id, amount]

        # ---- add --------------------------------------------------------
        self.assertEqual(
            "update",
            self._ingest_status(
                [
                    source_asset(
                        description="订单表",
                        fields=self._two_fields() + [source_field("region", ordinal=3, description="区域")],
                    )
                ]
            ),
        )
        region = self._field_id(asset_id, "region")
        self.assertNotIn(region, issued_ids)
        issued_ids.append(region)
        self.assertEqual(order_id, self._field_id(asset_id, "order_id"))
        self.assertEqual(amount, self._field_id(asset_id, "amount"))
        self.assertEqual("订单金额", self._field_row(asset_id, amount)["field_cn_name"])
        self.assertEqual("CNY,USD", self._field_row(asset_id, amount)["enum_desc"])
        self.assertEqual(3, self._asset_row(asset_id)["field_count"])

        # ---- remove -----------------------------------------------------
        self.assertEqual(
            "update",
            self._ingest_status(
                [
                    source_asset(
                        description="订单表",
                        fields=[
                            source_field("order_id", ordinal=1, nullable=False, pk=True, description="identifier"),
                            source_field("region", ordinal=2, description="区域"),
                        ],
                    )
                ]
            ),
        )
        self.assertEqual("Y", self._field_row(asset_id, amount)["is_deleted"])
        self.assertEqual(
            ["order_id", "region"],
            [row["name"] for row in self._read_fields(asset_id)],
        )
        self.assertEqual(
            [order_id, region],
            [int(row["fieldId"]) for row in self._read_fields(asset_id)],
        )
        self.assertNotIn("amount", self._read_ddl(asset_id)["ddl"])
        self.assertEqual(2, self._asset_row(asset_id)["field_count"])
        self.assertEqual(order_id, self._field_id(asset_id, "order_id"))

        # ---- rename (delete + add, no heuristic identity guessing) ------
        self.assertEqual(
            "update",
            self._ingest_status(
                [
                    source_asset(
                        description="订单表",
                        fields=[
                            source_field("order_id", ordinal=1, nullable=False, pk=True, description="identifier"),
                            source_field("region_code", ordinal=2, description="区域"),
                        ],
                    )
                ]
            ),
        )
        region_code = self._field_id(asset_id, "region_code")
        self.assertNotEqual(region, region_code)
        self.assertNotIn(region_code, issued_ids)
        issued_ids.append(region_code)
        self.assertEqual("Y", self._field_row(asset_id, region)["is_deleted"])
        self.assertEqual("region", self._field_row(asset_id, region)["field_name"])

        # ---- recreate the old name: a new field, never the old ID -------
        self.assertEqual(
            "update",
            self._ingest_status(
                [
                    source_asset(
                        description="订单表",
                        fields=[
                            source_field("order_id", ordinal=1, nullable=False, pk=True, description="identifier"),
                            source_field("region_code", ordinal=2, description="区域"),
                            source_field("region", ordinal=3, description="区域（新增）"),
                        ],
                    )
                ]
            ),
        )
        recreated = self._field_id(asset_id, "region")
        self.assertNotEqual(region, recreated)
        self.assertNotIn(recreated, issued_ids)
        issued_ids.append(recreated)
        self.assertEqual("Y", self._field_row(asset_id, region)["is_deleted"])

        # field IDs are monotonic and never recycled across the lifecycle
        all_ids = [int(row["field_id"]) for row in self._field_rows(asset_id)]
        self.assertEqual(len(all_ids), len(set(all_ids)))
        self.assertEqual(sorted(all_ids), all_ids)
        self.assertEqual({order_id, amount, region, region_code, recreated}, set(all_ids))


class AssetSyncLifecycleIdentityTests(AssetSyncLifecycleTestCase):
    """AC4：多 source 同名资产精确寻址 + 0/1/N 兼容查找。"""

    def test_reimport_targets_only_the_named_source_and_keeps_lookup_contract(self):
        fields = self._two_fields()

        # 0 matches → deterministic 404
        self.assertEqual(404, self._lookup_by_legacy_table_name("orders").status_code)

        self._ingest([source_asset(description="A 源订单表", fields=fields)], source_name="source-a")
        self._ingest([source_asset(description="B 源订单表", fields=fields)], source_name="source-b")
        asset_a = self._db_asset_id(source_name="source-a")
        asset_b = self._db_asset_id(source_name="source-b")
        self.assertNotEqual(asset_a, asset_b)

        # N matches → 409 with the exact candidates, never first match
        ambiguous = self._lookup_by_legacy_table_name("orders")
        self.assertEqual(409, ambiguous.status_code, ambiguous.text)
        error = ambiguous.json()["error"]
        self.assertEqual("ASSET_AMBIGUOUS", error["code"])
        self.assertEqual({asset_a, asset_b}, {item["assetId"] for item in error["details"]})

        before_b = self._snapshot(asset_b)

        # A re-import with a changed description must only touch A.
        self.assertEqual(
            "update",
            self._ingest_status(
                [source_asset(description="A 源订单表 v2", fields=fields)], source_name="source-a"
            ),
        )
        self.assertEqual("A 源订单表 v2", self._asset_row(asset_a)["table_desc"])
        self.assertEqual(before_b, self._snapshot(asset_b))

        # Both assets stay precisely addressable by assetId.
        self.assertEqual(asset_a, self._read_asset(asset_a)["assetId"])
        self.assertEqual("A 源订单表 v2", self._read_asset(asset_a)["desc"])
        self.assertEqual(asset_b, self._read_asset(asset_b)["assetId"])
        self.assertEqual("B 源订单表", self._read_asset(asset_b)["desc"])

        # Deleting A returns the compatibility lookup to a single match (1).
        deleted = self.client.delete(f"/api/assets/{asset_a}")
        self.assertEqual(200, deleted.status_code, deleted.text)
        self.assertEqual(404, self.client.get(f"/api/assets/{asset_a}").status_code)
        single = self._lookup_by_legacy_table_name("orders")
        self.assertEqual(200, single.status_code, single.text)
        self.assertEqual(asset_b, single.json()["data"]["assetId"])

        # The same source-scoped natural key is the same logical asset. Its
        # tombstone is restored with the original ID; B remains untouched.
        self.assertEqual(
            "update",
            self._ingest_status([source_asset(description="A 源订单表 v3", fields=fields)], source_name="source-a"),
        )
        asset_a2 = self._db_asset_id(source_name="source-a")
        self.assertEqual(asset_a, asset_a2)
        self.assertEqual("A 源订单表 v3", self._read_asset(asset_a2)["desc"])
        self.assertEqual(before_b, self._snapshot(asset_b))
        self.assertNotEqual(asset_a2, asset_b)


class AssetSyncLifecycleOwnershipTests(AssetSyncLifecycleTestCase):
    """I3：portal-only 不被 claim，source-bound 人工越权被确定性拒绝。"""

    def test_portal_only_asset_is_not_claimed_by_ingestion_and_stays_editable(self):
        created = self.client.post(
            "/api/assets/tables",
            json={
                "name": "manual_orders",
                "cn": "人工订单表",
                "domain": "交易",
                "layer": "DWD",
                "owner": "alice",
                "grain": "一行订单",
                "cycle": "每日",
                "desc": "人工创建",
                "fields": self._matching_manual_fields(),
            },
        )
        self.assertEqual(201, created.status_code, created.text)
        portal_asset_id = self._db_portal_asset_id("manual_orders")
        self.assertIsNone(self._asset_row(portal_asset_id)["source_key"])
        before = self._snapshot(portal_asset_id)

        # Same table name arrives from a source: it must not claim, overwrite
        # or merge into the portal-only row.
        self.assertEqual(
            "create",
            self._ingest_status([source_asset(name="manual_orders", description="上游订单表", fields=self._two_fields())]),
        )
        source_asset_id = self._db_asset_id(table_name="manual_orders")
        self.assertNotEqual(portal_asset_id, source_asset_id)
        self.assertEqual(before, self._snapshot(portal_asset_id))

        # Compatibility lookup is now ambiguous (N = 2); both stay addressable.
        ambiguous = self._lookup_by_legacy_table_name("manual_orders")
        self.assertEqual(409, ambiguous.status_code, ambiguous.text)
        self.assertEqual(
            {portal_asset_id, source_asset_id},
            {item["assetId"] for item in ambiguous.json()["error"]["details"]},
        )
        self.assertEqual("人工订单表", self._read_asset(portal_asset_id)["cn"])
        self.assertEqual("人工创建", self._read_asset(portal_asset_id)["desc"])
        self.assertEqual("上游订单表", self._read_asset(source_asset_id)["desc"])
        self.assertNotEqual(
            {int(row["field_id"]) for row in self._active_field_rows(portal_asset_id)},
            {int(row["field_id"]) for row in self._active_field_rows(source_asset_id)},
        )

        # portal-only keeps full manual editability (rename + desc + schema)
        edited = self.client.put(
            f"/api/assets/{portal_asset_id}",
            json={
                "name": "manual_orders_v2",
                "cn": "人工订单表 v2",
                "domain": "交易",
                "layer": "DWD",
                "owner": "alice",
                "grain": "一行订单",
                "cycle": "每日",
                "schema": "manual_schema",
                "desc": "人工描述 v2",
                "fields": self._matching_manual_fields(),
            },
        )
        self.assertEqual(200, edited.status_code, edited.text)
        row = self._asset_row(portal_asset_id)
        self.assertEqual("manual_orders_v2", row["table_name"])
        self.assertEqual("manual_schema", row["schema_name"])
        self.assertEqual("人工描述 v2", row["table_desc"])
        self.assertIsNone(row["source_key"])

    def test_source_bound_asset_manual_technical_edit_is_rejected_atomically(self):
        self._ingest([source_asset(description="订单表", fields=self._two_fields())])
        asset_id = self._db_asset_id()
        before = self._snapshot(asset_id)

        rejected = self.client.put(
            f"/api/assets/{asset_id}",
            json=governed_asset_payload(
                cn="不应保存的中文名",
                desc="人工描述",
                fields=self._matching_manual_fields(),
            ),
        )
        self.assertEqual(422, rejected.status_code, rejected.text)
        error = rejected.json()["error"]
        self.assertEqual("SOURCE_OWNED_ATTRIBUTE", error["code"])
        self.assertTrue(any(item["field"] == "desc" for item in error["details"]), error["details"])
        # atomic failure: portal-owned columns from the same request are not
        # partially persisted either.
        self.assertEqual(before, self._snapshot(asset_id))

        rename_payload = governed_asset_payload(
            desc="订单表",
            fields=self._matching_manual_fields(),
        )
        rename_payload["name"] = "orders_by_hand"
        renamed = self.client.put(f"/api/assets/{asset_id}", json=rename_payload)
        self.assertEqual(422, renamed.status_code, renamed.text)
        self.assertTrue(
            any(item["field"] == "name" for item in renamed.json()["error"]["details"])
        )
        self.assertEqual(before, self._snapshot(asset_id))

        # Portal-owned edits (including a value equal to the current one) are
        # still accepted.
        allowed = self._govern(asset_id, owner="alice")
        self.assertEqual(200, allowed.status_code, allowed.text)
        row = self._asset_row(asset_id)
        self.assertEqual("DWD", row["layer_code"])
        self.assertEqual("alice", row["owner_name"])


class AssetSyncLifecycleChangeLogTests(AssetSyncLifecycleTestCase):
    """AC1/AC3 的可审计性：change log 与 operation log 语义分离。"""

    def test_change_log_distinguishes_business_change_from_audit(self):
        fields = self._two_fields()
        self._ingest([source_asset(description="订单表", fields=fields)])
        asset_id = self._db_asset_id()

        created = self._change_log_rows(asset_id)
        self.assertEqual(1, len(created))
        self.assertEqual("CREATE_TABLE", created[0]["change_type"])
        after = json.loads(created[0]["after_json"])
        self.assertEqual("public.orders", after["qualifiedName"])
        self.assertEqual(2, after["fieldCount"])

        # Unrelated source-owned change → exactly one business UPDATE entry
        # whose before/after reflect the source-owned projection only.
        self.assertEqual(
            "update",
            self._ingest_status([source_asset(description="订单表 v2", fields=fields)]),
        )
        logs = self._change_log_rows(asset_id)
        self.assertEqual(2, len(logs))
        self.assertEqual("UPDATE_TABLE", logs[1]["change_type"])
        before = json.loads(logs[1]["before_json"])
        after = json.loads(logs[1]["after_json"])
        self.assertEqual("订单表", before["description"])
        self.assertEqual("订单表 v2", after["description"])
        self.assertEqual("orders", after["name"])
        self.assertEqual("public", after["schema"])

        # Portal-only manual governance is a business change of its own, but it
        # must not make ingestion treat the asset as changed: the next
        # identical re-import is ``unchanged`` and adds no change log row.
        self.assertEqual(200, self._govern(asset_id, desc="订单表 v2").status_code)
        logs_before = len(self._change_log_rows(asset_id))
        self.assertEqual(
            "unchanged",
            self._ingest_status([source_asset(description="订单表 v2", fields=fields)]),
        )
        self.assertEqual(logs_before, len(self._change_log_rows(asset_id)))


class AssetDeleteIdentityLifecycleTests(AssetSyncLifecycleTestCase):
    """整表删除遵守 asset / field stable identity 与 indicator 引用契约。"""

    def test_deleted_ids_stay_reserved_and_old_indicator_never_rebinds(self):
        self._ingest(
            [source_asset(name="orders", fields=[source_field("amount", ordinal=1, data_type="decimal")])],
            source_name="source-a",
        )
        asset_response = self._lookup_by_legacy_table_name("orders")
        self.assertEqual(200, asset_response.status_code, asset_response.text)
        asset_id = asset_response.json()["data"]["assetId"]
        field_id = self._read_fields(asset_id)[0]["fieldId"]
        created = self.client.post(
            "/api/indicators",
            json=indicator_body(source_asset_id=asset_id, result_field_id=field_id),
        )
        self.assertEqual(201, created.status_code, created.text)

        deleted = self.client.delete(f"/api/assets/{asset_id}")
        self.assertEqual(200, deleted.status_code, deleted.text)
        self.assertEqual("Y", self._asset_row(asset_id)["is_deleted"])
        self.assertEqual("Y", self._field_row(asset_id, field_id)["is_deleted"])
        self.assertEqual(404, self.client.get(f"/api/assets/{asset_id}").status_code)
        self.assertEqual(404, self.client.get(f"/api/assets/{asset_id}/fields").status_code)
        self.assertEqual(404, self._lookup_by_legacy_table_name("orders").status_code)
        listed = self.client.get("/api/assets/tables")
        self.assertEqual(200, listed.status_code, listed.text)
        self.assertNotIn(asset_id, {item["assetId"] for item in listed.json()["items"]})

        unrelated_ids = []
        unrelated_field_ids = []
        for source_name, table_name, field_name in (
            ("source-b", "payroll", "salary"),
            ("source-c", "employees", "employee_id"),
        ):
            self._ingest(
                [source_asset(name=table_name, fields=[source_field(field_name, ordinal=1)])],
                source_name=source_name,
            )
            response = self._lookup_by_legacy_table_name(table_name)
            self.assertEqual(200, response.status_code, response.text)
            unrelated_asset_id = response.json()["data"]["assetId"]
            unrelated_field_id = self._read_fields(unrelated_asset_id)[0]["fieldId"]
            unrelated_ids.append(unrelated_asset_id)
            unrelated_field_ids.append(unrelated_field_id)

        self.assertNotIn(asset_id, unrelated_ids)
        self.assertNotIn(field_id, unrelated_field_ids)
        self.assertEqual(len(unrelated_ids), len(set(unrelated_ids)))
        self.assertEqual(len(unrelated_field_ids), len(set(unrelated_field_ids)))

        old_indicator = self._read_indicator()
        self.assertEqual(asset_id, old_indicator["sourceAssetId"])
        self.assertEqual(field_id, old_indicator["resultFieldId"])
        self.assertEqual("orders", old_indicator["sourceAssetName"])
        self.assertEqual("amount", old_indicator["resultFieldName"])

        rejected_update = self.client.put(
            "/api/indicators/ORD001",
            json=indicator_body(
                source_asset_id=asset_id,
                result_field_id=field_id,
                name="订单金额更新",
            ),
        )
        self.assertEqual(422, rejected_update.status_code, rejected_update.text)
        update_details = rejected_update.json()["error"]["details"]
        self.assertTrue(
            any(item["message"] == f"result field is deleted: {field_id}" for item in update_details),
            update_details,
        )
        self.assertTrue(
            any(item["message"] == f"asset is deleted: {asset_id}" for item in update_details),
            update_details,
        )

        rejected_create = self.client.post(
            "/api/indicators",
            json=indicator_body(
                source_asset_id=asset_id,
                result_field_id=field_id,
                indicator_id="ORD002",
            ),
        )
        self.assertEqual(422, rejected_create.status_code, rejected_create.text)

    def test_same_source_reimport_restores_asset_but_not_deleted_field_id(self):
        payload = [
            source_asset(name="orders", fields=[source_field("amount", ordinal=1, data_type="decimal")])
        ]
        self._ingest(payload, source_name="source-a")
        original = self._lookup_by_legacy_table_name("orders").json()["data"]
        original_asset_id = original["assetId"]
        original_field_id = self._read_fields(original_asset_id)[0]["fieldId"]

        deleted = self.client.delete("/api/assets/tables/orders")
        self.assertEqual(200, deleted.status_code, deleted.text)
        self.assertEqual("Y", self._asset_row(original_asset_id)["is_deleted"])

        reimport = self._ingest(payload, source_name="source-a")
        self.assertEqual("update", reimport.json()["items"][0]["status"])
        restored = self._lookup_by_legacy_table_name("orders")
        self.assertEqual(200, restored.status_code, restored.text)
        self.assertEqual(original_asset_id, restored.json()["data"]["assetId"])
        restored_field_id = self._read_fields(original_asset_id)[0]["fieldId"]
        self.assertNotEqual(original_field_id, restored_field_id)
        self.assertEqual("Y", self._field_row(original_asset_id, original_field_id)["is_deleted"])
        self.assertEqual("N", self._field_row(original_asset_id, restored_field_id)["is_deleted"])

    def test_name_id_and_internal_delete_paths_leave_the_same_tombstones(self):
        assets = (
            ("source-a", "orders"),
            ("source-b", "payroll"),
            ("source-c", "employees"),
        )
        identities = {}
        for source_name, table_name in assets:
            self._ingest(
                [source_asset(name=table_name, fields=[source_field("id", ordinal=1)])],
                source_name=source_name,
            )
            response = self._lookup_by_legacy_table_name(table_name)
            self.assertEqual(200, response.status_code, response.text)
            asset_id = response.json()["data"]["assetId"]
            field_id = self._read_fields(asset_id)[0]["fieldId"]
            identities[table_name] = (asset_id, field_id)

        by_name = self.client.delete("/api/assets/tables/orders")
        by_id = self.client.delete(f"/api/assets/{identities['payroll'][0]}")
        internal = self.assets._delete_asset_table("employees")
        self.assertEqual(200, by_name.status_code, by_name.text)
        self.assertEqual(200, by_id.status_code, by_id.text)
        self.assertEqual("employees", internal["name"])

        for table_name, (asset_id, field_id) in identities.items():
            with self.subTest(table=table_name):
                self.assertEqual("Y", self._asset_row(asset_id)["is_deleted"])
                self.assertEqual("Y", self._field_row(asset_id, field_id)["is_deleted"])
                self.assertEqual(404, self.client.get(f"/api/assets/{asset_id}").status_code)


if __name__ == "__main__":
    unittest.main()
