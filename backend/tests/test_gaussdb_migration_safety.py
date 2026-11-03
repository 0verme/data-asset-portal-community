from __future__ import annotations

import unittest

from backend.app.migrations.dws_runner import apply_revisions, repository_head
from backend.app.migrations.schema import _reflection_metadata_queries
from backend.tests.dws_fake_database import (
    FakeColumn,
    FakeDwsDatabase,
    FakeTable,
    REVISION_ORDER,
)


CONFIG = {"type": "gaussdb", "schema": "dap"}


class GaussDbMigrationSafetyTests(unittest.TestCase):
    def test_catalog_queries_are_scoped_to_the_configured_schema(self):
        queries = _reflection_metadata_queries(CONFIG)
        expected_params = {
            "columns reflection": ("dap",),
            "attributes reflection": ("dap", "dap"),
            "constraints reflection": ("dap",),
            "referential constraints": ("dap",),
            "indexes reflection": ("dap",),
        }

        self.assertEqual(set(expected_params), {query.name for query in queries})
        for query in queries:
            with self.subTest(query=query.name):
                self.assertEqual(expected_params[query.name], query.params)
                self.assertIn("?", query.sql)

    def test_nonstandard_migration_record_table_is_preserved(self):
        database = FakeDwsDatabase().seed_from_baseline()
        nonstandard = FakeTable(name="p_recv_ops_mapping", relation_id=9001)
        nonstandard.columns["record_id"] = FakeColumn(
            "record_id", "BIGINT", nullable=False
        )
        nonstandard.columns["revision_name"] = FakeColumn(
            "revision_name", "VARCHAR(64)", nullable=False
        )
        nonstandard.rows.append(
            {"record_id": 71, "revision_name": "external-history"}
        )
        database.tables[nonstandard.name] = nonstandard
        rows_before = [dict(row) for row in nonstandard.rows]

        results = apply_revisions(
            database, CONFIG, "0001_baseline", repository_head()
        )

        self.assertEqual(repository_head(), database.ledger)
        self.assertEqual(len(REVISION_ORDER), len(results))
        self.assertIs(nonstandard, database.tables["p_recv_ops_mapping"])
        self.assertEqual(rows_before, nonstandard.rows)
        mutations = [
            sql
            for sql, _ in database.executed
            if sql.lstrip().upper().startswith(
                ("CREATE", "ALTER", "DROP", "INSERT", "UPDATE", "DELETE", "TRUNCATE")
            )
        ]
        self.assertFalse(
            any("p_recv_ops_mapping" in sql.lower() for sql in mutations),
            mutations,
        )
        self.assertFalse(any("DROP TABLE" in sql.upper() for sql in mutations))

        # Every catalog read uses the profile's schema as its first parameter.
        for sql, params in database.executed:
            lowered = sql.lower()
            if any(
                marker in lowered
                for marker in (
                    "information_schema.columns",
                    "information_schema.tables",
                    "information_schema.referential_constraints",
                    "from pg_attribute a",
                    "from pg_constraint c",
                    "from pg_class t",
                    "pg_get_constraintdef",
                )
            ):
                with self.subTest(sql=sql):
                    self.assertTrue(params)
                    self.assertEqual("dap", params[0])
                    if "from pg_attribute a" in lowered:
                        self.assertEqual(("dap", "dap"), params)


if __name__ == "__main__":
    unittest.main()
