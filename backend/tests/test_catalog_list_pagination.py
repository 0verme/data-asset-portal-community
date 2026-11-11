"""#464 Phase2: real, isolated SQLite/PostgreSQL/MySQL pagination contracts.

External providers require dedicated TEST_* profiles. Only uniquely named
synthetic objects owned by this test are written or deleted. SQL evidence is
recorded after successful driver execution, not merely dialect compilation.
"""
from __future__ import annotations

import json
import os
import tempfile
import unittest
import uuid
from pathlib import Path
from time import perf_counter
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import delete, event, insert, select, update

from backend.app.authorization.core import AuthorizationService
from backend.app.db.core import execute_statements_core, fetch_all_core, next_pk
from backend.app.db.facade import clear_engine_cache, connect_with_profile, database_transaction, get_db_profile, get_engine
from backend.app.db.tables import asset_field, asset_table, indicator_item, report_asset
from backend.app.fastapi_app import create_fastapi_app
from backend.app.migrations.schema import initialize
from backend.app.services.indicator_service import IndicatorNotFoundError, IndicatorService
from backend.app.services.report_service import ReportDataSourceError, ReportNotFoundError, ReportService
from backend.tests.test_system_list_pagination_integration import _configured, _RecordingConnection


class _CatalogPaginationContract:
    provider = "sqlite"
    profile_env = ""
    config_env = ""

    def setUp(self):
        if self.provider == "sqlite":
            temporary = tempfile.TemporaryDirectory(prefix="dap-464-phase2-")
            self.addCleanup(temporary.cleanup)
            database = Path(temporary.name) / "catalog.sqlite"
            config_path = Path(temporary.name) / "database.yaml"
            config_path.write_text(f"profiles:\n  dap_464_catalog:\n    type: sqlite\n    database: '{database.as_posix()}'\n", encoding="utf-8")
            self.profile = "dap_464_catalog"
        else:
            self.profile = os.environ[self.profile_env]
            config_path = Path(os.environ[self.config_env])
        environment = patch.dict(os.environ, {
            "ASSET_DB_PROFILE": self.profile, "ASSET_DB_CONFIG_PATH": str(config_path),
            "PUBLIC_CATALOG_PROFILE": "internal",
        })
        environment.start()
        self.addCleanup(environment.stop)
        for key in ("TYPE", "HOST", "PORT", "DATABASE", "USER", "PASSWORD", "DSN", "JDBC_URL"):
            os.environ.pop(f"ASSET_DB_{key}", None)
        clear_engine_cache()
        self.addCleanup(clear_engine_cache)
        config = get_db_profile(self.profile)
        self.assertEqual(self.provider, config["type"])
        if self.provider == "sqlite":
            connection = connect_with_profile(self.profile)
            try:
                self.assertTrue(initialize(connection, config, "sqlite"))
            finally:
                connection.close()
        self.indicator, self.report = IndicatorService(), ReportService()
        self.baseline_indicator = self.indicator.get_indicator_page(page_size=1)
        self.baseline_report = self.report.get_report_page(page_size=1)
        self.prefix = f"D464C_{uuid.uuid4().hex[:8].upper()}_"
        self.live_name = self.prefix + "live_table"
        self.stale_name = self.prefix + "obsolete_table"
        self.indicator_codes = [f"{self.prefix}I{index:02}" for index in range(1, 9)]
        self.report_codes = [f"{self.prefix}R{index:02}" for index in range(1, 9)]
        indicator_start = next_pk(self.profile, indicator_item, indicator_item.c.indicator_pk)
        report_start = next_pk(self.profile, report_asset, report_asset.c.report_pk)
        asset_start = next_pk(self.profile, asset_table, asset_table.c.asset_id)
        field_start = next_pk(self.profile, asset_field, asset_field.c.field_id)
        self.indicator_ids = list(range(indicator_start, indicator_start + 8))
        self.report_ids = list(range(report_start, report_start + 8))
        self.asset_ids = [asset_start, asset_start + 1]
        self.field_ids = list(range(field_start, field_start + 3))
        self.addCleanup(self._clean_owned)
        statements = []
        # Duplicate table names and multiple fields must not multiply indicator rows.
        for offset, asset_id in enumerate(self.asset_ids):
            statements.append(insert(asset_table).values(
                asset_id=asset_id, table_name=self.live_name, table_cn_name="Synthetic table",
                schema_name=f"fixture_{offset}", qualified_name=f"fixture_{offset}.{self.live_name}",
                field_count=3, is_deleted="N", created_by="dap464", updated_by="dap464",
            ))
        for index, field_id in enumerate(self.field_ids):
            statements.append(insert(asset_field).values(
                field_id=field_id, asset_id=self.asset_ids[0], field_name=self.prefix + f"live_field_{index}",
                field_order=index + 1, nullable_flag="Y", pk_flag="N", partition_flag="N",
                is_deleted="N", created_by="dap464", updated_by="dap464",
            ))
        self.related_tables = [{"assetId": value, "tableName": self.live_name} for value in self.asset_ids]
        self.related_indicators = [{"indicatorId": value} for value in self.indicator_codes[:3]]
        for offset in range(8):
            index = offset + 1
            status = "enabled" if index % 2 else "disabled"
            deleted = "Y" if index == 8 else "N"
            statements.extend([
                insert(indicator_item).values(
                    indicator_pk=self.indicator_ids[offset], indicator_id=self.indicator_codes[offset],
                    indicator_name=self.prefix + "same", meaning_desc="Synthetic metric",
                    result_table_name=self.stale_name, result_field_name=self.prefix + "obsolete_field",
                    source_asset_id=self.asset_ids[0], result_field_id=self.field_ids[0], aggregation_code="SUM",
                    semantic_state="certified", dimension_code="prd" if index % 2 else "mem",
                    path_desc="PRD > Synthetic" if index % 2 else "MEM > Synthetic", status_code=status,
                    registrar_name=self.prefix + f"person-{index}", registered_date="2026-01-01",
                    is_deleted=deleted, created_by="dap464", updated_by="dap464",
                ),
                insert(report_asset).values(
                    report_pk=self.report_ids[offset], report_code=self.report_codes[offset], report_name=self.prefix + "same",
                    report_type=self.prefix + ("typeA" if index % 2 else "typeB"), domain_name="Synthetic domain",
                    freq_code="日", status_code=status, owner_dept_name=self.prefix + ("deptA" if index % 2 else "deptB"),
                    owner_name=self.prefix + f"person-{index}", related_tables_json=json.dumps(self.related_tables),
                    related_indicators_json=json.dumps(self.related_indicators), is_deleted=deleted,
                    created_by="dap464", updated_by="dap464",
                ),
            ])
        with database_transaction():
            execute_statements_core(self.profile, statements)
        self.executed_sql = []

        engine = get_engine(self.profile)

        def before_execute(_connection, _cursor, _statement, _parameters, context, _executemany):
            context._dap_started_at = perf_counter()

        def after_execute(_connection, _cursor, statement, parameters, context, _executemany):
            started = getattr(context, "_dap_started_at", perf_counter())
            self.executed_sql.append((str(statement), parameters, (perf_counter() - started) * 1000))

        event.listen(engine, "before_cursor_execute", before_execute)
        event.listen(engine, "after_cursor_execute", after_execute)
        self.addCleanup(event.remove, engine, "before_cursor_execute", before_execute)
        self.addCleanup(event.remove, engine, "after_cursor_execute", after_execute)

        def record_connection(*args, **kwargs):
            return _RecordingConnection(connect_with_profile(*args, **kwargs), self.executed_sql)

        recorder = patch("backend.app.db.facade.connect_with_profile", side_effect=record_connection)
        recorder.start()
        self.addCleanup(recorder.stop)

    def _clean_owned(self):
        with database_transaction():
            execute_statements_core(self.profile, [
                delete(report_asset).where(report_asset.c.report_pk.in_(self.report_ids), report_asset.c.report_code.in_(self.report_codes)),
                delete(indicator_item).where(indicator_item.c.indicator_pk.in_(self.indicator_ids), indicator_item.c.indicator_id.in_(self.indicator_codes)),
                delete(asset_field).where(asset_field.c.field_id.in_(self.field_ids), asset_field.c.asset_id.in_(self.asset_ids)),
                delete(asset_table).where(asset_table.c.asset_id.in_(self.asset_ids), asset_table.c.table_name == self.live_name),
            ])
        for table, key, codes in ((indicator_item, indicator_item.c.indicator_id, self.indicator_codes),
                                  (report_asset, report_asset.c.report_code, self.report_codes)):
            self.assertEqual([], fetch_all_core(self.profile, select(key).select_from(table).where(key.in_(codes)))[1])

    def _insert_unassigned_indicator(self):
        identifier = self.prefix + "I_UNASSIGNED"
        pk = next_pk(self.profile, indicator_item, indicator_item.c.indicator_pk)
        with database_transaction():
            execute_statements_core(self.profile, [insert(indicator_item).values(
                indicator_pk=pk, indicator_id=identifier, indicator_name=self.prefix + "unassigned",
                meaning_desc="Synthetic unassigned dimension", result_table_name="", result_field_name="",
                source_asset_id=None, result_field_id=None, aggregation_code=None, semantic_state="candidate",
                dimension_code="", caliber_desc="", path_desc="", status_code="enabled",
                registrar_name="dap464", registered_date="2026-01-01", is_deleted="N",
                created_by="dap464", updated_by="dap464",
            )])

        def cleanup():
            with database_transaction():
                execute_statements_core(self.profile, [delete(indicator_item).where(
                    indicator_item.c.indicator_pk == pk, indicator_item.c.indicator_id == identifier,
                )])

        self.addCleanup(cleanup)
        return identifier

    def _assert_executed_bounds(self, table):
        queries = [(sql, params, ms) for sql, params, ms in self.executed_sql
                   if table in sql and "ORDER BY" in sql and "LIMIT" in sql]
        self.assertTrue(queries, f"No actual bounded driver query for {table}")
        sql, params, ms = queries[0]
        print(f"Catalog pagination SQL [{self.provider}] execute_ms={ms:.3f}: {sql}; binds={params!r}")

    def test_indicator_count_stable_ties_join_cardinality_and_legacy(self):
        ids = []
        for page, size in ((1, 3), (2, 3), (3, 1), (4, 0)):
            result = self.indicator.get_indicator_page(keyword=self.prefix, page=page, page_size=3, sort_key="name", sort_direction="desc")
            self.assertEqual((7, size), (result["total"], len(result["items"])))
            self.assertEqual(self.baseline_indicator["stats"]["indicatorCount"] + 7, result["stats"]["indicatorCount"])
            ids.extend(item["id"] for item in result["items"])
        self.assertEqual(self.indicator_codes[:7], ids)
        self.assertEqual(7, len(set(ids)))
        self.assertEqual(7, len(self.indicator.get_indicators(keyword=self.prefix)))
        result = self.indicator.get_indicator_page(keyword=self.prefix, dimension="PRD", status="enabled", page=2, page_size=2)
        self.assertEqual((4, self.indicator_codes[4:7:2]), (result["total"], [item["id"] for item in result["items"]]))
        self.assertEqual(self.baseline_indicator["facets"]["dimension"].get("mem", 0) + 3, result["facets"]["dimension"]["mem"])
        descending = self.indicator.get_indicator_page(keyword=self.prefix, page_size=3, sort_key="id", sort_direction="desc")
        self.assertEqual(self.indicator_codes[6:3:-1], [item["id"] for item in descending["items"]])
        self._assert_executed_bounds("p_indicator_item")

    def test_indicator_unassigned_dimension_filter_is_explicit_and_paged(self):
        identifier = self._insert_unassigned_indicator()
        unassigned = self.indicator.get_indicator_page(
            keyword=self.prefix, dimension_unassigned=True, page=1, page_size=20,
        )
        self.assertEqual((1, [identifier]), (unassigned["total"], [item["id"] for item in unassigned["items"]]))
        self.assertEqual(1, unassigned["facets"]["dimension"][""])

        all_items = self.indicator.get_indicator_page(keyword=self.prefix, page=1, page_size=20)
        self.assertEqual(8, all_items["total"])
        self.assertEqual(8, len(self.indicator.get_indicators(keyword=self.prefix)))
        self._assert_executed_bounds("p_indicator_item")

    def test_indicator_search_uses_resolved_display_names_not_snapshots(self):
        result = self.indicator.get_indicator_page(keyword=self.live_name, page_size=2)
        self.assertEqual((7, 2), (result["total"], len(result["items"])))
        self.assertTrue(all(item["resultTableName"] == self.live_name for item in result["items"]))
        self.assertEqual(0, self.indicator.get_indicator_page(keyword=self.stale_name)["total"])
        self.assertEqual(7, len(self.indicator.get_indicators(keyword=self.stale_name)))
        field = self.prefix + "live_field_0"
        self.assertEqual(7, self.indicator.get_indicator_page(keyword=field)["total"])

    def test_report_count_filters_global_facets_references_and_legacy(self):
        codes = []
        for page, size in ((1, 3), (2, 3), (3, 1), (4, 0)):
            result = self.report.get_report_page(keyword=self.prefix, page=page, page_size=3, sort_key="name", sort_direction="desc")
            self.assertEqual((7, size), (result["total"], len(result["items"])))
            self.assertEqual(self.baseline_report["stats"]["reportCount"] + 7, result["stats"]["reportCount"])
            self.assertEqual(3, result["facets"]["ownerDept"][self.prefix + "deptB"])
            for item in result["items"]:
                self.assertEqual((2, 3), (item["relatedTableCount"], item["relatedIndicatorCount"]))
                self.assertEqual(self.related_tables, item["relatedTables"])
                self.assertEqual(self.related_indicators, item["relatedIndicators"])
            codes.extend(item["code"] for item in result["items"])
        self.assertEqual(self.report_codes[:7], codes)
        result = self.report.get_report_page(keyword=self.prefix, report_type=self.prefix + "typeA", domain="Synthetic domain",
                                             status="enabled", owner_dept=self.prefix + "deptA", page=2, page_size=2)
        self.assertEqual((4, self.report_codes[4:7:2]), (result["total"], [item["code"] for item in result["items"]]))
        self.assertEqual(7, len(self.report.get_reports(keyword=self.prefix)))
        self._assert_executed_bounds("p_report_asset")

    def test_direct_details_never_call_full_collection_or_depend_on_page(self):
        self.indicator.get_indicator_page(keyword=self.prefix, page_size=1)
        self.report.get_report_page(keyword=self.prefix, page_size=1)
        self.executed_sql.clear()
        with patch.object(self.indicator, "get_indicators", side_effect=AssertionError("full indicators")), \
                patch.object(self.report, "get_reports", side_effect=AssertionError("full reports")):
            self.assertEqual(self.indicator_codes[6], self.indicator.get_indicator_detail(self.indicator_codes[6])["id"])
            self.assertEqual(self.report_codes[6], self.report.get_report_detail(" " + self.report_codes[6].lower() + " ")["code"])
            with self.assertRaises(IndicatorNotFoundError):
                self.indicator.get_indicator_detail(self.indicator_codes[7])
            with self.assertRaises(ReportNotFoundError):
                self.report.get_report_detail(self.report_codes[7])
        self.assertEqual(4, len(self.executed_sql))
        for sql, params, _ms in self.executed_sql:
            self.assertIn("WHERE", sql)
            self.assertIn("LIMIT", sql)
            self.assertNotIn("count(", sql.lower())
            self.assertTrue(params)

    def test_page_literal_search_and_hidden_person_search_policy(self):
        for service, method in ((self.indicator, self.indicator.get_indicator_page), (self.report, self.report.get_report_page)):
            for keyword in ("%", "'_not_sql", self.prefix + "missing_"):
                self.assertEqual(0, method(keyword=keyword, page_size=1)["total"])
            for profile, expected in (("strict", 0), ("internal", 1)):
                result = method(keyword=self.prefix + "person-7", profile=profile, page_size=1)
                self.assertEqual((expected, expected), (result["total"], len(result["items"])))
        empty = self.report.get_report_page(keyword=self.prefix, owner_dept="absent", page_size=2)
        self.assertEqual((0, []), (empty["total"], empty["items"]))
        self.assertEqual(4, empty["facets"]["type"][self.prefix + "typeA"])

    def test_report_only_decodes_selected_rows_and_sort_is_whitelisted(self):
        execute_statements_core(self.profile, [update(report_asset).where(report_asset.c.report_pk == self.report_ids[6])
                                             .values(related_tables_json="invalid synthetic JSON")])
        with patch.object(self.report, "_row_to_item", wraps=self.report._row_to_item) as decode:
            result = self.report.get_report_page(keyword=self.prefix, page_size=2, sort_key="invalid SQL sort")
            self.assertEqual(self.report_codes[:2], [item["code"] for item in result["items"]])
            self.assertEqual(2, decode.call_count)
        with self.assertRaises(ReportDataSourceError):
            self.report.get_report_detail(self.report_codes[6])


class SQLiteCatalogPaginationTests(_CatalogPaginationContract, unittest.TestCase):
    def _client(self):
        return TestClient(create_fastapi_app(
            identity_resolver=lambda _request: None, indicator_service_instance=self.indicator,
            report_service_instance=self.report, authorization_service_instance=AuthorizationService(),
        ))

    def test_route_page_alias_defaults_clamp_and_unpaged_shape(self):
        client = self._client()
        for route in ("/api/indicators", "/api/reports"):
            for query, page, size in (("page=2&limit=2", 2, 2), ("page=1&pageSize=3&limit=1", 1, 3),
                                      ("page=bad&pageSize=bad", 1, 20), ("page=0&pageSize=0&limit=5", 1, 1),
                                      ("page=-1&pageSize=-3", 1, 1)):
                response = client.get(f"{route}?{query}")
                self.assertEqual(200, response.status_code, response.text)
                data = response.json()
                self.assertEqual((7, page, size), (data["total"], data["page"], data["pageSize"]))
                self.assertIn("facets", data)
                self.assertIn("stats", data)
            unpaged = client.get(route).json()
            self.assertEqual({"items"}, set(unpaged))
            self.assertEqual(7, len(unpaged["items"]))
        with patch("backend.app.utils.pagination.get_page_size_limits", return_value=(20, 7)):
            for route in ("/api/indicators", "/api/reports"):
                data = client.get(f"{route}?page=1&pageSize=10000").json()
                self.assertEqual(7, data["pageSize"])

    def test_route_filters_unassigned_dimension_with_explicit_query_flag(self):
        identifier = self._insert_unassigned_indicator()
        client = self._client()
        filtered = client.get("/api/indicators", params={
            "keyword": self.prefix, "page": 1, "pageSize": 20, "dimensionUnassigned": "true",
        })
        self.assertEqual(200, filtered.status_code, filtered.text)
        self.assertEqual((1, [identifier]), (
            filtered.json()["total"], [item["id"] for item in filtered.json()["items"]],
        ))
        unfiltered = client.get("/api/indicators", params={
            "keyword": self.prefix, "page": 1, "pageSize": 20,
        })
        self.assertEqual(8, unfiltered.json()["total"])

    def test_public_projection_write_permissions_and_detail_routes(self):
        client = self._client()
        with patch.dict(os.environ, {"PUBLIC_CATALOG_PROFILE": "strict"}):
            for route, code, hidden in (("/api/indicators", self.indicator_codes[6], "registrar"),
                                         ("/api/reports", self.report_codes[6], "ownerName")):
                response = client.get(f"{route}?page=1&pageSize=1")
                self.assertEqual(200, response.status_code, response.text)
                self.assertNotIn(hidden, response.json()["items"][0])
                self.assertNotIn(hidden, client.get(f"{route}/{code}").json()["data"])
                self.assertEqual(0, client.get(f"{route}?page=1&keyword={self.prefix}person-7").json()["total"])
                self.assertEqual(401, client.put(f"{route}/{code}", json={}).status_code)
                self.assertEqual(401, client.delete(f"{route}/{code}").status_code)


@unittest.skipUnless(_configured("TEST_DATABASE_PROFILE", "TEST_DATABASE_CONFIG_PATH"), "dedicated PostgreSQL test profile not configured")
class PostgresCatalogPaginationTests(_CatalogPaginationContract, unittest.TestCase):
    provider = "postgres"
    profile_env = "TEST_DATABASE_PROFILE"
    config_env = "TEST_DATABASE_CONFIG_PATH"


@unittest.skipUnless(_configured("TEST_MYSQL_DATABASE_PROFILE", "TEST_MYSQL_DATABASE_CONFIG_PATH"), "dedicated MySQL test profile not configured")
class MySQLCatalogPaginationTests(_CatalogPaginationContract, unittest.TestCase):
    provider = "mysql"
    profile_env = "TEST_MYSQL_DATABASE_PROFILE"
    config_env = "TEST_MYSQL_DATABASE_CONFIG_PATH"


if __name__ == "__main__":
    unittest.main()
