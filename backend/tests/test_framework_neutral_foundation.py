"""Regression tests for the framework-neutral P1 foundation."""

from __future__ import annotations

import unittest
from pathlib import Path

from backend.app.application import (
    ADMIN_ROLE,
    ApplicationError,
    AuthenticationRequiredError,
    Identity,
    PermissionDeniedError,
    RequestContext,
    identity_for_session,
    identity_from_mapping,
)


class FrameworkNeutralIdentityTests(unittest.TestCase):
    def test_identity_parser_accepts_only_current_maintenance_roles(self):
        identity = identity_from_mapping(
            {"role": "maintainer", "user": "alice", "name": "Alice"}
        )
        self.assertEqual(Identity("maintainer", "alice", "Alice"), identity)
        self.assertIsNone(identity_from_mapping({"role": "viewer", "user": "alice"}))
        self.assertIsNone(identity_from_mapping(None))

    def test_session_normalization_preserves_legacy_admin_fallback(self):
        identity = identity_for_session({"role": "future-role", "user": "alice"})
        self.assertEqual(ADMIN_ROLE, identity.role)
        self.assertEqual("alice", identity.user)
        self.assertEqual({"role": "admin", "user": "alice", "name": "alice"}, identity.as_dict())

    def test_request_context_enforces_auth_without_flask_context(self):
        anonymous = RequestContext()
        with self.assertRaises(AuthenticationRequiredError) as error:
            anonymous.require_authenticated()
        self.assertEqual(401, error.exception.status_code)

        maintainer = RequestContext(identity=Identity("maintainer", "alice", "Alice"))
        with self.assertRaises(PermissionDeniedError) as error:
            maintainer.require_role("admin")
        self.assertEqual(403, error.exception.status_code)
        self.assertEqual(
            {"code": "FORBIDDEN", "message": "无权限执行此操作。"},
            error.exception.to_dict(),
        )

    def test_application_errors_are_transport_independent(self):
        error = ApplicationError("invalid input", details={"field": "name"})
        self.assertEqual(
            {"code": "APPLICATION_ERROR", "message": "invalid input", "details": {"field": "name"}},
            error.to_dict(),
        )

    def test_application_package_has_no_flask_import(self):
        package_root = Path(__file__).parents[1] / "app" / "application"
        source = "\n".join(path.read_text(encoding="utf-8") for path in package_root.glob("*.py"))
        self.assertNotIn("from flask", source)
        self.assertNotIn("import flask", source)


if __name__ == "__main__":
    unittest.main()
