"""Asset-level ownership and merge-policy regressions (#260 后半).

The frozen Ownership / Merge Matrix from #260 (mirrored by
``docs/metadata-ingestion.md``) is the contract under test:

* ingestion update never writes portal-owned asset columns
  (``table_cn_name`` / ``layer_code`` / ``domain_code`` / ``owner_name`` /
  ``grain_desc`` / ``cycle_desc``), while create seeds them exactly once;
* ``unchanged`` is decided by the source-owned projection only, so a manual
  governance edit never triggers an ingestion update or any write;
* asset-level source-owned scalars (``description`` / ``catalog`` /
  ``database``) follow absent / ``null`` / ``""`` three-state semantics;
* a source-bound manual edit of source-owned ``name`` / ``schema`` /
  ``desc`` fails deterministically with ``422 SOURCE_OWNED_ATTRIBUTE`` and
  the whole request writes nothing;
* portal-only assets (``source_key IS NULL``) keep full manual editability.

Field identity itself is covered by ``test_field_identity.py`` (#259); this
module only adds the asset-level half and must not regress it.
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
from backend.app.contracts.metadata_ingestion import (
    AssetMetadataIngestionRequest,
    MetadataSource,
)
from backend.app.db.sqlite_adapter import connect
from backend.app.fastapi_app import create_fastapi_app
from backend.app.migrations.schema import initialize
from backend.app.services.assets_service import AssetsService
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


def asset_payload(*, name="orders", external_id=None, description=_ABSENT, fields=_ABSENT, **extra):
    payload = {
        "external_id": external_id or f"public.{name}",
        "qualified_name": f"public.{name}",
        "asset_type": "table",
        "schema": "public",
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


def manual_field(name, *, cn, data_type="integer", nullable=True, pk=False, part=False, enum=None):
    return {
        "name": name,
        "cn": cn,
        "type": data_type,
        "nullable": nullable,
        "pk": pk,
        "part": part,
        "enum": enum,
    }


def manual_asset_payload(
    *,
    name="orders",
    cn="订单主表",
    domain="交易",
    layer="DWD",
    owner="alice",
    grain="一行订单",
    cycle="每日",
    schema=_ABSENT,
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
        "fields": fields
        if fields is not _ABSENT
        else [
            manual_field("order_id", cn="订单编号", data_type="INTEGER", nullable=False, pk=True),
            manual_field("amount", cn="订单金额", data_type="DECIMAL"),
        ],
    }
    if schema is not _ABSENT:
        payload["schema"] = schema
    if desc is not _ABSENT:
        payload["desc"] = desc
    return payload


class AssetOwnershipMergeTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.database = Path(self.temp_dir.name) / "asset_ownership.sqlite"
        self.config = Path(self.temp_dir.name) / "database.yaml"
        self.config.write_text(
            "profiles:\n  asset_ownership_test:\n    type: sqlite\n    database: "
            + self.database.as_posix()
            + "\n",
            encoding="utf-8",
        )
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(self.config),
                "ASSET_DB_PROFILE": "asset_ownership_test",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            initialize(connection, {"type": "sqlite", "database": str(self.database)}, "sqlite")
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
        self.ingestion = MetadataIngestionService(db_profile="asset_ownership_test")
        self.assets = AssetsService()
        app = create_fastapi_app(
            identity_resolver=lambda _request: Identity("maintainer", "asset-owner", "Asset Owner"),
            assets_service_instance=self.assets,
            metadata_ingestion_service_instance=self.ingestion,
        )
        self.client = TestClient(app)

    # -- helpers ---------------------------------------------------------

    def _connect(self):
        return connect({"type": "sqlite", "database": str(self.database)})

    def _two_fields(self):
        return [
            source_field("order_id", ordinal=1, nullable=False, pk=True, description="identifier"),
            source_field("amount", ordinal=2, data_type="decimal", description="金额"),
        ]

    def _ingest(self, asset, *, source_name="source-a"):
        request = AssetMetadataIngestionRequest.model_validate(
            {
                "contract_version": "1.0",
                "source": {"type": "postgresql", "name": source_name, "namespace": "finance"},
                "collector": {"name": "asset-ownership-test", "version": "1.0.0"},
                "assets": [asset],
            }
        )
        return self.ingestion.ingest_assets(request)

    def _source_key(self, source_name="source-a"):
        return self.ingestion._source_key(
            MetadataSource(type="postgresql", name=source_name, namespace="finance")
        )

    def _asset_id(self, *, source_name="source-a", table_name="orders"):
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT asset_id FROM dwp.p_asset_table "
                "WHERE table_name = ? AND source_key = ?",
                (table_name, self._source_key(source_name)),
            ).fetchone()
            self.assertIsNotNone(row, (table_name, source_name))
            return int(row[0])
        finally:
            connection.close()

    def _portal_asset_id(self, table_name):
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT asset_id FROM dwp.p_asset_table WHERE table_name = ? AND source_key IS NULL",
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
            self.assertIsNotNone(row)
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

    def _snapshot(self, asset_id):
        """Everything a rejected / unchanged request must leave untouched."""
        return {
            "asset": self._asset_row(asset_id),
            "fields": self._field_rows(asset_id),
            "change_log": self._change_log_rows(asset_id),
        }

    def _field_id(self, asset_id, name):
        matches = [
            row
            for row in self._field_rows(asset_id)
            if row["is_deleted"] == "N" and row["field_name"].casefold() == name.casefold()
        ]
        self.assertEqual(1, len(matches), (asset_id, name, matches))
        return int(matches[0]["field_id"])

    # -- Case 1: portal-owned columns survive source update ---------------

    def test_portal_owned_columns_survive_source_update_and_identical_reimport(self):
        fields = self._two_fields()
        self._ingest(asset_payload(description="订单表", fields=fields))
        asset_id = self._asset_id()

        edited = self.client.put(
            f"/api/assets/{asset_id}",
            json=manual_asset_payload(
                cn="订单主表",
                owner="alice",
                grain="一行订单",
                cycle="每日",
                desc="订单表",
                fields=[
                    manual_field("order_id", cn="订单编号", data_type="INTEGER", nullable=False, pk=True),
                    manual_field("amount", cn="订单金额", data_type="DECIMAL", enum="CNY,USD"),
                ],
            ),
        )
        self.assertEqual(200, edited.status_code, edited.text)

        before = self._snapshot(asset_id)
        self.assertEqual("订单主表", before["asset"]["table_cn_name"])
        self.assertEqual("DWD", before["asset"]["layer_code"])
        self.assertEqual("D01", before["asset"]["domain_code"])
        self.assertEqual("alice", before["asset"]["owner_name"])
        self.assertEqual("一行订单", before["asset"]["grain_desc"])
        self.assertEqual("每日", before["asset"]["cycle_desc"])
        amount_id = self._field_id(asset_id, "amount")

        # Identical source payload: unchanged and provably zero writes.
        repeated = self._ingest(asset_payload(description="订单表", fields=fields))
        self.assertEqual("unchanged", repeated["items"][0]["status"])
        self.assertEqual(before, self._snapshot(asset_id))

        # A real source-owned change updates only source-owned columns.
        changed = self._ingest(asset_payload(description="订单表 v2", fields=fields))
        self.assertEqual("update", changed["items"][0]["status"])
        after = self._snapshot(asset_id)
        self.assertEqual("订单表 v2", after["asset"]["table_desc"])
        self.assertEqual("订单主表", after["asset"]["table_cn_name"])
        self.assertEqual("DWD", after["asset"]["layer_code"])
        self.assertEqual("D01", after["asset"]["domain_code"])
        self.assertEqual("alice", after["asset"]["owner_name"])
        self.assertEqual("一行订单", after["asset"]["grain_desc"])
        self.assertEqual("每日", after["asset"]["cycle_desc"])
        self.assertEqual(before["fields"], after["fields"])
        self.assertEqual(amount_id, self._field_id(asset_id, "amount"))
        self.assertEqual(len(before["change_log"]) + 1, len(after["change_log"]))

    # -- Case 2: source update keeps field identity and portal field data --

    def test_source_update_keeps_field_id_and_portal_field_metadata(self):
        self._ingest(asset_payload(description="订单表", fields=self._two_fields()))
        asset_id = self._asset_id()
        order_id = self._field_id(asset_id, "order_id")
        amount = self._field_id(asset_id, "amount")

        edited = self.client.put(
            f"/api/assets/{asset_id}/fields",
            json={
                "fields": [
                    manual_field("order_id", cn="订单编号", data_type="INTEGER", nullable=False, pk=True),
                    manual_field("amount", cn="订单金额", data_type="DECIMAL", enum="CNY,USD"),
                ]
            },
        )
        self.assertEqual(200, edited.status_code, edited.text)

        result = self._ingest(
            asset_payload(
                description="订单表（上游更新）",
                fields=[
                    source_field("order_id", ordinal=1, data_type="bigint", nullable=False, pk=True, description="identifier v2"),
                    source_field("amount", ordinal=2, data_type="decimal", description="金额 v2"),
                ],
            )
        )
        self.assertEqual("update", result["items"][0]["status"])

        rows = {row["field_id"]: row for row in self._field_rows(asset_id)}
        self.assertEqual(order_id, self._field_id(asset_id, "order_id"))
        self.assertEqual(amount, self._field_id(asset_id, "amount"))
        self.assertEqual("订单编号", rows[order_id]["field_cn_name"])
        self.assertEqual("订单金额", rows[amount]["field_cn_name"])
        self.assertEqual("CNY,USD", rows[amount]["enum_desc"])
        self.assertEqual("identifier v2", rows[order_id]["field_desc"])
        self.assertEqual("BIGINT", rows[order_id]["data_type"])

    # -- Case 3: source-bound manual mutation of source-owned columns -----

    def test_source_bound_manual_source_owned_asset_mutation_is_rejected(self):
        self._ingest(asset_payload(description="订单表", fields=self._two_fields()))
        asset_id = self._asset_id()
        before = self._snapshot(asset_id)

        def assert_rejected(response, field):
            self.assertEqual(422, response.status_code, response.text)
            error = response.json()["error"]
            self.assertEqual("SOURCE_OWNED_ATTRIBUTE", error["code"])
            self.assertTrue(
                any(item["field"] == field for item in error["details"]),
                (field, error["details"]),
            )
            self.assertEqual(before, self._snapshot(asset_id))

        assert_rejected(
            self.client.put(
                f"/api/assets/{asset_id}",
                json=manual_asset_payload(name="orders_by_hand", desc="订单表"),
            ),
            "name",
        )
        assert_rejected(
            self.client.put(
                f"/api/assets/{asset_id}",
                json=manual_asset_payload(schema="other_schema", desc="订单表"),
            ),
            "schema",
        )
        assert_rejected(
            self.client.put(
                f"/api/assets/{asset_id}",
                json=manual_asset_payload(desc="人工描述"),
            ),
            "desc",
        )
        # The compatibility route enforces exactly the same contract.
        assert_rejected(
            self.client.put(
                "/api/assets/tables/orders",
                json=manual_asset_payload(desc="人工描述"),
            ),
            "desc",
        )
        # A portal-owned edit combined with an illegal source-owned change is
        # rejected atomically: the cn change must not be persisted either.
        assert_rejected(
            self.client.put(
                f"/api/assets/{asset_id}",
                json=manual_asset_payload(name="orders_by_hand", cn="不应保存的中文名", desc="订单表"),
            ),
            "name",
        )

        # Portal-owned columns stay editable; the echoed source-owned values
        # are not a mutation.
        allowed = self.client.put(
            f"/api/assets/{asset_id}",
            json=manual_asset_payload(cn="订单主表", owner="alice", desc="订单表"),
        )
        self.assertEqual(200, allowed.status_code, allowed.text)
        row = self._asset_row(asset_id)
        self.assertEqual("订单主表", row["table_cn_name"])
        self.assertEqual("alice", row["owner_name"])
        self.assertEqual("orders", row["table_name"])
        self.assertEqual("public", row["schema_name"])
        self.assertEqual("订单表", row["table_desc"])

    # -- Case 4: portal-only assets keep full manual editability ----------

    def test_portal_only_manual_edit_keeps_full_editability(self):
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
                "fields": [
                    manual_field("order_id", cn="订单编号", data_type="INTEGER", nullable=False, pk=True)
                ],
            },
        )
        self.assertEqual(201, created.status_code, created.text)
        asset_id = self._portal_asset_id("manual_orders")

        updated = self.client.put(
            f"/api/assets/{asset_id}",
            json=manual_asset_payload(
                name="manual_orders_v2",
                cn="人工订单表 v2",
                desc="人工描述 v2",
                schema="manual_schema",
                fields=[
                    manual_field("order_id", cn="订单编号", data_type="INTEGER", nullable=False, pk=True)
                ],
            ),
        )
        self.assertEqual(200, updated.status_code, updated.text)
        row = self._asset_row(asset_id)
        self.assertEqual("manual_orders_v2", row["table_name"])
        self.assertEqual("manual_schema", row["schema_name"])
        self.assertEqual("人工描述 v2", row["table_desc"])
        self.assertEqual("人工订单表 v2", row["table_cn_name"])
        self.assertEqual("alice", row["owner_name"])
        self.assertIsNone(row["source_key"])

    # -- Case 5: absent / null / "" three-state semantics -----------------

    def test_asset_source_owned_scalars_presence_semantics(self):
        fields = self._two_fields()
        self._ingest(asset_payload(description="订单表", fields=fields, catalog="wh", database="analytics"))
        asset_id = self._asset_id()

        # absent -> preserve, and the payload is still `unchanged`
        logs_before = len(self._change_log_rows(asset_id))
        repeated = self._ingest(asset_payload(fields=fields))
        self.assertEqual("unchanged", repeated["items"][0]["status"])
        row = self._asset_row(asset_id)
        self.assertEqual("订单表", row["table_desc"])
        self.assertEqual("wh", row["catalog_name"])
        self.assertEqual("analytics", row["database_name"])
        self.assertEqual(logs_before, len(self._change_log_rows(asset_id)))

        # explicit null -> clear
        cleared = self._ingest(
            asset_payload(description=None, fields=fields, catalog=None, database=None)
        )
        self.assertEqual("update", cleared["items"][0]["status"])
        row = self._asset_row(asset_id)
        self.assertIsNone(row["table_desc"])
        self.assertIsNone(row["catalog_name"])
        self.assertIsNone(row["database_name"])

        # whitespace-only -> explicit clear; non-empty -> stripped write
        self._ingest(
            asset_payload(description="  ", fields=fields, catalog="  ", database="  ")
        )
        row = self._asset_row(asset_id)
        self.assertIsNone(row["table_desc"])
        self.assertIsNone(row["catalog_name"])
        self.assertIsNone(row["database_name"])

        written = self._ingest(
            asset_payload(
                description="  订单表 v3  ",
                fields=fields,
                catalog="  wh2  ",
                database="  db2  ",
            )
        )
        self.assertEqual("update", written["items"][0]["status"])
        row = self._asset_row(asset_id)
        self.assertEqual("订单表 v3", row["table_desc"])
        self.assertEqual("wh2", row["catalog_name"])
        self.assertEqual("db2", row["database_name"])

        # create without description still seeds table_cn_name = name
        self._ingest(asset_payload(name="no_desc", fields=[]))
        no_desc_id = self._asset_id(table_name="no_desc")
        no_desc = self._asset_row(no_desc_id)
        self.assertEqual("no_desc", no_desc["table_cn_name"])
        self.assertIsNone(no_desc["table_desc"])

    # -- Case 6: portal display fallback never pollutes the compare -------

    def test_manual_portal_edits_do_not_trigger_ingestion_update(self):
        fields = self._two_fields()
        self._ingest(asset_payload(description="订单表", fields=fields))
        asset_id = self._asset_id()

        asset_edit = self.client.put(
            f"/api/assets/{asset_id}",
            json=manual_asset_payload(cn="人工中文名", owner="alice", desc="订单表"),
        )
        self.assertEqual(200, asset_edit.status_code, asset_edit.text)
        field_edit = self.client.put(
            f"/api/assets/{asset_id}/fields",
            json={
                "fields": [
                    manual_field("order_id", cn="订单编号", data_type="INTEGER", nullable=False, pk=True),
                    manual_field("amount", cn="订单金额", data_type="DECIMAL", enum="CNY,USD"),
                ]
            },
        )
        self.assertEqual(200, field_edit.status_code, field_edit.text)

        before = self._snapshot(asset_id)
        repeated = self._ingest(asset_payload(description="订单表", fields=fields))
        self.assertEqual("unchanged", repeated["items"][0]["status"])
        self.assertEqual(before, self._snapshot(asset_id))

    # -- change log covers the source-owned projection --------------------

    def test_ingestion_change_log_records_source_owned_projection(self):
        fields = self._two_fields()
        self._ingest(asset_payload(description="订单表", fields=fields))
        asset_id = self._asset_id()

        created = self._change_log_rows(asset_id)
        self.assertEqual(1, len(created))
        self.assertEqual("CREATE_TABLE", created[0]["change_type"])
        after = json.loads(created[0]["after_json"])
        self.assertEqual("public.orders", after["qualifiedName"])
        self.assertEqual("订单表", after["description"])
        self.assertEqual(2, after["fieldCount"])

        self._ingest(asset_payload(description="订单表 v2", fields=fields))
        logs = self._change_log_rows(asset_id)
        self.assertEqual(2, len(logs))
        self.assertEqual("UPDATE_TABLE", logs[1]["change_type"])
        before = json.loads(logs[1]["before_json"])
        after = json.loads(logs[1]["after_json"])
        self.assertEqual("订单表", before["description"])
        self.assertEqual("订单表 v2", after["description"])
        self.assertEqual("public.orders", after["qualifiedName"])


if __name__ == "__main__":
    unittest.main()
