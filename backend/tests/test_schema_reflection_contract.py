from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.app.db.sqlite_adapter import connect
from backend.app.migrations.schema import (
    baseline_schema,
    compare_schema,
    initialize,
    verify_database,
)


class SchemaReflectionContractTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="schema-contract-")
        self.addCleanup(self.temp_dir.cleanup)
        self.database = Path(self.temp_dir.name) / "schema.sqlite"
        self.config = {"type": "sqlite", "database": str(self.database)}
        self.connection = connect(self.config)
        self.addCleanup(self.connection.close)
        self.assertTrue(initialize(self.connection, self.config, "sqlite"))

    def test_reflected_fresh_schema_matches_baseline_contract(self):
        self.assertEqual("0001_baseline", verify_database(self.connection, self.config, "sqlite"))
        self.assertEqual([], compare_schema(baseline_schema("sqlite"), baseline_schema("sqlite")))

    def test_missing_index_is_reported_as_schema_drift(self):
        self.connection.execute("DROP INDEX dwp.idx_p_api_asset_filter")
        self.connection.commit()
        with self.assertRaisesRegex(RuntimeError, "missing index"):
            verify_database(self.connection, self.config, "sqlite")

    def test_unexpected_application_column_is_reported_as_schema_drift(self):
        self.connection.execute("ALTER TABLE dwp.p_system ADD COLUMN contract_drift TEXT")
        self.connection.commit()
        with self.assertRaisesRegex(RuntimeError, "unexpected application column"):
            verify_database(self.connection, self.config, "sqlite")


if __name__ == "__main__":
    unittest.main()
