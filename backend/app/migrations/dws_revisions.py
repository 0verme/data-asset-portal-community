"""GaussDB/DWS JDBC revision adapters for revisions ``0002``-``0010``.

The DWS provider has no SQLAlchemy/Alembic online engine, so every revision
that can be reached by an existing GaussDB/DWS deployment needs an explicit
adapter.  Each adapter classifies the *physical* schema into exactly one of
three states before doing anything:

``APPLIED``
    The complete post-condition already exists.  The runner adopts the
    revision and only normalizes the ledger.
``NOT_APPLIED``
    The revision has not run, or only its documented, provably idempotent and
    non-destructive completion is missing.  The runner executes the adapter.
``CONFLICT``
    The observed state is neither the pre-condition nor the post-condition
    (for example a partially created table set, a column present without its
    index, or a legacy and a new unique key at the same time).  The runner
    fails closed and never guesses, deletes or rebuilds anything.

State detection uses the repository's DWS metadata reflection (the same
catalog queries validated by ``dws_verify_metadata_preflight.py``); it never
uses SQLAlchemy's PostgreSQL inspector, and it never assumes physical foreign
keys because GaussDB/DWS does not support them.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Sequence

from ..db.providers import gaussdb_schema_sql_identifier
from ..db.registry import get_provider
from .revision_logic import (
    duplicate_mapping_keys,
    plan_code_option_seed,
    plan_indicator_reference_backfill,
    plan_upstream_backfill,
)
from .schema import (
    SCHEMA_ROOT,
    ColumnSpec,
    IndexSpec,
    SchemaModel,
    TableSpec,
    _render_schema_qualified_identifiers,
    baseline_table_statements,
)


class RevisionState(str, Enum):
    APPLIED = "applied"
    NOT_APPLIED = "not-applied"
    CONFLICT = "conflict"


@dataclass(frozen=True)
class RevisionInspection:
    revision: str
    state: RevisionState
    summary: str
    details: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()

    @property
    def adoptable(self) -> bool:
        return self.state is RevisionState.APPLIED

    @property
    def applicable(self) -> bool:
        return self.state is RevisionState.NOT_APPLIED


class DwsMigrationError(RuntimeError):
    """Fail-closed migration error with the STOP report contract."""

    def __init__(
        self,
        revision: str,
        *,
        observed: str,
        reason: str,
        details: Sequence[str] = (),
        repairs: Sequence[str] = (),
    ) -> None:
        self.revision = revision
        self.observed = observed
        self.reason = reason
        self.details = tuple(details)
        self.repairs = tuple(repairs)
        lines = [
            f"revision: {revision}",
            f"observed state: {observed}",
            f"why unsafe: {reason}",
        ]
        lines.extend(f"detail: {item}" for item in self.details)
        lines.extend(f"possible repair: {item}" for item in self.repairs)
        super().__init__("\n".join(lines))


@dataclass
class DwsRevisionContext:
    """One revision's read/write view of a DWS connection."""

    connection: Any
    config: dict
    model: SchemaModel
    root: Path = SCHEMA_ROOT
    revision: str = ""

    @property
    def schema(self) -> str:
        provider = get_provider(self.config["type"])
        schema = provider.physical_schema(self.config)
        if not schema:
            raise ValueError("DWS migration requires a physical schema")
        return schema

    @property
    def schema_sql(self) -> str:
        return gaussdb_schema_sql_identifier(self.schema)

    def qualified(self, table: str) -> str:
        return f"{self.schema_sql}.{table}"

    def table(self, name: str) -> TableSpec | None:
        return self.model.tables.get(name.lower())

    def has_table(self, name: str) -> bool:
        return self.table(name) is not None

    def columns(self, name: str) -> dict[str, ColumnSpec]:
        table = self.table(name)
        return dict(table.columns) if table is not None else {}

    def indexes(self, name: str) -> dict[str, IndexSpec]:
        table = self.table(name)
        return dict(table.indexes) if table is not None else {}

    def unique_columns(self, name: str) -> set[tuple[str, ...]]:
        table = self.table(name)
        return set(table.unique_constraints) if table is not None else set()

    def unique_constraint_name(self, table: str, columns: tuple[str, ...]) -> str | None:
        spec = self.table(table)
        if spec is None:
            return None
        return spec.unique_constraint_names.get(columns)

    def execute(self, sql: str, params: Sequence[Any] | None = None) -> None:
        cursor = self.connection.cursor()
        try:
            if params:
                cursor.execute(sql, tuple(params))
            else:
                cursor.execute(sql)
        finally:
            cursor.close()

    def fetchall(self, sql: str, params: Sequence[Any] | None = None) -> list[Any]:
        cursor = self.connection.cursor()
        try:
            if params:
                cursor.execute(sql, tuple(params))
            else:
                cursor.execute(sql)
            return list(cursor.fetchall())
        finally:
            cursor.close()


def _quote_identifier(value: str) -> str:
    return '"' + str(value).replace('"', '""') + '"'


def _unique_index_names(table: TableSpec, columns: tuple[str, ...]) -> list[str]:
    return [
        name
        for name, index in table.indexes.items()
        if index.unique and index.columns == columns
    ]


def _non_unique_index(table: TableSpec, name: str, columns: tuple[str, ...]) -> bool:
    index = table.indexes.get(name)
    return index is not None and index.columns == columns and not index.unique


def _baseline_statements(ctx: DwsRevisionContext, tables: Sequence[str]) -> list[str]:
    return [
        _render_schema_qualified_identifiers(statement, "dwp", ctx.schema)
        for statement in baseline_table_statements("dws", list(tables), ctx.root)
    ]


class DwsRevisionAdapter:
    revision: str

    def inspect(self, ctx: DwsRevisionContext) -> RevisionInspection:
        raise NotImplementedError

    def apply(self, ctx: DwsRevisionContext) -> None:
        raise NotImplementedError


# ---------------------------------------------------------------------------
# 0002_portable_asset_filter
# ---------------------------------------------------------------------------


class PortableAssetFilter(DwsRevisionAdapter):
    revision = "0002_portable_asset_filter"
    index_name = "idx_p_asset_table_filter"
    columns = ("layer_code", "domain_code")

    def inspect(self, ctx: DwsRevisionContext) -> RevisionInspection:
        table = ctx.table("p_asset_table")
        if table is None:
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                "p_asset_table is missing from the target schema",
                details=("the DWS baseline contract requires p_asset_table",),
                warnings=(),
            )
        index = table.indexes.get(self.index_name)
        if index is None:
            return RevisionInspection(
                self.revision,
                RevisionState.NOT_APPLIED,
                "portable asset filter index is absent",
            )
        if index.columns != self.columns or index.unique:
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                f"{self.index_name} exists with an unexpected definition",
                details=(
                    f"expected columns={self.columns!r}, unique=False",
                    f"observed columns={index.columns!r}, unique={index.unique!r}",
                ),
            )
        return RevisionInspection(
            self.revision,
            RevisionState.APPLIED,
            "portable asset filter index already exists",
        )

    def apply(self, ctx: DwsRevisionContext) -> None:
        ctx.execute(
            f"CREATE INDEX {self.index_name} ON {ctx.qualified('p_asset_table')} "
            "(layer_code, domain_code)"
        )


# ---------------------------------------------------------------------------
# 0003_open_repository_modules
# ---------------------------------------------------------------------------


class OpenRepositoryModules(DwsRevisionAdapter):
    revision = "0003_open_repository_modules"
    tables = (
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

    def inspect(self, ctx: DwsRevisionContext) -> RevisionInspection:
        present = [name for name in self.tables if ctx.has_table(name)]
        if len(present) == len(self.tables):
            return RevisionInspection(
                self.revision,
                RevisionState.APPLIED,
                "all open repository module tables already exist",
            )
        if not present:
            return RevisionInspection(
                self.revision,
                RevisionState.NOT_APPLIED,
                "no open repository module tables exist",
            )
        missing = [name for name in self.tables if name not in present]
        return RevisionInspection(
            self.revision,
            RevisionState.CONFLICT,
            "partial open repository module schema detected",
            details=(
                f"present: {', '.join(sorted(present))}",
                f"missing: {', '.join(sorted(missing))}",
            ),
            warnings=(),
        )

    def apply(self, ctx: DwsRevisionContext) -> None:
        for statement in _baseline_statements(ctx, self.tables):
            ctx.execute(statement)


# ---------------------------------------------------------------------------
# 0004_metadata_ingestion_identity
# ---------------------------------------------------------------------------


class MetadataIngestionIdentity(DwsRevisionAdapter):
    revision = "0004_metadata_ingestion_identity"
    asset_columns = {
        "catalog_name": "VARCHAR(128)",
        "database_name": "VARCHAR(128)",
        "source_key": "VARCHAR(64)",
        "asset_type": "VARCHAR(64)",
        "external_id": "VARCHAR(256)",
        "qualified_name": "VARCHAR(512)",
    }
    lineage_columns = {
        "source_key": "VARCHAR(64)",
        "content_hash": "VARCHAR(64)",
        "ingestion_id": "VARCHAR(64)",
    }
    legacy_unique = ("table_name",)
    identity_unique = ("source_key", "asset_type", "external_id")

    def inspect(self, ctx: DwsRevisionContext) -> RevisionInspection:
        asset = ctx.table("p_asset_table")
        lineage = ctx.table("p_lineage_snapshot")
        if asset is None or lineage is None:
            missing = [
                name
                for name, spec in (
                    ("p_asset_table", asset),
                    ("p_lineage_snapshot", lineage),
                )
                if spec is None
            ]
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                "0004 target tables are missing",
                details=(f"missing: {', '.join(missing)}",),
            )

        asset_present = [name for name in self.asset_columns if name in asset.columns]
        asset_new = len(asset_present) == len(self.asset_columns)
        asset_old = not asset_present
        lineage_present = [name for name in self.lineage_columns if name in lineage.columns]
        lineage_new = len(lineage_present) == len(self.lineage_columns)
        lineage_old = not lineage_present

        legacy_unique = self.legacy_unique in asset.unique_constraints or bool(
            _unique_index_names(asset, self.legacy_unique)
        )
        identity_unique = self.identity_unique in asset.unique_constraints or bool(
            _unique_index_names(asset, self.identity_unique)
        )

        if asset_new and not legacy_unique and identity_unique and lineage_new:
            return RevisionInspection(
                self.revision,
                RevisionState.APPLIED,
                "asset identity columns, identity unique key and lineage columns already exist",
            )
        if asset_old and legacy_unique and not identity_unique:
            return RevisionInspection(
                self.revision,
                RevisionState.NOT_APPLIED,
                "legacy asset identity shape detected",
                details=(
                    "asset side: pre-0004 shape",
                    "lineage side: " + ("new shape" if lineage_new else "pre-0004 shape"),
                ),
            )
        if asset_new and not legacy_unique and identity_unique and lineage_old:
            return RevisionInspection(
                self.revision,
                RevisionState.NOT_APPLIED,
                "asset identity contract is complete; only additive lineage columns remain",
            )

        details: list[str] = [
            f"asset columns present: {', '.join(sorted(asset_present)) or 'none'}",
            f"lineage columns present: {', '.join(sorted(lineage_present)) or 'none'}",
            f"legacy UNIQUE(table_name): {legacy_unique}",
            f"identity UNIQUE{self.identity_unique!r}: {identity_unique}",
        ]
        return RevisionInspection(
            self.revision,
            RevisionState.CONFLICT,
            "asset identity contract is partially applied",
            details=tuple(details),
        )

    def apply(self, ctx: DwsRevisionContext) -> None:
        asset = ctx.table("p_asset_table")
        if asset is None or ctx.table("p_lineage_snapshot") is None:
            raise DwsMigrationError(
                self.revision,
                observed="0004 target tables are missing",
                reason="the canonical DWS baseline tables must exist before this revision",
                repairs=("verify the target schema and rerun from the recorded ledger revision",),
            )
        for name, type_sql in self.asset_columns.items():
            if name not in asset.columns:
                ctx.execute(
                    f"ALTER TABLE {ctx.qualified('p_asset_table')} ADD COLUMN {name} {type_sql}"
                )

        legacy_name = ctx.unique_constraint_name("p_asset_table", self.legacy_unique)
        if legacy_name is not None:
            ctx.execute(
                f"ALTER TABLE {ctx.qualified('p_asset_table')} "
                f"DROP CONSTRAINT {_quote_identifier(legacy_name)}"
            )
        else:
            for index_name in _unique_index_names(asset, self.legacy_unique):
                ctx.execute(f"DROP INDEX {ctx.qualified(index_name)}")

        if not (
            self.identity_unique in ctx.unique_columns("p_asset_table")
            or _unique_index_names(asset, self.identity_unique)
        ):
            ctx.execute(
                f"ALTER TABLE {ctx.qualified('p_asset_table')} "
                "ADD CONSTRAINT uq_p_asset_ingestion_identity "
                "UNIQUE (source_key, asset_type, external_id)"
            )

        lineage = ctx.table("p_lineage_snapshot")
        assert lineage is not None
        for name, type_sql in self.lineage_columns.items():
            if name not in lineage.columns:
                ctx.execute(
                    f"ALTER TABLE {ctx.qualified('p_lineage_snapshot')} "
                    f"ADD COLUMN {name} {type_sql}"
                )


# ---------------------------------------------------------------------------
# 0005_rbac_persistence
# ---------------------------------------------------------------------------


class RbacPersistence(DwsRevisionAdapter):
    revision = "0005_rbac_persistence"
    tables = ("p_role", "p_permission", "p_role_permission")
    expected_columns = {
        "p_role": {"role_code", "name", "description", "builtin", "enabled", "created_at", "updated_at"},
        "p_permission": {"permission_code", "resource", "action", "name", "description"},
        "p_role_permission": {"role_code", "permission_code"},
    }
    index_name = "idx_p_role_permission_permission"
    index_columns = ("permission_code",)

    def inspect(self, ctx: DwsRevisionContext) -> RevisionInspection:
        present = [name for name in self.tables if ctx.has_table(name)]
        if not present:
            return RevisionInspection(
                self.revision,
                RevisionState.NOT_APPLIED,
                "no RBAC tables exist",
            )
        if len(present) != len(self.tables):
            missing = [name for name in self.tables if name not in present]
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                "partial RBAC table set detected",
                details=(
                    f"present: {', '.join(sorted(present))}",
                    f"missing: {', '.join(sorted(missing))}",
                ),
            )
        for name in self.tables:
            missing = self.expected_columns[name] - set(ctx.columns(name))
            if missing:
                return RevisionInspection(
                    self.revision,
                    RevisionState.CONFLICT,
                    f"partial RBAC table {name} detected",
                    details=(f"missing columns: {', '.join(sorted(missing))}",),
                )
        if not _non_unique_index(ctx.table("p_role_permission"), self.index_name, self.index_columns):
            return RevisionInspection(
                self.revision,
                RevisionState.NOT_APPLIED,
                "RBAC tables exist but the permission lookup index is absent",
            )
        return RevisionInspection(
            self.revision,
            RevisionState.APPLIED,
            "RBAC tables and permission lookup index already exist",
        )

    def apply(self, ctx: DwsRevisionContext) -> None:
        if not all(ctx.has_table(name) for name in self.tables):
            for statement in _baseline_statements(ctx, self.tables):
                ctx.execute(statement)
            return
        table = ctx.table("p_role_permission")
        if not _non_unique_index(table, self.index_name, self.index_columns):
            ctx.execute(
                f"CREATE INDEX {self.index_name} ON {ctx.qualified('p_role_permission')} "
                "(permission_code)"
            )


# ---------------------------------------------------------------------------
# 0006_field_mapping_upstream_id
# ---------------------------------------------------------------------------


class FieldMappingUpstreamId(DwsRevisionAdapter):
    revision = "0006_field_mapping_upstream_id"
    table = "p_field_mapping_table"
    upstream_index = "idx_p_field_mapping_table_uk_01"
    identity_index = "idx_p_field_mapping_table_identity"
    upstream_index_columns = ("upstream_system_id", "source_table_name")
    identity_index_columns = (
        "upstream_system_id",
        "source_table_name",
        "target_layer_code",
        "target_table_name",
        "load_mode",
    )

    def _data_state(self, ctx: DwsRevisionContext):
        mapping_rows = ctx.fetchall(
            f"SELECT table_pk, data_source_id, upstream_system_id, source_table_name "
            f"FROM {ctx.qualified(self.table)}"
        )
        system_rows = ctx.fetchall(
            "SELECT system_pk, data_source_id, system_id, system_abbr, system_name "
            f"FROM {ctx.qualified('p_upstream_system')}"
        )
        mapping = [
            {
                "table_pk": row[0],
                "data_source_id": row[1],
                "upstream_system_id": row[2],
                "source_table_name": row[3],
            }
            for row in mapping_rows
        ]
        systems = [
            {
                "system_pk": row[0],
                "data_source_id": row[1],
                "system_id": row[2],
                "system_abbr": row[3],
                "system_name": row[4],
            }
            for row in system_rows
        ]
        return mapping, systems

    def inspect(self, ctx: DwsRevisionContext) -> RevisionInspection:
        table = ctx.table(self.table)
        if table is None:
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                f"{self.table} is missing from the target schema",
            )
        if "upstream_system_id" not in table.columns or "data_source_id" not in table.columns:
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                f"{self.table} is missing the upstream identity columns",
                details=(
                    "expected columns: data_source_id, upstream_system_id",
                    f"observed columns: {', '.join(sorted(table.columns))}",
                ),
            )

        index = table.indexes.get(self.upstream_index)
        if index is not None and (
            index.columns != self.upstream_index_columns or not index.unique
        ):
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                f"{self.upstream_index} exists with an unexpected definition",
                details=(
                    f"expected columns={self.upstream_index_columns!r}, unique=True",
                    f"observed columns={index.columns!r}, unique={index.unique!r}",
                ),
            )
        identity_index = _non_unique_index(
            table, self.identity_index, self.identity_index_columns
        )
        upstream_not_null = not table.columns["upstream_system_id"].nullable

        mapping_rows, system_rows = self._data_state(ctx)
        plan = plan_upstream_backfill(mapping_rows, system_rows)
        duplicates = duplicate_mapping_keys(mapping_rows, plan.updates)

        if upstream_not_null and (index is not None or identity_index):
            warnings = []
            if plan.errors:
                warnings.append(
                    "existing upstream_system_id values contain unresolved rows: "
                    + "; ".join(plan.errors)
                )
            return RevisionInspection(
                self.revision,
                RevisionState.APPLIED,
                "field mapping upstream identity contract already exists",
                warnings=tuple(warnings),
            )

        if plan.errors or duplicates:
            details = list(plan.errors)
            details.extend(item.describe() for item in duplicates)
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                "field mapping data cannot be backfilled deterministically",
                details=tuple(details),
            )

        return RevisionInspection(
            self.revision,
            RevisionState.NOT_APPLIED,
            "field mapping upstream identity backfill is pending",
            details=(
                f"planned backfill rows: {len(plan.updates)}",
                "upstream_system_id is nullable: " + str(not upstream_not_null),
                f"unique index present: {index is not None}",
            ),
        )

    def apply(self, ctx: DwsRevisionContext) -> None:
        table = ctx.table(self.table)
        if table is None:
            raise DwsMigrationError(
                self.revision,
                observed=f"{self.table} is missing",
                reason="the field-mapping table must exist before this revision",
            )
        mapping_rows, system_rows = self._data_state(ctx)
        plan = plan_upstream_backfill(mapping_rows, system_rows)
        if plan.errors:
            raise DwsMigrationError(
                self.revision,
                observed="field mapping backfill data is ambiguous",
                reason="0006 never guesses between multiple or missing upstream systems",
                details=plan.errors,
                repairs=(
                    "add an explicit upstream system for each unresolved data_source_id",
                    "or set p_field_mapping_table.upstream_system_id explicitly",
                ),
            )
        duplicates = duplicate_mapping_keys(mapping_rows, plan.updates)
        if duplicates:
            raise DwsMigrationError(
                self.revision,
                observed="duplicate (upstream_system_id, source_table_name) keys",
                reason="the stable unique relation cannot be created without losing rows",
                details=tuple(item.describe() for item in duplicates),
                repairs=("resolve the duplicate mapping rows before retrying",),
            )

        for table_pk, system_pk in plan.updates:
            ctx.execute(
                f"UPDATE {ctx.qualified(self.table)} SET upstream_system_id = ? "
                "WHERE table_pk = ? AND upstream_system_id IS NULL",
                (system_pk, table_pk),
            )

        if table.columns["data_source_id"].nullable is False:
            ctx.execute(
                f"ALTER TABLE {ctx.qualified(self.table)} "
                "ALTER COLUMN data_source_id DROP NOT NULL"
            )
        if table.columns["upstream_system_id"].nullable:
            ctx.execute(
                f"ALTER TABLE {ctx.qualified(self.table)} "
                "ALTER COLUMN upstream_system_id SET NOT NULL"
            )
        if not _non_unique_index(table, self.identity_index, self.identity_index_columns):
            index = table.indexes.get(self.upstream_index)
            if index is None:
                ctx.execute(
                    f"CREATE UNIQUE INDEX {self.upstream_index} ON {ctx.qualified(self.table)} "
                    "(upstream_system_id, source_table_name)"
                )


# ---------------------------------------------------------------------------
# 0007_binary_status_contract
# ---------------------------------------------------------------------------


class BinaryStatusContract(DwsRevisionAdapter):
    revision = "0007_binary_status_contract"
    table = "p_manual_code_table"
    check_name = "ck_p_manual_code_table_status_code"
    canonical_default = "enabled"
    known_statuses = {"active", "draft", "enabled", "disabled"}
    legacy_statuses = {"active", "draft"}

    def _status_checks(self, ctx: DwsRevisionContext) -> list[tuple[str, str]]:
        rows = ctx.fetchall(
            "SELECT c.conname, pg_get_constraintdef(c.oid) "
            "FROM pg_constraint c "
            "JOIN pg_class t ON t.oid = c.conrelid "
            "JOIN pg_namespace n ON n.oid = t.relnamespace "
            "WHERE n.nspname = ? AND t.relname = ? AND c.contype = 'c' "
            "ORDER BY c.conname",
            (ctx.schema, self.table),
        )
        return [(str(row[0]), str(row[1] or "")) for row in rows]

    @staticmethod
    def _is_status_check(expression: str) -> bool:
        return "status_code" in expression.lower()

    @staticmethod
    def _is_canonical_check(expression: str) -> bool:
        lowered = expression.lower()
        return (
            "status_code" in lowered
            and "enabled" in lowered
            and "disabled" in lowered
            and "draft" not in lowered
            and "active" not in lowered
        )

    def inspect(self, ctx: DwsRevisionContext) -> RevisionInspection:
        table = ctx.table(self.table)
        if table is None:
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                f"{self.table} is missing from the target schema",
                details=("the open repository module revision must run before 0007",),
            )
        status_column = table.columns.get("status_code")
        if status_column is None:
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                f"{self.table} is missing the status_code column",
            )

        checks = self._status_checks(ctx)
        canonical_check = any(
            self._is_canonical_check(expression) for _, expression in checks
        )
        statuses = {
            str(row[0]).strip()
            for row in ctx.fetchall(
                f"SELECT DISTINCT status_code FROM {ctx.qualified(self.table)}"
            )
            if row[0] is not None
        }
        unknown = sorted(statuses - self.known_statuses)
        if unknown:
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                "p_manual_code_table contains status values outside the binary contract",
                details=(f"unknown status values: {', '.join(unknown)}",),
            )
        legacy_rows = sorted(statuses & self.legacy_statuses)
        default = status_column.default

        if (
            canonical_check
            and default == self.canonical_default
            and not legacy_rows
        ):
            return RevisionInspection(
                self.revision,
                RevisionState.APPLIED,
                "binary status default, check and rows already satisfy the contract",
            )
        return RevisionInspection(
            self.revision,
            RevisionState.NOT_APPLIED,
            "binary status contract is pending",
            details=(
                f"server default: {default!r}",
                f"canonical check present: {canonical_check}",
                f"legacy status rows: {', '.join(legacy_rows) or 'none'}",
            ),
        )

    def apply(self, ctx: DwsRevisionContext) -> None:
        table = ctx.table(self.table)
        if table is None:
            raise DwsMigrationError(
                self.revision,
                observed=f"{self.table} is missing",
                reason="the open repository module revision must run before 0007",
            )
        checks = self._status_checks(ctx)
        canonical_check = False
        for name, expression in checks:
            if not self._is_status_check(expression):
                continue
            if self._is_canonical_check(expression):
                canonical_check = True
                continue
            ctx.execute(
                f"ALTER TABLE {ctx.qualified(self.table)} "
                f"DROP CONSTRAINT {_quote_identifier(name)}"
            )

        ctx.execute(
            f"UPDATE {ctx.qualified(self.table)} SET status_code = 'enabled' "
            "WHERE status_code = 'active'"
        )
        ctx.execute(
            f"UPDATE {ctx.qualified(self.table)} SET status_code = 'disabled' "
            "WHERE status_code = 'draft'"
        )
        ctx.execute(
            f"ALTER TABLE {ctx.qualified(self.table)} "
            "ALTER COLUMN status_code SET DEFAULT 'enabled'"
        )
        if not canonical_check:
            ctx.execute(
                f"ALTER TABLE {ctx.qualified(self.table)} "
                f"ADD CONSTRAINT {self.check_name} "
                "CHECK (status_code IN ('enabled', 'disabled'))"
            )


# ---------------------------------------------------------------------------
# 0008_indicator_semantic_contract
# ---------------------------------------------------------------------------


class IndicatorSemanticContract(DwsRevisionAdapter):
    revision = "0008_indicator_semantic_contract"
    table = "p_indicator_item"
    reference_index = "idx_p_indicator_semantic_ref"
    reference_columns = ("source_asset_id", "result_field_id")
    new_columns = {
        "source_asset_id": "BIGINT",
        "result_field_id": "BIGINT",
        "aggregation_code": "VARCHAR(32)",
        "semantic_state": "VARCHAR(32) NOT NULL DEFAULT 'candidate'",
    }

    def _data_plan(self, ctx: DwsRevisionContext):
        indicator_rows = ctx.fetchall(
            "SELECT indicator_pk, result_table_name, result_field_name, "
            f"source_asset_id, result_field_id FROM {ctx.qualified(self.table)}"
        )
        asset_rows = ctx.fetchall(
            "SELECT asset_id, table_name, schema_name, catalog_name, qualified_name, "
            f"is_deleted FROM {ctx.qualified('p_asset_table')}"
        )
        field_rows = ctx.fetchall(
            "SELECT field_id, asset_id, field_name, is_deleted "
            f"FROM {ctx.qualified('p_asset_field')}"
        )
        indicators = [
            {
                "indicator_pk": row[0],
                "result_table_name": row[1],
                "result_field_name": row[2],
                "source_asset_id": row[3],
                "result_field_id": row[4],
            }
            for row in indicator_rows
        ]
        assets = [
            {
                "asset_id": row[0],
                "table_name": row[1],
                "schema_name": row[2],
                "catalog_name": row[3],
                "qualified_name": row[4],
                "is_deleted": row[5],
            }
            for row in asset_rows
        ]
        fields = [
            {
                "field_id": row[0],
                "asset_id": row[1],
                "field_name": row[2],
                "is_deleted": row[3],
            }
            for row in field_rows
        ]
        return plan_indicator_reference_backfill(indicators, assets, fields)

    def inspect(self, ctx: DwsRevisionContext) -> RevisionInspection:
        table = ctx.table(self.table)
        if table is None:
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                f"{self.table} is missing from the target schema",
            )
        present = [name for name in self.new_columns if name in table.columns]
        if not present:
            return RevisionInspection(
                self.revision,
                RevisionState.NOT_APPLIED,
                "indicator semantic columns are absent",
            )
        if len(present) != len(self.new_columns):
            missing = [name for name in self.new_columns if name not in table.columns]
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                "indicator semantic columns are partially present",
                details=(
                    f"present: {', '.join(sorted(present))}",
                    f"missing: {', '.join(sorted(missing))}",
                ),
            )
        if not _non_unique_index(table, self.reference_index, self.reference_columns):
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                "indicator semantic columns exist but the reference index is missing",
                details=(
                    f"expected non-unique index {self.reference_index}{self.reference_columns!r}",
                ),
                warnings=(),
            )

        pending_updates = self._data_plan(ctx)
        null_states = ctx.fetchall(
            f"SELECT COUNT(*) FROM {ctx.qualified(self.table)} "
            "WHERE semantic_state IS NULL"
        )
        null_count = int(null_states[0][0]) if null_states else 0
        if pending_updates or null_count:
            return RevisionInspection(
                self.revision,
                RevisionState.NOT_APPLIED,
                "indicator semantic structure exists but the backfill is incomplete",
                details=(
                    f"pending reference updates: {len(pending_updates)}",
                    f"rows with NULL semantic_state: {null_count}",
                ),
            )
        return RevisionInspection(
            self.revision,
            RevisionState.APPLIED,
            "indicator semantic columns, reference index and backfill already exist",
        )

    def apply(self, ctx: DwsRevisionContext) -> None:
        table = ctx.table(self.table)
        if table is None:
            raise DwsMigrationError(
                self.revision,
                observed=f"{self.table} is missing",
                reason="the indicator table must exist before this revision",
            )
        for name, type_sql in self.new_columns.items():
            if name not in table.columns:
                ctx.execute(
                    f"ALTER TABLE {ctx.qualified(self.table)} ADD COLUMN {name} {type_sql}"
                )
        if not _non_unique_index(table, self.reference_index, self.reference_columns):
            ctx.execute(
                f"CREATE INDEX {self.reference_index} ON {ctx.qualified(self.table)} "
                "(source_asset_id, result_field_id)"
            )
        ctx.execute(
            f"UPDATE {ctx.qualified(self.table)} SET semantic_state = 'candidate' "
            "WHERE semantic_state IS NULL"
        )
        for update in self._data_plan(ctx):
            assignments = ", ".join(
                f"{column} = ?" for column in update.values
            )
            ctx.execute(
                f"UPDATE {ctx.qualified(self.table)} SET {assignments} "
                f"WHERE indicator_pk = ? AND "
                + " AND ".join(f"{column} IS NULL" for column in update.values),
                (*update.values.values(), update.indicator_pk),
            )


# ---------------------------------------------------------------------------
# 0009_upstream_option_contract
# ---------------------------------------------------------------------------


class UpstreamOptionContract(DwsRevisionAdapter):
    revision = "0009_upstream_option_contract"

    def _plan(self, ctx: DwsRevisionContext):
        category_rows = ctx.fetchall(
            "SELECT category_id, category_code FROM "
            f"{ctx.qualified('p_code_category')}"
        )
        item_rows = ctx.fetchall(
            "SELECT item_id, category_code, item_code FROM "
            f"{ctx.qualified('p_code_item')}"
        )
        categories = [
            {"category_id": row[0], "category_code": row[1]} for row in category_rows
        ]
        items = [
            {"item_id": row[0], "category_code": row[1], "item_code": row[2]}
            for row in item_rows
        ]
        return plan_code_option_seed(categories, items)

    def inspect(self, ctx: DwsRevisionContext) -> RevisionInspection:
        if not (ctx.has_table("p_code_category") and ctx.has_table("p_code_item")):
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                "code category/item tables are missing from the target schema",
            )
        plan = self._plan(ctx)
        if plan.empty:
            return RevisionInspection(
                self.revision,
                RevisionState.APPLIED,
                "all required upstream option categories and items already exist",
            )
        return RevisionInspection(
            self.revision,
            RevisionState.NOT_APPLIED,
            "upstream option seed rows are missing",
            details=(
                f"missing categories: {len(plan.categories)}",
                f"missing items: {len(plan.items)}",
            ),
        )

    def apply(self, ctx: DwsRevisionContext) -> None:
        plan = self._plan(ctx)
        for values in plan.categories:
            columns = tuple(values)
            placeholders = ", ".join("?" for _ in columns)
            ctx.execute(
                f"INSERT INTO {ctx.qualified('p_code_category')} "
                f"({', '.join(columns)}) VALUES ({placeholders})",
                tuple(values[column] for column in columns),
            )
        for values in plan.items:
            columns = tuple(values)
            placeholders = ", ".join("?" for _ in columns)
            ctx.execute(
                f"INSERT INTO {ctx.qualified('p_code_item')} "
                f"({', '.join(columns)}) VALUES ({placeholders})",
                tuple(values[column] for column in columns),
            )


# ---------------------------------------------------------------------------
# 0010_field_mapping_identity
# ---------------------------------------------------------------------------


class FieldMappingIdentity(DwsRevisionAdapter):
    revision = "0010_field_mapping_identity"
    table = "p_field_mapping_table"
    obsolete_index = "idx_p_field_mapping_table_uk_01"
    identity_index = "idx_p_field_mapping_table_identity"
    source_only_columns = ("upstream_system_id", "source_table_name")
    identity_columns = (
        "upstream_system_id",
        "source_table_name",
        "target_layer_code",
        "target_table_name",
        "load_mode",
    )

    def _source_only_conflicts(self, table: TableSpec) -> list[str]:
        conflicts: list[str] = []
        for name, index in table.indexes.items():
            if (
                name != self.obsolete_index
                and index.unique
                and index.columns == self.source_only_columns
            ):
                conflicts.append(f"unique index {name} on {self.source_only_columns!r}")
        if self.source_only_columns in table.unique_constraints:
            conflicts.append(
                f"unique constraint on {self.source_only_columns!r}"
            )
        return conflicts

    def inspect(self, ctx: DwsRevisionContext) -> RevisionInspection:
        table = ctx.table(self.table)
        if table is None:
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                f"{self.table} is missing from the target schema",
            )
        identity = table.indexes.get(self.identity_index)
        if identity is not None and (
            identity.columns != self.identity_columns or identity.unique
        ):
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                f"{self.identity_index} exists with an unexpected definition",
                details=(
                    f"expected columns={self.identity_columns!r}, unique=False",
                    f"observed columns={identity.columns!r}, unique={identity.unique!r}",
                ),
            )
        conflicts = self._source_only_conflicts(table)
        if conflicts:
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                "an alternate source-only unique key still exists",
                details=tuple(conflicts),
            )
        obsolete = table.indexes.get(self.obsolete_index)
        if identity is not None:
            if obsolete is not None:
                return RevisionInspection(
                    self.revision,
                    RevisionState.CONFLICT,
                    "both the obsolete source-only unique index and the identity index exist",
                    details=(
                        f"{self.obsolete_index} must be removed explicitly before retrying",
                    ),
                )
            return RevisionInspection(
                self.revision,
                RevisionState.APPLIED,
                "identity index already exists and the obsolete unique index is gone",
            )
        if obsolete is not None:
            return RevisionInspection(
                self.revision,
                RevisionState.NOT_APPLIED,
                "obsolete source-only unique index is present",
            )
        return RevisionInspection(
            self.revision,
            RevisionState.CONFLICT,
            "neither the obsolete source-only unique index nor the identity index exists",
            details=("the recorded revision does not match the physical index state",),
        )

    def apply(self, ctx: DwsRevisionContext) -> None:
        table = ctx.table(self.table)
        if table is None:
            raise DwsMigrationError(
                self.revision,
                observed=f"{self.table} is missing",
                reason="the field-mapping table must exist before this revision",
            )
        obsolete = table.indexes.get(self.obsolete_index)
        if obsolete is not None:
            ctx.execute(f"DROP INDEX {ctx.qualified(self.obsolete_index)}")
        if not _non_unique_index(table, self.identity_index, self.identity_columns):
            ctx.execute(
                f"CREATE INDEX {self.identity_index} ON {ctx.qualified(self.table)} "
                "(upstream_system_id, source_table_name, target_layer_code, "
                "target_table_name, load_mode)"
            )


# ---------------------------------------------------------------------------
# 0011_push_job_freq_desc_capacity
# ---------------------------------------------------------------------------

_BOUNDED_TEXT_RE = re.compile(
    r"(?:CHARACTER\s+VARYING|VARCHAR)\s*\(\s*(\d+)\s*\)", re.I
)
_UNLIMITED_TEXT_TYPES = {"TEXT", "CHARACTER VARYING", "VARCHAR", "CLOB"}


def _text_capacity(type_name: str) -> tuple[bool, int | None]:
    """Return ``(recognized, length)`` for a text column type.

    ``length is None`` means the type stores text without a fixed limit.
    """
    normalized = " ".join(str(type_name or "").upper().split())
    match = _BOUNDED_TEXT_RE.fullmatch(normalized)
    if match:
        return True, int(match.group(1))
    if normalized in _UNLIMITED_TEXT_TYPES:
        return True, None
    return False, None


class PushJobFreqDescCapacity(DwsRevisionAdapter):
    revision = "0011_push_job_freq_desc_capacity"
    table = "p_push_job"
    column = "freq_desc"
    target_length = 1000

    def inspect(self, ctx: DwsRevisionContext) -> RevisionInspection:
        table = ctx.table(self.table)
        if table is None:
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                f"{self.table} is missing from the target schema",
            )
        column = table.columns.get(self.column)
        if column is None:
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                f"{self.table}.{self.column} is missing from the target schema",
            )
        recognized, length = _text_capacity(column.type_name)
        if not recognized:
            return RevisionInspection(
                self.revision,
                RevisionState.CONFLICT,
                f"{self.table}.{self.column} has an unsupported type for this revision",
                details=(f"observed type: {column.type_name}",),
            )
        if length is None or length >= self.target_length:
            return RevisionInspection(
                self.revision,
                RevisionState.APPLIED,
                f"{self.table}.{self.column} already meets the {self.target_length} capacity",
                details=(f"observed type: {column.type_name}",),
            )
        return RevisionInspection(
            self.revision,
            RevisionState.NOT_APPLIED,
            f"{self.table}.{self.column} capacity {length} is below {self.target_length}",
            details=(f"observed type: {column.type_name}",),
        )

    def apply(self, ctx: DwsRevisionContext) -> None:
        ctx.execute(
            f"ALTER TABLE {ctx.qualified(self.table)} "
            f"ALTER COLUMN {self.column} TYPE VARCHAR({self.target_length})"
        )


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

ADAPTERS: tuple[DwsRevisionAdapter, ...] = (
    PortableAssetFilter(),
    OpenRepositoryModules(),
    MetadataIngestionIdentity(),
    RbacPersistence(),
    FieldMappingUpstreamId(),
    BinaryStatusContract(),
    IndicatorSemanticContract(),
    UpstreamOptionContract(),
    FieldMappingIdentity(),
    PushJobFreqDescCapacity(),
)

_ADAPTERS_BY_REVISION: dict[str, DwsRevisionAdapter] = {
    adapter.revision: adapter for adapter in ADAPTERS
}


def get_adapter(revision: str) -> DwsRevisionAdapter | None:
    return _ADAPTERS_BY_REVISION.get(revision)


def registered_revisions() -> tuple[str, ...]:
    return tuple(adapter.revision for adapter in ADAPTERS)
