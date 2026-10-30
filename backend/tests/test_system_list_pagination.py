# Copyright 2025 Jearhe
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0

"""#464 Phase 1: execute pagination/COUNT/legacy contracts on isolated SQLite.

SQL traces below come from sqlite3's execution callback, not SQL compilation
or canned query results. No deployment configuration or business data is used.
"""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.authorization.core import AuthorizationService
from backend.app.db.facade import clear_engine_cache, connect_with_profile
from backend.app.fastapi_app import create_fastapi_app
from backend.app.migrations.schema import initialize
from backend.app.services.common_code_service import common_code_service
from backend.app.services.push_service import PushService, PushSystemNotFoundError
from backend.app.services.upstream_service import UpstreamService


class SystemListPaginationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="dap-464-pagination-")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        database = root / "pagination.sqlite"
        config_path = root / "database.yaml"
        config_path.write_text(
            "profiles:\n  dap_464_test:\n    type: sqlite\n"
            f"    database: '{database.as_posix()}'\n", encoding="utf-8",
        )
        environment = patch.dict(os.environ, {
            "ASSET_DB_PROFILE": "dap_464_test", "ASSET_DB_CONFIG_PATH": str(config_path),
            "ASSET_DB_DATABASE": str(database), "PUBLIC_CATALOG_PROFILE": "internal",
        })
        environment.start()
        self.addCleanup(environment.stop)
        clear_engine_cache()
        self.addCleanup(clear_engine_cache)
        self.connection = connect_with_profile("dap_464_test")
        self.addCleanup(self.connection.close)
        self.assertTrue(initialize(self.connection, {"type": "sqlite", "database": str(database)}, "sqlite"))
        self._insert_fixture()
        self.upstream = UpstreamService()
        self.push = PushService()
        self.sql: list[str] = []
        self.statements = []

        def traced_connect(*args, **kwargs):
            connection = connect_with_profile(*args, **kwargs)
            connection.set_trace_callback(self.sql.append)
            return connection

        trace = patch("backend.app.db.facade.connect_with_profile", side_effect=traced_connect)
        trace.start()
        self.addCleanup(trace.stop)
        for service in (self.upstream, self.push):
            original = service._fetch_rows

            def record(statement, fetch=original):
                self.statements.append(statement)
                return fetch(statement)

            recorder = patch.object(service, "_fetch_rows", side_effect=record)
            recorder.start()
            self.addCleanup(recorder.stop)

    def _insert_fixture(self):
        for index in range(1, 9):
            deleted = "Y" if index == 8 else "N"
            status = "enabled" if index % 2 else "disabled"
            self.connection.execute(
                "INSERT INTO dwp.p_upstream_system "
                "(system_pk, system_id, system_abbr, system_name, db_type, host_name, "
                "owner_name, dept_name, status_code, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (index, f"up_{index:02}", "SAME", "Same system", "POSTGRESQL" if index % 2 else "MYSQL",
                 f"locator-{index}.demo.invalid", f"person-{index}", f"Dept {index % 2}", status, deleted),
            )
            for number, time in enumerate(("01:00", "23:15"), start=1):
                self.connection.execute(
                    "INSERT INTO dwp.p_upstream_unload_time (time_pk, system_pk, unload_time) VALUES (?, ?, ?)",
                    (index * 10 + number, index, time),
                )
            self.connection.execute(
                "INSERT INTO dwp.p_push_system "
                "(system_id, system_code, system_name, system_abbr, protocol_type, host_name, port_no, "
                "dept_name, status_code, importance_level_code, job_count, is_deleted) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (index, f"PUSH_{index:02}", "Same system", "SAME", "SFTP" if index % 2 else "FTP",
                 f"push-{index}.demo.invalid", 22, f"Dept {index % 2}", status,
                 "important" if index % 3 == 1 else "normal", 999, deleted),
            )
            for number in (1, 2, 3):
                job_id = index * 10 + number
                self.connection.execute(
                    "INSERT INTO dwp.p_push_job "
                    "(job_id, system_id, job_code, job_name, target_file_name, freq_type, is_deleted) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (job_id, index, f"JOB_{number}", "needle" if index % 3 == 1 else "Other job",
                     f"file_{index}_{number}.csv", "only-last" if index == 7 else "T+1",
                     "Y" if number == 3 else "N"),
                )
                self.connection.execute(
                    "INSERT INTO dwp.p_push_job_field "
                    "(field_id, job_id, field_name, field_cn_name, data_type) VALUES (?, ?, ?, ?, ?)",
                    (job_id, job_id, "field_id", "Field", "string"),
                )
        self.connection.commit()

    def _client(self):
        return TestClient(create_fastapi_app(
            identity_resolver=lambda _request: None,
            upstream_service_instance=self.upstream, push_service_instance=self.push,
            authorization_service_instance=AuthorizationService(),
        ))

    def test_upstream_first_last_out_of_range_and_stable_unique_order(self):
        ids = []
        for page, expected_size in ((1, 3), (2, 3), (3, 1), (4, 0)):
            result = self.upstream.get_system_page(page=page, page_size=3)
            self.assertEqual((7, page, 3), (result["total"], result["page"], result["pageSize"]))
            self.assertEqual(expected_size, len(result["items"]))
            ids.extend(item["id"] for item in result["items"])
        self.assertEqual([f"up_{index:02}" for index in range(1, 8)], ids)
        self.assertEqual(7, len(set(ids)))
        self.assertTrue(any("LIMIT 3 OFFSET 6" in statement for statement in self.sql))
        self.assertTrue(any("LIMIT 3 OFFSET 9" in statement for statement in self.sql))
        self.assertTrue(any("ORDER BY" in statement and "system_pk ASC" in statement for statement in self.sql))

    def test_upstream_filter_count_aliases_and_global_facets(self):
        result = self.upstream.get_system_page(status="enabled", db_type="PostgreSQL", keyword="23:15",
                                               page=2, page_size=2)
        self.assertEqual(4, result["total"])
        self.assertEqual(["up_05", "up_07"], [item["id"] for item in result["items"]])
        self.assertEqual({"POSTGRESQL": 4, "MYSQL": 3}, result["facets"]["dbType"])
        self.assertTrue(all(item["dbType"] == "POSTGRESQL" for item in result["items"]))
        self.assertEqual({"enabled": 4, "disabled": 3}, result["facets"]["status"])
        self.assertEqual(7, result["stats"]["systemCount"])
        self.assertEqual(["Dept 0", "Dept 1"], result["options"]["depts"])
        by_code = self.upstream.get_system_page(db_type="POSTGRESQL", page=1, page_size=20)
        self.assertEqual(4, by_code["total"])

    def test_upstream_dictionary_backed_facets_and_rows_use_identical_display_values(self):
        self.connection.execute(
            "INSERT INTO dwp.p_code_category (category_id, category_code, category_name) VALUES (?, ?, ?)",
            (464, "UPSTREAM_DB_TYPE", "Database type"),
        )
        for number, code, value in ((4641, "POSTGRESQL", "PostgreSQL"), (4642, "MYSQL", "MySQL")):
            self.connection.execute(
                "INSERT INTO dwp.p_code_item (item_id, category_code, item_code, item_name, item_value) VALUES (?, ?, ?, ?, ?)",
                (number, "UPSTREAM_DB_TYPE", code, value, value),
            )
        self.connection.commit()
        common_code_service.invalidate(["UPSTREAM_DB_TYPE"])
        result = self.upstream.get_system_page(db_type="PostgreSQL", page=1, page_size=2)
        self.assertEqual(4, result["total"])
        self.assertEqual({"PostgreSQL": 4, "MySQL": 3}, result["facets"]["dbType"])
        self.assertTrue(all(item["dbType"] == "PostgreSQL" for item in result["items"]))
        self.assertEqual(["MySQL", "PostgreSQL"], result["options"]["dbTypes"])

    def test_upstream_page_count_has_same_strict_search_policy_as_items(self):
        for profile, count in (("strict", 0), ("internal", 1)):
            for keyword in ("locator-7", "person-7"):
                with self.subTest(profile=profile, keyword=keyword):
                    result = self.upstream.get_system_page(keyword=keyword, page=1, page_size=1, profile=profile)
                    self.assertEqual(count, result["total"])
                    self.assertEqual(count, len(result["items"]))
        result = self.upstream.get_system_page(page=1, page_size=1, profile="strict")
        self.assertNotIn("host", result["items"][0])
        self.assertNotIn("owner", result["items"][0])

    def test_upstream_sort_whitelist_and_unique_ties(self):
        result = self.upstream.get_system_page(page=1, page_size=3, sort_key="id", sort_direction="desc")
        self.assertEqual(["up_07", "up_06", "up_05"], [item["id"] for item in result["items"]])
        result = self.upstream.get_system_page(page=2, page_size=3, sort_key="name", sort_direction="desc")
        self.assertEqual(["up_04", "up_05", "up_06"], [item["id"] for item in result["items"]])
        result = self.upstream.get_system_page(page=1, page_size=1, sort_key="invalid SQL sort", sort_direction="bogus")
        self.assertEqual("up_01", result["items"][0]["id"])

    def test_push_page_is_lightweight_with_live_job_counts_and_complete_options(self):
        with patch.object(self.push, "_load_public_job_rows", side_effect=AssertionError("full jobs on page")), \
                patch.object(self.push, "_load_job_rows", side_effect=AssertionError("admin jobs on page")), \
                patch.object(self.push, "_load_field_rows", side_effect=AssertionError("fields on page")):
            result = self.push.get_push_system_page(page=1, page_size=2)
        self.assertEqual(["PUSH_01", "PUSH_04"], [item["id"] for item in result["items"]])
        self.assertEqual([2, 2], [item["jobCount"] for item in result["items"]])
        self.assertEqual([[], []], [item["jobs"] for item in result["items"]])
        self.assertEqual({"systemCount": 7, "jobCount": 14}, result["stats"])
        self.assertEqual([f"PUSH_{index:02}" for index in range(1, 8)], result["options"]["systemIds"])
        self.assertEqual(["T+1", "only-last"], result["options"]["freqTypes"])
        self.assertEqual({"important": 3, "normal": 4}, result["facets"]["importanceLevel"])
        self.assertFalse(any("p_push_job_field" in statement for statement in self.sql))
        self.assertFalse(any("source_path" in statement or "host_name" in statement for statement in self.sql))

    def test_push_job_search_count_does_not_multiply_rows_and_importance_filters(self):
        result = self.push.get_push_system_page(keyword="needle", importance_level="important", status="enabled",
                                                page=1, page_size=1)
        self.assertEqual(2, result["total"])
        self.assertEqual("PUSH_01", result["items"][0]["id"])
        last = self.push.get_push_system_page(keyword="needle", importance_level="important", status="enabled",
                                              page=2, page_size=1)
        self.assertEqual("PUSH_07", last["items"][0]["id"])
        self.assertEqual(7, last["stats"]["systemCount"])
        self.assertTrue(any("EXISTS" in statement and "count(*)" in statement for statement in self.sql))
        empty = self.push.get_push_system_page(protocol="FTP", dept="Dept 1", page=1, page_size=2)
        self.assertEqual((0, []), (empty["total"], empty["items"]))

    def test_push_first_last_out_of_range_and_sort_switch(self):
        ids = []
        for page, expected_size in ((1, 3), (2, 3), (3, 1), (4, 0)):
            result = self.push.get_push_system_page(page=page, page_size=3)
            self.assertEqual(7, result["total"])
            self.assertEqual(expected_size, len(result["items"]))
            ids.extend(item["id"] for item in result["items"])
        self.assertEqual(["PUSH_01", "PUSH_04", "PUSH_07", "PUSH_02", "PUSH_03", "PUSH_05", "PUSH_06"], ids)
        result = self.push.get_push_system_page(page=1, page_size=2, sort_key="id", sort_direction="desc")
        self.assertEqual(["PUSH_07", "PUSH_06"], [item["id"] for item in result["items"]])
        self.assertTrue(any("LIMIT 3 OFFSET 6" in statement for statement in self.sql))
        self.assertTrue(any("system_id ASC" in statement and "ORDER BY" in statement for statement in self.sql))

    def test_legacy_services_keep_full_collections_and_nested_jobs_fields(self):
        upstream = self.upstream.get_systems()
        self.assertEqual(7, len(upstream))
        self.assertTrue(all(item["unloadTimes"] == ["01:00", "23:15"] for item in upstream))
        push = self.push.get_push_systems()
        self.assertEqual(7, len(push))
        self.assertTrue(all(len(item["jobs"]) == 2 for item in push))
        self.assertTrue(all(len(job["fields"]) == 1 for item in push for job in item["jobs"]))
        self.assertTrue(all("jobCount" not in item for item in push))
        filtered = self.push.get_push_systems(importance_level="important")
        self.assertEqual(3, len(filtered))

    def test_push_public_detail_queries_only_selected_system_instead_of_full_list(self):
        detail = self.push.get_push_system_detail("PUSH_07")
        self.assertEqual("PUSH_07", detail["id"])
        self.assertEqual(2, len(detail["jobs"]))
        self.assertEqual("field_id", detail["jobs"][0]["fields"][0]["name"])
        system_queries = [statement for statement in self.sql if "FROM dwp.p_push_system" in statement]
        self.assertEqual(1, len(system_queries))
        self.assertIn("system_code = 'PUSH_07'", system_queries[0])
        self.assertFalse(any(" IN (1, 2," in statement for statement in self.sql))
        with self.assertRaises(PushSystemNotFoundError):
            self.push.get_push_system_detail("PUSH_08")

    def test_paged_keyword_is_literal_without_changing_legacy_wildcard_contract(self):
        for method in (self.upstream.get_system_page, self.push.get_push_system_page):
            for keyword in ("%", "PUSH_0_", "up_0_"):
                result = method(keyword=keyword, page=1, page_size=2)
                self.assertEqual((0, []), (result["total"], result["items"]))
        self.assertEqual(7, len(self.upstream.get_systems(keyword="%")))
        self.assertEqual(7, len(self.push.get_push_systems(keyword="%")))
        self.connection.execute("UPDATE dwp.p_upstream_system SET system_name = ? WHERE system_pk = 7", ("literal%_~\\",))
        self.connection.execute("UPDATE dwp.p_push_system SET system_name = ? WHERE system_id = 7", ("literal%_~\\",))
        self.connection.commit()
        for method in (self.upstream.get_system_page, self.push.get_push_system_page):
            result = method(keyword="%_~\\", page=1, page_size=1)
            self.assertEqual(1, result["total"])
            self.assertEqual(1, len(result["items"]))

    def test_upstream_dictionary_queries_are_constant_not_per_returned_system(self):
        counts = []
        for size in (1, 7):
            with patch.object(self.upstream, "_get_option_contract", wraps=self.upstream._get_option_contract) as options:
                result = self.upstream.get_system_page(page=1, page_size=size)
                self.assertEqual(size, len(result["items"]))
                counts.append(options.call_count)
        self.assertEqual([4, 4], counts)

    def test_page_size_defaults_clamp_and_legacy_limit_precedence_at_routes(self):
        client = self._client()
        for route in ("/api/upstreams/systems", "/api/push/systems"):
            for query, page, size in (("page=2&limit=2", 2, 2), ("page=1&pageSize=3&limit=1", 1, 3),
                                      ("page=-9&pageSize=-2", 1, 1), ("page=bad&pageSize=bad", 1, 20),
                                      ("page=0&pageSize=0&limit=5", 1, 1)):
                with self.subTest(route=route, query=query):
                    response = client.get(f"{route}?{query}")
                    self.assertEqual(200, response.status_code, response.text)
                    payload = response.json()
                    self.assertEqual((7, page, size), (payload["total"], payload["page"], payload["pageSize"]))
            legacy = client.get(route).json()
            self.assertEqual({"items"}, set(legacy))
            self.assertEqual(7, len(legacy["items"]))
        for service in (self.upstream, self.push):
            with patch(f"{service.__module__}.get_page_size_limits", return_value=(20, 100)):
                self.assertEqual((1, 100), service._resolve_paging("1", "99999"))

    def test_routes_keep_public_projection_and_protect_admin_details(self):
        client = self._client()
        with patch.dict(os.environ, {"PUBLIC_CATALOG_PROFILE": "strict"}):
            for route in ("/api/upstreams/systems?page=1&pageSize=1", "/api/push/systems?page=1&pageSize=1"):
                response = client.get(route)
                self.assertEqual(200, response.status_code, response.text)
                item = response.json()["items"][0]
                for hidden in ("host", "db", "schema", "owner", "account", "downstreamContact", "dataDeveloperContact"):
                    self.assertNotIn(hidden, item)
        for route in ("/api/upstreams/systems/up_07/admin-detail", "/api/push/systems/PUSH_07/admin-detail"):
            self.assertEqual(401, client.get(route).status_code)
        self.assertEqual("PUSH_07", client.get("/api/push/systems/PUSH_07").json()["data"]["id"])
        self.assertEqual("up_07", client.get("/api/upstreams/systems/up_07").json()["data"]["id"])

    def test_empty_catalog_and_all_sql_statements_compile_for_existing_providers(self):
        self.connection.execute("UPDATE dwp.p_upstream_system SET is_deleted = 'Y'")
        self.connection.execute("UPDATE dwp.p_push_system SET is_deleted = 'Y'")
        self.connection.commit()
        for service, method in ((self.upstream, self.upstream.get_system_page), (self.push, self.push.get_push_system_page)):
            result = method(page=1, page_size=3)
            self.assertEqual(([], 0, 0), (result["items"], result["total"], result["stats"]["systemCount"]))
            self.assertTrue(all(not counts for counts in result["facets"].values()))
        for statement in self.statements:
            for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
                statement.compile(dialect=dialect)


if __name__ == "__main__":
    unittest.main()
