"""GaussDB/JDBC ``execute_many_core`` batch fast-path regression tests (#333).

The GaussDB raw JDBC path must use the JDBC driver's own batch API
(``cursor.executemany`` -> ``prepareStatement`` + ``addBatch`` +
``executeBatch``) for homogeneous payloads instead of recompiling and
executing every row.  Anything the fast path cannot prove safe (heterogeneous
mappings, extra bind parameters, non-insert statements, non-GaussDB
providers) must keep the historical per-row semantics.
"""

from __future__ import annotations

import importlib
import importlib.util
import os
import sys
import tempfile
import types
import unittest
from contextlib import ExitStack, contextmanager
from datetime import date, datetime, time, timedelta, timezone
from unittest.mock import patch

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    Integer,
    LargeBinary,
    MetaData,
    String,
    Table,
    Time,
    insert,
)

from backend.app.db import core
from backend.app.db.core import execute_many_core
from backend.app.db.facade import clear_engine_cache, database_transaction
from backend.app.db.sqlite_adapter import connect as sqlite_connect

GAUSSDB_PROFILE = {"type": "gaussdb", "schema": "dap"}
POSTGRES_PROFILE = {"type": "postgres", "schema": "dwp"}

AWARE_UTC = datetime(2026, 10, 3, 9, 30, 1, 123456, tzinfo=timezone.utc)
AWARE_PLUS_8 = datetime(2026, 10, 3, 17, 30, 1, 123456, tzinfo=timezone(timedelta(hours=8)))
NAIVE = datetime(2026, 10, 3, 9, 30, 1, 123456)
EXPECTED_LITERAL = "2026-10-03 09:30:01.123456"


class _FakeTimestamp:
    java_name = "java.sql.Timestamp"

    def __init__(self, literal):
        self.literal = literal

    @classmethod
    def valueOf(cls, literal):
        return cls(literal)


class _FakeDate:
    java_name = "java.sql.Date"

    def __init__(self, literal):
        self.literal = literal

    @classmethod
    def valueOf(cls, literal):
        return cls(literal)


class _FakeTime:
    java_name = "java.sql.Time"

    def __init__(self, literal):
        self.literal = literal

    @classmethod
    def valueOf(cls, literal):
        return cls(literal)


_JAVA_CLASSES = {
    "java.sql.Timestamp": _FakeTimestamp,
    "java.sql.Date": _FakeDate,
    "java.sql.Time": _FakeTime,
}


class _FakeJpype(types.ModuleType):
    """Minimal JPype double that records which JDBC classes were resolved."""

    def __init__(self):
        super().__init__("jpype")
        self.resolved_classes = []

    def JClass(self, name):
        self.resolved_classes.append(name)
        return _JAVA_CLASSES[name]


def _import_gaussdb_adapter(stack: ExitStack):
    """Import the adapter without requiring optional JDBC dependencies."""
    if importlib.util.find_spec("jaydebeapi") is None:
        stack.enter_context(
            patch.dict(sys.modules, {"jaydebeapi": types.ModuleType("jaydebeapi")})
        )
    return importlib.import_module("backend.app.db.gaussdb_adapter")


class _BatchCursor:
    """DB-API cursor double that mirrors JayDeBeApi batch bookkeeping."""

    def __init__(self, *, batch_error=None, batch_rowcount=None):
        self.calls = []
        self.rowcount = -1
        self.description = None
        self.closed = False
        self._batch_error = batch_error
        self._batch_rowcount = batch_rowcount

    def execute(self, sql, params=None):
        self.calls.append(("execute", sql, params))
        self.rowcount = 1

    def executemany(self, sql, rows):
        rows = [tuple(row) for row in rows]
        self.calls.append(("executemany", sql, rows))
        if self._batch_error is not None:
            raise self._batch_error
        self.rowcount = len(rows) if self._batch_rowcount is None else self._batch_rowcount

    def fetchall(self):
        return []

    def close(self):
        self.closed = True

    @property
    def kinds(self):
        return [call[0] for call in self.calls]


class _BatchConnection:
    def __init__(self, cursor):
        self._cursor = cursor
        self.jconn = types.SimpleNamespace(getAutoCommit=lambda: False)
        self.closed = False
        self.committed = 0
        self.rolled_back = 0

    def cursor(self):
        return self._cursor

    def commit(self):
        self.committed += 1

    def rollback(self):
        self.rolled_back += 1

    def close(self):
        self.closed = True


def _batch_table() -> Table:
    metadata = MetaData()
    return Table(
        "batch_probe",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("name", String(64)),
        Column("amount", Float),
        Column("flag", Boolean),
        Column("payload", LargeBinary),
        schema="__app__",
    )


def _temporal_table() -> Table:
    metadata = MetaData()
    return Table(
        "temporal_batch_probe",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("generated_at", DateTime, nullable=False),
        Column("generated_date", Date),
        Column("generated_time", Time),
        schema="__app__",
    )


@contextmanager
def _gaussdb_path(connection):
    with (
        patch("backend.app.db.core.get_db_profile", return_value=dict(GAUSSDB_PROFILE)),
        patch("backend.app.db.core.get_engine", return_value=None),
        patch("backend.app.db.core.connect_with_profile", return_value=connection),
    ):
        yield


class JdbcBatchFastPathTests(unittest.TestCase):
    def setUp(self):
        self.cursor = _BatchCursor()
        self.connection = _BatchConnection(self.cursor)

    def tearDown(self):
        self.assertTrue(self.cursor.closed)

    def test_homogeneous_batch_compiles_once_and_calls_executemany_once(self):
        table = _batch_table()
        rows = [
            {"id": 1, "name": "alpha"},
            {"id": 2, "name": "beta"},
            {"id": 3, "name": "gamma"},
        ]

        with patch.object(core, "_compile_statement", wraps=core._compile_statement) as compile_statement:
            with _gaussdb_path(self.connection):
                affected = execute_many_core("primary", insert(table), rows)

        self.assertEqual(3, affected)
        self.assertEqual(1, compile_statement.call_count)
        self.assertEqual(["executemany"], self.cursor.kinds)
        _kind, sql, params = self.cursor.calls[0]
        self.assertIn("INSERT INTO dap.batch_probe", sql)
        self.assertEqual([(1, "alpha"), (2, "beta"), (3, "gamma")], params)

    def test_key_order_does_not_change_bind_order(self):
        table = _batch_table()
        rows = [{"id": 1, "name": "alpha"}, {"name": "beta", "id": 2}]

        with _gaussdb_path(self.connection):
            affected = execute_many_core("primary", insert(table), rows)

        self.assertEqual(2, affected)
        self.assertEqual(["executemany"], self.cursor.kinds)
        self.assertEqual([(1, "alpha"), (2, "beta")], self.cursor.calls[0][2])

    def test_thousand_rows_use_single_executemany(self):
        table = _batch_table()
        rows = [{"id": index, "name": f"node-{index}"} for index in range(1000)]

        with _gaussdb_path(self.connection):
            affected = execute_many_core("primary", insert(table), rows)

        self.assertEqual(1000, affected)
        self.assertEqual(["executemany"], self.cursor.kinds)
        params = self.cursor.calls[0][2]
        self.assertEqual(1000, len(params))
        self.assertEqual((0, "node-0"), params[0])
        self.assertEqual((999, "node-999"), params[-1])

    def test_negative_batch_rowcount_reports_attempted_rows(self):
        table = _batch_table()
        rows = [{"id": 1, "name": "alpha"}, {"id": 2, "name": "beta"}]
        self.cursor = _BatchCursor(batch_rowcount=-4)
        self.connection = _BatchConnection(self.cursor)

        with _gaussdb_path(self.connection):
            affected = execute_many_core("primary", insert(table), rows)

        self.assertEqual(2, affected)
        self.assertEqual(["executemany"], self.cursor.kinds)

    def test_heterogeneous_mappings_fall_back_to_per_row_execution(self):
        table = _batch_table()
        rows = [{"id": 1, "name": "alpha"}, {"id": 2}]

        with _gaussdb_path(self.connection):
            affected = execute_many_core("primary", insert(table), rows)

        self.assertEqual(2, affected)
        self.assertEqual(["execute", "execute"], self.cursor.kinds)
        first_sql, first_params = self.cursor.calls[0][1], self.cursor.calls[0][2]
        second_sql, second_params = self.cursor.calls[1][1], self.cursor.calls[1][2]
        self.assertIn("name", first_sql)
        self.assertNotIn("name", second_sql)
        self.assertEqual((1, "alpha"), tuple(first_params))
        self.assertEqual((2,), tuple(second_params))

    def test_statement_with_extra_bind_parameters_falls_back_to_per_row(self):
        table = _batch_table()
        rows = [{"name": "alpha"}, {"name": "beta"}]

        with _gaussdb_path(self.connection):
            affected = execute_many_core("primary", insert(table).values(id=7), rows)

        self.assertEqual(2, affected)
        self.assertEqual(["execute", "execute"], self.cursor.kinds)
        self.assertEqual((7, "alpha"), tuple(self.cursor.calls[0][2]))
        self.assertEqual((7, "beta"), tuple(self.cursor.calls[1][2]))

    def test_none_and_primitive_values_are_passed_through_unchanged(self):
        table = _batch_table()
        rows = [{"id": 7, "name": None, "amount": 3.5, "flag": True, "payload": b"bytes"}]

        with _gaussdb_path(self.connection):
            affected = execute_many_core("primary", insert(table), rows)

        self.assertEqual(1, affected)
        params = self.cursor.calls[0][2]
        self.assertEqual([(7, None, 3.5, True, b"bytes")], params)
        values = params[0]
        self.assertIsNone(values[1])
        self.assertIsInstance(values[4], bytes)

    def test_non_gaussdb_raw_path_keeps_per_row_execution(self):
        table = _batch_table()
        rows = [{"id": 1, "name": "alpha"}, {"id": 2, "name": "beta"}]

        with (
            patch("backend.app.db.core.get_db_profile", return_value=dict(POSTGRES_PROFILE)),
            patch("backend.app.db.core.get_engine", return_value=None),
            patch("backend.app.db.core.connect_with_profile", return_value=self.connection),
        ):
            affected = execute_many_core("primary", insert(table), rows)

        self.assertEqual(2, affected)
        self.assertEqual(["execute", "execute"], self.cursor.kinds)


class JdbcBatchTemporalNormalizationTests(unittest.TestCase):
    def setUp(self):
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.fake_jpype = _FakeJpype()
        stack.enter_context(patch.dict(sys.modules, {"jpype": self.fake_jpype}))
        self.adapter = _import_gaussdb_adapter(stack)
        self.cursor = _BatchCursor()
        self.connection = _BatchConnection(self.cursor)

    def test_batch_rows_still_normalize_temporal_binds(self):
        table = _temporal_table()
        rows = [
            {
                "id": 1,
                "generated_at": AWARE_UTC,
                "generated_date": date(2026, 10, 3),
                "generated_time": time(9, 30, 1, 123456),
            },
            {
                "id": 2,
                "generated_at": AWARE_PLUS_8,
                "generated_date": date(2026, 10, 4),
                "generated_time": time(9, 30, 2),
            },
            {
                "id": 3,
                "generated_at": NAIVE,
                "generated_date": date(2026, 10, 5),
                "generated_time": time(9, 30, 3),
            },
        ]

        with _gaussdb_path(self.connection):
            affected = execute_many_core("primary", insert(table), rows)

        self.assertEqual(3, affected)
        self.assertEqual(["executemany"], self.cursor.kinds)
        params = self.cursor.calls[0][2]
        self.assertEqual(3, len(params))
        for row in params:
            self.assertIsInstance(row[1], _FakeTimestamp)
            self.assertIsInstance(row[2], _FakeDate)
            self.assertIsInstance(row[3], _FakeTime)
        self.assertEqual(EXPECTED_LITERAL, params[0][1].literal)
        self.assertEqual(EXPECTED_LITERAL, params[1][1].literal)
        self.assertEqual(EXPECTED_LITERAL, params[2][1].literal)
        self.assertEqual("2026-10-03", params[0][2].literal)
        self.assertEqual("09:30:01", params[0][3].literal)

    def test_non_temporal_batch_does_not_touch_jpype(self):
        table = _batch_table()
        rows = [{"id": 1, "name": "alpha"}, {"id": 2, "name": "beta"}]

        with _gaussdb_path(self.connection):
            execute_many_core("primary", insert(table), rows)

        self.assertEqual([], self.fake_jpype.resolved_classes)


class JdbcBatchTransactionTests(unittest.TestCase):
    def test_batch_failure_propagates_and_rolls_back_without_retry(self):
        table = _batch_table()
        cursor = _BatchCursor(batch_error=RuntimeError("jdbc batch failed"))
        connection = _BatchConnection(cursor)
        rows = [{"id": 1, "name": "alpha"}, {"id": 2, "name": "beta"}]

        with (
            patch("backend.app.db.facade.get_db_profile", return_value=dict(GAUSSDB_PROFILE)),
            patch("backend.app.db.facade.connect_with_profile", return_value=connection),
            patch("backend.app.db.core.get_db_profile", return_value=dict(GAUSSDB_PROFILE)),
            patch("backend.app.db.core.get_engine", return_value=None),
        ):
            with self.assertRaisesRegex(RuntimeError, "jdbc batch failed"):
                with database_transaction():
                    execute_many_core("primary", insert(table), rows)

        self.assertEqual(0, connection.committed)
        self.assertEqual(1, connection.rolled_back)
        self.assertEqual(["executemany"], cursor.kinds)
        self.assertTrue(cursor.closed)

    def test_successful_shared_transaction_commits_once(self):
        table = _batch_table()
        cursor = _BatchCursor()
        connection = _BatchConnection(cursor)
        rows = [{"id": 1, "name": "alpha"}, {"id": 2, "name": "beta"}]

        with (
            patch("backend.app.db.facade.get_db_profile", return_value=dict(GAUSSDB_PROFILE)),
            patch("backend.app.db.facade.connect_with_profile", return_value=connection),
            patch("backend.app.db.core.get_db_profile", return_value=dict(GAUSSDB_PROFILE)),
            patch("backend.app.db.core.get_engine", return_value=None),
        ):
            with database_transaction():
                execute_many_core("primary", insert(table), rows)
                self.assertEqual(0, connection.committed)

        self.assertEqual(1, connection.committed)
        self.assertEqual(0, connection.rolled_back)


class SqlAlchemyProviderBatchTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(clear_engine_cache)
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.database = os.path.join(self.temp_dir.name, "core_batch.sqlite")
        self.config = {"type": "sqlite", "database": self.database}
        connection = sqlite_connect(self.config)
        try:
            connection.execute(
                "CREATE TABLE dwp.batch_probe ("
                "id INTEGER PRIMARY KEY, name VARCHAR(64), amount FLOAT, "
                "flag BOOLEAN, payload BLOB)"
            )
            connection.commit()
        finally:
            connection.close()

    def test_sqlite_engine_path_executes_batch_without_jdbc_fast_path(self):
        profile = "sqlite_core_batch_test"
        rows = [
            {"id": 1, "name": "alpha"},
            {"id": 2, "name": "beta"},
            {"id": 3, "name": "gamma"},
        ]

        with (
            patch("backend.app.db.core.get_db_profile", return_value=dict(self.config)),
            patch.object(core, "_execute_many_jdbc_batch", wraps=core._execute_many_jdbc_batch) as jdbc_batch,
        ):
            affected = execute_many_core(profile, insert(_batch_table()), rows)

        jdbc_batch.assert_not_called()
        self.assertEqual(3, affected)
        connection = sqlite_connect(self.config)
        try:
            stored = connection.execute(
                "SELECT id, name FROM dwp.batch_probe ORDER BY id"
            ).fetchall()
        finally:
            connection.close()
        self.assertEqual([(1, "alpha"), (2, "beta"), (3, "gamma")], stored)


if __name__ == "__main__":
    unittest.main()
