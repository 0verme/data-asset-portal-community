# Copyright 2025 Jearhe
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Issue #336: PUBLIC_CATALOG_PROFILE drives display *and* search.

The anonymous catalog policy is one source of truth: a field hidden from a
profile must not be searchable and must not leak through ``matchedFields``.
Runs against a real temporary SQLite repository (community profile + demo
seed) so provider SQL and upstream keyword SQL are executed, not mocked.
"""

# pyright: reportMissingImports=false

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app.application import Identity
from backend.app.authorization.core import AuthorizationService
from backend.app.db.facade import clear_engine_cache, connect_with_profile
from backend.app.fastapi_app import create_fastapi_app
from backend.app.migrations.schema import initialize
from backend.app.security.public_field_policy import (
    project_public_value,
    public_field_class_visible,
    sanitize_connection_uri,
)
from backend.app.services.search_provider import KeywordSearchProvider
from backend.app.services.upstream_service import UpstreamService
from demo.seed_sqlite import seed

ROOT = Path(__file__).resolve().parents[1]
COMMUNITY_CONFIG = ROOT / "configs" / "database.community.yaml"

SCHEMA_KEYWORD = "DEMO_FUL_OWNER"
HOST_KEYWORD = "ful.demo.invalid"
DB_KEYWORD = "DEMO_FUL"
SYSTEM_ID_KEYWORD = "up_fulfillment"
SYSTEM_NAME_KEYWORD = "履约平台"
OWNER_KEYWORD = "演示数据维护组"


class PublicFieldPolicyUnitTests(unittest.TestCase):
    def test_connection_and_person_visibility_is_profile_driven(self):
        self.assertTrue(public_field_class_visible("business", "internal"))
        self.assertTrue(public_field_class_visible("business", "strict"))
        self.assertTrue(public_field_class_visible("connection", "internal"))
        self.assertFalse(public_field_class_visible("connection", "strict"))
        self.assertTrue(public_field_class_visible("person", "internal"))
        self.assertFalse(public_field_class_visible("person", "strict"))
        # Unknown classes fail closed instead of silently becoming public.
        self.assertFalse(public_field_class_visible("unknown-class", "internal"))

    def test_internal_keeps_locators_and_strict_hides_them(self):
        source = {
            "id": "up_fulfillment",
            "host": "ful.demo.invalid",
            "port": 5432,
            "db": "DEMO_FUL",
            "schema": "DEMO_FUL_OWNER",
            "jdbcUrl": "jdbc:postgresql://ful.demo.invalid:5432/DEMO_FUL?user=x&password=y",
            "owner": "演示数据维护组",
            "password": "nope",
            "token": "nope",
        }
        internal = project_public_value(source, profile="internal")
        strict = project_public_value(source, profile="strict")

        for key in ("host", "port", "db", "schema", "jdbcUrl", "owner"):
            self.assertIn(key, internal)
        self.assertEqual(
            "jdbc:postgresql://ful.demo.invalid:5432/DEMO_FUL",
            internal["jdbcUrl"],
        )
        for key in ("host", "port", "db", "schema", "jdbcUrl", "owner"):
            self.assertNotIn(key, strict)
        for key in ("password", "token"):
            self.assertNotIn(key, internal)
            self.assertNotIn(key, strict)

    def test_sanitize_connection_uri_keeps_safe_endpoint(self):
        self.assertEqual(
            "jdbc:postgresql://demo.invalid:5432/db?sslmode=require",
            sanitize_connection_uri(
                "jdbc:postgresql://user:pass@demo.invalid:5432/db?user=x&password=y&sslmode=require"
            ),
        )


class _CatalogDatabaseMixin:
    @classmethod
    def setUpClass(cls):
        cls._temp_dir = tempfile.TemporaryDirectory()
        cls.database = Path(cls._temp_dir.name) / "public-catalog-search.sqlite"
        cls._environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(COMMUNITY_CONFIG),
                "ASSET_DB_PROFILE": "community_sqlite",
                "ASSET_DB_DATABASE": str(cls.database),
            },
            clear=False,
        )
        cls._environment.start()
        connection = connect_with_profile("community_sqlite")
        try:
            config = {"type": "sqlite", "database": str(cls.database)}
            assert initialize(connection, config, "sqlite")
        finally:
            connection.close()
        seed(cls.database)
        cls.addClassCleanup(clear_engine_cache)
        cls.addClassCleanup(cls._environment.stop)
        cls.addClassCleanup(cls._temp_dir.cleanup)

    def setUp(self):
        self.provider = KeywordSearchProvider()
        self.service = UpstreamService()


class PublicCatalogSearchPolicyTestCase(_CatalogDatabaseMixin, unittest.TestCase):
    def _system_group(self, result):
        return next(group for group in result["groups"] if group["type"] == "system")

    # --- unified search ----------------------------------------------------

    def test_internal_searches_schema_host_and_database(self):
        # Contract keywords shared with the frontend mock search test.
        for keyword in (
            "FUL",
            SYSTEM_ID_KEYWORD,
            HOST_KEYWORD,
            SCHEMA_KEYWORD,
            DB_KEYWORD,
        ):
            with self.subTest(keyword=keyword):
                result = self.provider.search(
                    keyword, scope="system", limit=5, profile="internal"
                )
                group = self._system_group(result)
                self.assertGreaterEqual(group["count"], 1)
                ids = [item["id"] for item in group["items"]]
                self.assertIn(SYSTEM_ID_KEYWORD, ids)

    def test_internal_matched_fields_expose_the_locator_that_matched(self):
        result = self.provider.search(
            SCHEMA_KEYWORD, scope="system", limit=5, profile="internal"
        )
        item = next(
            item
            for item in self._system_group(result)["items"]
            if item["id"] == SYSTEM_ID_KEYWORD
        )
        self.assertIn(
            {"label": "Schema", "value": SCHEMA_KEYWORD},
            item["matchedFields"],
        )

    def test_strict_does_not_hit_hidden_connection_or_person_fields(self):
        for keyword in (SCHEMA_KEYWORD, HOST_KEYWORD, DB_KEYWORD, OWNER_KEYWORD):
            with self.subTest(keyword=keyword):
                result = self.provider.search(
                    keyword, scope="system", limit=5, profile="strict"
                )
                group = self._system_group(result)
                self.assertEqual(0, group["count"])
                self.assertEqual([], group["items"])

    def test_strict_business_search_never_returns_hidden_values(self):
        result = self.provider.search(
            SYSTEM_NAME_KEYWORD, scope="system", limit=5, profile="strict"
        )
        group = self._system_group(result)
        self.assertGreaterEqual(group["count"], 1)
        payload = json.dumps(group, ensure_ascii=False)
        for hidden in (SCHEMA_KEYWORD, HOST_KEYWORD, OWNER_KEYWORD):
            self.assertNotIn(hidden, payload)
        item = next(item for item in group["items"] if item["id"] == SYSTEM_ID_KEYWORD)
        self.assertEqual("", item["meta"])
        self.assertNotIn("Schema", [match["label"] for match in item["matchedFields"]])

    # --- upstream keyword --------------------------------------------------

    def test_internal_upstream_keyword_matches_locators_and_returns_them(self):
        for keyword in (SCHEMA_KEYWORD, HOST_KEYWORD, DB_KEYWORD, SYSTEM_ID_KEYWORD):
            with self.subTest(keyword=keyword):
                items = self.service.get_systems(
                    keyword=keyword, profile="internal"
                )
                self.assertEqual([SYSTEM_ID_KEYWORD], [item["id"] for item in items])
                self.assertEqual(HOST_KEYWORD, items[0]["host"])
                self.assertEqual(DB_KEYWORD, items[0]["db"])
                self.assertEqual(SCHEMA_KEYWORD, items[0]["schema"])

    def test_strict_upstream_keyword_excludes_hidden_fields(self):
        for keyword in (SCHEMA_KEYWORD, HOST_KEYWORD, DB_KEYWORD, OWNER_KEYWORD):
            with self.subTest(keyword=keyword):
                items = self.service.get_systems(
                    keyword=keyword, profile="strict"
                )
                self.assertEqual([], items)

        items = self.service.get_systems(keyword=SYSTEM_NAME_KEYWORD, profile="strict")
        self.assertEqual([SYSTEM_ID_KEYWORD], [item["id"] for item in items])
        for key in ("host", "db", "schema", "owner"):
            self.assertNotIn(key, items[0])


class PublicCatalogRoutePolicyTestCase(_CatalogDatabaseMixin, unittest.TestCase):
    """Route-level coverage: the same policy applies to anonymous responses."""

    def _client(self, identity=None):
        return TestClient(
            create_fastapi_app(
                identity_resolver=lambda _request: identity,
                authorization_service_instance=AuthorizationService(),
            )
        )

    def _with_profile(self, profile):
        patcher = patch.dict(os.environ, {"PUBLIC_CATALOG_PROFILE": profile})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_internal_upstream_routes_expose_safe_connection_metadata(self):
        self._with_profile("internal")
        client = self._client()
        listing = client.get("/api/upstreams/systems", params={"keyword": SCHEMA_KEYWORD})
        self.assertEqual(200, listing.status_code, listing.text)
        items = listing.json()["items"]
        self.assertEqual([SYSTEM_ID_KEYWORD], [item["id"] for item in items])
        self.assertEqual(HOST_KEYWORD, items[0]["host"])
        self.assertEqual(SCHEMA_KEYWORD, items[0]["schema"])

        detail = client.get(f"/api/upstreams/systems/{SYSTEM_ID_KEYWORD}")
        self.assertEqual(200, detail.status_code, detail.text)
        data = detail.json()["data"]
        self.assertEqual(HOST_KEYWORD, data["host"])
        self.assertEqual(DB_KEYWORD, data["db"])
        self.assertEqual(SCHEMA_KEYWORD, data["schema"])

    def test_strict_upstream_routes_hide_connection_metadata_and_search(self):
        self._with_profile("strict")
        client = self._client()
        listing = client.get("/api/upstreams/systems", params={"keyword": SCHEMA_KEYWORD})
        self.assertEqual(200, listing.status_code, listing.text)
        self.assertEqual([], listing.json()["items"])

        detail = client.get(f"/api/upstreams/systems/{SYSTEM_ID_KEYWORD}")
        self.assertEqual(200, detail.status_code, detail.text)
        data = detail.json()["data"]
        for key in ("host", "db", "schema", "owner"):
            self.assertNotIn(key, data)

    def test_admin_detail_keeps_full_management_fields(self):
        self._with_profile("strict")
        client = self._client(Identity("admin", "admin", "Admin"))
        detail = client.get(f"/api/upstreams/systems/{SYSTEM_ID_KEYWORD}/admin-detail")
        self.assertEqual(200, detail.status_code, detail.text)
        data = detail.json()["data"]
        self.assertEqual(HOST_KEYWORD, data["host"])
        self.assertEqual(DB_KEYWORD, data["db"])
        self.assertEqual(SCHEMA_KEYWORD, data["schema"])

    def test_strict_search_route_does_not_leak_locators(self):
        self._with_profile("strict")
        client = self._client()
        response = client.get("/api/search", params={"q": SCHEMA_KEYWORD, "scope": "system"})
        self.assertEqual(200, response.status_code, response.text)
        payload = response.json()
        self.assertEqual(0, payload["total"])
        for group in payload["groups"]:
            self.assertEqual(0, group["count"])
            self.assertEqual([], group["items"])

    def test_disabled_profile_rejects_anonymous_search_and_upstream_keyword(self):
        self._with_profile("disabled")
        client = self._client()
        for path in (
            "/api/search?q=DEMO_FUL_OWNER",
            "/api/upstreams/systems?keyword=DEMO_FUL_OWNER",
        ):
            with self.subTest(path=path):
                response = client.get(path)
                self.assertEqual(401, response.status_code, response.text)


if __name__ == "__main__":
    unittest.main()
