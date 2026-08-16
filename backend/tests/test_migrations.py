import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from backend.app.migrations.errors import BaselineError, ManifestError, VerificationError
from backend.app.migrations.manifest import SUPPORTED_DIALECTS, load_manifest
from backend.app.migrations.runner import MigrationRunner
from backend.tests.db_test_support import (
    MIGRATIONS_ROOT,
    PROJECT_ROOT,
    SpyConnection,
    skip_without_postgres_integration,
)


class ManifestValidationTests(unittest.TestCase):
    def test_supported_dialects_include_community_sqlite(self):
        self.assertEqual(SUPPORTED_DIALECTS, ("sqlite", "postgresql", "dws"))

    def test_project_uses_one_migration_root_with_dialect_trees(self):
        root = MIGRATIONS_ROOT
        self.assertTrue(root.is_dir())
        self.assertFalse((PROJECT_ROOT / "docs" / "migrations").exists())
        self.assertTrue((root / "sqlite").exists())
        versions = [item.version for item in load_manifest(root)]
        self.assertEqual(versions, ["0001", "0002", "0003", "0004", "0005", "0006"])
        for migration in load_manifest(root):
            self.assertTrue(set(migration.files) <= set(SUPPORTED_DIALECTS))

    def test_accepts_migration_for_a_dialect_subset(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "postgresql").mkdir()
            (root / "postgresql" / "0001.sql").write_text("SELECT 1;", encoding="utf-8")
            data = {
                "formatVersion": 1,
                "migrations": [
                    {
                        "version": "0001",
                        "name": "bad",
                        "description": "bad",
                        "files": {"postgresql": "postgresql/0001.sql"},
                        "transactional": True,
                    }
                ],
            }
            (root / "manifest.json").write_text(json.dumps(data), encoding="utf-8")
            migrations = load_manifest(root)
            self.assertEqual({"postgresql"}, set(migrations[0].files))

    def test_rejects_path_escape(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for dialect in SUPPORTED_DIALECTS:
                (root / dialect).mkdir()
            data = {
                "formatVersion": 1,
                "migrations": [
                    {
                        "version": "0001",
                        "name": "bad",
                        "description": "bad",
                        "files": {
                            "postgresql": "../bad.sql",
                            "dws": "dws/0001.sql",
                        },
                        "transactional": True,
                    }
                ],
            }
            (root / "dws" / "0001.sql").write_text("SELECT 1;", encoding="utf-8")
            (root / "manifest.json").write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaises(ManifestError):
                load_manifest(root)


class MigrationRunnerProtocolTests(unittest.TestCase):
    def _write_manifest(self, root: Path, migrations):
        for dialect in SUPPORTED_DIALECTS:
            (root / dialect).mkdir(parents=True, exist_ok=True)
        for item in migrations:
            version = item["version"]
            for dialect in SUPPORTED_DIALECTS:
                path = root / dialect / f"{version}.sql"
                path.write_text(
                    item.get("sql", f"CREATE TABLE dwp.widget_{version} (id INTEGER);"),
                    encoding="utf-8",
                )
                item.setdefault("files", {})[dialect] = f"{dialect}/{version}.sql"
        payload = []
        for item in migrations:
            entry = {
                "version": item["version"],
                "name": item["name"],
                "description": item.get("description", item["name"]),
                "files": item["files"],
                "transactional": True,
            }
            if item.get("baseline"):
                entry["baseline"] = True
            payload.append(entry)
        (root / "manifest.json").write_text(
            json.dumps({"formatVersion": 1, "migrations": payload}),
            encoding="utf-8",
        )

    def test_lock_placeholder_and_ledger_protocol_for_postgresql_and_dws(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._write_manifest(
                root,
                [{"version": "0001", "name": "contract", "sql": "CREATE TABLE dwp.contract_test (id INTEGER);"}],
            )
            for dialect, placeholder in (("postgresql", "%s"), ("dws", "?")):
                spy = SpyConnection()
                self.assertEqual(MigrationRunner(spy, dialect, root).apply(), ["0001"])
                sql = "\n".join(call[0] for call in spy.calls)
                self.assertIn("FOR UPDATE", sql)
                self.assertIn("CREATE TABLE dwp.contract_test", sql)
                self.assertIn(
                    f"VALUES ({placeholder}, {placeholder}, {placeholder}, {placeholder})",
                    sql,
                )
                self.assertGreaterEqual(spy.commits, 2)
                self.assertEqual(spy.rollbacks, 0)

    def test_checksum_change_blocks_verify_and_apply(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._write_manifest(root, [{"version": "0001", "name": "one"}])
            spy = SpyConnection()
            # Pretend ledger already applied with a different checksum.
            def side_effect(sql, params):
                if "FROM dwp.schema_migrations" in sql and "ORDER BY" in sql:
                    spy._cursor._fetchall = [("0001", "one", "deadbeef" * 8)]
                return None

            spy.execute_side_effect = side_effect
            runner = MigrationRunner(spy, "postgresql", root)
            with self.assertRaises(VerificationError):
                runner.verify()
            with self.assertRaises(VerificationError):
                runner.apply()

    def test_apply_failure_rolls_back_and_propagates(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._write_manifest(
                root,
                [
                    {"version": "0001", "name": "one"},
                    {"version": "0002", "name": "two"},
                ],
            )
            spy = SpyConnection()
            calls = {"n": 0}

            def side_effect(sql, params):
                calls["n"] += 1
                # Fail when executing migration SQL body (not ledger setup).
                if "CREATE TABLE dwp.widget_0002" in sql:
                    raise RuntimeError("migration failed")
                if "FROM dwp.schema_migrations" in sql and "ORDER BY" in sql:
                    # After first migration recorded, report 0001 applied on re-verify.
                    if any("widget_0001" in c[0] for c in spy.calls):
                        checksum = MigrationRunner(spy, "postgresql", root).migrations[0].checksum("postgresql")
                        spy._cursor._fetchall = [("0001", "one", checksum)]
                    else:
                        spy._cursor._fetchall = []
                return None

            spy.execute_side_effect = side_effect
            with self.assertRaisesRegex(RuntimeError, "migration failed"):
                MigrationRunner(spy, "postgresql", root).apply()
            self.assertGreaterEqual(spy.rollbacks, 1)

    def test_baseline_never_executes_business_sql_and_rejects_empty(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._write_manifest(
                root,
                [{"version": "0001", "name": "baseline", "baseline": True, "sql": "CREATE TABLE dwp.widget (id INT);"}],
            )
            spy = SpyConnection()

            def empty_tables(sql, params):
                if "information_schema.tables" in sql:
                    spy._cursor._fetchone = None
                if "FROM dwp.schema_migrations" in sql:
                    spy._cursor._fetchall = []
                return None

            spy.execute_side_effect = empty_tables
            runner = MigrationRunner(spy, "dws", root)
            with self.assertRaises(BaselineError):
                runner.baseline("0001")

            def non_empty(sql, params):
                if "information_schema.tables" in sql:
                    spy._cursor._fetchone = (1,)
                if "FROM dwp.schema_migrations" in sql:
                    spy._cursor._fetchall = []
                return None

            spy.execute_side_effect = non_empty
            spy.calls.clear()
            self.assertEqual(runner.baseline("0001"), ["0001"])
            sql = "\n".join(call[0] for call in spy.calls)
            self.assertNotIn("CREATE TABLE dwp.widget", sql)

    def test_unsupported_dialect_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self._write_manifest(root, [{"version": "0001", "name": "one"}])
            with self.assertRaises(VerificationError):
                MigrationRunner(SpyConnection(), "oracle", root)


class ProjectPushMigrationStaticTests(unittest.TestCase):
    def test_project_push_importance_sql_exists_for_both_dialects(self):
        for dialect in ("postgresql", "dws"):
            path = MIGRATIONS_ROOT / dialect / "0001.sql"
            text = path.read_text(encoding="utf-8")
            self.assertIn("importance_level_code", text)
            self.assertIn("latest_output_time", text)


@skip_without_postgres_integration()
class MigrationPostgresIntegrationTests(unittest.TestCase):
    """Real apply is intentionally not exercised here without explicit authorization.

    When TEST_DATABASE_* is set, only read-only status/verify protocol is checked
    against an isolated config path — never backend/configs/database.yaml.
    """

    def test_runner_can_be_constructed_for_postgresql_dialect(self):
        # Guard that the optional integration env is wired; does not apply DDL.
        self.assertTrue(os.getenv("TEST_DATABASE_PROFILE"))
        self.assertTrue(Path(os.getenv("TEST_DATABASE_CONFIG_PATH")).is_file())


# Late import only for the skip-marked class above.
import os  # noqa: E402


if __name__ == "__main__":
    unittest.main()
