"""P3 backend route permission and direct API bypass tests."""

# pyright: reportMissingImports=false

from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from backend.app.application.identity import Identity
from backend.app.authorization.core import AuthorizationService, AuthorizationSubject
from backend.app.fastapi_app import create_fastapi_app


class RoutePermissionInventoryTests(unittest.TestCase):
    EXPECTED = {
        ("POST", "/api/assets/tables"): "require_permission_asset_write",
        ("PUT", "/api/assets/tables/{table_name}"): "require_permission_asset_write",
        ("POST", "/api/roots"): "require_permission_root_write",
        ("POST", "/api/indicators"): "require_permission_indicator_write",
        ("POST", "/api/reports"): "require_permission_report_write",
        ("POST", "/api/api-assets"): "require_permission_api_asset_write",
        (
            "GET",
            "/api/upstreams/systems/{system_id}/admin-detail",
        ): "require_permission_upstream_read",
        ("POST", "/api/upstreams/systems"): "require_permission_upstream_write",
        (
            "GET",
            "/api/push/systems/{system_id}/admin-detail",
        ): "require_permission_push_read",
        ("POST", "/api/push/systems"): "require_permission_push_write",
        ("POST", "/api/manual-code-tables"): "require_permission_code_table_write",
        (
            "POST",
            "/api/metadata/assets/ingestions",
        ): "require_permission_metadata_write",
        (
            "POST",
            "/api/metadata/assets:bulk-upsert",
        ): "require_permission_metadata_write",
        (
            "POST",
            "/api/metadata/lineage/ingestions",
        ): "require_permission_metadata_write",
        (
            "POST",
            "/api/metadata/lineage:snapshots",
        ): "require_permission_metadata_write",
        (
            "GET",
            "/api/metadata/ingestions/{ingestion_id}",
        ): "require_permission_metadata_read",
        ("GET", "/api/operation-logs"): "require_permission_operation_log_read",
        ("GET", "/api/system/users"): "require_permission_system_user_read",
        ("POST", "/api/system/users"): "require_permission_system_user_write",
        ("PATCH", "/api/system/users/{username}/role"): "require_permission_system_user_write",
        ("GET", "/api/system/permissions"): "require_permission_system_role_read",
        ("GET", "/api/system/roles"): "require_permission_system_role_read",
        ("POST", "/api/system/roles"): "require_permission_system_role_write",
        ("PUT", "/api/system/roles/{role_code}"): "require_permission_system_role_write",
        ("DELETE", "/api/system/roles/{role_code}"): "require_permission_system_role_write",
        ("POST", "/api/system/menus"): "require_permission_system_menu_write",
        ("GET", "/api/system/param-dicts"): "require_permission_system_param_read",
        ("POST", "/api/system/param-dicts"): "require_permission_system_param_write",
    }

    def test_sensitive_routes_have_explicit_permission_dependencies(self):
        app = create_fastapi_app(identity_resolver=lambda _request: None)
        found = {}
        for route in app.routes:
            if not isinstance(route, APIRoute):
                continue
            dependency_names = {
                getattr(dependency.call, "__name__", "")
                for dependency in route.dependant.dependencies
            }
            for method in route.methods or ():
                found[(method, route.path)] = dependency_names

        for key, dependency_name in self.EXPECTED.items():
            with self.subTest(route=key):
                self.assertIn(key, found)
                self.assertIn(dependency_name, found[key])

    def test_business_routes_require_authentication_by_default(self):
        app = create_fastapi_app(identity_resolver=lambda _request: None)
        explicit_auth_contract = {
            ("POST", "/api/auth/login"),
            ("GET", "/api/auth/me"),
            ("POST", "/api/auth/logout"),
            ("GET", "/api/capabilities"),
        }
        for route in app.routes:
            if not isinstance(route, APIRoute):
                continue
            names = {
                getattr(dependency.call, "__name__", "")
                for dependency in route.dependant.dependencies
            }
            for method in route.methods or ():
                if (method, route.path) in explicit_auth_contract:
                    continue
                with self.subTest(route=(method, route.path)):
                    self.assertIn("require_authenticated", names)

    def test_ordinary_business_reads_are_authentication_only(self):
        app = create_fastapi_app(identity_resolver=lambda _request: None)
        ordinary_reads = {
            ("GET", "/api/assets/tables"),
            ("GET", "/api/indicators"),
            ("GET", "/api/search"),
            ("GET", "/api/lineage/bootstrap"),
            ("GET", "/api/field-mappings/fields"),
            ("GET", "/api/system/menus"),
        }
        routes = {
            (method, route.path): route
            for route in app.routes
            if isinstance(route, APIRoute)
            for method in route.methods or ()
        }
        for key in ordinary_reads:
            with self.subTest(route=key):
                self.assertIn(key, routes)
                names = {
                    getattr(dependency.call, "__name__", "")
                    for dependency in routes[key].dependant.dependencies
                }
                self.assertIn("require_authenticated", names)
                self.assertFalse(any(name.startswith("require_permission_") for name in names))


class DirectApiBypassTests(unittest.TestCase):
    def test_missing_permission_returns_403_before_mutation_service(self):
        current_identity: Identity | None = Identity(
            "indicator-maintainer", "custom-user", "Custom"
        )
        repository = MagicMock()
        repository.get_subject.return_value = AuthorizationSubject(
            "custom-user", "indicator-maintainer"
        )
        repository.get_permissions.return_value = {"indicator:read"}
        service = AuthorizationService(repository)
        indicator_service = MagicMock()
        indicator_service.get_indicators.return_value = []

        app = create_fastapi_app(
            identity_resolver=lambda _request: current_identity,
            authorization_service_instance=service,
            indicator_service_instance=indicator_service,
        )
        client = TestClient(app)

        forbidden = client.post("/api/indicators", json={})
        self.assertEqual(403, forbidden.status_code)
        indicator_service.create_indicator.assert_not_called()

        authenticated_read = client.get("/api/indicators")
        self.assertEqual(200, authenticated_read.status_code)
        self.assertEqual([], authenticated_read.json()["items"])

        current_identity = None
        anonymous_read = client.get("/api/indicators")
        self.assertEqual(401, anonymous_read.status_code)
        anonymous_mutation = client.post("/api/indicators", json={})
        self.assertEqual(401, anonymous_mutation.status_code)


if __name__ == "__main__":
    unittest.main()
