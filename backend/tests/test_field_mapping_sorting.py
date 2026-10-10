from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app.db.sqlite_adapter import connect
from backend.app.fastapi_app import create_fastapi_app
from backend.app.migrations.schema import initialize
from backend.app.services.field_mapping_service import (
    FIELD_SORT_COLUMNS,
    FieldMappingService,
)

SORT_FIXTURES = (
    {
        "source_id": 1,
        "system_id": 101,
        "table_pk": 201,
        "field_pk": 301,
        "system_abbr": "SYS_Z",
        "srcSystem": "System-Z",
        "srcTable": "table-B",
        "srcField": "field-C",
        "srcType": "type-B",
        "srcComment": "comment-A",
        "targetTable": "target-C",
        "targetField": "target-B",
        "mappingRule": "rule-C",
    },
    {
        "source_id": 2,
        "system_id": 102,
        "table_pk": 202,
        "field_pk": 302,
        "system_abbr": "SYS_A",
        "srcSystem": "System-A",
        "srcTable": "table-C",
        "srcField": "field-A",
        "srcType": "type-C",
        "srcComment": "comment-C",
        "targetTable": "target-A",
        "targetField": "target-C",
        "mappingRule": "rule-B",
    },
    {
        "source_id": 3,
        "system_id": 103,
        "table_pk": 203,
        "field_pk": 303,
        "system_abbr": "SYS_M",
        "srcSystem": "System-M",
        "srcTable": "table-A",
        "srcField": "field-B",
        "srcType": "type-A",
        "srcComment": "comment-B",
        "targetTable": "target-B",
        "targetField": "target-A",
        "mappingRule": "rule-A",
    },
)


class FieldMappingSortingTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="field-mapping-sort-")
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        self.database = root / "mapping.sqlite"
        self.config = root / "database.yaml"
        self.config.write_text(
            "profiles:\n  sorting:\n    type: sqlite\n"
            f"    database: {self.database.as_posix()}\n",
            encoding="utf-8",
        )
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(self.config),
                "ASSET_DB_PROFILE": "sorting",
                "APP_SECRET_KEY": "field-mapping-sort-test-only",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)

        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            self.assertTrue(
                initialize(
                    connection,
                    {"type": "sqlite", "database": str(self.database)},
                    "sqlite",
                )
            )
            for fixture in SORT_FIXTURES:
                self._insert_mapping(
                    connection,
                    source_id=fixture["source_id"],
                    system_id=fixture["system_id"],
                    table_pk=fixture["table_pk"],
                    system_name=fixture["srcSystem"],
                    system_abbr=fixture["system_abbr"],
                    source_table=fixture["srcTable"],
                    target_table=fixture["targetTable"],
                    fields=[
                        {
                            "field_pk": fixture["field_pk"],
                            "source_field": fixture["srcField"],
                            "source_type": fixture["srcType"],
                            "source_comment": fixture["srcComment"],
                            "target_field": fixture["targetField"],
                            "mapping_rule": fixture["mappingRule"],
                            "field_order": 1,
                        }
                    ],
                )
        finally:
            connection.close()

        self.service = FieldMappingService()
        app = create_fastapi_app(
            identity_resolver=lambda _request: None,
            field_mapping_service_instance=self.service,
        )
        self.client = TestClient(app, raise_server_exceptions=False)

    @staticmethod
    def _insert_mapping(
        connection,
        *,
        source_id,
        system_id,
        table_pk,
        system_name,
        system_abbr,
        source_table,
        target_table,
        fields,
    ):
        connection.execute(
            """
            INSERT INTO p_data_source
                (source_id, source_code, source_name, source_type, status_code)
            VALUES (?, ?, ?, 'relational', 'enabled')
            """,
            (source_id, system_abbr, system_name),
        )
        connection.execute(
            """
            INSERT INTO p_upstream_system
                (system_pk, data_source_id, system_id, system_abbr, system_name,
                 db_type, host_name, status_code)
            VALUES (?, ?, ?, ?, ?, 'SQLite', 'test.invalid', 'enabled')
            """,
            (
                system_id,
                source_id,
                f"upstream-{system_id}",
                system_abbr,
                system_name,
            ),
        )
        connection.execute(
            """
            INSERT INTO p_field_mapping_table
                (table_pk, data_source_id, upstream_system_id, source_table_name,
                 source_table_cn, target_layer_code, target_table_name,
                 field_total_count, mapped_field_count)
            VALUES (?, ?, ?, ?, ?, 'DWF', ?, ?, ?)
            """,
            (
                table_pk,
                source_id,
                system_id,
                source_table,
                source_table,
                target_table,
                len(fields),
                len(fields),
            ),
        )
        for field in fields:
            connection.execute(
                """
                INSERT INTO p_field_mapping_field
                    (field_pk, table_pk, source_field_name, source_field_type,
                     source_field_comment, target_field_name, mapping_rule, field_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    field["field_pk"],
                    table_pk,
                    field["source_field"],
                    field["source_type"],
                    field["source_comment"],
                    field["target_field"],
                    field["mapping_rule"],
                    field["field_order"],
                ),
            )
        connection.commit()

    def _insert_extra_mapping(self, **kwargs):
        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            self._insert_mapping(connection, **kwargs)
        finally:
            connection.close()

    def _get_fields(self, params=None):
        response = self.client.get("/api/field-mappings/fields", params=params or {})
        self.assertEqual(200, response.status_code, response.text)
        return response.json()["items"]

    def test_all_sort_keys_order_both_directions_via_sqlite_api(self):
        self.assertEqual(
            {
                "srcSystem",
                "srcTable",
                "srcField",
                "srcType",
                "srcComment",
                "targetTable",
                "targetField",
                "mappingRule",
            },
            set(FIELD_SORT_COLUMNS),
        )
        for sort_key in FIELD_SORT_COLUMNS:
            for direction in ("ASC", "DESC"):
                with self.subTest(sort_key=sort_key, direction=direction):
                    expected_rows = sorted(
                        SORT_FIXTURES,
                        key=lambda row: row[sort_key],
                        reverse=direction == "DESC",
                    )
                    response = self.client.get(
                        "/api/field-mappings/fields",
                        params={
                            "sortKey": sort_key,
                            "sortDirection": direction,
                            "pageSize": 10,
                        },
                    )
                    self.assertEqual(200, response.status_code, response.text)
                    actual = [item["srcField"] for item in response.json()["items"]]
                    self.assertEqual([row["srcField"] for row in expected_rows], actual)

    def test_missing_and_invalid_sort_keys_use_default_order(self):
        expected = [
            row["srcField"]
            for row in sorted(SORT_FIXTURES, key=lambda row: row["srcSystem"])
        ]
        default = self._get_fields({"pageSize": 10})
        invalid = self._get_fields(
            {"sortKey": "notAField", "sortDirection": "DESC", "pageSize": 10}
        )
        self.assertEqual(expected, [item["srcField"] for item in default])
        self.assertEqual(default, invalid)

    def test_null_empty_and_whitespace_comments_sort_last_in_both_directions(self):
        for index, (suffix, comment) in enumerate(
            (("D", None), ("E", ""), ("F", "   ")), start=4
        ):
            self._insert_extra_mapping(
                source_id=index,
                system_id=100 + index,
                table_pk=200 + index,
                system_name=f"System-{suffix}",
                system_abbr=f"SYS_{suffix}",
                source_table=f"table-{suffix}",
                target_table=f"target-{suffix}",
                fields=[
                    {
                        "field_pk": 300 + index,
                        "source_field": f"field-{suffix}",
                        "source_type": f"type-{suffix}",
                        "source_comment": comment,
                        "target_field": f"target-field-{suffix}",
                        "mapping_rule": f"rule-{suffix}",
                        "field_order": 1,
                    }
                ],
            )

        for direction in ("ASC", "DESC"):
            expected_prefix = [
                row["srcField"]
                for row in sorted(
                    SORT_FIXTURES,
                    key=lambda row: row["srcComment"],
                    reverse=direction == "DESC",
                )
            ]
            with self.subTest(direction=direction):
                items = self._get_fields(
                    {
                        "sortKey": "srcComment",
                        "sortDirection": direction,
                        "pageSize": 10,
                    }
                )
                self.assertEqual(
                    expected_prefix, [item["srcField"] for item in items[:3]]
                )
                self.assertTrue(
                    all(not item["srcComment"].strip() for item in items[3:])
                )

    def test_null_empty_and_whitespace_values_keep_mapping_stats_and_filters_correct(self):
        self._insert_extra_mapping(
            source_id=20,
            system_id=120,
            table_pk=220,
            system_name="Boundary System",
            system_abbr="BOUNDARY",
            source_table="boundary_table",
            target_table="boundary_target",
            fields=[
                {
                    "field_pk": 401,
                    "source_field": "null_comment",
                    "source_type": "text",
                    "source_comment": None,
                    "target_field": None,
                    "mapping_rule": "direct",
                    "field_order": 1,
                },
                {
                    "field_pk": 402,
                    "source_field": "empty_comment",
                    "source_type": "text",
                    "source_comment": "",
                    "target_field": "",
                    "mapping_rule": "direct",
                    "field_order": 2,
                },
                {
                    "field_pk": 403,
                    "source_field": "space_comment",
                    "source_type": "text",
                    "source_comment": "   ",
                    "target_field": "   ",
                    "mapping_rule": "direct",
                    "field_order": 3,
                },
                {
                    "field_pk": 404,
                    "source_field": "normal_comment",
                    "source_type": "text",
                    "source_comment": "ordinary comment",
                    "target_field": "mapped_target",
                    "mapping_rule": "direct",
                    "field_order": 4,
                },
            ],
        )

        params = {"sourceSystemId": "120"}
        stats_empty = self.service.get_stats({**params, "emptyComment": "yes"})
        self.assertEqual(3, stats_empty["fieldCount"])
        self.assertEqual(0, stats_empty["mappedFieldCount"])
        self.assertEqual(3, stats_empty["emptyCommentCount"])
        self.assertEqual(0, stats_empty["coverage"])

        stats_nonempty = self.service.get_stats({**params, "emptyComment": "no"})
        self.assertEqual(1, stats_nonempty["fieldCount"])
        self.assertEqual(1, stats_nonempty["mappedFieldCount"])
        self.assertEqual(0, stats_nonempty["emptyCommentCount"])
        self.assertEqual(100, stats_nonempty["coverage"])

        table_summary = self.service._get_table_mappings(params)["items"][0]
        self.assertEqual(4, table_summary["fieldCount"])
        self.assertEqual(1, table_summary["mappedCount"])
        self.assertEqual(3, table_summary["emptyCommentCount"])
        self.assertEqual(75, table_summary["emptyCommentRate"])

        empty_page_one_response = self.client.get(
            "/api/field-mappings/fields",
            params={**params, "emptyComment": "yes", "page": 1, "pageSize": 2},
        )
        empty_page_two_response = self.client.get(
            "/api/field-mappings/fields",
            params={**params, "emptyComment": "yes", "page": 2, "pageSize": 2},
        )
        self.assertEqual(200, empty_page_one_response.status_code)
        self.assertEqual(200, empty_page_two_response.status_code)
        empty_page_one = empty_page_one_response.json()
        empty_page_two = empty_page_two_response.json()
        self.assertEqual(3, empty_page_one["total"])
        self.assertEqual(2, len(empty_page_one["items"]))
        self.assertEqual(1, len(empty_page_two["items"]))
        empty_items = empty_page_one["items"] + empty_page_two["items"]
        self.assertTrue(all(not item["srcComment"].strip() for item in empty_items))
        nonempty = self.client.get(
            "/api/field-mappings/fields",
            params={**params, "emptyComment": "no"},
        )
        self.assertEqual(200, nonempty.status_code, nonempty.text)
        self.assertEqual(
            ["normal_comment"],
            [item["srcField"] for item in nonempty.json()["items"]],
        )

    def test_equal_sort_values_have_stable_default_ties_across_pages(self):
        self._insert_extra_mapping(
            source_id=10,
            system_id=110,
            table_pk=210,
            system_name="Page System",
            system_abbr="PAGE",
            source_table="page_table",
            target_table="page_target",
            fields=[
                {
                    "field_pk": 310,
                    "source_field": "beta",
                    "source_type": "text",
                    "source_comment": "same",
                    "target_field": "beta_target",
                    "mapping_rule": "direct",
                    "field_order": 2,
                },
                {
                    "field_pk": 311,
                    "source_field": "zeta",
                    "source_type": "text",
                    "source_comment": "same",
                    "target_field": "zeta_target",
                    "mapping_rule": "direct",
                    "field_order": 1,
                },
                {
                    "field_pk": 312,
                    "source_field": "alpha",
                    "source_type": "text",
                    "source_comment": "same",
                    "target_field": "alpha_target",
                    "mapping_rule": "direct",
                    "field_order": 1,
                },
            ],
        )

        def read_pages():
            result = []
            for page in (1, 2, 3):
                response = self.client.get(
                    "/api/field-mappings/fields",
                    params={
                        "sourceSystemId": "110",
                        "sortKey": "srcComment",
                        "sortDirection": "ASC",
                        "page": page,
                        "pageSize": 1,
                    },
                )
                self.assertEqual(200, response.status_code, response.text)
                payload = response.json()
                self.assertEqual(3, payload["total"])
                self.assertEqual(page, payload["page"])
                result.extend(item["srcField"] for item in payload["items"])
            return result

        expected = ["alpha", "zeta", "beta"]
        self.assertEqual(expected, read_pages())
        self.assertEqual(expected, read_pages())


if __name__ == "__main__":
    unittest.main()
