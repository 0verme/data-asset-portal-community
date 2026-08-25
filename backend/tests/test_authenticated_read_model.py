"""P0 authenticated-by-default business read model regression tests."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from backend.app.application import Identity
from backend.app.authorization.core import AuthorizationService, AuthorizationSubject
from backend.app.authorization.permissions import BUILTIN_ROLE_PERMISSION_CODES
from backend.app.fastapi_app import create_fastapi_app


ORDINARY_READS = (
    "/api/assets/tables",
    "/api/indicators",
    "/api/portal/stats",
    "/api/search?q=customer",
    "/api/lineage/bootstrap",
    "/api/field-mappings/fields",
    "/api/system/menus",
)


class AuthenticatedReadModelApiTests(unittest.TestCase):
    def setUp(self):
        self.current_identity: Identity | None = None
        self.subjects = {
            "normal": AuthorizationSubject("normal", "catalog-reader"),
            "no-permission": AuthorizationSubject("no-permission", "catalog-reader"),
            "admin": AuthorizationSubject("admin", "admin"),
        }
        self.permission_sets = {
            "catalog-reader": set(),
            "admin": BUILTIN_ROLE_PERMISSION_CODES["admin"],
        }
        repository = MagicMock()
        repository.get_subject.side_effect = lambda identity: self.subjects.get(identity.user)
        repository.get_permissions.side_effect = lambda role: self.permission_sets.get(role, set())
        self.repository = repository
        self.authorization = AuthorizationService(repository)

        self.assets = MagicMock()
        self.assets.get_asset_tables.return_value = []
        self.indicators = MagicMock()
        self.indicators.get_indicators.return_value = []
        self.portal = MagicMock()
        self.portal.get_stats.return_value = []
        self.search = MagicMock()
        self.search.search.return_value = {"query": "customer", "scope": "all", "groups": [], "total": 0}
        self.lineage = MagicMock()
        self.lineage.get_bootstrap.return_value = {}
        self.mapping = MagicMock()
        self.mapping.get_field_mappings.return_value = {"items": []}
        self.system = MagicMock()
        self.system.get_menus.return_value = [{"code": "system", "status": "enabled"}]
        self.system.get_roles.return_value = []
        self.indicators.create_indicator.return_value = {"id": "I1", "name": "Indicator"}

        self.app = create_fastapi_app(
            identity_resolver=lambda _request: self.current_identity,
            authorization_service_instance=self.authorization,
            assets_service_instance=self.assets,
            indicator_service_instance=self.indicators,
            portal_service_instance=self.portal,
            search_provider_instance=self.search,
            lineage_service_instance=self.lineage,
            field_mapping_service_instance=self.mapping,
            system_management_service_instance=self.system,
        )
        self.client = TestClient(self.app)

    def test_anonymous_business_reads_are_401_and_do_not_reach_services(self):
        self.current_identity = None
        for path in ORDINARY_READS:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(401, response.status_code)
                self.assertEqual("UNAUTHORIZED", response.json()["error"]["code"])
                self.assertNotIn("permission", response.text.lower())
                self.assertNotIn("role", response.text.lower())
                self.assertNotIn("database", response.text.lower())

        self.assets.get_asset_tables.assert_not_called()
        self.indicators.get_indicators.assert_not_called()
        self.portal.get_stats.assert_not_called()
        self.search.search.assert_not_called()
        self.lineage.get_bootstrap.assert_not_called()
        self.mapping.get_field_mappings.assert_not_called()
        self.system.get_menus.assert_not_called()

    def test_authenticated_user_without_read_permissions_can_browse_ordinary_catalog(self):
        self.current_identity = Identity("catalog-reader", "normal", "Normal")
        for path in ORDINARY_READS:
            with self.subTest(path=path):
                self.assertEqual(200, self.client.get(path).status_code)

    def test_authenticated_user_without_sensitive_permission_is_denied_sensitive_and_mutation(self):
        self.current_identity = Identity("catalog-reader", "no-permission", "No permission")
        self.assertEqual(200, self.client.get("/api/indicators").status_code)

        sensitive = self.client.get("/api/system/roles")
        self.assertEqual(403, sensitive.status_code)
        self.assertEqual("FORBIDDEN", sensitive.json()["error"]["code"])
        self.assertNotIn("system:role", sensitive.text)
        self.assertNotIn("database", sensitive.text.lower())
        self.system.get_roles.assert_not_called()

        mutation = self.client.post("/api/indicators", json={"name": "blocked"})
        self.assertEqual(403, mutation.status_code)
        self.assertEqual("FORBIDDEN", mutation.json()["error"]["code"])
        self.indicators.create_indicator.assert_not_called()

    def test_authentication_decision_is_request_scoped_for_sensitive_routes(self):
        self.current_identity = Identity("catalog-reader", "no-permission", "No permission")
        self.assertEqual(403, self.client.get("/api/system/roles").status_code)
        self.assertEqual(1, self.repository.get_subject.call_count)

    def test_admin_can_read_sensitive_data_and_mutate_where_permitted(self):
        self.current_identity = Identity("admin", "admin", "Admin")
        for path in ORDINARY_READS:
            with self.subTest(path=path):
                self.assertEqual(200, self.client.get(path).status_code)

        self.assertEqual(200, self.client.get("/api/system/roles").status_code)
        self.assertEqual(201, self.client.post("/api/indicators", json={"name": "Indicator"}).status_code)
        self.indicators.create_indicator.assert_called_once()

    def test_only_explicit_auth_and_capability_routes_are_unguarded(self):
        explicit = {
            ("POST", "/api/auth/login"),
            ("GET", "/api/auth/me"),
            ("POST", "/api/auth/logout"),
            ("GET", "/api/capabilities"),
        }
        paths = self.app.openapi()["paths"]
        registered = {
            (method.upper(), path)
            for path, operations in paths.items()
            for method in operations
            if method != "parameters"
        }
        self.assertTrue(explicit.issubset(registered))

        def concrete_path(path):
            return "/".join(
                "contract-value" if segment.startswith("{") else segment
                for segment in path.split("/")
            )

        for method, path in sorted(registered - explicit):
            with self.subTest(route=(method, path)):
                payload = None if method in {"GET", "HEAD", "OPTIONS"} else {}
                response = self.client.request(
                    method,
                    concrete_path(path),
                    json=payload,
                )
                self.assertEqual(401, response.status_code)
                self.assertEqual("UNAUTHORIZED", response.json()["error"]["code"])


if __name__ == "__main__":
    unittest.main()
