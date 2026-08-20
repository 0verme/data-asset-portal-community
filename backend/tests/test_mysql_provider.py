from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.db.providers import MySQLProvider
from backend.app.db.registry import clear_registry_for_tests, get_provider


class MySQLProviderTests(unittest.TestCase):
    def tearDown(self):
        clear_registry_for_tests()

    def test_provider_validates_profile_without_connecting(self):
        provider = MySQLProvider()
        config = provider.validate(
            "mysql_test",
            {
                "type": "mysql",
                "database": "asset_portal",
                "user": "tester",
                "password": "secret",
            },
            config_path=Path("database.yaml"),
        )
        self.assertEqual(3306, config["port"])
        self.assertEqual("utf8mb4", config["charset"])
        self.assertEqual("", provider.physical_schema(config))

    def test_provider_fails_fast_for_missing_credentials(self):
        with self.assertRaisesRegex(ValueError, "requires database, user, password"):
            MySQLProvider().validate(
                "mysql_missing",
                {"type": "mysql"},
                config_path=Path("database.yaml"),
            )

    def test_registry_exposes_mysql_and_alias(self):
        self.assertIs(get_provider("mysql"), get_provider("mysql+pymysql"))

    def test_optional_driver_error_is_explicit(self):
        with patch.dict("sys.modules", {"pymysql": None}):
            with self.assertRaisesRegex(RuntimeError, "optional PyMySQL dependency"):
                from backend.app.db.mysql_adapter import connect

                connect({
                    "host": "127.0.0.1",
                    "port": 3306,
                    "database": "asset_portal",
                    "user": "tester",
                    "password": "secret",
                })


if __name__ == "__main__":
    unittest.main()
