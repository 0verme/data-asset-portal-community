from __future__ import annotations

# pyright: reportMissingImports=false
import inspect
import unittest
from typing import Any, cast
from unittest.mock import MagicMock, patch

from backend.scripts import imp_dws_comments
from backend.scripts.imp_dws_comments import (
    FieldMappingApiClient,
    FieldMappingApiError,
    FieldMappingRow,
    TableMappingRow,
    build_import_payload,
    execute_import,
    extract_insert_select_mapping,
    load_upstream_system_map,
)


def _table_row(name: str) -> TableMappingRow:
    return TableMappingRow(
        upstream_system_id=1,
        file_path=f"{name}.py",
        source_table=f"SRC_{name.upper()}",
        source_table_name=f"SRC_{name.upper()}",
        source_table_cn=name,
        target_table_name=f"DWF_{name.upper()}",
        load_mode="full",
        table_desc=name,
        fields=[FieldMappingRow("source", "target", 1, "direct")],
        source_columns={"source": {"type": "VARCHAR", "comment": "源字段"}},
    )


class DwsCommentImportApiTests(unittest.TestCase):
    def test_parser_retains_existing_insert_select_mapping_behavior(self):
        fields = extract_insert_select_mapping(
            """
            INSERT INTO DWF_ORDERS (ORDER_ID, ORDER_DATE)
            SELECT SRC.ORDER_ID, TO_DATE(SRC.ORDER_DT, 'YYYY-MM-DD') -- 订单日期
            FROM ODS.ORDERS SRC
            """
        )

        self.assertEqual(
            ["ORDER_ID", "ORDER_DATE"], [field.target_field_name for field in fields]
        )
        self.assertEqual("ORDER_ID", fields[0].source_field_name)
        self.assertEqual("日期格式化", fields[1].mapping_rule)

    def test_source_metadata_resolves_unique_upstream_id(self):
        with patch(
            "backend.scripts.imp_dws_comments.fetch_all",
            return_value=(
                ["system_pk", "system_abbr", "system_id"],
                [(17, "MEM", "up_member")],
            ),
        ) as fetch:
            mapping = load_upstream_system_map("source-profile")

        self.assertEqual(17, mapping["MEM"])
        self.assertEqual(17, mapping["UP_MEMBER"])
        self.assertIn("system_pk,", fetch.call_args.args[1])
        self.assertNotIn("data_source_id", fetch.call_args.args[1])

    def test_source_metadata_omits_ambiguous_abbreviations(self):
        with patch(
            "backend.scripts.imp_dws_comments.fetch_all",
            return_value=(
                ["system_pk", "system_abbr", "system_id"],
                [(17, "MEM", "up_member"), (18, "MEM", "up_member_test")],
            ),
        ):
            mapping = load_upstream_system_map("source-profile")

        self.assertNotIn("MEM", mapping)
        self.assertEqual(17, mapping["UP_MEMBER"])
        self.assertEqual(18, mapping["UP_MEMBER_TEST"])

    def test_payload_uses_the_public_import_contract(self):
        payload = build_import_payload([_table_row("good_one")], dry_run=True)

        self.assertEqual(
            {"mode": "upsert", "dryRun": True},
            {
                "mode": payload["mode"],
                "dryRun": payload["dryRun"],
            },
        )
        items = cast(list[dict[str, Any]], payload["items"])
        self.assertEqual(1, len(items))
        item = items[0]
        fields = cast(list[dict[str, Any]], item["fields"])
        self.assertEqual(1, item["sourceSystemId"])
        self.assertEqual("SRC_GOOD_ONE", item["sourceTable"])
        self.assertEqual("源字段", fields[0]["sourceComment"])
        self.assertNotIn("table_pk", item)
        self.assertNotIn("field_pk", item["fields"][0])

    def test_client_posts_to_import_endpoint(self):
        transport = MagicMock()
        transport.headers = {}
        response = MagicMock(status_code=200)
        response.json.return_value = {
            "mode": "upsert",
            "dryRun": False,
            "summary": {
                "received": 1,
                "created": 1,
                "updated": 0,
                "unchanged": 0,
                "failed": 0,
                "fieldCount": 1,
            },
            "items": [],
        }
        transport.post.return_value = response
        payload = build_import_payload([_table_row("good_one")])

        api = FieldMappingApiClient("https://portal.example.test", client=transport)
        self.assertEqual(response.json.return_value, api.import_mappings(payload))

        transport.post.assert_called_once_with(
            "/api/field-mappings/import", json=payload
        )
        self.assertEqual("application/json", transport.headers["Content-Type"])

    def test_execute_import_sends_bounded_batches_and_aggregates(self):
        api = MagicMock()
        api.import_mappings.side_effect = [
            {
                "summary": {
                    "received": 1,
                    "created": 1,
                    "updated": 0,
                    "unchanged": 0,
                    "failed": 0,
                    "fieldCount": 1,
                }
            },
            {
                "summary": {
                    "received": 1,
                    "created": 0,
                    "updated": 1,
                    "unchanged": 0,
                    "failed": 0,
                    "fieldCount": 2,
                }
            },
        ]

        summary = execute_import(
            api,
            [_table_row("one"), _table_row("two")],
            batch_size=1,
        )

        self.assertEqual(
            {
                "received": 2,
                "created": 1,
                "updated": 1,
                "unchanged": 0,
                "failed": 0,
                "fieldCount": 3,
            },
            summary,
        )
        self.assertEqual(2, api.import_mappings.call_count)

    def test_client_turns_http_errors_into_safe_cli_errors(self):
        transport = MagicMock()
        response = MagicMock(status_code=403)
        response.json.return_value = {
            "error": {"code": "FORBIDDEN", "message": "无权限执行此操作。"}
        }
        transport.post.return_value = response

        with self.assertRaisesRegex(FieldMappingApiError, "HTTP 403"):
            FieldMappingApiClient(
                "https://portal.example.test", client=transport
            ).import_mappings({})

    def test_script_contains_no_portal_mapping_write_path(self):
        source = inspect.getsource(imp_dws_comments)

        self.assertNotIn("connect_with_profile", source)
        self.assertNotIn("TRUNCATE TABLE", source)
        self.assertNotIn("INSERT INTO dwp.p_field_mapping_table", source)
        self.assertNotIn("INSERT INTO dwp.p_field_mapping_field", source)
        self.assertIn("/api/field-mappings/import", source)


if __name__ == "__main__":
    unittest.main()
