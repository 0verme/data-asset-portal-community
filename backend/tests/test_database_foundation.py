from __future__ import annotations

import unittest

from backend.app.db.metadata import LOGICAL_SCHEMA, metadata
from backend.app.db.tables import admin_user


class DatabaseFoundationTests(unittest.TestCase):
    def test_core_metadata_uses_one_logical_application_schema(self):
        self.assertEqual("__app__", LOGICAL_SCHEMA)
        self.assertIs(metadata, admin_user.metadata)
        self.assertEqual(LOGICAL_SCHEMA, metadata.schema)
        self.assertEqual("p_admin_user", admin_user.name)
        self.assertEqual(
            {"id", "username", "password_hash", "display_name", "status", "role", "last_login_at", "created_at", "updated_at"},
            {column.name for column in admin_user.columns},
        )


if __name__ == "__main__":
    unittest.main()
