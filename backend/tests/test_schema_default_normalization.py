from __future__ import annotations

import copy
import unittest

from backend.app.migrations.schema import (
    SUPPORTED_DIALECTS,
    _normalize_reflected_column_default,
    baseline_schema,
    compare_schema,
    normalize_default,
    verify_database,
)
from backend.tests.dws_fake_database import FakeDwsDatabase


class SchemaDefaultNormalizationTests(unittest.TestCase):
    def test_gaussdb_systimestamp_matches_all_canonical_timestamp_defaults(self):
        expected = baseline_schema("dws")
        timestamp_columns = [
            (table_name, column)
            for table_name, table in expected.tables.items()
            for column in table.columns.values()
            if column.default == "CURRENT_TIMESTAMP"
        ]
        # The production audit identified 52 false mismatches. Exercise every
        # current canonical timestamp default so the regression remains broad
        # if additional timestamp columns are added later.
        self.assertGreaterEqual(len(timestamp_columns), 52)

        actual = copy.deepcopy(expected)
        for table_name, expected_column in timestamp_columns:
            with self.subTest(table=table_name, column=expected_column.name):
                actual.tables[table_name].columns[expected_column.name].default = (
                    _normalize_reflected_column_default(
                        "pg_systimestamp()",
                        expected_column.type_name,
                        db_type="gaussdb",
                        expected_column=expected_column,
                    )
                )
                self.assertEqual(
                    expected_column.default,
                    actual.tables[table_name].columns[expected_column.name].default,
                )

        self.assertEqual([], compare_schema(expected, actual))

        database = FakeDwsDatabase().seed_from_baseline()
        for table_name, expected_column in timestamp_columns:
            database.set_default(
                table_name, expected_column.name, "pg_systimestamp()"
            )
        self.assertIsNone(
            verify_database(database, {"type": "gaussdb", "schema": "dap"}, "dws")
        )

    def test_systimestamp_alias_is_limited_to_gaussdb_timestamp_columns(self):
        self.assertEqual(
            "CURRENT_TIMESTAMP",
            normalize_default(
                " (PG_SYSTIMESTAMP())::timestamp without time zone ",
                "TIMESTAMP",
                db_type="gaussdb",
            ),
        )
        self.assertEqual(
            "pg_systimestamp()",
            normalize_default("pg_systimestamp()", "TIMESTAMP", db_type="postgres"),
        )
        self.assertEqual(
            "pg_systimestamp()",
            normalize_default("pg_systimestamp()", "VARCHAR(64)", db_type="gaussdb"),
        )
        self.assertNotEqual(
            "CURRENT_TIMESTAMP",
            normalize_default(
                "pg_systimestamp() + INTERVAL '1 second'",
                "TIMESTAMP",
                db_type="gaussdb",
            ),
        )

    def test_missing_system_abbr_default_remains_a_schema_drift(self):
        expected = baseline_schema("dws")
        expected_column = expected.tables["p_system"].columns["system_abbr"]
        self.assertEqual("", expected_column.default)

        actual = copy.deepcopy(expected)
        actual_column = actual.tables["p_system"].columns["system_abbr"]
        actual_column.default = _normalize_reflected_column_default(
            None,
            actual_column.type_name,
            db_type="gaussdb",
            expected_column=expected_column,
        )

        mismatches = compare_schema(expected, actual)
        default_mismatches = [
            mismatch
            for mismatch in mismatches
            if mismatch.table == "p_system"
            and mismatch.object_type == "default"
            and mismatch.object_name == "system_abbr"
        ]
        self.assertEqual(1, len(default_mismatches))
        self.assertEqual("", default_mismatches[0].expected)
        self.assertIsNone(default_mismatches[0].actual)

        database = FakeDwsDatabase().seed_from_baseline()
        database.set_default("p_system", "system_abbr", None)
        with self.assertRaisesRegex(RuntimeError, "default.system_abbr"):
            verify_database(database, {"type": "gaussdb", "schema": "dap"}, "dws")

    def test_existing_timestamp_normalization_remains_available_for_all_dialects(self):
        for dialect in SUPPORTED_DIALECTS:
            with self.subTest(dialect=dialect):
                self.assertEqual(
                    "CURRENT_TIMESTAMP",
                    normalize_default(
                        "CURRENT_TIMESTAMP", "TIMESTAMP", db_type=dialect
                    ),
                )


if __name__ == "__main__":
    unittest.main()
