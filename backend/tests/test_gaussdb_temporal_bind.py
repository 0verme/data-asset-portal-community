"""GaussDB/JDBC temporal bind normalization regression tests.

Real failure (Issue #329): the GaussDB vendor JDBC driver has no
``setObject(int, datetime)`` overload, so JayDeBeApi raises ``TypeError`` for
every Python ``datetime`` bind value, starting with the lineage snapshot
INSERT.  These tests pin the database infrastructure boundary: temporal values
are converted to real ``java.sql`` objects before a raw JDBC cursor executes,
while SQLite/PostgreSQL/MySQL keep Python values untouched.
"""

from __future__ import annotations

import importlib
import importlib.util
import sys
import types
import unittest
from contextlib import ExitStack
from datetime import date, datetime, time, timedelta, timezone
from unittest.mock import patch

from sqlalchemy import Column, DateTime, Integer, MetaData, Table, insert, select

from backend.app.db.core import (
    execute_core,
    execute_core_on_cursor,
    execute_many_core,
    execute_statements_core,
    fetch_all_core,
)
from backend.app.db.facade import _prepare_execute_args, execute_many, execute_sql, execute_statements, fetch_all

AWARE_UTC = datetime(2026, 10, 2, 16, 0, 1, 799209, tzinfo=timezone.utc)
AWARE_PLUS_8 = datetime(2026, 10, 3, 0, 0, 1, 799209, tzinfo=timezone(timedelta(hours=8)))
NAIVE = datetime(2026, 10, 2, 16, 0, 1, 799209)
EXPECTED_LITERAL = "2026-10-02 16:00:01.799209"
GAUSSDB_PROFILE = {"type": "gaussdb", "schema": "dap"}


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


class _RecordingCursor:
    def __init__(self):
        self.calls = []
        self.rowcount = 1
        self.description = None
        self.closed = False

    def execute(self, sql, params=None):
        self.calls.append((sql, params))

    def executemany(self, sql, rows):
        self.calls.append((sql, [tuple(row) for row in rows]))

    def fetchall(self):
        return []

    def close(self):
        self.closed = True


class _RecordingConnection:
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


def _temporal_table() -> Table:
    metadata = MetaData()
    return Table(
        "temporal_bind_probe",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("generated_at", DateTime, nullable=False),
        schema="__app__",
    )


def _timestamp_literals(params) -> list[str]:
    return [value.literal for value in params if isinstance(value, _FakeTimestamp)]


class _GaussdbAdapterTestCase(unittest.TestCase):
    def setUp(self):
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.fake_jpype = _FakeJpype()
        stack.enter_context(patch.dict(sys.modules, {"jpype": self.fake_jpype}))
        self.adapter = _import_gaussdb_adapter(stack)


class GaussdbTemporalConversionTests(_GaussdbAdapterTestCase):
    def test_aware_utc_datetime_becomes_jdbc_timestamp(self):
        result = self.adapter.normalize_bind_value(AWARE_UTC)

        self.assertIsInstance(result, _FakeTimestamp)
        self.assertEqual(EXPECTED_LITERAL, result.literal)

    def test_aware_non_utc_datetime_is_written_as_utc_wall_clock(self):
        result = self.adapter.normalize_bind_value(AWARE_PLUS_8)

        self.assertIsInstance(result, _FakeTimestamp)
        self.assertEqual(EXPECTED_LITERAL, result.literal)

    def test_naive_datetime_keeps_wall_clock_and_microseconds(self):
        result = self.adapter.normalize_bind_value(NAIVE)

        self.assertIsInstance(result, _FakeTimestamp)
        self.assertEqual(EXPECTED_LITERAL, result.literal)

    def test_datetime_without_microseconds_still_uses_jdbc_timestamp(self):
        result = self.adapter.normalize_bind_value(datetime(2026, 10, 2, 16, 0, 1))

        self.assertIsInstance(result, _FakeTimestamp)
        self.assertEqual("2026-10-02 16:00:01.000000", result.literal)

    def test_date_becomes_jdbc_date(self):
        result = self.adapter.normalize_bind_value(date(2026, 10, 2))

        self.assertIsInstance(result, _FakeDate)
        self.assertEqual("2026-10-02", result.literal)

    def test_naive_time_becomes_second_precision_jdbc_time(self):
        result = self.adapter.normalize_bind_value(time(16, 0, 1, 799209))

        self.assertIsInstance(result, _FakeTime)
        self.assertEqual("16:00:01", result.literal)

    def test_aware_time_is_written_as_utc_wall_clock(self):
        value = time(0, 0, 1, 799209, tzinfo=timezone(timedelta(hours=8)))
        result = self.adapter.normalize_bind_value(value)

        self.assertIsInstance(result, _FakeTime)
        self.assertEqual("16:00:01", result.literal)

    def test_non_temporal_values_are_returned_unchanged(self):
        for value in (None, "text", 7, 3.5, True, b"bytes"):
            with self.subTest(value=value):
                self.assertIs(value, self.adapter.normalize_bind_value(value))

    def test_non_temporal_params_do_not_resolve_java_classes(self):
        params = (None, "text", 7, True)

        result = self.adapter.normalize_bind_params(params)

        self.assertEqual(params, result)
        self.assertEqual([], self.fake_jpype.resolved_classes)

    def test_normalize_bind_params_handles_sequences_and_mappings(self):
        sequence = self.adapter.normalize_bind_params(("snapshot-1", AWARE_UTC, None))
        mapping = self.adapter.normalize_bind_params({"generated_at": AWARE_UTC, "name": "n"})

        self.assertEqual("snapshot-1", sequence[0])
        self.assertIsInstance(sequence[1], _FakeTimestamp)
        self.assertEqual(EXPECTED_LITERAL, sequence[1].literal)
        self.assertIsNone(sequence[2])
        self.assertIsInstance(mapping["generated_at"], _FakeTimestamp)
        self.assertEqual("n", mapping["name"])

    def test_normalize_bind_params_keeps_none(self):
        self.assertIsNone(self.adapter.normalize_bind_params(None))


class GaussdbCoreBindTests(_GaussdbAdapterTestCase):
    def setUp(self):
        super().setUp()
        self.cursor = _RecordingCursor()
        self.connection = _RecordingConnection(self.cursor)

    def _patch_gaussdb_path(self):
        return (
            patch("backend.app.db.core.get_db_profile", return_value=dict(GAUSSDB_PROFILE)),
            patch("backend.app.db.core.get_engine", return_value=None),
            patch("backend.app.db.core.connect_with_profile", return_value=self.connection),
        )

    def test_execute_core_normalizes_datetime_bind(self):
        table = _temporal_table()
        profile_patch, engine_patch, connect_patch = self._patch_gaussdb_path()

        with profile_patch, engine_patch, connect_patch:
            affected = execute_core("primary", insert(table).values(id=1, generated_at=AWARE_UTC))

        self.assertEqual(1, affected)
        _sql, params = self.cursor.calls[0]
        self.assertEqual([EXPECTED_LITERAL], _timestamp_literals(params))

    def test_execute_core_on_cursor_normalizes_datetime_bind(self):
        table = _temporal_table()
        cursor = _RecordingCursor()

        with (
            patch("backend.app.db.core.get_db_profile", return_value=dict(GAUSSDB_PROFILE)),
            patch("backend.app.db.core.get_engine", return_value=None),
        ):
            execute_core_on_cursor(
                "primary", cursor, insert(table).values(id=1, generated_at=NAIVE)
            )

        _sql, params = cursor.calls[0]
        self.assertEqual([EXPECTED_LITERAL], _timestamp_literals(params))

    def test_execute_many_core_normalizes_every_row(self):
        table = _temporal_table()
        rows = [
            {"id": 1, "generated_at": AWARE_UTC},
            {"id": 2, "generated_at": AWARE_PLUS_8},
        ]

        with (
            patch("backend.app.db.core.get_db_profile", return_value=dict(GAUSSDB_PROFILE)),
            patch("backend.app.db.core.get_engine", return_value=None),
            patch("backend.app.db.core.connect_with_profile", return_value=self.connection),
        ):
            affected = execute_many_core("primary", insert(table), rows)

        self.assertEqual(2, affected)
        self.assertEqual(2, len(self.cursor.calls))
        self.assertEqual([EXPECTED_LITERAL], _timestamp_literals(self.cursor.calls[0][1]))
        self.assertEqual([EXPECTED_LITERAL], _timestamp_literals(self.cursor.calls[1][1]))

    def test_execute_statements_core_normalizes_datetime_bind(self):
        table = _temporal_table()
        statements = [
            insert(table).values(id=1, generated_at=AWARE_UTC),
            insert(table).values(id=2, generated_at=AWARE_PLUS_8),
        ]

        with (
            patch("backend.app.db.core.get_db_profile", return_value=dict(GAUSSDB_PROFILE)),
            patch("backend.app.db.core.get_engine", return_value=None),
            patch("backend.app.db.core.connect_with_profile", return_value=self.connection),
        ):
            affected = execute_statements_core("primary", statements)

        self.assertEqual(2, affected)
        for _sql, params in self.cursor.calls:
            self.assertEqual([EXPECTED_LITERAL], _timestamp_literals(params))

    def test_fetch_all_core_normalizes_datetime_bind(self):
        table = _temporal_table()
        statement = select(table.c.id).where(table.c.generated_at == AWARE_UTC)

        with (
            patch("backend.app.db.core.get_db_profile", return_value=dict(GAUSSDB_PROFILE)),
            patch("backend.app.db.core.get_engine", return_value=None),
            patch("backend.app.db.core.connect_with_profile", return_value=self.connection),
        ):
            fetch_all_core("primary", statement)

        _sql, params = self.cursor.calls[0]
        self.assertEqual([EXPECTED_LITERAL], _timestamp_literals(params))

    def test_gaussdb_non_temporal_bind_does_not_touch_jpype(self):
        table = _temporal_table()
        self.fake_jpype.resolved_classes.clear()
        profile_patch, engine_patch, connect_patch = self._patch_gaussdb_path()

        with profile_patch, engine_patch, connect_patch:
            execute_core("primary", insert(table).values(id=1))

        self.assertEqual([], self.fake_jpype.resolved_classes)


class GaussdbFacadeBindTests(_GaussdbAdapterTestCase):
    def setUp(self):
        super().setUp()
        self.cursor = _RecordingCursor()
        self.connection = _RecordingConnection(self.cursor)

    def _patch_facade_path(self, config=None):
        return (
            patch("backend.app.db.facade.get_db_profile", return_value=config or dict(GAUSSDB_PROFILE)),
            patch("backend.app.db.facade.connect_with_profile", return_value=self.connection),
        )

    def test_execute_sql_normalizes_datetime_bind(self):
        profile_patch, connect_patch = self._patch_facade_path()
        with profile_patch, connect_patch:
            execute_sql("primary", "INSERT INTO sample (ts) VALUES (?)", params=[AWARE_UTC])

        _sql, params = self.cursor.calls[0]
        self.assertEqual([EXPECTED_LITERAL], _timestamp_literals(params))

    def test_execute_many_normalizes_every_row(self):
        profile_patch, connect_patch = self._patch_facade_path()
        with profile_patch, connect_patch:
            execute_many(
                "primary",
                "INSERT INTO sample (id, ts) VALUES (?, ?)",
                [(1, AWARE_UTC), (2, AWARE_PLUS_8)],
            )

        _sql, rows = self.cursor.calls[0]
        self.assertEqual(2, len(rows))
        for row in rows:
            self.assertEqual([EXPECTED_LITERAL], _timestamp_literals(row))

    def test_execute_statements_normalizes_pair_params(self):
        profile_patch, connect_patch = self._patch_facade_path()
        with profile_patch, connect_patch:
            execute_statements(
                "primary",
                [("INSERT INTO sample (ts) VALUES (?)", [AWARE_UTC])],
            )

        _sql, params = self.cursor.calls[0]
        self.assertEqual([EXPECTED_LITERAL], _timestamp_literals(params))

    def test_fetch_all_normalizes_datetime_bind(self):
        profile_patch, connect_patch = self._patch_facade_path()
        with profile_patch, connect_patch:
            fetch_all("primary", "SELECT id FROM sample WHERE ts = ?", params=[NAIVE])

        _sql, params = self.cursor.calls[0]
        self.assertEqual([EXPECTED_LITERAL], _timestamp_literals(params))


class NonGaussdbBindIsolationTests(unittest.TestCase):
    def test_prepare_execute_args_keeps_python_temporal_for_other_providers(self):
        for config in ({"type": "sqlite"}, {"type": "postgres", "schema": "dwp"}, {"type": "mysql"}):
            with self.subTest(db_type=config["type"]):
                with patch("backend.app.db.facade.get_db_profile", return_value=config):
                    _sql, params = _prepare_execute_args(
                        "primary", "UPDATE sample SET ts = ? WHERE id = ?", params=[AWARE_UTC, 1]
                    )
                self.assertIs(AWARE_UTC, params[0])
                self.assertEqual(1, params[1])

    def test_postgres_core_path_keeps_python_datetime(self):
        table = _temporal_table()
        cursor = _RecordingCursor()
        connection = _RecordingConnection(cursor)

        with (
            patch("backend.app.db.core.get_db_profile", return_value={"type": "postgres", "schema": "dwp"}),
            patch("backend.app.db.core.get_engine", return_value=None),
            patch("backend.app.db.core.connect_with_profile", return_value=connection),
        ):
            execute_core("primary", insert(table).values(id=1, generated_at=AWARE_UTC))

        _sql, params = cursor.calls[0]
        temporal = [value for value in params if isinstance(value, datetime)]
        self.assertEqual(1, len(temporal))
        self.assertIs(AWARE_UTC, temporal[0])


if __name__ == "__main__":
    unittest.main()
