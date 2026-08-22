"""P2 framework-neutral authorization core and FastAPI adapter tests."""

# pyright: reportMissingImports=false

from __future__ import annotations

import unittest
from dataclasses import replace

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from backend.app.application.identity import Identity
from backend.app.authorization.core import (
    AuthorizationService,
    AuthorizationSubject,
)
from backend.app.fastapi.dependencies import (
    RequestContextMiddleware,
    require_permission,
)
from backend.app.fastapi.errors import register_exception_handlers


class FakeAuthorizationRepository:
    def __init__(self):
        self.subjects: dict[str, AuthorizationSubject] = {}
        self.permissions: dict[str, set[str]] = {}

    def get_subject(self, identity: Identity):
        return self.subjects.get(identity.user or "")

    def get_permissions(self, role_code: str):
        return self.permissions.get(role_code, set())


class AuthorizationCoreTests(unittest.TestCase):
    def setUp(self):
        self.repository = FakeAuthorizationRepository()
        self.repository.subjects.update(
            {
                "admin-user": AuthorizationSubject("admin-user", "admin"),
                "maintainer-user": AuthorizationSubject("maintainer-user", "maintainer"),
                "custom-user": AuthorizationSubject("custom-user", "indicator-maintainer"),
                "unknown-user": AuthorizationSubject("unknown-user", "retired", role_enabled=False),
                "disabled-role-user": AuthorizationSubject("disabled-role-user", "maintainer", role_enabled=False),
                "disabled-user": AuthorizationSubject("disabled-user", "admin", user_enabled=False),
            }
        )
        self.repository.permissions.update(
            {
                "admin": {"system:user:write", "indicator:write", "operation_log:read"},
                "maintainer": {"indicator:write", "operation_log:read"},
                "indicator-maintainer": {"indicator:read", "indicator:write", "operation_log:read"},
            }
        )
        self.service = AuthorizationService(self.repository)

    def test_admin_and_maintainer_permissions_are_current_and_sorted(self):
        admin = Identity("admin", "admin-user", "Admin")
        maintainer = Identity("maintainer", "maintainer-user", "Maintainer")

        self.assertEqual(
            ("indicator:write", "operation_log:read", "system:user:write"),
            self.service.get_permissions(admin),
        )
        self.assertTrue(self.service.has_permission(admin, "system:user:write"))
        self.assertFalse(self.service.has_permission(maintainer, "system:user:write"))
        self.assertTrue(self.service.has_permission(maintainer, "indicator:write"))

    def test_custom_role_is_exact_and_does_not_inherit_admin(self):
        identity = Identity("indicator-maintainer", "custom-user", "Custom")

        self.assertEqual(
            ("indicator:read", "indicator:write", "operation_log:read"),
            self.service.get_permissions(identity),
        )
        self.assertFalse(self.service.has_permission(identity, "system:user:write"))

    def test_unknown_role_disabled_role_disabled_user_and_deleted_user_fail_closed(self):
        unknown = self.service.authorize(
            Identity("retired", "unknown-user"), "indicator:write"
        )
        disabled_role = self.service.authorize(
            Identity("maintainer", "disabled-role-user"), "indicator:write"
        )
        disabled_user = self.service.authorize(
            Identity("admin", "disabled-user"), "system:user:write"
        )
        deleted_user = self.service.authorize(
            Identity("admin", "deleted-user"), "system:user:write"
        )

        self.assertTrue(unknown.authenticated)
        self.assertEqual("role_unknown_or_disabled", unknown.reason)
        self.assertFalse(unknown.allowed)
        self.assertTrue(disabled_role.authenticated)
        self.assertFalse(disabled_role.allowed)
        self.assertFalse(disabled_user.authenticated)
        self.assertEqual("user_disabled", disabled_user.reason)
        self.assertFalse(deleted_user.authenticated)
        self.assertEqual("user_not_found", deleted_user.reason)

    def test_missing_and_unknown_permission_are_denied(self):
        identity = Identity("maintainer", "maintainer-user")

        missing = self.service.authorize(identity, "system:user:write")
        unknown = self.service.authorize(identity, "permission:does_not_exist")

        self.assertTrue(missing.authenticated)
        self.assertEqual("missing_permission", missing.reason)
        self.assertEqual("unknown_permission", unknown.reason)
        self.assertFalse(unknown.allowed)

    def test_role_change_and_permission_revocation_apply_without_session_cache(self):
        identity = Identity("admin", "admin-user")
        self.assertTrue(self.service.has_permission(identity, "system:user:write"))

        self.repository.subjects["admin-user"] = replace(
            self.repository.subjects["admin-user"], role_code="maintainer"
        )
        self.assertFalse(self.service.has_permission(identity, "system:user:write"))
        self.assertTrue(self.service.has_permission(identity, "indicator:write"))

        self.repository.permissions["maintainer"].remove("indicator:write")
        self.assertFalse(self.service.has_permission(identity, "indicator:write"))


class FastApiAuthorizationAdapterTests(unittest.TestCase):
    def test_adapter_maps_anonymous_to_401_and_forbidden_to_403(self):
        current_identity: Identity | None = None
        repository = FakeAuthorizationRepository()
        repository.subjects["maintainer-user"] = AuthorizationSubject(
            "maintainer-user", "maintainer"
        )
        repository.permissions["maintainer"] = {"indicator:read"}
        service = AuthorizationService(repository)

        app = FastAPI()
        app.state.identity_resolver = lambda _request: current_identity
        app.state.authorization_service = service
        app.add_middleware(
            RequestContextMiddleware,
            identity_resolver=app.state.identity_resolver,
        )
        register_exception_handlers(app)

        @app.get("/protected")
        def protected(_context=Depends(require_permission("indicator:write"))):
            return {"ok": True}

        client = TestClient(app)
        self.assertEqual(401, client.get("/protected").status_code)

        current_identity = Identity("maintainer", "maintainer-user")
        self.assertEqual(403, client.get("/protected").status_code)

        repository.permissions["maintainer"].add("indicator:write")
        self.assertEqual(200, client.get("/protected").status_code)


if __name__ == "__main__":
    unittest.main()
