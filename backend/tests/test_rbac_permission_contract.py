"""P0 contract tests for the repository-owned RBAC registry."""

# pyright: reportMissingImports=false

from __future__ import annotations

import unittest

from backend.app.authorization import (
    ADMIN_ROLE,
    BUILTIN_ROLE_PERMISSION_CODES,
    MAINTAINER_ROLE,
    PERMISSION_CODES,
    PERMISSION_DEFINITIONS,
    PUBLIC_PERMISSION_CODES,
    ROLE_ASSIGNABLE_PERMISSION_CODES,
    get_permission_definition,
    is_public_permission,
    is_registered_permission,
    is_role_assignable_permission,
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

    def test_public_and_role_assignable_permission_sets_are_disjoint_and_complete(self):
        self.assertTrue(PUBLIC_PERMISSION_CODES)
        self.assertTrue(all(is_public_permission(code) for code in PUBLIC_PERMISSION_CODES))
        self.assertTrue(all(is_role_assignable_permission(code) for code in ROLE_ASSIGNABLE_PERMISSION_CODES))
        self.assertEqual(
            set(PERMISSION_CODES),
            PUBLIC_PERMISSION_CODES | set(ROLE_ASSIGNABLE_PERMISSION_CODES),
        )
        self.assertTrue(PUBLIC_PERMISSION_CODES.isdisjoint(ROLE_ASSIGNABLE_PERMISSION_CODES))
        self.assertTrue(all(code.endswith(":read") for code in PUBLIC_PERMISSION_CODES))
        self.assertTrue(
            PUBLIC_PERMISSION_CODES.isdisjoint(
                {
                    "upstream:read",
                    "push:read",
                    "metadata:read",
                    "operation_log:read",
                    "system:user:read",
                    "system:menu:read",
                    "system:param:read",
                    "system:role:read",
                }
            )
        )

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
