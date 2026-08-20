"""Shared Core access helpers for business services.

Services keep domain exceptions and transaction coordination here, but do
not assemble SQL strings, quote identifiers, or convert placeholders.
"""

from __future__ import annotations

from .core import (
    execute_core,
    execute_many_core,
    execute_statements_core,
    fetch_all_core,
    next_pk,
)
from .facade import resolve_db_profile_name


def rows_from_result(columns, rows) -> list[dict]:
    return [dict(zip(columns, row, strict=True)) for row in rows]


class CoreAccess:
    """Thin wrapper that maps infrastructure failures to a service exception."""

    def __init__(self, *, profile_getter, error_factory):
        self._profile_getter = profile_getter
        self._error_factory = error_factory

    def profile(self) -> str:
        return self._profile_getter() or resolve_db_profile_name()

    def _raise(self, fallback: str, error: Exception):
        if isinstance(error, FileNotFoundError):
            raise self._error_factory("数据库配置文件不存在") from error
        if isinstance(error, (KeyError, RuntimeError, ValueError)):
            raise self._error_factory("数据库服务暂不可用，请稍后重试") from error
        raise self._error_factory(fallback) from error

    def fetch_rows(self, statement) -> list[dict]:
        try:
            columns, rows = fetch_all_core(self.profile(), statement)
        except Exception as error:
            self._raise("数据库查询失败", error)
        return rows_from_result(columns, rows)

    def execute(self, statement) -> int:
        try:
            return execute_core(self.profile(), statement)
        except Exception as error:
            self._raise("数据库执行失败", error)
        return 0

    def execute_many(self, statement, rows) -> int:
        try:
            return execute_many_core(self.profile(), statement, rows)
        except Exception as error:
            self._raise("数据库执行失败", error)
        return 0

    def execute_statements(self, statements) -> int:
        try:
            return execute_statements_core(self.profile(), statements)
        except Exception as error:
            self._raise("数据库执行失败", error)
        return 0

    def next_pk(self, table, column) -> int:
        try:
            return next_pk(self.profile(), table, column)
        except Exception as error:
            self._raise("数据库查询失败", error)
        return 0
