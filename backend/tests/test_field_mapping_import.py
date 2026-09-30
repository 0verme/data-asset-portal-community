from __future__ import annotations

# pyright: reportMissingImports=false

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

from backend.app.contracts import FieldMappingImportRequest
from backend.app.db.facade import clear_engine_cache
from backend.app.db.sqlite_adapter import connect
from backend.app.migrations.schema import initialize
from backend.app.services.field_mapping_service import FieldMappingService


class FieldMappingImportContractTests(unittest.TestCase):
    def _valid_item(self) -> dict:
        return {
            "dataSourceId": 1,
            "sourceTable": "ORDERS",
            "targetTable": "DWF_ORDERS",
            "fields": [{"sourceField": "ORDER_ID", "fieldOrder": 1}],
        }

    def test_contract_accepts_camel_case_and_rejects_empty_or_duplicate_fields(self):
        request = FieldMappingImportRequest.model_validate(
            {"items": [self._valid_item()]}
        )
        self.assertEqual("upsert", request.mode)
        self.assertEqual(1, request.items[0].data_source_id)

        canonical_item = self._valid_item()
        canonical_item.pop("dataSourceId")
        canonical_item["sourceSystemId"] = 101
        canonical = FieldMappingImportRequest.model_validate(
            {"items": [canonical_item]}
        )
        self.assertEqual(101, canonical.items[0].source_system_id)
        self.assertIsNone(canonical.items[0].data_source_id)
        with_table_pk = FieldMappingImportRequest.model_validate(
            {
                "items": [
                    {
                        **canonical_item,
                        "tablePk": 201,
                    }
                ]
            }
        )
        self.assertEqual(201, with_table_pk.items[0].table_pk)

        with self.assertRaises(ValidationError):
            FieldMappingImportRequest.model_validate({"items": []})
        with self.assertRaises(ValidationError):
            FieldMappingImportRequest.model_validate(
                {
                    "items": [
                        {
                            **self._valid_item(),
                            "fields": [
                                {"sourceField": "ORDER_ID", "fieldOrder": 1},
                                {"sourceField": "ORDER_ID", "fieldOrder": 2},
                            ],
                        }
                    ]
                }
            )

    def test_contract_rejects_invalid_field_and_batch_size(self):
        with self.assertRaises(ValidationError):
            FieldMappingImportRequest.model_validate(
                {
                    "items": [
                        {
                            **self._valid_item(),
                            "fields": [{"sourceField": "", "fieldOrder": 1}],
                        }
                    ]
                }
            )
        with self.assertRaises(ValidationError):
            FieldMappingImportRequest.model_validate(
                {"items": [self._valid_item()] * 501}
            )


class FieldMappingImportServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="field-mapping-import-")
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        self.database = root / "field-mapping.sqlite"
        self.config = root / "database.yaml"
        self.config.write_text(
            "profiles:\n"
            "  test:\n"
            "    type: sqlite\n"
            f"    database: {json.dumps(str(self.database))}\n",
            encoding="utf-8",
        )
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(self.config),
                "ASSET_DB_PROFILE": "test",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.connection = connect({"type": "sqlite", "database": str(self.database)})
        self.addCleanup(self.connection.close)
        initialize(
            self.connection,
            {"type": "sqlite", "database": str(self.database)},
            "sqlite",
        )
        self.connection.execute(
            "INSERT INTO dwp.p_data_source "
            "(source_id, source_code, source_name, source_type, status_code, is_deleted, created_by, updated_by) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (1, "SRC", "Source", "relational", "enabled", "N", "seed", "seed"),
        )
        self.connection.execute(
            "INSERT INTO dwp.p_data_source "
            "(source_id, source_code, source_name, source_type, status_code, is_deleted, created_by, updated_by) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (2, "DISABLED", "Disabled", "relational", "disabled", "N", "seed", "seed"),
        )
        self.connection.execute(
            "INSERT INTO dwp.p_upstream_system "
            "(system_pk, data_source_id, system_id, system_abbr, system_name, db_type, host_name, status_code, is_deleted, created_by, updated_by) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                101,
                1,
                "up_source",
                "SRC",
                "Source",
                "SQLite",
                "source.demo.invalid",
                "enabled",
                "N",
                "seed",
                "seed",
            ),
        )
        self.connection.commit()
        clear_engine_cache()
        self.addCleanup(clear_engine_cache)
        self.service = FieldMappingService(db_profile="test")

    @staticmethod
    def _field(name: str, *, comment: str = "comment", order: int = 1) -> dict:
        return {
            "sourceField": name,
            "sourceType": "VARCHAR(40)",
            "sourceComment": comment,
            "targetField": name,
            "mappingRule": "直接映射",
            "fieldOrder": order,
        }

    def _request(
        self,
        fields=None,
        *,
        data_source_id: int | None = 1,
        source_system_id: int | None = None,
        source_table: str = "ORDERS",
        target_layer: str = "DWF",
        target_table: str | None = "DWF_ORDERS",
        load_mode: str | None = "full",
        table_pk: int | None = None,
    ):
        item = {
            "dataSourceId": data_source_id,
            "sourceTable": source_table,
            "sourceTableCn": "订单",
            "targetLayer": target_layer,
            "targetTable": target_table,
            "loadMode": load_mode,
            "tableDesc": "订单映射",
            "fields": fields or [self._field("ORDER_ID")],
        }
        if table_pk is not None:
            item["tablePk"] = table_pk
        if source_system_id is not None:
            item.pop("dataSourceId")
            item["sourceSystemId"] = source_system_id
        return FieldMappingImportRequest.model_validate({"items": [item]})

    def _count(self, table: str) -> int:
        statements = {
            "p_field_mapping_table": "SELECT COUNT(*) FROM dwp.p_field_mapping_table",
            "p_field_mapping_field": "SELECT COUNT(*) FROM dwp.p_field_mapping_field",
            "p_operation_log": "SELECT COUNT(*) FROM dwp.p_operation_log",
        }
        return self.connection.execute(statements[table]).fetchone()[0]

    def test_create_update_unchanged_and_replay_are_idempotent(self):
        request = self._request()

        created = self.service.import_mappings(request)
        self.assertEqual("created", created["items"][0]["action"])
        self.assertEqual(1, created["summary"]["created"])
        self.assertEqual(1, created["summary"]["createdFieldCount"])
        self.assertEqual(1, self._count("p_field_mapping_table"))
        self.assertEqual(1, self._count("p_field_mapping_field"))

        unchanged = self.service.import_mappings(request)
        self.assertEqual("unchanged", unchanged["items"][0]["action"])
        self.assertEqual(1, unchanged["summary"]["unchanged"])
        self.assertEqual(1, unchanged["summary"]["unchangedFieldCount"])
        self.assertEqual(1, self._count("p_field_mapping_table"))
        self.assertEqual(1, self._count("p_field_mapping_field"))

        changed = self._request(fields=[self._field("ORDER_ID", comment="updated")])
        updated = self.service.import_mappings(changed)
        self.assertEqual("updated", updated["items"][0]["action"])
        self.assertEqual(1, updated["summary"]["updated"])
        self.assertEqual(1, updated["summary"]["updatedFieldCount"])
        self.assertEqual(
            ("updated",),
            self.connection.execute(
                "SELECT source_field_comment FROM dwp.p_field_mapping_field"
            ).fetchone(),
        )

    def test_same_upstream_source_can_map_to_multiple_targets(self):
        self.connection.execute(
            "INSERT INTO p_upstream_system "
            "(system_pk, data_source_id, system_id, system_abbr, system_name, "
            "db_type, host_name, status_code) "
            "VALUES (166, NULL, 'up_finance', 'FIN', 'Finance', 'DWS', "
            "'finance.demo.invalid', 'enabled')"
        )
        self.connection.commit()
        first = self._request(
            source_system_id=166,
            source_table="EXTR_FINANCE_BOOK",
            target_table="DWF.F_AGT_EXTR_FINANCE_BOOK",
            load_mode="incr_zip",
        ).items[0]
        second = self._request(
            source_system_id=166,
            source_table="EXTR_FINANCE_BOOK",
            target_table="DWF.F_EVT_EXTR_FINANCE_BOOK",
            load_mode="incr",
        ).items[0]

        created = self.service.import_mappings(FieldMappingImportRequest(items=[first, second]))

        self.assertEqual(2, created["summary"]["created"])
        self.assertEqual(
            [
                ("DWF.F_AGT_EXTR_FINANCE_BOOK", "incr_zip"),
                ("DWF.F_EVT_EXTR_FINANCE_BOOK", "incr"),
            ],
            self.connection.execute(
                "SELECT target_table_name, load_mode FROM p_field_mapping_table "
                "WHERE upstream_system_id = 166 AND source_table_name = 'EXTR_FINANCE_BOOK' "
                "ORDER BY target_table_name"
            ).fetchall(),
        )
        replay = self.service.import_mappings(
            FieldMappingImportRequest(items=[first])
        )
        self.assertEqual("unchanged", replay["items"][0]["action"])
        self.assertEqual(2, self._count("p_field_mapping_table"))
        table_page = self.service.get_table_mappings({"sourceSystemId": 166})
        self.assertEqual(2, table_page["total"])
        self.assertEqual(
            {
                "DWF.F_AGT_EXTR_FINANCE_BOOK",
                "DWF.F_EVT_EXTR_FINANCE_BOOK",
            },
            {item["targetTable"] for item in table_page["items"]},
        )

    def test_load_mode_is_part_of_mapping_business_identity(self):
        first = self._request(
            source_table="ORDERS",
            target_table="DWF.ORDERS",
            load_mode="incr",
        ).items[0]
        second = self._request(
            source_table="ORDERS",
            target_table="DWF.ORDERS",
            load_mode="full",
        ).items[0]

        result = self.service.import_mappings(FieldMappingImportRequest(items=[first, second]))

        self.assertEqual(2, result["summary"]["created"])
        self.assertEqual(
            [("DWF.ORDERS", "full"), ("DWF.ORDERS", "incr")],
            self.connection.execute(
                "SELECT target_table_name, load_mode FROM p_field_mapping_table "
                "WHERE upstream_system_id = 101 AND source_table_name = 'ORDERS' "
                "ORDER BY load_mode"
            ).fetchall(),
        )

    def test_duplicate_existing_business_identity_is_rejected_without_choosing_a_row(self):
        request = self._request()
        self.service.import_mappings(request)
        self.connection.execute(
            "INSERT INTO p_field_mapping_table "
            "(table_pk, upstream_system_id, data_source_id, source_table_name, target_layer_code, "
            "target_table_name, load_mode) VALUES (999, 101, 1, 'ORDERS', 'DWF', 'DWF_ORDERS', 'full')"
        )
        self.connection.execute(
            "INSERT INTO p_field_mapping_field "
            "(field_pk, table_pk, source_field_name, source_field_type, source_field_comment, "
            "target_field_name, mapping_rule, field_order) "
            "SELECT 999, 999, source_field_name, source_field_type, source_field_comment, "
            "target_field_name, mapping_rule, field_order FROM p_field_mapping_field LIMIT 1"
        )
        self.connection.commit()

        result = self.service.import_mappings(request)

        self.assertEqual("failed", result["items"][0]["action"])
        self.assertEqual(
            "DUPLICATE_MAPPING_IDENTITY", result["items"][0]["error"]["code"]
        )
        self.assertEqual(2, self._count("p_field_mapping_table"))
        table_page = self.service.get_table_mappings({"sourceSystemId": 101})
        self.assertEqual(2, table_page["total"])
        self.assertEqual(2, len(table_page["items"]))
        self.assertEqual(
            2, len({item["tablePk"] for item in table_page["items"]})
        )

    def test_duplicate_identity_with_nullable_target_fields_is_rejected(self):
        request = self._request(target_table=None, load_mode=None)
        created = self.service.import_mappings(request)
        self.assertEqual("created", created["items"][0]["action"])
        self.connection.execute(
            "INSERT INTO p_field_mapping_table "
            "(table_pk, upstream_system_id, data_source_id, source_table_name, target_layer_code, "
            "target_table_name, load_mode) VALUES (999, 101, 1, 'ORDERS', 'DWF', NULL, NULL)"
        )
        self.connection.commit()

        result = self.service.import_mappings(request)

        self.assertEqual("failed", result["items"][0]["action"])
        self.assertEqual(
            "DUPLICATE_MAPPING_IDENTITY", result["items"][0]["error"]["code"]
        )
        self.assertEqual(2, self._count("p_field_mapping_table"))

    def test_different_source_and_upstream_systems_have_independent_identities(self):
        self.connection.execute(
            "INSERT INTO p_upstream_system "
            "(system_pk, data_source_id, system_id, system_abbr, system_name, "
            "db_type, host_name, status_code) "
            "VALUES (102, NULL, 'up_source_alt', 'SRC_ALT', 'Source Alt', 'SQLite', "
            "'alt.demo.invalid', 'enabled')"
        )
        self.connection.commit()
        requests = [
            self._request(source_table="ORDERS").items[0],
            self._request(source_table="CUSTOMERS").items[0],
            self._request(source_system_id=102, source_table="ORDERS").items[0],
        ]

        result = self.service.import_mappings(FieldMappingImportRequest(items=requests))

        self.assertEqual(3, result["summary"]["created"])
        identities = self.connection.execute(
            "SELECT upstream_system_id, source_table_name "
            "FROM p_field_mapping_table ORDER BY upstream_system_id, source_table_name"
        ).fetchall()
        self.assertEqual([(101, "CUSTOMERS"), (101, "ORDERS"), (102, "ORDERS")], identities)

    def test_table_pk_updates_the_exact_mapping_entity(self):
        created = self.service.import_mappings(self._request())
        table_pk = created["items"][0]["identity"]["tablePk"]

        updated = self.service.import_mappings(
            self._request(
                table_pk=table_pk,
                fields=[self._field("ORDER_ID", comment="updated by pk")],
            )
        )

        self.assertEqual("updated", updated["items"][0]["action"])
        self.assertEqual(table_pk, updated["items"][0]["identity"]["tablePk"])
        self.assertEqual(
            [(table_pk, "updated by pk")],
            self.connection.execute(
                "SELECT t.table_pk, f.source_field_comment "
                "FROM p_field_mapping_table t JOIN p_field_mapping_field f USING (table_pk)"
            ).fetchall(),
        )

    def test_canonical_source_system_id_is_persisted_as_mapping_identity(self):
        result = self.service.import_mappings(self._request(source_system_id=101))

        self.assertEqual("created", result["items"][0]["action"])
        self.assertEqual(101, result["items"][0]["identity"]["sourceSystemId"])
        self.assertEqual(
            (101, 1),
            self.connection.execute(
                "SELECT upstream_system_id, data_source_id "
                "FROM dwp.p_field_mapping_table"
            ).fetchone(),
        )

    def test_omitted_existing_fields_are_preserved(self):
        initial = self._request(
            fields=[self._field("ORDER_ID"), self._field("CUSTOMER_ID", order=2)]
        )
        self.service.import_mappings(initial)

        partial = self._request(fields=[self._field("ORDER_ID", comment="changed")])
        result = self.service.import_mappings(partial)

        self.assertEqual("updated", result["items"][0]["action"])
        self.assertEqual(2, result["items"][0]["fieldCount"])
        self.assertEqual(2, self._count("p_field_mapping_field"))
        self.assertEqual(
            ("CUSTOMER_ID",),
            self.connection.execute(
                "SELECT source_field_name FROM dwp.p_field_mapping_field "
                "WHERE source_field_name = 'CUSTOMER_ID' AND is_deleted = 'N'"
            ).fetchone(),
        )

    def test_dry_run_has_zero_writes_and_real_replay_still_creates(self):
        self.service._stats_cache["cached"] = {"value": 1}
        preview = self.service.import_mappings(
            self._request().model_copy(update={"dry_run": True})
        )

        self.assertTrue(preview["dryRun"])
        self.assertEqual("created", preview["items"][0]["action"])
        self.assertEqual(0, self._count("p_field_mapping_table"))
        self.assertEqual(0, self._count("p_field_mapping_field"))
        self.assertEqual(0, self._count("p_operation_log"))
        self.assertIn("cached", self.service._stats_cache)

        created = self.service.import_mappings(self._request())
        self.assertEqual("created", created["items"][0]["action"])
        self.assertEqual({}, self.service._stats_cache)

    def test_invalid_item_is_reported_and_other_items_commit(self):
        valid = self._request().items[0]
        invalid = self._request(data_source_id=999).items[0]
        result = self.service.import_mappings(
            FieldMappingImportRequest(items=[invalid, valid])
        )

        self.assertEqual(1, result["summary"]["failed"])
        self.assertEqual("failed", result["items"][0]["action"])
        self.assertEqual("DATA_SOURCE_NOT_FOUND", result["items"][0]["error"]["code"])
        self.assertEqual("created", result["items"][1]["action"])
        self.assertEqual(1, self._count("p_field_mapping_table"))

    def test_failed_item_rolls_back_and_batch_continues(self):
        first = self._request().items[0]
        second = self._request(source_table="CUSTOMERS").items[0]
        original_execute = self.service._db.execute
        calls = 0

        def fail_on_first_field(statement):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError("field write failed")
            return original_execute(statement)

        with patch.object(self.service._db, "execute", side_effect=fail_on_first_field):
            result = self.service.import_mappings(
                FieldMappingImportRequest(items=[first, second])
            )

        self.assertEqual("failed", result["items"][0]["action"])
        self.assertEqual("IMPORT_FAILED", result["items"][0]["error"]["code"])
        self.assertEqual("created", result["items"][1]["action"])
        self.assertEqual(1, self._count("p_field_mapping_table"))
        self.assertEqual(1, self._count("p_field_mapping_field"))

    def test_successful_import_writes_required_operation_audit(self):
        self.service.import_mappings(self._request())

        row = self.connection.execute(
            "SELECT module_name, operation_type, result_status "
            "FROM dwp.p_operation_log ORDER BY id DESC LIMIT 1"
        ).fetchone()
        self.assertEqual(("字段映射", "导入", "success"), row)

    def test_unchanged_import_does_not_write_operation_audit(self):
        request = self._request()
        self.service.import_mappings(request)
        audit_count_after_create = self._count("p_operation_log")

        self.service.import_mappings(request)

        self.assertEqual(1, audit_count_after_create)
        self.assertEqual(audit_count_after_create, self._count("p_operation_log"))


if __name__ == "__main__":
    unittest.main()
