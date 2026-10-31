from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import Column, Integer, MetaData, Table, insert, text
from sqlalchemy.dialects import mysql

from backend.app.db.core import (
    _compile_statement,
    _schema_translate_map,
    execute_core,
    execute_core_on_connection,
    execute_core_on_cursor,
    execute_many_core,
    execute_statements_core,
)
from backend.app.db.facade import execute_many, execute_sql, execute_statements
from backend.app.db.providers import GaussDBProvider
from backend.app.db.sqlite_adapter import connect as connect_sqlite
from backend.app.db.write_target import (
    WriteTargetError,
    resolve_write_target,
    rewrite_logical_schema,
    validate_connection_target,
    validate_write_sql,
)
from backend.app.migrations.schema import (
    _prefix,
    _reflection_metadata_queries,
    _schema_for_reflection,
    baseline_path,
    initialize,
    render_baseline_for_profile,
)


class RecordingCursor:
    def __init__(self, connection):
        self.connection = connection
        self.result = None
        self.rowcount = 1
        self.description = None
        self.closed = False

    def execute(self, sql, params=None):
        self.connection.calls.append((sql, params))
        if sql == "SELECT current_schema(), current_schemas(false)":
            self.result = (self.connection.schema, self.connection.search_schemas)
        elif sql == "SELECT current_schema()":
            self.result = (self.connection.schema,)
        elif sql == "SELECT DATABASE()":
            self.result = (self.connection.database,)
        elif sql == "PRAGMA database_list":
            self.result = None
            self.connection.rows = [(0, "main", ""), (2, "dwp", "")]
        elif "information_schema.tables" in sql:
            self.result = None
        elif sql.lower().startswith("select version_num from"):
            self.result = (self.connection.revision,) if self.connection.revision else None
        elif sql.lower().startswith("insert into") and "alembic_version" in sql.lower():
            self.connection.revision = params[0]
            self.result = None
        elif sql.lower().startswith("update") and "alembic_version" in sql.lower():
            self.connection.revision = params[0]
            self.result = None
        else:
            self.result = None
        return self

    def executemany(self, sql, params):
        rows = list(params)
        self.connection.calls.append((sql, rows))
        self.rowcount = len(rows)

    def fetchone(self):
        return self.result

    def fetchall(self):
        if self.connection.rows is not None:
            return self.connection.rows
        return [self.result] if self.result is not None else []

    def close(self):
        self.closed = True


class RecordingConnection:
    def __init__(self, *, schema="dap", search_schemas=None, database="asset_db"):
        self.schema = schema
        self.search_schemas = [schema] if search_schemas is None else search_schemas
        self.database = database
        self.revision = None
        self.calls = []
        self.rows = None
        self.commits = 0
        self.rollbacks = 0
        self.closes = 0

        class JavaConnection:
            @staticmethod
            def getAutoCommit():
                return False

        self.jconn = JavaConnection()

    def cursor(self):
        return RecordingCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closes += 1


class SchemaWriteTargetContractTests(unittest.TestCase):
    def test_postgres_missing_schema_fails_closed_but_explicit_dwp_is_supported(self):
        with self.assertRaisesRegex(WriteTargetError, "explicit Profile schema"):
            resolve_write_target({"type": "postgres"})
        self.assertEqual(
            "dwp",
            resolve_write_target({"type": "postgres", "schema": "dwp"}).schema,
        )

    def test_postgres_configured_case_matches_unquoted_profile_target(self):
        config = {"type": "postgres", "schema": "Dap"}
        self.assertEqual("dap", resolve_write_target(config).schema)
        self.assertEqual({"__app__": "dap"}, _schema_translate_map(config))
        table = Table(
            "p_asset_table",
            MetaData(schema="__app__"),
            Column("id", Integer, primary_key=True),
        )
        sql, _compiled, _provider = _compile_statement(
            "primary", insert(table).values(id=1), config=config
        )
        self.assertIn("INSERT INTO dap.p_asset_table", sql)

    def test_logical_schema_rewrite_is_token_aware_and_keeps_literals_comments(self):
        target = resolve_write_target({"type": "postgres", "schema": "dap"})
        source = (
            "UPDATE __app__.p_report_asset SET note = '__app__.p_report_asset' "
            "/* __app__.comment */ WHERE id = 1"
        )
        expected = (
            "UPDATE dap.p_report_asset SET note = '__app__.p_report_asset' "
            "/* __app__.comment */ WHERE id = 1"
        )
        self.assertEqual(expected, rewrite_logical_schema(source, target))

        mysql = resolve_write_target({"type": "mysql", "database": "asset_db"})
        self.assertEqual(
            "INSERT INTO p_report_asset (id) VALUES (1)",
            rewrite_logical_schema(
                "INSERT INTO __app__.p_report_asset (id) VALUES (1)", mysql
            ),
        )

    def test_gaussdb_mixed_case_targets_require_quoted_identifiers(self):
        target = resolve_write_target({"type": "gaussdb", "schema": "Dap"})
        with self.assertRaisesRegex(WriteTargetError, "does not match"):
            validate_write_sql("UPDATE Dap.p_asset_table SET id = 1", target)
        self.assertTrue(
            validate_write_sql('UPDATE "Dap".p_asset_table SET id = 1', target)
        )

    def test_wrong_explicit_schema_is_rejected_without_rewriting(self):
        target = resolve_write_target({"type": "postgres", "schema": "dap"})
        sql = "UPDATE dwp.p_report_asset SET owner_name = 'x'"
        with self.assertRaisesRegex(WriteTargetError, "does not match"):
            validate_write_sql(sql, target)
        self.assertIn("dwp.p_report_asset", sql)

    def test_multi_target_ddl_checks_every_target(self):
        target = resolve_write_target({"type": "postgres", "schema": "dap"})
        statements = (
            "DROP TABLE dap.first_table, dwp.second_table",
            "DROP INDEX dap.first_index, dwp.second_index",
            "TRUNCATE TABLE dap.first_table, dwp.second_table",
            "TRUNCATE TABLE ONLY dap.first_table, dwp.second_table",
            "TRUNCATE TABLE dap.first_table, ONLY dwp.second_table",
            "TRUNCATE TABLE dap.first_table *, dwp.second_table",
            "LOCK TABLE ONLY dap.first_table, dwp.second_table IN ACCESS EXCLUSIVE MODE",
            "LOCK TABLE dap.first_table *, ONLY dwp.second_table IN ACCESS EXCLUSIVE MODE",
        )
        for sql in statements:
            with self.subTest(sql=sql), self.assertRaisesRegex(
                WriteTargetError, "does not match"
            ):
                validate_write_sql(sql, target)

    def test_multitable_mysql_dml_fails_closed(self):
        target = resolve_write_target({"type": "mysql", "database": "asset_db"})
        statements = (
            "UPDATE asset_db.first_table, dwp.second_table SET first_table.id = 1",
            "UPDATE asset_db.first_table JOIN dwp.second_table "
            "ON first_table.id = second_table.id SET first_table.id = 1",
            "DELETE FROM asset_db.first_table, dwp.second_table WHERE id = 1",
            "LOCK TABLES asset_db.first_table WRITE, dwp.second_table READ",
            "DROP INDEX idx ON dwp.p_asset_table",
            "ALTER TABLE asset_db.first_table RENAME TO other_db.second_table",
            "ALTER TABLE asset_db.partitioned EXCHANGE PARTITION p0 WITH TABLE other_db.shadow",
        )
        for sql in statements:
            with self.subTest(sql=sql), self.assertRaises(WriteTargetError):
                validate_write_sql(sql, target)

    def test_mysql_table_rename_validates_source_and_destination_database(self):
        target = resolve_write_target({"type": "mysql", "database": "asset_db"})
        self.assertTrue(
            validate_write_sql(
                "ALTER TABLE asset_db.old_name RENAME TO asset_db.new_name", target
            )
        )
        self.assertTrue(
            validate_write_sql("ALTER TABLE old_name RENAME TO new_name", target)
        )
        with self.assertRaisesRegex(WriteTargetError, "does not match"):
            validate_write_sql(
                "ALTER TABLE asset_db.old_name RENAME AS other_db.new_name", target
            )

    def test_alter_column_action_is_not_parsed_as_a_second_ddl_statement(self):
        target = resolve_write_target({"type": "postgres", "schema": "dwp"})
        self.assertTrue(
            validate_write_sql(
                "ALTER TABLE dwp.p_push_job ALTER COLUMN freq_desc TYPE VARCHAR(200)",
                target,
            )
        )
        with self.assertRaisesRegex(WriteTargetError, "does not match"):
            validate_write_sql(
                "ALTER TABLE public.p_push_job ALTER COLUMN freq_desc TYPE VARCHAR(200)",
                target,
            )

    def test_schema_moving_and_temporary_table_ddl_fail_closed(self):
        target = resolve_write_target({"type": "postgres", "schema": "dap"})
        statements = (
            "CREATE TEMP TABLE dwp.temporary_probe (id INTEGER)",
            "ALTER TABLE dap.p_asset_table SET SCHEMA dwp",
            "ALTER TABLE ALL IN TABLESPACE app_space SET TABLESPACE other_space",
            "ALTER TABLE dap.parent ATTACH PARTITION dwp.child FOR VALUES IN (1)",
        )
        for sql in statements:
            with self.subTest(sql=sql), self.assertRaises(WriteTargetError):
                validate_write_sql(sql, target)

    def test_nonstandard_write_commands_and_select_into_fail_closed(self):
        target = resolve_write_target({"type": "postgres", "schema": "dap"})
        statements = (
            "SELECT 1 INTO dwp.new_table",
            "ANALYZE dwp.p_asset_table",
            "REFRESH MATERIALIZED VIEW dwp.asset_view",
            "COMMENT ON TABLE dwp.p_asset_table IS 'external'",
        )
        for sql in statements:
            with self.subTest(sql=sql), self.assertRaises(WriteTargetError):
                validate_write_sql(sql, target)

    def test_mysql_legacy_dwp_prefix_only_matches_explicit_database_dwp(self):
        sql = "DELETE FROM dwp.p_report_asset WHERE id = 1"
        target = resolve_write_target({"type": "mysql", "database": "asset_db"})
        with self.assertRaisesRegex(WriteTargetError, "does not match"):
            validate_write_sql(sql, target)
        self.assertTrue(
            validate_write_sql(
                sql, resolve_write_target({"type": "mysql", "database": "dwp"})
            )
        )

    def test_mysql_current_database_maps_logical_schema_across_raw_and_core_paths(self):
        config = {"type": "mysql", "database": "asset_db"}
        raw_connection = RecordingConnection(database="asset_db")
        with (
            patch("backend.app.db.facade.get_db_profile", return_value=config),
            patch(
                "backend.app.db.facade.connect_with_profile",
                return_value=raw_connection,
            ),
        ):
            execute_many(
                "primary",
                "INSERT INTO __app__.p_asset_table (id) VALUES (?)",
                [(1,)],
            )

        self.assertEqual(
            [
                ("SELECT DATABASE()", None),
                ("INSERT INTO p_asset_table (id) VALUES (%s)", [(1,)]),
            ],
            raw_connection.calls,
        )
        self.assertEqual(1, raw_connection.commits)

        core_connection = RecordingConnection(database="asset_db")
        table = Table(
            "p_asset_table",
            MetaData(schema="__app__"),
            Column("id", Integer, primary_key=True),
        )
        mysql_engine = SimpleNamespace(dialect=mysql.dialect())
        with (
            patch("backend.app.db.core.get_db_profile", return_value=config),
            patch("backend.app.db.core.get_engine", return_value=mysql_engine),
            patch(
                "backend.app.db.core.active_transaction_connection",
                return_value=core_connection,
            ),
        ):
            execute_core("primary", insert(table).values(id=1))

        self.assertEqual("SELECT DATABASE()", core_connection.calls[0][0])
        self.assertEqual(
            ("INSERT INTO p_asset_table (id) VALUES (%s)", (1,)),
            core_connection.calls[1],
        )
        self.assertEqual(0, core_connection.commits)

    def test_mysql_explicit_dwp_sql_is_never_rewritten_to_another_database(self):
        sql = "DELETE FROM dwp.p_report_asset WHERE id = 1"
        wrong_target = {"type": "mysql", "database": "asset_db"}
        with (
            patch("backend.app.db.facade.get_db_profile", return_value=wrong_target),
            patch("backend.app.db.facade.connect_with_profile") as connect,
        ):
            with self.assertRaisesRegex(WriteTargetError, "does not match"):
                execute_sql("primary", sql)
        connect.assert_not_called()

        dwp_target = {"type": "mysql", "database": "dwp"}
        connection = RecordingConnection(database="dwp")
        with (
            patch("backend.app.db.facade.get_db_profile", return_value=dwp_target),
            patch(
                "backend.app.db.facade.connect_with_profile",
                return_value=connection,
            ),
        ):
            execute_sql("primary", sql)
        self.assertEqual(
            [("SELECT DATABASE()", None), (sql, None)],
            connection.calls,
        )
        self.assertEqual(1, connection.commits)

    def test_escape_strings_and_mysql_executable_comments_fail_closed(self):
        target = resolve_write_target({"type": "postgres", "schema": "dap"})
        source = r"UPDATE __app__.p_asset_table SET note = E'escaped \' __app__.literal'"
        rewritten = rewrite_logical_schema(source, target)
        self.assertIn("UPDATE dap.p_asset_table", rewritten)
        self.assertIn("E'escaped \\' __app__.literal'", rewritten)

        mysql = resolve_write_target({"type": "mysql", "database": "asset_db"})
        with self.assertRaisesRegex(WriteTargetError, "ambiguous"):
            rewrite_logical_schema(
                r"UPDATE p_asset_table SET note = 'escaped \' UPDATE dwp.p_report_asset'",
                mysql,
            )
        with self.assertRaisesRegex(WriteTargetError, "Executable MySQL comments"):
            rewrite_logical_schema(
                "/*!50000 UPDATE dwp.p_report_asset SET id = 1 */", mysql
            )
        with self.assertRaisesRegex(WriteTargetError, "does not match"):
            validate_write_sql(
                "/* outer /* inner */ UPDATE dwp.p_report_asset SET id = 1 */",
                mysql,
            )

    def test_sqlite_internal_dwp_attachment_is_preserved_and_required(self):
        config = {"type": "sqlite", "database": ":memory:"}
        target = resolve_write_target(config)
        self.assertTrue(validate_write_sql("INSERT INTO dwp.p_asset_table (id) VALUES (1)", target))
        with self.assertRaisesRegex(WriteTargetError, "must explicitly target"):
            validate_write_sql("INSERT INTO p_asset_table (id) VALUES (1)", target)
        with self.assertRaisesRegex(WriteTargetError, "must explicitly target"):
            validate_write_sql("DROP INDEX outside_idx", target)
        with self.assertRaisesRegex(WriteTargetError, "does not match"):
            validate_write_sql("DROP INDEX main.outside_idx", target)
        self.assertTrue(validate_write_sql("DROP INDEX dwp.internal_idx", target))

        connection = connect_sqlite(config)
        try:
            validate_connection_target(connection, config, target)
        finally:
            connection.close()

    def test_recording_facade_preflights_the_entire_batch_before_any_connection(self):
        config = {"type": "gaussdb", "schema": "dap"}
        with (
            patch("backend.app.db.facade.get_db_profile", return_value=config),
            patch("backend.app.db.facade.connect_with_profile") as connect,
        ):
            with self.assertRaisesRegex(WriteTargetError, "does not match"):
                execute_statements(
                    "primary",
                    [
                        "UPDATE p_asset_table SET table_name = 'safe'",
                        "UPDATE dwp.p_report_asset SET owner_name = 'wrong'",
                    ],
                )
        connect.assert_not_called()

    def test_raw_execute_sql_validates_before_connect_and_preserves_literal(self):
        config = {"type": "postgres", "schema": "dap"}
        with (
            patch("backend.app.db.facade.get_db_profile", return_value=config),
            patch("backend.app.db.facade.connect_with_profile") as connect,
        ):
            with self.assertRaisesRegex(WriteTargetError, "does not match"):
                execute_sql(
                    "primary",
                    "UPDATE dwp.p_asset_table SET table_name = 'wrong'",
                )
        connect.assert_not_called()

        connection = RecordingConnection(schema="dap")
        with (
            patch("backend.app.db.facade.get_db_profile", return_value=config),
            patch("backend.app.db.facade.connect_with_profile", return_value=connection),
        ):
            execute_sql(
                "primary",
                "UPDATE __app__.p_asset_table "
                "SET table_name = 'literal dwp.p_asset_table' WHERE id = 1",
            )
        self.assertEqual("SELECT current_schema(), current_schemas(false)", connection.calls[0][0])
        self.assertIn("UPDATE dap.p_asset_table", connection.calls[1][0])
        self.assertIn("'literal dwp.p_asset_table'", connection.calls[1][0])
        self.assertEqual(1, connection.commits)

    def test_raw_str_and_tuple_share_validation_and_jdbc_session_probe(self):
        config = {"type": "gaussdb", "schema": "dap"}
        connection = RecordingConnection(schema="dap")
        statements = [
            "UPDATE __app__.p_asset_table SET table_name = 'literal __app__.t'",
            ("INSERT INTO __app__.p_asset_table (id) VALUES (?)", [7]),
        ]
        with (
            patch("backend.app.db.facade.get_db_profile", return_value=config),
            patch("backend.app.db.facade.connect_with_profile", return_value=connection),
        ):
            execute_statements("primary", statements)

        self.assertEqual("SELECT current_schema()", connection.calls[0][0])
        self.assertIn("UPDATE dap.p_asset_table", connection.calls[1][0])
        self.assertIn("'literal __app__.t'", connection.calls[1][0])
        self.assertEqual("INSERT INTO dap.p_asset_table (id) VALUES (?)", connection.calls[2][0])
        self.assertEqual((7,), connection.calls[2][1])
        self.assertEqual(1, connection.commits)
        self.assertEqual(0, connection.rollbacks)

    def test_jdbc_schema_mismatch_fails_before_core_dml_and_rolls_back(self):
        config = {"type": "gaussdb", "schema": "dap"}
        connection = RecordingConnection(schema="dwp")
        table = Table(
            "p_asset_table",
            MetaData(schema="__app__"),
            Column("id", Integer, primary_key=True),
        )
        with (
            patch("backend.app.db.core.get_db_profile", return_value=config),
            patch("backend.app.db.core.get_engine", return_value=None),
            patch("backend.app.db.core.connect_with_profile", return_value=connection),
        ):
            with self.assertRaisesRegex(WriteTargetError, "current_schema"):
                execute_core("primary", insert(table).values(id=1))

        self.assertEqual(["SELECT current_schema()"], [call[0] for call in connection.calls])
        self.assertEqual(0, connection.commits)
        self.assertEqual(1, connection.rollbacks)

    def test_postgres_ambiguous_search_path_fails_before_write(self):
        config = {"type": "postgres", "schema": "dap"}
        connection = RecordingConnection(schema="dap", search_schemas=["dap", "public"])
        table = Table(
            "p_asset_table",
            MetaData(schema="__app__"),
            Column("id", Integer, primary_key=True),
        )
        with (
            patch("backend.app.db.core.get_db_profile", return_value=config),
            patch("backend.app.db.core.get_engine", return_value=None),
            patch("backend.app.db.core.connect_with_profile", return_value=connection),
        ):
            with self.assertRaisesRegex(WriteTargetError, "search_path is ambiguous"):
                execute_core("primary", insert(table).values(id=1))

        self.assertEqual(1, len(connection.calls))
        self.assertEqual(0, connection.commits)
        self.assertEqual(1, connection.rollbacks)

    def test_core_batches_preflight_every_target_before_connection(self):
        config = {"type": "gaussdb", "schema": "dap"}
        valid_table = Table(
            "p_asset_table",
            MetaData(schema="__app__"),
            Column("id", Integer, primary_key=True),
        )
        wrong_table = Table(
            "p_report_asset",
            MetaData(),
            Column("id", Integer, primary_key=True),
            schema="dwp",
        )
        with (
            patch("backend.app.db.core.get_db_profile", return_value=config),
            patch("backend.app.db.core.get_engine", return_value=None),
            patch("backend.app.db.core.connect_with_profile") as connect,
        ):
            with self.assertRaisesRegex(WriteTargetError, "does not match"):
                execute_statements_core(
                    "primary",
                    [insert(valid_table).values(id=1), insert(wrong_table).values(id=2)],
                )
            connect.assert_not_called()

        with (
            patch("backend.app.db.core.get_db_profile", return_value=config),
            patch("backend.app.db.core.get_engine", return_value=None),
            patch("backend.app.db.core.connect_with_profile") as connect,
        ):
            with self.assertRaisesRegex(WriteTargetError, "does not match"):
                execute_many_core("primary", insert(wrong_table), [{"id": 2}])
        connect.assert_not_called()

    def test_core_rejects_explicit_wrong_table_schema_before_connect(self):
        config = {"type": "postgres", "schema": "dap"}
        table = Table(
            "p_asset_table",
            MetaData(),
            Column("id", Integer, primary_key=True),
            schema="dwp",
        )
        with (
            patch("backend.app.db.core.get_db_profile", return_value=config),
            patch("backend.app.db.core.get_engine", return_value=None),
            patch("backend.app.db.core.connect_with_profile") as connect,
        ):
            with self.assertRaisesRegex(WriteTargetError, "does not match"):
                execute_core("primary", insert(table).values(id=1))
        connect.assert_not_called()

    def test_textclause_write_is_rejected_before_connect(self):
        profiles = (
            {"type": "gaussdb", "schema": "dap"},
            {"type": "mysql", "database": "asset_db"},
        )
        for config in profiles:
            with self.subTest(provider=config["type"]):
                with (
                    patch("backend.app.db.core.get_db_profile", return_value=config),
                    patch("backend.app.db.core.get_engine", return_value=None),
                    patch("backend.app.db.core.connect_with_profile") as connect,
                ):
                    with self.assertRaisesRegex(
                        WriteTargetError, "TextClause DML/DDL"
                    ):
                        execute_core(
                            "primary", text("UPDATE dwp.p_asset_table SET id = 1")
                        )
                connect.assert_not_called()

    def test_gaussdb_provider_rejects_jdbc_current_schema_mismatch(self):
        profile = {
            "type": "gaussdb",
            "schema": "dap",
            "jdbc_url": "jdbc:gaussdb://db.example.test:25308/asset?currentSchema=dwp",
            "user": "test-user",
            "password": "test-password",
            "jar_path": "driver.jar",
        }
        with patch.object(Path, "exists", return_value=True):
            with self.assertRaisesRegex(ValueError, "currentSchema must match"):
                GaussDBProvider().validate("gauss_test", profile, config_path=Path("database.yaml"))

    def test_postgres_baseline_renders_only_schema_identifiers_for_profile(self):
        with tempfile.TemporaryDirectory(prefix="postgres-profile-baseline-") as directory:
            root = Path(directory)
            (root / "postgresql.sql").write_text(
                "-- Keep dwp.p_comment in this reference comment\n"
                "CREATE SCHEMA IF NOT EXISTS dwp;\n"
                "CREATE SCHEMA IF NOT EXISTS \"dwp\";\n"
                "CREATE TABLE IF NOT EXISTS dwp.p_system ("
                "schema_name TEXT DEFAULT 'dwp', note TEXT DEFAULT '__app__.p_report_asset');\n"
                "CREATE TABLE IF NOT EXISTS \"dwp\".quoted_table (id INTEGER);\n",
                encoding="utf-8",
            )
            rendered = render_baseline_for_profile(
                {"type": "postgres", "schema": "Dap"}, "postgresql", root
            )

        self.assertIn("-- Keep dwp.p_comment in this reference comment", rendered)
        self.assertEqual(2, rendered.count("CREATE SCHEMA IF NOT EXISTS dap;"))
        self.assertIn("CREATE TABLE IF NOT EXISTS dap.p_system", rendered)
        self.assertIn("DEFAULT 'dwp'", rendered)
        self.assertIn("DEFAULT '__app__.p_report_asset'", rendered)
        self.assertIn("CREATE TABLE IF NOT EXISTS dap.quoted_table", rendered)
        self.assertNotIn('CREATE TABLE IF NOT EXISTS "dwp".quoted_table', rendered)

    def test_postgres_dwp_target_preserves_canonical_baseline(self):
        canonical = baseline_path("postgresql").read_text(encoding="utf-8")
        rendered = render_baseline_for_profile(
            {"type": "postgres", "schema": "dwp"}, "postgresql"
        )
        self.assertEqual(canonical, rendered)

    def test_postgres_profile_target_is_shared_by_baseline_ledger_and_reflection(self):
        config = {"type": "postgres", "schema": "Dap"}
        self.assertEqual("dap.", _prefix(config))
        self.assertEqual("dap", _schema_for_reflection(config))
        reflection_queries = _reflection_metadata_queries(config)
        self.assertTrue(reflection_queries)
        for query in reflection_queries:
            with self.subTest(query=query.name):
                self.assertEqual(("dap",) * len(query.params), query.params)

        connection = RecordingConnection(schema="dap")
        self.assertTrue(initialize(connection, config, "postgresql"))
        statements = [sql for sql, _params in connection.calls]
        metadata_params = [
            params
            for sql, params in connection.calls
            if "information_schema.tables" in sql
        ]
        self.assertEqual([("dap", "alembic_version"), ("dap",)], metadata_params)
        self.assertTrue(
            any("CREATE SCHEMA IF NOT EXISTS dap" in sql for sql in statements)
        )
        self.assertTrue(
            any("CREATE TABLE IF NOT EXISTS dap.p_system" in sql for sql in statements)
        )
        self.assertIn(
            "CREATE TABLE IF NOT EXISTS dap.alembic_version "
            "(version_num VARCHAR(32) NOT NULL PRIMARY KEY)",
            statements,
        )
        self.assertFalse(
            any(sql.startswith("DELETE FROM dap.alembic_version") for sql in statements)
        )
        self.assertTrue(
            any(sql.startswith("SELECT version_num FROM dap.alembic_version") for sql in statements)
        )
        self.assertTrue(
            any(sql.startswith("INSERT INTO dap.alembic_version") for sql in statements)
        )
        self.assertEqual(1, connection.commits)
        self.assertEqual(0, connection.rollbacks)

    def test_postgres_missing_schema_fails_before_migration_query_or_ddl(self):
        connection = RecordingConnection(schema="dwp")
        with self.assertRaisesRegex(WriteTargetError, "explicit Profile schema"):
            initialize(connection, {"type": "postgres"}, "postgresql")
        with self.assertRaisesRegex(WriteTargetError, "explicit Profile schema"):
            render_baseline_for_profile({"type": "postgres"}, "postgresql")
        self.assertEqual([], connection.calls)
        self.assertEqual(0, connection.commits)
        self.assertEqual(0, connection.rollbacks)

    def test_execute_many_rejects_wrong_database_before_connect(self):
        config = {"type": "mysql", "database": "asset_db"}
        with (
            patch("backend.app.db.facade.get_db_profile", return_value=config),
            patch("backend.app.db.facade.connect_with_profile") as connect,
        ):
            with self.assertRaisesRegex(WriteTargetError, "does not match"):
                execute_many(
                    "primary",
                    "INSERT INTO dwp.p_report_asset (id) VALUES (?)",
                    [(1,)],
                )
        connect.assert_not_called()

    def test_caller_owned_connection_checks_session_before_dml(self):
        config = {"type": "gaussdb", "schema": "dap"}
        connection = RecordingConnection(schema="dwp")
        table = Table(
            "p_asset_table",
            MetaData(schema="__app__"),
            Column("id", Integer, primary_key=True),
        )
        with (
            patch("backend.app.db.core.get_db_profile", return_value=config),
            patch("backend.app.db.core.get_engine", return_value=None),
        ):
            with self.assertRaisesRegex(WriteTargetError, "current_schema"):
                execute_core_on_connection("primary", connection, insert(table).values(id=1))
        self.assertEqual(["SELECT current_schema()"], [call[0] for call in connection.calls])

    def test_caller_owned_cursor_requires_and_checks_parent_connection(self):
        config = {"type": "gaussdb", "schema": "dap"}
        connection = RecordingConnection(schema="dwp")
        cursor = connection.cursor()
        table = Table(
            "p_asset_table",
            MetaData(schema="__app__"),
            Column("id", Integer, primary_key=True),
        )
        with (
            patch("backend.app.db.core.get_db_profile", return_value=config),
            patch("backend.app.db.core.get_engine", return_value=None),
        ):
            with self.assertRaisesRegex(WriteTargetError, "current_schema"):
                execute_core_on_cursor("primary", cursor, insert(table).values(id=1))
        self.assertEqual(["SELECT current_schema()"], [call[0] for call in connection.calls])


if __name__ == "__main__":
    unittest.main()
