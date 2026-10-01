"""In-memory GaussDB/DWS simulation used by the incremental migration tests.

The helper answers the exact catalog queries produced by
:func:`backend.app.migrations.schema.reflect_schema` for a GaussDB profile and
applies the small DDL/DML surface emitted by the DWS revision adapters.  It is
deliberately a *simulation*: the point is to exercise the real reflection,
state detection, ledger advancement and failure semantics without a live
GaussDB/DWS instance.

The fake never pretends to validate GaussDB/DWS 8.1.3 SQL execution.  Real
validation remains ``NOT RUN`` until the maintainer executes
``backend/alembic/REAL_DWS_VALIDATION.md``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Iterable

from backend.app.migrations.schema import SchemaModel, baseline_schema

SCHEMA = "dap"

REVISION_ORDER = (
    "0002_portable_asset_filter",
    "0003_open_repository_modules",
    "0004_metadata_ingestion_identity",
    "0005_rbac_persistence",
    "0006_field_mapping_upstream_id",
    "0007_binary_status_contract",
    "0008_indicator_semantic_contract",
    "0009_upstream_option_contract",
    "0010_field_mapping_identity",
    "0011_push_job_freq_desc_capacity",
)

OPEN_MODULE_TABLES = (
    "p_upstream_system",
    "p_upstream_unload_time",
    "p_upstream_change_log",
    "p_push_system",
    "p_push_job",
    "p_push_job_field",
    "p_push_change_log",
    "p_report_asset",
    "p_manual_code_table",
    "p_lineage_snapshot",
    "p_lineage_node",
    "p_lineage_edge",
)

ASSET_IDENTITY_COLUMNS = (
    "catalog_name",
    "database_name",
    "source_key",
    "asset_type",
    "external_id",
    "qualified_name",
)
LINEAGE_INGESTION_COLUMNS = ("source_key", "content_hash", "ingestion_id")
ASSET_IDENTITY_UNIQUE = ("source_key", "asset_type", "external_id")
ASSET_LEGACY_UNIQUE = ("table_name",)
INDICATOR_SEMANTIC_COLUMNS = (
    "source_asset_id",
    "result_field_id",
    "aggregation_code",
    "semantic_state",
)


@dataclass
class FakeColumn:
    name: str
    type_name: str
    nullable: bool = True
    default: str | None = None
    primary_key: bool = False
    generated: bool = False


@dataclass
class FakeIndex:
    name: str
    columns: tuple[str, ...]
    unique: bool = False


@dataclass
class FakeTable:
    name: str
    columns: dict[str, FakeColumn] = field(default_factory=dict)
    primary_key: tuple[str, ...] = ()
    unique_constraints: dict[tuple[str, ...], str] = field(default_factory=dict)
    indexes: dict[str, FakeIndex] = field(default_factory=dict)
    checks: dict[str, str] = field(default_factory=dict)
    rows: list[dict[str, Any]] = field(default_factory=list)
    relation_id: int = 0

    def add_row(self, values: dict[str, Any]) -> None:
        row = {name: None for name in self.columns}
        row.update(values)
        self.rows.append(row)


class FakeCursor:
    def __init__(self, database: "FakeDwsDatabase") -> None:
        self.database = database
        self.result: list[tuple] = []
        self.description: list[tuple] | None = None

    def execute(self, sql: str, params: Any = None) -> "FakeCursor":
        self.database.execute(sql.strip(), params)
        self.result = self.database.consume_result()
        self.description = self.database.consume_description()
        return self

    def executemany(self, sql: str, rows: Iterable[Any]) -> "FakeCursor":
        for row in rows:
            self.database.execute(sql.strip(), row)
        return self

    def fetchone(self):
        return self.result[0] if self.result else None

    def fetchall(self):
        return list(self.result)

    def close(self) -> None:
        pass


class FakeDwsDatabase:
    """A tiny GaussDB/DWS state machine for migration tests."""

    def __init__(self, *, schema: str = SCHEMA) -> None:
        self.schema = schema
        self.tables: dict[str, FakeTable] = {}
        self.ledger_table = False
        self.ledger: str | None = None
        self.schema_exists = True
        self.executed: list[tuple[str, Any]] = []
        self.commits = 0
        self.rollbacks = 0
        self.fail_on: str | None = None
        self._next_relation_id = 1
        self._pending_result: list[tuple] = []
        self._pending_description: list[tuple] | None = None

    # -- connection API -------------------------------------------------

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1

    def close(self) -> None:
        pass

    # -- state helpers --------------------------------------------------

    def consume_result(self) -> list[tuple]:
        result = self._pending_result
        self._pending_result = []
        return result

    def consume_description(self):
        description = self._pending_description
        self._pending_description = None
        return description

    def table(self, name: str) -> FakeTable:
        return self.tables[name.lower()]

    def has_table(self, name: str) -> bool:
        return name.lower() in self.tables

    def seed_from_baseline(self) -> "FakeDwsDatabase":
        model = baseline_schema("dws")
        for name, spec in model.tables.items():
            table = self._table_from_spec(name, spec)
            self.tables[name] = table
        # The baseline parser intentionally ignores CHECK constraints; the
        # canonical status contract must still be visible to revision 0007.
        if "p_manual_code_table" in self.tables:
            self.add_check(
                "p_manual_code_table",
                "ck_p_manual_code_table_status_code",
                "status_code IN ('enabled', 'disabled')",
            )
        return self

    def _table_from_spec(self, name: str, spec) -> FakeTable:
        table = FakeTable(name=name, relation_id=self._allocate_relation_id())
        for column_name, column in spec.columns.items():
            table.columns[column_name] = FakeColumn(
                name=column_name,
                type_name=column.type_name,
                nullable=column.nullable,
                default=column.default,
                primary_key=column.primary_key,
                generated=column.generated_by_default,
            )
        table.primary_key = tuple(spec.primary_key)
        for columns in spec.unique_constraints:
            table.unique_constraints[tuple(columns)] = f"{name}_{'_'.join(columns)}_key"
        for index_name, index in spec.indexes.items():
            table.indexes[index_name] = FakeIndex(
                index_name, tuple(index.columns), index.unique
            )
        return table

    def _allocate_relation_id(self) -> int:
        value = self._next_relation_id
        self._next_relation_id += 1
        return value

    # -- legacy state construction --------------------------------------

    def remove_table(self, name: str) -> None:
        self.tables.pop(name.lower(), None)

    def remove_column(self, table_name: str, column: str) -> None:
        table = self.table(table_name)
        table.columns.pop(column, None)
        for index in list(table.indexes.values()):
            if column in index.columns:
                del table.indexes[index.name]
        table.unique_constraints = {
            columns: name
            for columns, name in table.unique_constraints.items()
            if column not in columns
        }

    def add_column(
        self,
        table_name: str,
        column: str,
        type_name: str,
        *,
        nullable: bool = True,
        default: str | None = None,
    ) -> None:
        self.table(table_name).columns[column] = FakeColumn(
            column, type_name, nullable=nullable, default=default
        )

    def add_unique(self, table_name: str, columns: tuple[str, ...], name: str) -> None:
        self.table(table_name).unique_constraints[tuple(columns)] = name

    def remove_unique(self, table_name: str, columns: tuple[str, ...]) -> None:
        self.table(table_name).unique_constraints.pop(tuple(columns), None)

    def add_index(
        self, table_name: str, name: str, columns: tuple[str, ...], *, unique: bool = False
    ) -> None:
        self.table(table_name).indexes[name] = FakeIndex(name, tuple(columns), unique)

    def remove_index(self, table_name: str, name: str) -> None:
        self.table(table_name).indexes.pop(name, None)

    def add_check(self, table_name: str, name: str, expression: str) -> None:
        self.table(table_name).checks[name] = expression

    def remove_check(self, table_name: str, name: str) -> None:
        self.table(table_name).checks.pop(name, None)

    def set_nullable(self, table_name: str, column: str, nullable: bool) -> None:
        self.table(table_name).columns[column].nullable = nullable

    def set_default(self, table_name: str, column: str, default: str | None) -> None:
        self.table(table_name).columns[column].default = default

    # -- statement execution --------------------------------------------

    def execute(self, sql: str, params: Any = None) -> None:
        self.executed.append((sql, params))
        if self.fail_on and self.fail_on in sql:
            raise RuntimeError(f"injected DWS failure: {self.fail_on}")
        # Canonical baseline statements may carry leading line comments.
        sql = re.sub(r"^(?:\s*--[^\n]*\n)+", "", sql)
        lowered = sql.lower()

        if self._handle_reflection(sql, params):
            return
        if self._handle_ledger(sql, params):
            return
        if self._handle_data_select(sql):
            return
        if self._handle_ddl(sql):
            return
        if self._handle_update(sql, params):
            return
        if self._handle_insert(sql, params):
            return
        raise AssertionError(f"FakeDwsDatabase cannot execute: {sql!r}")

    # -- reflection -----------------------------------------------------

    def _handle_reflection(self, sql: str, params: Any) -> bool:
        lowered = sql.lower()
        if "information_schema.schemata" in lowered:
            self._pending_result = [(1,)] if self.schema_exists else []
            self._pending_description = [("schema_name",)]
            return True
        if "information_schema.tables" in lowered:
            if "table_name <>" in lowered:
                names = [
                    name for name in self.tables
                    if name != "alembic_version"
                ]
                self._pending_result = [(1,)] if names else []
            else:
                requested = params[-1] if params else None
                exists = self.ledger_table if requested == "alembic_version" else requested in self.tables
                self._pending_result = [(1,)] if exists else []
            self._pending_description = [("exists",)]
            return True
        if lowered.startswith("select version_num from"):
            self._pending_result = [(self.ledger,)] if self.ledger else []
            self._pending_description = [("version_num",)]
            return True
        if "information_schema.columns" in lowered:
            self._pending_result = self._column_rows()
            self._pending_description = [("column_name",)]
            return True
        if "pg_get_constraintdef" in lowered:
            table = self.table(str(params[1]))
            self._pending_result = [
                (name, expression) for name, expression in table.checks.items()
            ]
            self._pending_description = [("conname", "definition")]
            return True
        if "from pg_attribute a" in lowered:
            self._pending_result = self._attribute_rows()
            self._pending_description = [("attrelid", "attnum", "attname")]
            return True
        if "from pg_constraint c" in lowered:
            self._pending_result = self._constraint_rows()
            self._pending_description = [("relname", "kind", "conname", "conkey")]
            return True
        if "information_schema.referential_constraints" in lowered:
            self._pending_result = []
            self._pending_description = [("constraint_name", "delete_rule")]
            return True
        if "pg_index" in lowered:
            self._pending_result = self._index_rows()
            self._pending_description = [("relname", "indexrelname", "indisunique", "indkey")]
            return True
        return False

    def _column_rows(self) -> list[tuple]:
        rows: list[tuple] = []
        for name in sorted(self.tables):
            table = self.tables[name]
            for ordinal, column in enumerate(table.columns.values(), start=1):
                default = column.default
                if column.generated:
                    default = f"nextval('{name}_{column.name}_seq'::regclass)"
                rows.append(
                    (
                        name,
                        column.name,
                        column.type_name,
                        None,
                        None,
                        None,
                        "YES" if column.nullable else "NO",
                        default,
                        ordinal,
                    )
                )
        return rows

    def _attribute_rows(self) -> list[tuple]:
        rows: list[tuple] = []
        for name in sorted(self.tables):
            table = self.tables[name]
            for ordinal, column in enumerate(table.columns.values(), start=1):
                rows.append((table.relation_id, ordinal, column.name))
        return rows

    def _constraint_rows(self) -> list[tuple]:
        rows: list[tuple] = []
        for name in sorted(self.tables):
            table = self.tables[name]
            attnums = {
                column.name: ordinal
                for ordinal, column in enumerate(table.columns.values(), start=1)
            }
            if table.primary_key:
                conkey = ",".join(
                    str(attnums[column])
                    for column in table.primary_key
                    if column in attnums
                )
                rows.append(
                    (
                        name,
                        "PRIMARY KEY",
                        f"{name}_pkey",
                        "{" + conkey + "}",
                        table.relation_id,
                        None,
                        None,
                        None,
                        None,
                    )
                )
            for columns, constraint_name in sorted(table.unique_constraints.items()):
                if columns == table.primary_key:
                    continue
                conkey = ",".join(
                    str(attnums[column]) for column in columns if column in attnums
                )
                rows.append(
                    (
                        name,
                        "UNIQUE",
                        constraint_name,
                        "{" + conkey + "}",
                        table.relation_id,
                        None,
                        None,
                        None,
                        None,
                    )
                )
        return rows

    def _index_rows(self) -> list[tuple]:
        rows: list[tuple] = []
        for name in sorted(self.tables):
            table = self.tables[name]
            attnums = {
                column.name: ordinal
                for ordinal, column in enumerate(table.columns.values(), start=1)
            }
            for index in table.indexes.values():
                indkey = " ".join(
                    str(attnums[column]) for column in index.columns if column in attnums
                )
                rows.append(
                    (
                        name,
                        index.name,
                        index.unique,
                        indkey,
                        table.relation_id,
                    )
                )
        return rows

    # -- data selects ---------------------------------------------------

    def _handle_data_select(self, sql: str) -> bool:
        match = re.match(
            r"SELECT\s+(?P<columns>.+?)\s+FROM\s+(?P<table>[\w\".]+)\s*(?P<tail>.*)$",
            sql,
            re.I | re.S,
        )
        if not match:
            return False
        table_name = match.group("table").split(".")[-1].strip('"').lower()
        if table_name == "alembic_version":
            return False
        table = self.tables.get(table_name)
        if table is None:
            return False
        columns_text = match.group("columns").strip()
        tail = match.group("tail").strip()
        if columns_text.upper().startswith("DISTINCT "):
            column = columns_text.split(None, 1)[1].strip()
            values = {row.get(column) for row in table.rows}
            self._pending_result = [(value,) for value in sorted(values, key=str) if value is not None]
            self._pending_description = [(column,)]
            return True
        if columns_text.upper().startswith("COUNT(*)"):
            count = len(table.rows)
            where = tail
            if "semantic_state IS NULL" in where:
                count = sum(1 for row in table.rows if row.get("semantic_state") is None)
            self._pending_result = [(count,)]
            self._pending_description = [("count",)]
            return True
        selected = [part.strip() for part in columns_text.split(",")]
        rows = []
        for row in table.rows:
            rows.append(tuple(row.get(column) for column in selected))
        self._pending_result = rows
        self._pending_description = [(column,) for column in selected]
        return True

    # -- DDL -------------------------------------------------------------

    def _handle_ddl(self, sql: str) -> bool:
        create_table = re.match(
            r"CREATE TABLE IF NOT EXISTS (?:[\w\"]+\.)?(?P<table>\w+)\s*\(",
            sql,
            re.I,
        )
        if create_table:
            self._create_table(create_table.group("table").lower(), sql)
            return True
        create_index = re.match(
            r"CREATE (?P<unique>UNIQUE )?INDEX\s+(?P<name>\w+)\s+ON\s+"
            r"(?:[\w\"]+\.)?(?P<table>\w+)\s*\((?P<columns>[^)]*)\)",
            sql,
            re.I,
        )
        if create_index:
            table = self.table(create_index.group("table"))
            columns = tuple(
                part.strip().strip('"')
                for part in create_index.group("columns").split(",")
            )
            table.indexes[create_index.group("name")] = FakeIndex(
                create_index.group("name"), columns, bool(create_index.group("unique"))
            )
            return True
        drop_index = re.match(
            r"DROP INDEX (?:[\w\"]+\.)?(?P<name>\w+)$", sql, re.I
        )
        if drop_index:
            for table in self.tables.values():
                table.indexes.pop(drop_index.group("name"), None)
            return True
        add_column = re.match(
            r"ALTER TABLE (?:[\w\"]+\.)?(?P<table>\w+) ADD COLUMN (?P<name>\w+) "
            r"(?P<definition>.+)$",
            sql,
            re.I | re.S,
        )
        if add_column:
            table = self.table(add_column.group("table"))
            definition = add_column.group("definition")
            nullable = "NOT NULL" not in definition.upper()
            default_match = re.search(r"DEFAULT\s+(.+?)\s*$", definition, re.I)
            default = default_match.group(1).strip() if default_match else None
            type_name = re.split(
                r"\s+(?:NOT NULL|DEFAULT)\b", definition, flags=re.I
            )[0].strip()
            table.columns[add_column.group("name")] = FakeColumn(
                add_column.group("name"),
                type_name,
                nullable=nullable,
                default=default,
            )
            return True
        alter_column = re.match(
            r"ALTER TABLE (?:[\w\"]+\.)?(?P<table>\w+) ALTER COLUMN (?P<name>\w+) "
            r"(?P<action>.+)$",
            sql,
            re.I,
        )
        if alter_column:
            table = self.table(alter_column.group("table"))
            column = table.columns[alter_column.group("name")]
            action = alter_column.group("action").strip()
            if re.fullmatch(r"DROP NOT NULL", action, re.I):
                column.nullable = True
            elif re.fullmatch(r"SET NOT NULL", action, re.I):
                column.nullable = False
            elif re.match(r"SET DEFAULT ", action, re.I):
                column.default = re.sub(r"SET DEFAULT ", "", action, flags=re.I).strip()
            elif re.match(r"TYPE\s+", action, re.I):
                column.type_name = re.sub(r"TYPE\s+", "", action, flags=re.I).strip()
            return True
        add_constraint = re.match(
            r"ALTER TABLE (?:[\w\"]+\.)?(?P<table>\w+) ADD CONSTRAINT "
            r"(?P<name>\w+) (?P<definition>.+)$",
            sql,
            re.I | re.S,
        )
        if add_constraint:
            table = self.table(add_constraint.group("table"))
            definition = add_constraint.group("definition")
            unique = re.match(r"UNIQUE\s*\((?P<columns>[^)]*)\)", definition, re.I)
            if unique:
                columns = tuple(
                    part.strip().strip('"')
                    for part in unique.group("columns").split(",")
                )
                table.unique_constraints[columns] = add_constraint.group("name")
                return True
            check = re.match(r"CHECK\s*\((?P<expression>.+)\)$", definition, re.I | re.S)
            if check:
                table.checks[add_constraint.group("name")] = check.group("expression")
                return True
        drop_constraint = re.match(
            r"ALTER TABLE (?:[\w\"]+\.)?(?P<table>\w+) DROP CONSTRAINT "
            r"\"?(?P<name>[^\"]+)\"?$",
            sql,
            re.I,
        )
        if drop_constraint:
            table = self.table(drop_constraint.group("table"))
            name = drop_constraint.group("name")
            table.checks.pop(name, None)
            for columns, constraint_name in list(table.unique_constraints.items()):
                if constraint_name == name:
                    del table.unique_constraints[columns]
            return True
        return False

    def _create_table(self, name: str, sql: str) -> None:
        model: SchemaModel = baseline_schema("dws")
        spec = model.tables.get(name)
        if spec is None:
            raise AssertionError(f"unknown canonical table: {name}")
        table = self._table_from_spec(name, spec)
        for check in re.finditer(r"CHECK\s*\((?P<expression>[^()]*)\)", sql, re.I):
            expression = check.group("expression").strip()
            if "status_code" in expression:
                table.checks["ck_p_manual_code_table_status_code"] = expression
            elif "table_style" in expression:
                table.checks["ck_p_manual_code_table_table_style"] = expression
        self.tables[name] = table

    # -- DML -------------------------------------------------------------

    def _handle_update(self, sql: str, params: Any) -> bool:
        match = re.match(
            r"UPDATE (?:[\w\"]+\.)?(?P<table>\w+) SET (?P<assignments>.+?) "
            r"WHERE (?P<where>.+)$",
            sql,
            re.I | re.S,
        )
        if not match:
            return False
        table = self.tables.get(match.group("table").lower())
        if table is None:
            return False
        param_index = 0
        assignments, param_index = self._parse_assignments(
            match.group("assignments"), params, param_index
        )
        conditions, _ = self._parse_conditions(match.group("where"), params, param_index)
        for row in table.rows:
            if all(self._condition_matches(row, condition) for condition in conditions):
                for column, value in assignments:
                    row[column] = value
        return True

    def _parse_assignments(self, text: str, params: Any, param_index: int):
        assignments = []
        for part in text.split(","):
            column, value = part.split("=", 1)
            column = column.strip()
            value = value.strip()
            if value == "?":
                assignments.append((column, params[param_index]))
                param_index += 1
            else:
                assignments.append((column, self._literal(value)))
        return assignments, param_index

    def _parse_conditions(self, text: str, params: Any, param_index: int):
        conditions = []
        for part in re.split(r"\s+AND\s+", text, flags=re.I):
            part = part.strip()
            is_null = re.match(r"(?P<column>\w+)\s+IS\s+NULL$", part, re.I)
            if is_null:
                conditions.append((is_null.group("column"), "IS NULL", None))
                continue
            column, value = part.split("=", 1)
            column = column.strip()
            value = value.strip()
            if value == "?":
                conditions.append((column, "=", params[param_index]))
                param_index += 1
            else:
                conditions.append((column, "=", self._literal(value)))
        return conditions, param_index

    @staticmethod
    def _literal(value: str):
        value = value.strip()
        if value.upper() == "NULL":
            return None
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            return value[1:-1]
        try:
            return int(value)
        except ValueError:
            return value

    @staticmethod
    def _condition_matches(row, condition) -> bool:
        column, operator, value = condition
        current = row.get(column)
        if operator == "IS NULL":
            return current is None
        return current == value

    def _handle_insert(self, sql: str, params: Any) -> bool:
        match = re.match(
            r"INSERT INTO (?:[\w\"]+\.)?(?P<table>\w+)\s*\((?P<columns>[^)]*)\)\s*"
            r"VALUES\s*\((?P<values>[^)]*)\)",
            sql,
            re.I | re.S,
        )
        if not match:
            return False
        table = self.tables.get(match.group("table").lower())
        if table is None:
            return False
        columns = [part.strip() for part in match.group("columns").split(",")]
        values = [part.strip() for part in match.group("values").split(",")]
        row = {}
        param_index = 0
        for column, value in zip(columns, values):
            if value == "?":
                row[column] = params[param_index]
                param_index += 1
            else:
                row[column] = self._literal(value)
        table.add_row(row)
        return True

    # -- ledger ----------------------------------------------------------

    def _handle_ledger(self, sql: str, params: Any) -> bool:
        lowered = sql.lower()
        if lowered.startswith("create table if not exists") and "alembic_version" in lowered:
            self.ledger_table = True
            return True
        if lowered.startswith("delete from") and "alembic_version" in lowered:
            self.ledger = None
            return True
        if lowered.startswith("insert into") and "alembic_version" in lowered:
            self.ledger = params[0] if params else None
            return True
        return False

    # -- assertions ------------------------------------------------------

    def table_state(self, name: str) -> dict:
        table = self.table(name)
        return {
            "columns": {
                column: {
                    "type": spec.type_name,
                    "nullable": spec.nullable,
                    "default": spec.default,
                }
                for column, spec in table.columns.items()
            },
            "primary_key": tuple(table.primary_key),
            "unique": sorted(tuple(columns) for columns in table.unique_constraints),
            "indexes": {
                index_name: (tuple(index.columns), index.unique)
                for index_name, index in table.indexes.items()
            },
            "rows": [dict(row) for row in table.rows],
        }


def canonical_snapshot(database: FakeDwsDatabase) -> dict:
    return {
        name: database.table_state(name)
        for name in sorted(database.tables)
    }


def downgrade_to_prefix(database: FakeDwsDatabase, satisfied: Iterable[str]) -> None:
    """Reverse canonical state to the prefix of *satisfied* revisions.

    This reconstructs the historical released-baseline shapes (the legacy
    ``0001_baseline`` ambiguity) without embedding historical DDL: the canonical
    model is the single source, and each unsatisfied revision is undone.
    """
    satisfied = set(satisfied)
    for revision in reversed(REVISION_ORDER):
        if revision in satisfied:
            continue
        _reverse_revision(database, revision, satisfied)


def _reverse_revision(
    database: FakeDwsDatabase, revision: str, satisfied: set[str]
) -> None:
    if revision == "0002_portable_asset_filter":
        database.remove_index("p_asset_table", "idx_p_asset_table_filter")
    elif revision == "0003_open_repository_modules":
        for table in OPEN_MODULE_TABLES:
            database.remove_table(table)
    elif revision == "0004_metadata_ingestion_identity":
        for column in ASSET_IDENTITY_COLUMNS:
            database.remove_column("p_asset_table", column)
        database.remove_unique("p_asset_table", ASSET_IDENTITY_UNIQUE)
        database.add_unique(
            "p_asset_table", ASSET_LEGACY_UNIQUE, "p_asset_table_table_name_key"
        )
        for column in LINEAGE_INGESTION_COLUMNS:
            database.remove_column("p_lineage_snapshot", column)
    elif revision == "0005_rbac_persistence":
        for table in ("p_role", "p_permission", "p_role_permission"):
            database.remove_table(table)
    elif revision == "0006_field_mapping_upstream_id":
        database.remove_index("p_field_mapping_table", "idx_p_field_mapping_table_uk_01")
        database.remove_index("p_field_mapping_table", "idx_p_field_mapping_table_identity")
        database.set_nullable("p_field_mapping_table", "data_source_id", False)
        database.set_nullable("p_field_mapping_table", "upstream_system_id", True)
    elif revision == "0007_binary_status_contract":
        database.set_default("p_manual_code_table", "status_code", "active")
        database.remove_check("p_manual_code_table", "ck_p_manual_code_table_status_code")
        database.add_check(
            "p_manual_code_table",
            "ck_p_manual_code_table_legacy_status",
            "status_code IN ('active', 'draft', 'disabled')",
        )
    elif revision == "0008_indicator_semantic_contract":
        for column in INDICATOR_SEMANTIC_COLUMNS:
            database.remove_column("p_indicator_item", column)
        database.remove_index("p_indicator_item", "idx_p_indicator_semantic_ref")
    elif revision == "0009_upstream_option_contract":
        database.table("p_code_category").rows.clear()
        database.table("p_code_item").rows.clear()
    elif revision == "0010_field_mapping_identity":
        database.remove_index("p_field_mapping_table", "idx_p_field_mapping_table_identity")
        if "0006_field_mapping_upstream_id" in satisfied:
            database.add_index(
                "p_field_mapping_table",
                "idx_p_field_mapping_table_uk_01",
                ("upstream_system_id", "source_table_name"),
                unique=True,
            )
    elif revision == "0011_push_job_freq_desc_capacity":
        table = database.tables.get("p_push_job")
        if table is not None and "freq_desc" in table.columns:
            table.columns["freq_desc"].type_name = "VARCHAR(200)"
