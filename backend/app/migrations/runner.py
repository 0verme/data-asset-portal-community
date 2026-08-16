from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

from .errors import BaselineError, LockError, VerificationError
from .manifest import Migration, load_manifest

LEDGER = "schema_migrations"
LOCK = "schema_migration_lock"


@dataclass(frozen=True)
class MigrationState:
    applied: dict[str, tuple[str, str]]
    pending: list[Migration]
    checksum_errors: list[str]
    unknown_versions: list[str]


class MigrationRunner:
    def __init__(self, connection, dialect: str, root: Path, *, enabled_modules=None):
        self.connection, self.dialect, self.root = connection, dialect, root
        selected_modules = set(enabled_modules or ())
        selected_modules.add("core")
        self.all_migrations = [
            migration
            for migration in load_manifest(root)
            if dialect in migration.files
        ]
        self.migrations = [
            migration
            for migration in self.all_migrations
            if selected_modules.intersection(migration.modules)
        ]
        if dialect not in {"sqlite", "postgresql", "dws"}:
            raise VerificationError(f"unsupported database dialect: {dialect}")

    @property
    def placeholder(self):
        # PostgreSQL (psycopg) uses %s; DWS/JDBC path keeps ? like the app adapter.
        return "%s" if self.dialect == "postgresql" else "?"

    @property
    def table_prefix(self):
        return "dwp."

    def _execute(self, sql, params=None):
        cur = self.connection.cursor()
        try:
            cur.execute(sql, params or ())
            return cur
        except Exception:
            cur.close()
            raise

    def ensure_ledger(self):
        table = f"{self.table_prefix}{LEDGER}"
        lock = f"{self.table_prefix}{LOCK}"
        self._execute(
            f"CREATE TABLE IF NOT EXISTS {table} ("
            f"version VARCHAR(64) PRIMARY KEY, "
            f"name VARCHAR(255) NOT NULL, "
            f"checksum VARCHAR(64) NOT NULL, "
            f"applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            f"execution_ms INTEGER NOT NULL)"
        ).close()
        self._execute(
            f"CREATE TABLE IF NOT EXISTS {lock} (lock_name VARCHAR(64) PRIMARY KEY)"
        ).close()
        self._execute(
            f"INSERT INTO {lock} (lock_name) "
            f"SELECT 'schema_migrations' WHERE NOT EXISTS ("
            f"SELECT 1 FROM {lock} WHERE lock_name = 'schema_migrations')"
        ).close()
        self.connection.commit()

    def _ledger(self) -> dict[str, tuple[str, str]]:
        table = f"{self.table_prefix}{LEDGER}"
        try:
            cur = self._execute(f"SELECT version, name, checksum FROM {table} ORDER BY version")
            rows = cur.fetchall()
            cur.close()
        except Exception as exc:
            raise VerificationError("schema migrations ledger is not installed") from exc
        return {row[0]: (row[1], row[2]) for row in rows}

    def status(self, create_ledger=False) -> MigrationState:
        if create_ledger:
            self.ensure_ledger()
        applied = self._ledger()
        known = {m.version: m for m in self.all_migrations}
        checksum_errors = [
            v for v, (_, checksum) in applied.items()
            if v in known and checksum != known[v].checksum(self.dialect)
        ]
        unknown = sorted(set(applied) - set(known))
        return MigrationState(
            applied,
            [m for m in self.migrations if m.version not in applied],
            checksum_errors,
            unknown,
        )

    def verify(self, create_ledger=False) -> MigrationState:
        state = self.status(create_ledger=create_ledger)
        if state.checksum_errors or state.unknown_versions:
            details = state.checksum_errors + (
                ["unknown database versions: " + ", ".join(state.unknown_versions)]
                if state.unknown_versions else []
            )
            raise VerificationError("; ".join(details))
        return state

    def _acquire_lock(self):
        if self.dialect == "sqlite":
            self._execute(
                f"SELECT lock_name FROM {self.table_prefix}{LOCK} "
                "WHERE lock_name = 'schema_migrations'"
            ).close()
            return
        try:
            self._execute(
                f"SELECT lock_name FROM {self.table_prefix}{LOCK} "
                f"WHERE lock_name = 'schema_migrations' FOR UPDATE"
            ).close()
        except Exception as exc:
            raise LockError("could not acquire schema migration lock before timeout") from exc

    def _record(self, migration: Migration, ms: int):
        sql = (
            f"INSERT INTO {self.table_prefix}{LEDGER} "
            f"(version, name, checksum, execution_ms) VALUES "
            f"({self.placeholder}, {self.placeholder}, {self.placeholder}, {self.placeholder})"
        )
        self._execute(
            sql,
            (migration.version, migration.name, migration.checksum(self.dialect), ms),
        ).close()

    def apply(self) -> list[str]:
        self.ensure_ledger()
        self.verify()
        self._acquire_lock()
        executed: list[str] = []
        try:
            state = self.verify()
            for migration in state.pending:
                if migration.baseline:
                    raise BaselineError(
                        f"baseline migration {migration.version} must be registered with baseline, not applied"
                    )
                started = time.monotonic()
                sql = migration.files[self.dialect].read_text(encoding="utf-8")
                if self.dialect == "sqlite":
                    for statement in (part.strip() for part in sql.split(";")):
                        if statement:
                            self._execute(statement).close()
                else:
                    self._execute(sql).close()
                self._record(migration, int((time.monotonic() - started) * 1000))
                self.connection.commit()
                executed.append(migration.version)
            return executed
        except Exception:
            self.connection.rollback()
            raise

    def baseline(self, version: str, *, allow_empty=False, dry_run=False) -> list[str]:
        self.ensure_ledger()
        state = self.verify()
        selected = [m for m in self.migrations if m.version <= version]
        if not selected or selected[-1].version != version or not selected[-1].baseline:
            raise BaselineError("baseline version must be a declared baseline migration")
        if state.applied:
            raise BaselineError("baseline is only allowed for an unmanaged database")
        if not allow_empty and not self._has_user_tables():
            raise BaselineError("refusing to baseline an empty database")
        versions = [m.version for m in selected]
        if dry_run:
            return versions
        self._acquire_lock()
        try:
            for migration in selected:
                self._record(migration, 0)
            self.connection.commit()
            return versions
        except Exception:
            self.connection.rollback()
            raise

    def _has_user_tables(self):
        if self.dialect == "sqlite":
            cur = self._execute(
                "SELECT 1 FROM dwp.sqlite_master WHERE type='table' "
                "AND name NOT IN ('schema_migrations','schema_migration_lock') LIMIT 1"
            )
            row = cur.fetchone()
            cur.close()
            return row is not None
        cur = self._execute(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'dwp' "
            "AND table_name NOT IN ('schema_migrations', 'schema_migration_lock') "
            "LIMIT 1"
        )
        row = cur.fetchone()
        cur.close()
        return row is not None
