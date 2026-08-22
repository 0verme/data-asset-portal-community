"""P0 contract tests for the repository-owned RBAC registry."""

from __future__ import annotations

import unittest

from backend.app.authorization import (
    ADMIN_ROLE,
    BUILTIN_ROLE_PERMISSION_CODES,
    MAINTAINER_ROLE,
    PERMISSION_CODES,
    PERMISSION_DEFINITIONS,
    get_permission_definition,
    is_registered_permission,
    validate_permission_registry,
)


class RbacPermissionContractTests(unittest.TestCase):
    def test_registry_is_self_consistent_and_admin_is_explicit(self):
        validate_permission_registry()

        self.assertEqual(
            len(PERMISSION_CODES),
            len(PERMISSION_DEFINITIONS),
        )
        self.assertEqual(
            BUILTIN_ROLE_PERMISSION_CODES[ADMIN_ROLE],
            frozenset(PERMISSION_CODES),
        )
        self.assertIn(MAINTAINER_ROLE, BUILTIN_ROLE_PERMISSION_CODES)

    def test_permission_codes_decompose_into_resource_and_action(self):
        for definition in PERMISSION_DEFINITIONS:
            self.assertEqual(
                definition.code,
                f"{definition.resource}:{definition.action}",
            )
            self.assertIn(definition.action, {"read", "write"})
            self.assertIs(get_permission_definition(definition.code), definition)

    def test_unknown_permission_is_not_registered(self):
        self.assertFalse(is_registered_permission("system:everything:write"))
        self.assertIsNone(get_permission_definition("system:everything:write"))

    def test_maintainer_does_not_receive_system_management_permissions(self):
        maintainer = BUILTIN_ROLE_PERMISSION_CODES[MAINTAINER_ROLE]
        self.assertTrue(any(code.startswith("indicator:") for code in maintainer))
        self.assertIn("operation_log:read", maintainer)
        self.assertFalse(any(code.startswith("system:") for code in maintainer))


if __name__ == "__main__":
    unittest.main()
