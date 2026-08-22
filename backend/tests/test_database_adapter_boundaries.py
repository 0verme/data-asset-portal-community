"""Database provider availability is independent of repository modules."""

from __future__ import annotations

import builtins
import importlib
import unittest
from unittest.mock import patch


class DatabaseProviderAvailabilityTests(unittest.TestCase):
    def test_sqlite_facade_loads_without_jdbc_dependencies(self):
        real_import = builtins.__import__

        def guarded_import(name, *args, **kwargs):
            if name.split(".", 1)[0].lower() in {"jaydebeapi", "jpype", "jpype1"}:
                raise AssertionError(f"unexpected JDBC dependency import: {name}")
            return real_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=guarded_import):
            module = importlib.import_module("backend.app.db.facade")
            self.assertIn("sqlite", module.SUPPORTED_DB_TYPES)
            self.assertIn("postgres", module.SUPPORTED_DB_TYPES)

    def test_adapter_registry_lists_all_provider_types(self):
        from backend.app.db.registry import available_adapter_names

        self.assertEqual(("gaussdb", "mysql", "postgres", "sqlite"), available_adapter_names())


if __name__ == "__main__":
    unittest.main()
