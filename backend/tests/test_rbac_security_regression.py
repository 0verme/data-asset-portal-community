"""P7 end-to-end RBAC security matrix and direct API bypass tests."""

from __future__ import annotations

# pyright: reportMissingImports=false

import unittest
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from backend.app.application.identity import Identity
from backend.app.authorization.core import AuthorizationService, AuthorizationSubject
from backend.app.fastapi_app import create_fastapi_app


class RbacSecurityRegressionTests(unittest.TestCase):
    def setUp(self):
        self.current_identity = None
        self.subjects = {
            "custom": AuthorizationSubject("custom", "indicator-reader"),
            "role-reader": AuthorizationSubject("role-reader", "role-reader"),
            "disabled": AuthorizationSubject("disabled", "indicator-reader", user_enabled=False),
        }
        self.permission_sets = {
            "indicator-reader": {"indicator:read"},
            "role-reader": {"system:role:read"},
        }
        repository = MagicMock()
        repository.get_subject.side_effect = lambda identity: self.subjects.get(identity.user)
        repository.get_permissions.side_effect = lambda role: self.permission_sets.get(role, set())
        self.authorization = AuthorizationService(repository)
        self.system_service = MagicMock()
        self.system_service.get_roles.return_value = [
            {"roleCode": "indicator-reader", "builtin": False},
        ]
        self.system_service.get_permissions.return_value = []
        self.system_service.get_menus.return_value = [
            {"code": "system", "status": "enabled", "adminOnly": True},
        ]
        self.indicator_service = MagicMock()
        self.indicator_service.get_indicators.return_value = []
        self.client = TestClient(
            create_fastapi_app(
                identity_resolver=lambda _request: self.current_identity,
                authorization_service_instance=self.authorization,
                system_management_service_instance=self.system_service,
                indicator_service_instance=self.indicator_service,
            )
        )

    def test_custom_role_cannot_bypass_sensitive_api_or_role_management(self):
        self.current_identity = Identity("indicator-reader", "custom", "Custom")

        forbidden_mutation = self.client.post("/api/indicators", json={})
        self.assertEqual(403, forbidden_mutation.status_code)
        self.indicator_service.create_indicator.assert_not_called()

        forbidden_roles = self.client.get("/api/system/roles")
        self.assertEqual(403, forbidden_roles.status_code)
        self.system_service.get_roles.assert_not_called()

        ordinary_read = self.client.get("/api/indicators")
        self.assertEqual(200, ordinary_read.status_code)
        self.assertEqual([], ordinary_read.json()["items"])

    def test_role_reader_can_read_roles_but_guest_and_disabled_user_cannot(self):
        self.current_identity = Identity("role-reader", "role-reader", "Role reader")
        allowed = self.client.get("/api/system/roles")
        self.assertEqual(200, allowed.status_code)
        self.system_service.get_roles.assert_called_once_with()

        self.current_identity = None
        guest = self.client.get("/api/system/roles")
        self.assertEqual(401, guest.status_code)

        self.current_identity = Identity("indicator-reader", "disabled", "Disabled")
        disabled = self.client.get("/api/system/roles")
        self.assertEqual(401, disabled.status_code)

    def test_authenticated_menu_read_is_not_an_authorization_boundary(self):
        self.current_identity = Identity("indicator-reader", "custom", "Custom")
        response = self.client.get("/api/system/menus")
        self.assertEqual(200, response.status_code)
        self.assertEqual("system", response.json()["items"][0]["code"])
        self.assertNotIn("permission", response.text.lower())

        self.current_identity = None
        anonymous = self.client.get("/api/system/menus")
        self.assertEqual(401, anonymous.status_code)
        self.system_service.get_menus.assert_called_once()

    def test_anonymous_business_reads_return_401_across_catalog_groups(self):
        self.current_identity = None
        representative_reads = (
            "/api/assets/tables",
            "/api/indicators",
            "/api/search?q=customer",
            "/api/lineage/bootstrap",
            "/api/field-mappings/fields",
            "/api/system/menus",
        )
        for path in representative_reads:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(401, response.status_code)
                self.assertEqual("UNAUTHORIZED", response.json()["error"]["code"])
                self.assertNotIn("permission", response.text.lower())
                self.assertNotIn("database", response.text.lower())

    def test_authenticated_missing_role_write_cannot_create_role_directly(self):
        self.current_identity = Identity("role-reader", "role-reader", "Role reader")
        response = self.client.post(
            "/api/system/roles",
            json={"roleCode": "new-role", "name": "New role", "permissionCodes": []},
        )
        self.assertEqual(403, response.status_code)
        self.system_service.create_role.assert_not_called()
