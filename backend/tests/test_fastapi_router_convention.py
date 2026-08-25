"""Contract tests for the incremental FastAPI router convention."""

# pyright: reportMissingImports=false

from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from fastapi import APIRouter
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from backend.app.fastapi_app import create_fastapi_app
from backend.app.fastapi.dependencies import require_authenticated
from backend.app.fastapi.routers import operation_logs


class OperationLogRouterConventionTests(unittest.TestCase):
    EXPECTED_ROUTES = {
        ("GET", "/api/operation-logs"): "get_operation_logs",
        ("GET", "/api/operation-logs/{log_id}"): "get_operation_log_detail",
    }

    def app(self):
        return create_fastapi_app(
            identity_resolver=lambda _request: None,
            operation_log_service_instance=MagicMock(),
        )

    def test_pilot_is_a_module_owned_router(self):
        self.assertIsInstance(operation_logs.router, APIRouter)
        self.assertFalse(hasattr(operation_logs, "_register_operation_log_routes"))
        self.assertEqual("/api/operation-logs", operation_logs.router.prefix)
        self.assertEqual(["operation-log-migration"], operation_logs.router.tags)

    def test_route_surface_and_dependencies_are_preserved(self):
        app = self.app()
        paths = app.openapi()["paths"]
        module_routes = {
            (method, route.path): route
            for route in operation_logs.router.routes
            if isinstance(route, APIRoute)
            for method in route.methods or ()
        }

        self.assertEqual(set(self.EXPECTED_ROUTES), set(module_routes))
        for (method, path), expected_name in self.EXPECTED_ROUTES.items():
            with self.subTest(route=(method, path)):
                operation = paths[path][method.lower()]
                self.assertTrue(
                    operation["operationId"].startswith(f"{expected_name}_")
                )
                self.assertEqual(["operation-log-migration"], operation["tags"])
                route = module_routes[(method, path)]
                dependency_names = {
                    getattr(dependency.call, "__name__", "")
                    for dependency in route.dependant.dependencies
                }
                self.assertIn("require_authenticated", dependency_names)
                self.assertIn(
                    "require_permission_operation_log_read", dependency_names
                )

    def test_pilot_keeps_existing_registration_order(self):
        app = self.app()
        paths = list(app.openapi()["paths"])
        operation_indices = [
            index
            for index, path in enumerate(paths)
            if path.startswith("/api/operation-logs")
        ]
        system_indices = [
            index for index, path in enumerate(paths) if path.startswith("/api/system/")
        ]
        upstream_indices = [
            index for index, path in enumerate(paths) if path.startswith("/api/upstreams/")
        ]
        self.assertTrue(operation_indices)
        self.assertTrue(system_indices)
        self.assertTrue(upstream_indices)
        self.assertGreater(min(operation_indices), max(system_indices))
        self.assertLess(max(operation_indices), min(upstream_indices))

    def test_service_factory_and_dependency_override_seams_remain_explicit(self):
        service = MagicMock()
        service.get_logs.return_value = {"items": [], "total": 0}
        app = create_fastapi_app(
            identity_resolver=lambda _request: None,
            operation_log_service_instance=service,
        )
        self.assertIs(service, app.state.operation_log_service)

        override = MagicMock()
        override.get_logs.return_value = {"items": [], "total": 0}
        app.dependency_overrides[require_authenticated] = lambda: None
        app.dependency_overrides[operation_logs.require_operation_log_read] = (
            lambda: None
        )
        app.dependency_overrides[operation_logs.get_operation_logs_service] = (
            lambda: override
        )

        response = TestClient(app).get("/api/operation-logs")
        self.assertEqual(200, response.status_code)
        override.get_logs.assert_called_once()
        service.get_logs.assert_not_called()


if __name__ == "__main__":
    unittest.main()
