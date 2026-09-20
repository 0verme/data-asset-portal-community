"""Stable field identity and incremental field merge regressions (#259).

The contract under test (Epic #257 / #259, canonical Ownership / Merge Matrix
in #260 §8):

* historical field identity is ``field_id``; IDs are never recycled;
* active matching key is ``(asset_id, field_name.casefold())`` over
  ``is_deleted = 'N'`` rows; deleted historical rows never match;
* rename is a soft delete plus a brand-new ``field_id``;
* portal-owned field columns survive ingestion updates;
* ``fields`` absent is a collection NOOP, ``fields: []`` clears the
  collection, and any other list is the authoritative collection;
* manual edits preserve IDs and obey the same field-level ownership rules.
"""

from __future__ import annotations

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
from backend.app.services.indicator_service import IndicatorService, IndicatorValidationError
from backend.app.services.metadata_ingestion_service import (
    MetadataIngestionService,
    MetadataValidationError,
)

_ABSENT = object()

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
    "created_at",
    "updated_at",
)

_ASSET_COLUMNS = (
    "asset_id",
    "table_name",
    "table_cn_name",
    "schema_name",
    "table_desc",
    "field_count",
    "layer_code",
    "domain_code",
    "owner_name",
    "is_deleted",
    "created_at",
    "updated_at",
)


def asset_payload(
    *,
    name: str = "orders",
    external_id: str | None = None,
    description: str = "订单表",
    fields=_ABSENT,
    **extra,
):
    payload = {
        "external_id": external_id or f"public.{name}",
        "qualified_name": f"public.{name}",
        "asset_type": "table",
        "schema": "public",
        "name": name,
        "description": description,
    }
    if fields is not _ABSENT:
        payload["fields"] = fields
    payload.update(extra)
    return payload


def source_field(
    name: str,
    *,
    ordinal: int | None = None,
    data_type: str = "integer",
    nullable: bool = True,
    pk: bool = False,
    part: bool = False,
    description=_ABSENT,
    **extra,
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
    value.update(extra)
    return value


def manual_field(
    name: str,
    *,
    cn: str,
    data_type: str = "integer",
    nullable: bool = True,
    pk: bool = False,
    part: bool = False,
    enum: str | None = None,
):
    return {
        "name": name,
        "cn": cn,
        "type": data_type,
        "nullable": nullable,
        "pk": pk,
        "part": part,
        "enum": enum,
    }


def indicator_payload(*, source_asset_id: int, result_field_id: int):
    return {
        "id": "ORD001",
        "name": "订单金额",
        "meaning": "有效订单的金额汇总",
        "sourceAssetId": source_asset_id,
        "resultFieldId": result_field_id,
        "aggregation": "SUM",
        "semanticState": "candidate",
        "dimension": "ord",
        "caliber": "有效订单",
        "path": "ORD > 销售分析",
        "status": "enabled",
        "registrar": "tester",
        "registeredAt": "2026-08-01",
    }


class FieldIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.database = Path(self.temp_dir.name) / "field_identity.sqlite"
        self.config = Path(self.temp_dir.name) / "database.yaml"
        self.config.write_text(
            "profiles:\n  field_identity_test:\n    type: sqlite\n    database: "
            + self.database.as_posix()
            + "\n",
            encoding="utf-8",
        )
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(self.config),
                "ASSET_DB_PROFILE": "field_identity_test",
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
        self.ingestion = MetadataIngestionService(db_profile="field_identity_test")
        self.assets = AssetsService()
        self.indicators = IndicatorService()
        self.indicators._allowed_status_values = lambda: {"enabled"}
        app = create_fastapi_app(
            identity_resolver=lambda _request: Identity(
                "maintainer", "field-tester", "Field Tester"
            ),
            assets_service_instance=self.assets,
            metadata_ingestion_service_instance=self.ingestion,
        )
        self.client = TestClient(app)

    # -- helpers ---------------------------------------------------------

    def _connect(self):
        return connect({"type": "sqlite", "database": str(self.database)})

    def _ingest(self, asset, *, source_name="source-a", authoritative=False):
        request = AssetMetadataIngestionRequest.model_validate(
            {
                "contract_version": "1.0",
                "source": {"type": "postgresql", "name": source_name, "namespace": "finance"},
                "collector": {"name": "field-identity-test", "version": "1.0.0"},
                "assets": [asset],
                "authoritative": authoritative,
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
                "SELECT asset_id FROM dwp.p_asset_table "
                "WHERE table_name = ? AND source_key IS NULL",
                (table_name,),
            ).fetchone()
            self.assertIsNotNone(row, table_name)
            return int(row[0])
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
            row for row in self._active_field_rows(asset_id) if row["field_name"].casefold() == name.casefold()
        ]
        self.assertEqual(1, len(matches), (asset_id, name, matches))
        return int(matches[0]["field_id"])

    def _asset_row(self, asset_id):
        connection = self._connect()
        try:
            row = connection.execute(
                "SELECT " + ", ".join(_ASSET_COLUMNS) + " FROM dwp.p_asset_table "
                "WHERE asset_id = ?",
                (int(asset_id),),
            ).fetchone()
            self.assertIsNotNone(row)
            return dict(zip(_ASSET_COLUMNS, row))
        finally:
            connection.close()

    def _two_fields(self):
        return [
            source_field("order_id", ordinal=1, nullable=False, pk=True, description="identifier"),
            source_field("amount", ordinal=2, data_type="decimal", description="金额"),
        ]

    # -- A: stable IDs on unchanged re-import ----------------------------

    def test_reimport_is_unchanged_and_preserves_field_ids_and_rows(self):
        payload = asset_payload(fields=self._two_fields())
        first = self._ingest(payload)
        asset_id = self._asset_id()
        self.assertEqual("create", first["items"][0]["status"])
        fields_before = self._field_rows(asset_id)
        asset_before = self._asset_row(asset_id)
        self.assertEqual(2, len(fields_before))

        second = self._ingest(payload)

        self.assertEqual("unchanged", second["items"][0]["status"])
        self.assertEqual(fields_before, self._field_rows(asset_id))
        self.assertEqual(asset_before, self._asset_row(asset_id))

    # -- B: unrelated asset metadata update ------------------------------

    def test_unrelated_asset_metadata_update_keeps_field_ids_and_rows(self):
        self._ingest(asset_payload(fields=self._two_fields()))
        asset_id = self._asset_id()
        fields_before = self._field_rows(asset_id)

        result = self._ingest(
            asset_payload(description="订单表（上游更新了注释）", fields=self._two_fields())
        )

        self.assertEqual("update", result["items"][0]["status"])
        self.assertEqual(fields_before, self._field_rows(asset_id))

    # -- C: portal-owned field metadata preservation ---------------------

    def test_portal_field_metadata_survives_source_technical_update(self):
        self._ingest(asset_payload(fields=self._two_fields()))
        asset_id = self._asset_id()
        order_id = self._field_id(asset_id, "order_id")
        amount = self._field_id(asset_id, "amount")

        edited = self.client.put(
            f"/api/assets/{asset_id}/fields",
            json={
                "fields": [
                    manual_field("order_id", cn="订单编号", data_type="INTEGER", nullable=False, pk=True),
                    manual_field("amount", cn="订单金额", data_type="DECIMAL", nullable=True, enum="CNY,USD"),
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

        rows = {row["field_id"]: row for row in self._active_field_rows(asset_id)}
        self.assertEqual(order_id, self._field_id(asset_id, "order_id"))
        self.assertEqual(amount, self._field_id(asset_id, "amount"))
        self.assertEqual("订单编号", rows[order_id]["field_cn_name"])
        self.assertEqual("订单金额", rows[amount]["field_cn_name"])
        self.assertEqual("CNY,USD", rows[amount]["enum_desc"])
        self.assertEqual("identifier v2", rows[order_id]["field_desc"])
        self.assertEqual("BIGINT", rows[order_id]["data_type"])

    # -- D: new field gets a new ID, existing IDs stay -------------------

    def test_new_field_receives_new_id_while_existing_ids_stay(self):
        self._ingest(asset_payload(fields=self._two_fields()))
        asset_id = self._asset_id()
        order_id = self._field_id(asset_id, "order_id")
        amount = self._field_id(asset_id, "amount")

        result = self._ingest(
            asset_payload(
                fields=[
                    *self._two_fields(),
                    source_field("status", ordinal=3, data_type="varchar(16)", description="状态"),
                ]
            )
        )

        self.assertEqual("update", result["items"][0]["status"])
        self.assertEqual(order_id, self._field_id(asset_id, "order_id"))
        self.assertEqual(amount, self._field_id(asset_id, "amount"))
        status_id = self._field_id(asset_id, "status")
        self.assertNotIn(status_id, {order_id, amount})
        self.assertEqual(3, len(self._active_field_rows(asset_id)))

    # -- E: removal is a soft delete -------------------------------------

    def test_removed_field_is_soft_deleted_and_hidden_from_reads(self):
        self._ingest(asset_payload(fields=self._two_fields()))
        asset_id = self._asset_id()
        amount = self._field_id(asset_id, "amount")

        result = self._ingest(
            asset_payload(fields=[source_field("order_id", ordinal=1, nullable=False, pk=True, description="identifier")])
        )
        self.assertEqual("update", result["items"][0]["status"])

        historical = next(row for row in self._field_rows(asset_id) if row["field_id"] == amount)
        self.assertEqual("Y", historical["is_deleted"])
        self.assertEqual(1, self._asset_row(asset_id)["field_count"])

        detail = self.client.get(f"/api/assets/{asset_id}/fields")
        self.assertEqual(200, detail.status_code, detail.text)
        self.assertEqual(["order_id"], [item["name"] for item in detail.json()["items"]])

    # -- F: delete + recreate same name never reuses the ID ---------------

    def test_delete_then_recreate_same_name_gets_new_field_id(self):
        self._ingest(asset_payload(fields=self._two_fields()))
        asset_id = self._asset_id()
        original_amount = self._field_id(asset_id, "amount")

        self._ingest(
            asset_payload(fields=[source_field("order_id", ordinal=1, nullable=False, pk=True, description="identifier")])
        )
        self.assertNotIn(
            original_amount,
            {row["field_id"] for row in self._active_field_rows(asset_id)},
        )

        self._ingest(asset_payload(fields=self._two_fields()))
        recreated = self._field_id(asset_id, "amount")
        self.assertNotEqual(original_amount, recreated)
        historical = next(row for row in self._field_rows(asset_id) if row["field_id"] == original_amount)
        self.assertEqual("Y", historical["is_deleted"])

    # -- G: indicator reference behavior ----------------------------------

    def test_indicator_reference_survives_reimport_and_reports_deleted_field(self):
        self._ingest(asset_payload(fields=self._two_fields()))
        asset_id = self._asset_id()
        amount = self._field_id(asset_id, "amount")

        resolved = self.indicators._normalize_payload(
            indicator_payload(source_asset_id=asset_id, result_field_id=amount)
        )
        self.assertEqual(asset_id, resolved["sourceAssetId"])
        self.assertEqual(amount, resolved["resultFieldId"])
        self.indicators._create_indicator(
            indicator_payload(source_asset_id=asset_id, result_field_id=amount)
        )

        # Unrelated source update must keep the reference resolvable.
        self._ingest(
            asset_payload(description="订单表（上游更新）", fields=self._two_fields())
        )
        self.assertEqual(
            amount,
            self.indicators._normalize_payload(
                indicator_payload(source_asset_id=asset_id, result_field_id=amount)
            )["resultFieldId"],
        )

        self._ingest(
            asset_payload(fields=[source_field("order_id", ordinal=1, nullable=False, pk=True, description="identifier")])
        )
        field_row = self.indicators._resolve_semantic_field(amount)
        self.assertEqual("Y", field_row["is_deleted"])
        listed = self.indicators.get_indicators()
        self.assertEqual(amount, listed[0]["resultFieldId"])
        with self.assertRaises(IndicatorValidationError) as context:
            self.indicators._normalize_payload(
                indicator_payload(source_asset_id=asset_id, result_field_id=amount)
            )
        messages = [item["message"] for item in context.exception.details]
        self.assertIn(f"result field is deleted: {amount}", messages)

        # A later same-name field must not silently absorb the old reference.
        self._ingest(asset_payload(fields=self._two_fields()))
        recreated = self._field_id(asset_id, "amount")
        self.assertNotEqual(amount, recreated)
        with self.assertRaises(IndicatorValidationError) as context:
            self.indicators._normalize_payload(
                indicator_payload(source_asset_id=asset_id, result_field_id=amount)
            )
        self.assertTrue(
            any("deleted" in item["message"] for item in context.exception.details)
        )

    # -- H: rename = soft delete + insert ---------------------------------

    def test_rename_is_soft_delete_plus_new_field_id(self):
        self._ingest(asset_payload(fields=self._two_fields()))
        asset_id = self._asset_id()
        amount = self._field_id(asset_id, "amount")

        result = self._ingest(
            asset_payload(
                fields=[
                    source_field("order_id", ordinal=1, nullable=False, pk=True, description="identifier"),
                    source_field("total_amount", ordinal=2, data_type="decimal", description="金额"),
                ]
            )
        )

        self.assertEqual("update", result["items"][0]["status"])
        renamed = self._field_id(asset_id, "total_amount")
        self.assertNotEqual(amount, renamed)
        self.assertEqual([], [row for row in self._active_field_rows(asset_id) if row["field_name"] == "amount"])
        historical = next(row for row in self._field_rows(asset_id) if row["field_id"] == amount)
        self.assertEqual("Y", historical["is_deleted"])
        self.assertEqual("amount", historical["field_name"])

    # -- I: fields absent is a NOOP ---------------------------------------

    def test_fields_absent_is_collection_noop(self):
        self._ingest(asset_payload(fields=self._two_fields()))
        asset_id = self._asset_id()
        fields_before = self._field_rows(asset_id)
        count_before = self._asset_row(asset_id)["field_count"]

        result = self._ingest(asset_payload(description="订单表 v2"))

        self.assertEqual("update", result["items"][0]["status"])
        self.assertEqual(fields_before, self._field_rows(asset_id))
        self.assertEqual(count_before, self._asset_row(asset_id)["field_count"])

    # -- J: fields [] clears the collection -------------------------------

    def test_empty_fields_collection_soft_deletes_all_active_fields(self):
        self._ingest(asset_payload(fields=self._two_fields()))
        asset_id = self._asset_id()

        result = self._ingest(asset_payload(description="订单表 v2", fields=[]))

        self.assertEqual("update", result["items"][0]["status"])
        self.assertEqual([], self._active_field_rows(asset_id))
        self.assertTrue(all(row["is_deleted"] == "Y" for row in self._field_rows(asset_id)))
        self.assertEqual(0, self._asset_row(asset_id)["field_count"])

    # -- K: case-insensitive conflict -------------------------------------

    def test_case_insensitive_duplicate_fields_are_rejected(self):
        with self.assertRaises(MetadataValidationError) as context:
            self._ingest(
                asset_payload(
                    fields=[
                        source_field("Foo", ordinal=1),
                        source_field("foo", ordinal=2),
                    ]
                )
            )
        self.assertIn("INVALID_DUPLICATE_FIELD", str(context.exception.details))
        self.assertEqual([], self._all_assets())
        self.assertEqual([], self._all_fields())

    def _all_assets(self):
        connection = self._connect()
        try:
            return connection.execute("SELECT asset_id FROM dwp.p_asset_table").fetchall()
        finally:
            connection.close()

    def _all_fields(self):
        connection = self._connect()
        try:
            return connection.execute("SELECT field_id FROM dwp.p_asset_field").fetchall()
        finally:
            connection.close()

    # -- L: array order must not reorder existing fields ------------------

    def test_array_reorder_does_not_reorder_or_update_existing_fields(self):
        self._ingest(asset_payload(fields=self._two_fields()))
        asset_id = self._asset_id()
        fields_before = self._field_rows(asset_id)

        reversed_fields = [
            source_field("amount", data_type="decimal", description="金额"),
            source_field("order_id", nullable=False, pk=True, description="identifier"),
        ]
        result = self._ingest(
            asset_payload(description="订单表 v2", fields=reversed_fields)
        )

        self.assertEqual("update", result["items"][0]["status"])
        self.assertEqual(fields_before, self._field_rows(asset_id))

    # -- case-only field name change keeps identity -----------------------

    def test_case_only_field_name_change_keeps_field_identity(self):
        self._ingest(asset_payload(fields=self._two_fields()))
        asset_id = self._asset_id()
        amount = self._field_id(asset_id, "amount")

        result = self._ingest(
            asset_payload(
                fields=[
                    source_field("order_id", ordinal=1, nullable=False, pk=True, description="identifier"),
                    source_field("AMOUNT", ordinal=2, data_type="decimal", description="金额"),
                ]
            )
        )

        self.assertEqual("update", result["items"][0]["status"])
        self.assertEqual(amount, self._field_id(asset_id, "AMOUNT"))

    # -- description presence semantics -----------------------------------

    def test_field_description_presence_semantics(self):
        self._ingest(
            asset_payload(
                fields=[source_field("order_id", ordinal=1, nullable=False, pk=True, description="identifier")]
            )
        )
        asset_id = self._asset_id()
        field_id = self._field_id(asset_id, "order_id")

        # absent -> preserve the stored source-owned description
        self._ingest(
            asset_payload(
                description="v2",
                fields=[source_field("order_id", ordinal=1, nullable=False, pk=True)],
            )
        )
        row = next(item for item in self._active_field_rows(asset_id) if item["field_id"] == field_id)
        self.assertEqual("identifier", row["field_desc"])
        self.assertEqual(field_id, self._field_id(asset_id, "order_id"))

        # explicit null -> clear; portal-owned cn fallback stays available
        self._ingest(
            asset_payload(
                description="v3",
                fields=[
                    source_field(
                        "order_id", ordinal=1, nullable=False, pk=True, description=None
                    )
                ],
            )
        )
        row = next(item for item in self._active_field_rows(asset_id) if item["field_id"] == field_id)
        self.assertIsNone(row["field_desc"])
        self.assertEqual("identifier", row["field_cn_name"])
        self.assertEqual(field_id, self._field_id(asset_id, "order_id"))

        # whitespace-only -> explicit clear; non-empty -> stripped write
        self._ingest(
            asset_payload(
                description="v4",
                fields=[
                    source_field(
                        "order_id", ordinal=1, nullable=False, pk=True, description="   "
                    )
                ],
            )
        )
        self._ingest(
            asset_payload(
                description="v5",
                fields=[
                    source_field(
                        "order_id", ordinal=1, nullable=False, pk=True, description="  identifier v5  "
                    )
                ],
            )
        )
        row = next(item for item in self._active_field_rows(asset_id) if item["field_id"] == field_id)
        self.assertEqual("identifier v5", row["field_desc"])

    # -- ordinalPosition presence semantics -------------------------------

    def test_absent_ordinal_preserves_existing_order_and_appends_new_fields(self):
        self._ingest(
            asset_payload(
                fields=[
                    source_field("order_id", ordinal=5, nullable=False, pk=True, description="identifier"),
                    source_field("amount", ordinal=9, data_type="decimal", description="金额"),
                ]
            )
        )
        asset_id = self._asset_id()

        # Existing fields without ordinalPosition keep their stored order.
        self._ingest(
            asset_payload(
                description="v2",
                fields=[
                    source_field("order_id", nullable=False, pk=True, description="identifier"),
                    source_field("amount", data_type="decimal", description="金额"),
                ],
            )
        )
        orders = {row["field_name"]: row["field_order"] for row in self._active_field_rows(asset_id)}
        self.assertEqual({"order_id": 5, "amount": 9}, orders)

        # A new field without ordinalPosition appends after the current max.
        self._ingest(
            asset_payload(
                description="v3",
                fields=[
                    source_field("order_id", nullable=False, pk=True, description="identifier"),
                    source_field("amount", data_type="decimal", description="金额"),
                    source_field("status", data_type="varchar(16)", description="状态"),
                ],
            )
        )
        orders = {row["field_name"]: row["field_order"] for row in self._active_field_rows(asset_id)}
        self.assertEqual({"order_id": 5, "amount": 9, "status": 10}, orders)

    # -- M: manual portal-only edits preserve IDs -------------------------

    def test_manual_portal_only_edit_preserves_ids_and_soft_deletes_removed(self):
        created = self.client.post(
            "/api/assets/tables",
            json={
                "name": "manual_orders",
                "cn": "人工订单表",
                "domain": "交易",
                "layer": "DWD",
                "owner": "owner",
                "grain": "一行订单",
                "cycle": "每日",
                "desc": "人工创建",
                "fields": [
                    manual_field("order_id", cn="订单编号", nullable=False, pk=True),
                    manual_field("amount", cn="金额", data_type="decimal"),
                ],
            },
        )
        self.assertEqual(201, created.status_code, created.text)
        asset_id = self._portal_asset_id("manual_orders")
        order_id = self._field_id(asset_id, "order_id")
        amount = self._field_id(asset_id, "amount")

        updated = self.client.put(
            f"/api/assets/{asset_id}/fields",
            json={
                "fields": [
                    manual_field("order_id", cn="订单主键", nullable=False, pk=True),
                    manual_field("amount", cn="金额", data_type="decimal"),
                ]
            },
        )
        self.assertEqual(200, updated.status_code, updated.text)
        self.assertEqual(order_id, self._field_id(asset_id, "order_id"))
        self.assertEqual(amount, self._field_id(asset_id, "amount"))
        rows = {row["field_id"]: row for row in self._active_field_rows(asset_id)}
        self.assertEqual("订单主键", rows[order_id]["field_cn_name"])

        replaced = self.client.put(
            f"/api/assets/{asset_id}/fields",
            json={
                "fields": [
                    manual_field("order_id", cn="订单主键", nullable=False, pk=True),
                    manual_field("status", cn="状态", data_type="varchar(16)"),
                ]
            },
        )
        self.assertEqual(200, replaced.status_code, replaced.text)
        self.assertEqual(order_id, self._field_id(asset_id, "order_id"))
        historical = next(row for row in self._field_rows(asset_id) if row["field_id"] == amount)
        self.assertEqual("Y", historical["is_deleted"])
        status_id = self._field_id(asset_id, "status")
        self.assertNotIn(status_id, {order_id, amount})
        self.assertEqual(2, self._asset_row(asset_id)["field_count"])

    # -- N: source-bound manual technical mutation is rejected ------------

    def test_source_bound_manual_technical_mutation_is_rejected(self):
        self._ingest(asset_payload(fields=self._two_fields()))
        asset_id = self._asset_id()
        fields_before = self._field_rows(asset_id)

        def put(fields):
            return self.client.put(f"/api/assets/{asset_id}/fields", json={"fields": fields})

        rejected = put(
            [
                manual_field("order_id", cn="订单编号", data_type="bigint", nullable=False, pk=True),
                manual_field("amount", cn="金额", data_type="decimal"),
            ]
        )
        self.assertEqual(422, rejected.status_code, rejected.text)
        self.assertEqual("SOURCE_OWNED_ATTRIBUTE", rejected.json()["error"]["code"])
        self.assertEqual(fields_before, self._field_rows(asset_id))

        added = put(
            [
                manual_field("order_id", cn="订单编号", data_type="INTEGER", nullable=False, pk=True),
                manual_field("amount", cn="金额", data_type="DECIMAL"),
                manual_field("status", cn="状态", data_type="VARCHAR(16)"),
            ]
        )
        self.assertEqual(422, added.status_code, added.text)
        self.assertEqual("SOURCE_OWNED_ATTRIBUTE", added.json()["error"]["code"])

        removed = put(
            [
                manual_field("order_id", cn="订单编号", data_type="INTEGER", nullable=False, pk=True),
            ]
        )
        self.assertEqual(422, removed.status_code, removed.text)
        self.assertEqual("SOURCE_OWNED_ATTRIBUTE", removed.json()["error"]["code"])

        renamed = put(
            [
                manual_field("order_key", cn="订单编号", data_type="INTEGER", nullable=False, pk=True),
                manual_field("amount", cn="金额", data_type="DECIMAL"),
            ]
        )
        self.assertEqual(422, renamed.status_code, renamed.text)
        self.assertEqual("SOURCE_OWNED_ATTRIBUTE", renamed.json()["error"]["code"])

        # Portal-owned columns remain editable; the field rows are unchanged.
        allowed = put(
            [
                manual_field("order_id", cn="订单编号", data_type="INTEGER", nullable=False, pk=True),
                manual_field("amount", cn="金额", data_type="DECIMAL", enum="CNY"),
            ]
        )
        self.assertEqual(200, allowed.status_code, allowed.text)
        rows = {row["field_id"]: row for row in self._active_field_rows(asset_id)}
        amount_id = self._field_id(asset_id, "amount")
        self.assertEqual("金额", rows[amount_id]["field_cn_name"])
        self.assertEqual("CNY", rows[amount_id]["enum_desc"])
        self.assertEqual("NUMERIC(18,2)", rows[amount_id]["data_type"])

    # -- manual case-insensitive duplicate rejection ----------------------

    def test_manual_case_insensitive_duplicate_fields_are_rejected(self):
        self._ingest(asset_payload(fields=self._two_fields()))
        asset_id = self._asset_id()

        response = self.client.put(
            f"/api/assets/{asset_id}/fields",
            json={
                "fields": [
                    manual_field("Order_ID", cn="A", data_type="INTEGER", nullable=False, pk=True),
                    manual_field("order_id", cn="B", data_type="INTEGER", nullable=False, pk=True),
                ]
            },
        )

        self.assertEqual(422, response.status_code, response.text)
        self.assertEqual("ASSET_VALIDATION_FAILED", response.json()["error"]["code"])


if __name__ == "__main__":
    unittest.main()
