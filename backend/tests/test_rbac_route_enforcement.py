"""P3 backend route permission and direct API bypass tests."""

# pyright: reportMissingImports=false

from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from backend.app.application.identity import Identity
from backend.app.authorization.core import (
    AuthorizationDecision,
    AuthorizationService,
    AuthorizationSubject,
)
from backend.app.fastapi_app import create_fastapi_app


class RoutePermissionInventoryTests(unittest.TestCase):
    PUBLIC_GETS = {
        "/api/capabilities",
        "/api/portal/stats",
        "/api/search",
        "/api/assets/tables",
        "/api/assets/tables/{table_name}",
        "/api/assets/tables/{table_name}/fields",
        "/api/assets/tables/{table_name}/ddl",
        "/api/assets/domains",
        "/api/assets/layers",
        "/api/field-mappings/source-systems",
        "/api/field-mappings/stats",
        "/api/field-mappings/fields",
        "/api/field-mappings/tables",
        "/api/lineage/bootstrap",
        "/api/lineage/assets",
        "/api/lineage/subgraph",
        "/api/lineage/initial-view",
        "/api/roots",
        "/api/roots/categories",
        "/api/roots/{abbr}",
        "/api/indicators",
        "/api/indicators/{indicator_id}",
        "/api/reports",
        "/api/reports/{report_code}",
        "/api/api-assets",
        "/api/api-assets/downstream-systems",
        "/api/api-assets/systems",
        "/api/api-assets/{api_code}",
        "/api/manual-code-tables",
        "/api/manual-code-tables/export",
        "/api/manual-code-tables/{table_id}",
        "/api/upstreams/systems",
        "/api/upstreams/systems/{system_id}",
        "/api/push/systems",
        "/api/push/systems/{system_id}",
        "/api/system/menus",
    }

    EXPECTED = {
        ("POST", "/api/assets/tables"): "asset:write",
        ("PUT", "/api/assets/tables/{table_name}"): "asset:write",
        ("POST", "/api/roots"): "root:write",
        ("POST", "/api/indicators"): "indicator:write",
        ("POST", "/api/reports"): "report:write",
        ("POST", "/api/api-assets"): "api_asset:write",
        (
            "GET",
            "/api/upstreams/systems/{system_id}/admin-detail",
        ): "upstream:read",
        ("POST", "/api/upstreams/systems"): "upstream:write",
        (
            "GET",
            "/api/push/systems/{system_id}/admin-detail",
        ): "push:read",
        ("POST", "/api/push/systems"): "push:write",
        ("POST", "/api/manual-code-tables"): "code_table:write",
        (
            "POST",
            "/api/metadata/assets/ingestions",
        ): "metadata:write",
        (
            "POST",
            "/api/metadata/assets:bulk-upsert",
        ): "metadata:write",
        (
            "POST",
            "/api/metadata/lineage/ingestions",
        ): "metadata:write",
        (
            "POST",
            "/api/metadata/lineage:snapshots",
        ): "metadata:write",
        (
            "GET",
            "/api/metadata/ingestions/{ingestion_id}",
        ): "metadata:read",
        ("GET", "/api/operation-logs"): "operation_log:read",
        ("GET", "/api/system/users"): "system:user:read",
        ("POST", "/api/system/users"): "system:user:write",
        ("PATCH", "/api/system/users/{username}/role"): "system:user:write",
        ("GET", "/api/system/permissions"): "system:role:read",
        ("GET", "/api/system/roles"): "system:role:read",
        ("POST", "/api/system/roles"): "system:role:write",
        ("PUT", "/api/system/roles/{role_code}"): "system:role:write",
        ("DELETE", "/api/system/roles/{role_code}"): "system:role:write",
        ("POST", "/api/system/menus"): "system:menu:write",
        ("GET", "/api/system/param-dicts"): "system:param:read",
        ("POST", "/api/system/param-dicts"): "system:param:write",
    }

    @staticmethod
    def _concrete_path(path: str) -> str:
        return "/".join(
            "contract-value" if segment.startswith("{") else segment
            for segment in path.split("/")
        )

    @staticmethod
    def _denying_authorization_service() -> MagicMock:
        subject = AuthorizationSubject("contract-user", "contract-role")
        service = MagicMock(spec=AuthorizationService)
        service.repository = MagicMock()
        authenticated = AuthorizationDecision(
            authenticated=True,
            allowed=True,
            subject=subject,
            reason="authenticated",
        )
        service.authenticate.return_value = authenticated

        def deny(_identity, permission, *, authentication=None):
            return AuthorizationDecision(
                authenticated=True,
                allowed=False,
                permission=permission,
                subject=subject,
                reason="missing_permission",
            )

        service.authorize.side_effect = deny
        return service

    def test_sensitive_routes_are_registered_with_the_declared_permission(self):
        authorization = self._denying_authorization_service()
        app = create_fastapi_app(
            identity_resolver=lambda _request: Identity(
                "contract-role", "contract-user", "Contract"
            ),
            authorization_service_instance=authorization,
        )
        client = TestClient(app)

        for (method, path), permission in self.EXPECTED.items():
            with self.subTest(route=(method, path)):
                # Hidden compatibility aliases are intentionally omitted from
                # OpenAPI, so the request below is the registration check for
                # those routes as well as the permission check for every route.
                payload = None if method in {"GET", "HEAD", "OPTIONS"} else {}
                response = client.request(
                    method,
                    self._concrete_path(path),
                    json=payload,
                )
                self.assertEqual(403, response.status_code)
                self.assertEqual("FORBIDDEN", response.json()["error"]["code"])
                authorization.authorize.assert_called_once()
                self.assertEqual(
                    permission,
                    authorization.authorize.call_args.args[1],
                )
                authorization.authorize.reset_mock()

    def test_only_non_public_routes_require_authentication_by_default(self):
        app = create_fastapi_app(identity_resolver=lambda _request: None)
        client = TestClient(app)
        explicit_auth = {
            ("POST", "/api/auth/login"),
            ("GET", "/api/auth/me"),
            ("POST", "/api/auth/logout"),
            ("GET", "/api/capabilities"),
        }
        for path, operations in app.openapi()["paths"].items():
            for method in operations:
                if method == "parameters":
                    continue
                key = (method.upper(), path)
                if key in explicit_auth or (method.upper() == "GET" and path in self.PUBLIC_GETS):
                    continue
                with self.subTest(route=key):
                    payload = None if method in {"get", "head", "options"} else {}
                    response = client.request(
                        method.upper(),
                        self._concrete_path(path),
                        json=payload,
                    )
                    self.assertEqual(401, response.status_code, response.text)
                    self.assertEqual(
                        "UNAUTHORIZED", response.json()["error"]["code"]
                    )

    def test_public_catalog_gets_do_not_carry_authentication_guard(self):
        app = create_fastapi_app(identity_resolver=lambda _request: None)
        routes = {
            route.path: route
            for wrapper in app.routes
            for route in getattr(getattr(wrapper, "original_router", None), "routes", [])
            if isinstance(route, APIRoute) and "GET" in (route.methods or ())
        }
        for path in self.PUBLIC_GETS:
            with self.subTest(path=path):
                self.assertIn(path, routes)
                dependency_names = {
                    getattr(dependency.call, "__name__", "")
                    for dependency in routes[path].dependant.dependencies
                }
                self.assertNotIn("require_authenticated", dependency_names)

    def test_ordinary_business_reads_are_registered(self):
        registered = {
            (method.upper(), path)
            for path, operations in create_fastapi_app(
                identity_resolver=lambda _request: None
            ).openapi()["paths"].items()
            for method in operations
            if method != "parameters"
        }
        ordinary_reads = {
            ("GET", "/api/assets/tables"),
            ("GET", "/api/indicators"),
            ("GET", "/api/search"),
            ("GET", "/api/lineage/bootstrap"),
            ("GET", "/api/field-mappings/fields"),
            ("GET", "/api/system/menus"),
        }
        for key in ordinary_reads:
            with self.subTest(route=key):
                self.assertIn(key, registered)


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
        self.assertEqual(200, anonymous_read.status_code)
        self.assertEqual([], anonymous_read.json()["items"])
        anonymous_mutation = client.post("/api/indicators", json={})
        self.assertEqual(401, anonymous_mutation.status_code)


if __name__ == "__main__":
    unittest.main()
