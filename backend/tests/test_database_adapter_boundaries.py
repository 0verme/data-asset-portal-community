"""Database adapter boundaries for the Community edition.

SQLite and PostgreSQL are the supported Community runtimes and must import
without optional GaussDB/JDBC dependencies; the GaussDB adapter stays a
private-edition-only capability.
"""

from __future__ import annotations

import builtins
import importlib
import unittest
from unittest.mock import patch


class OptionalDatabaseDependencyTests(unittest.TestCase):
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

    def test_community_adapter_registry_excludes_gaussdb(self):
        from backend.app.db.registry import available_adapter_names

        self.assertEqual(("sqlite", "postgres"), available_adapter_names("community"))
        self.assertIn("gaussdb", available_adapter_names("private"))
