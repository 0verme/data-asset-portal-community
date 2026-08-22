"""Add the persistence contract for every repository module.

The fresh-install baselines already contain these tables. This revision is
idempotent for fresh databases and creates the missing structures when a
pre-#116 database upgrades from the previous head.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0003_open_repository_modules"
down_revision = "0002_portable_asset_filter"
branch_labels = None
depends_on = None

OPEN_TABLES = (
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


def _dialect() -> str:
    return op.get_bind().dialect.name


def _schema() -> str | None:
    return op.get_context().opts.get("version_table_schema")


def _number(big: bool = False):
    if _dialect() == "sqlite":
        return sa.Integer()
    return sa.BigInteger() if big else sa.Integer()


def _text(length: int | None = None):
    if _dialect() == "sqlite":
        return sa.Text()
    return sa.String(length) if length else sa.Text()


def _char(length: int = 1):
    if _dialect() == "sqlite":
        return sa.Text()
    return sa.CHAR(length)


def _large_text(length: int):
    return sa.Text() if _dialect() == "mysql" else _text(length)


def _timestamp():
    return sa.TIMESTAMP()


def _default(value: str):
    return sa.text(value)


def _has_table(name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(name, schema=_schema())


def _create_indexes(table: str, indexes: list[tuple]):
    for name, columns, *unique in indexes:
        op.create_index(
            name,
            table,
            columns,
            unique=bool(unique[0]) if unique else False,
            schema=_schema(),
        )


def upgrade() -> None:
    schema = _schema()
    references = sa.MetaData()

    def ref(table: str, column: str):
        key = f"{schema}.{table}" if schema else table
        target = references.tables.get(key)
        if target is None:
            target = sa.Table(
                table,
                references,
                sa.Column(column, _number(big=True)),
                schema=schema,
            )
        return target.c[column]

    existing = {_name for _name in OPEN_TABLES if _has_table(_name)}
    if len(existing) == len(OPEN_TABLES):
        return
    if existing:
        raise RuntimeError(
            "partial #116 schema detected; resolve existing open-module tables "
            f"before applying migration: {', '.join(sorted(existing))}"
        )

    op.create_table(
        "p_upstream_system",
        sa.Column("system_pk", _number(big=True), primary_key=True),
        sa.Column("data_source_id", _number(big=True)),
        sa.Column("system_id", _text(64), nullable=False),
        sa.Column("system_abbr", _text(32), nullable=False),
        sa.Column("system_name", _text(256), nullable=False),
        sa.Column("db_type", _text(64), nullable=False),
        sa.Column("host_name", _text(256), nullable=False),
        sa.Column("db_name", _text(256)),
        sa.Column("schema_name", _text(256)),
        sa.Column("status_code", _text(32), nullable=False, server_default=_default("'enabled'")),
        sa.Column("owner_name", _text(128)),
        sa.Column("dept_name", _text(128)),
        sa.Column("system_desc", _text(2000)),
        sa.Column("unload_count", sa.Integer(), nullable=False, server_default=_default("0")),
        sa.Column("is_deleted", _char(), nullable=False, server_default=_default("'N'")),
        sa.Column("created_by", _text(64), nullable=False, server_default=_default("'system'")),
        sa.Column("created_at", _timestamp(), nullable=False, server_default=_default("CURRENT_TIMESTAMP")),
        sa.Column("updated_by", _text(64), nullable=False, server_default=_default("'system'")),
        sa.Column("updated_at", _timestamp(), nullable=False, server_default=_default("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("system_id", name="uq_p_upstream_system_system_id"),
        sa.ForeignKeyConstraint(["data_source_id"], [ref("p_data_source", "source_id")], ondelete="RESTRICT"),
        schema=schema,
    )
    _create_indexes("p_upstream_system", [
        ("idx_p_upstream_system_data_source", ["data_source_id"]),
        ("idx_p_upstream_system_ix_01", ["status_code", "db_type"]),
    ])

    op.create_table(
        "p_upstream_unload_time",
        sa.Column("time_pk", _number(big=True), primary_key=True),
        sa.Column("system_pk", _number(big=True), nullable=False),
        sa.Column("unload_time", _text(8), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default=_default("0")),
        sa.Column("is_deleted", _char(), nullable=False, server_default=_default("'N'")),
        sa.Column("created_by", _text(64), nullable=False, server_default=_default("'system'")),
        sa.Column("created_at", _timestamp(), nullable=False, server_default=_default("CURRENT_TIMESTAMP")),
        sa.Column("updated_by", _text(64), nullable=False, server_default=_default("'system'")),
        sa.Column("updated_at", _timestamp(), nullable=False, server_default=_default("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("system_pk", "unload_time", name="uq_p_upstream_unload_time"),
        sa.ForeignKeyConstraint(["system_pk"], [ref("p_upstream_system", "system_pk")], ondelete="CASCADE"),
        schema=schema,
    )
    _create_indexes("p_upstream_unload_time", [
        ("idx_p_upstream_unload_time_ix_01", ["system_pk", "display_order"]),
    ])

    op.create_table(
        "p_upstream_change_log",
        sa.Column("change_id", _number(big=True), primary_key=True),
        sa.Column("system_pk", _number(big=True)),
        sa.Column("system_id", _text(64), nullable=False),
        sa.Column("change_type", _text(64), nullable=False),
        sa.Column("change_summary", _text(512)),
        sa.Column("before_json", sa.Text()),
        sa.Column("after_json", sa.Text()),
        sa.Column("operator_name", _text(64), nullable=False, server_default=_default("'system'")),
        sa.Column("change_time", _timestamp(), nullable=False, server_default=_default("CURRENT_TIMESTAMP")),
        schema=schema,
    )
    _create_indexes("p_upstream_change_log", [
        ("idx_p_upstream_change_log_ix_01", ["system_id", "change_time"]),
    ])

    op.create_table(
        "p_push_system",
        sa.Column("system_id", _number(big=True), primary_key=True),
        sa.Column("master_system_id", _number(big=True)),
        sa.Column("system_code", _text(64), nullable=False),
        sa.Column("system_name", _text(256), nullable=False),
        sa.Column("system_abbr", _text(32), nullable=False),
        sa.Column("protocol_type", _text(32), nullable=False),
        sa.Column("host_name", _text(256), nullable=False),
        sa.Column("port_no", sa.Integer(), nullable=False),
        sa.Column("account_name", _text(128)),
        sa.Column("auth_type", _text(64)),
        sa.Column("contact_name", _text(128)),
        sa.Column("data_developer_contact_name", _text(128)),
        sa.Column("dept_name", _text(128)),
        sa.Column("system_desc", _text(2000)),
        sa.Column("status_code", _text(32), nullable=False, server_default=_default("'enabled'")),
        sa.Column("importance_level_code", _text(16), nullable=False, server_default=_default("'normal'")),
        sa.Column("latest_output_time", _text(5)),
        sa.Column("job_count", sa.Integer(), nullable=False, server_default=_default("0")),
        sa.Column("is_deleted", _char(), nullable=False, server_default=_default("'N'")),
        sa.Column("created_by", _text(64), nullable=False, server_default=_default("'system'")),
        sa.Column("created_at", _timestamp(), nullable=False, server_default=_default("CURRENT_TIMESTAMP")),
        sa.Column("updated_by", _text(64), nullable=False, server_default=_default("'system'")),
        sa.Column("updated_at", _timestamp(), nullable=False, server_default=_default("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("system_code", name="uq_p_push_system_system_code"),
        sa.ForeignKeyConstraint(["master_system_id"], [ref("p_system", "system_id")], ondelete="RESTRICT"),
        schema=schema,
    )
    _create_indexes("p_push_system", [
        ("idx_p_push_system_master", ["master_system_id"]),
        ("idx_p_push_system_ix_01", ["status_code", "protocol_type", "dept_name"]),
    ])

    op.create_table(
        "p_push_job",
        sa.Column("job_id", _number(big=True), primary_key=True),
        sa.Column("system_id", _number(big=True), nullable=False),
        sa.Column("job_code", _text(128), nullable=False),
        sa.Column("job_name", _text(256), nullable=False),
        sa.Column("source_path", _text(1000)),
        sa.Column("source_file_name", _text(512)),
        sa.Column("target_path", _text(1000)),
        sa.Column("target_file_name", _text(512), nullable=False),
        sa.Column("freq_desc", _text(200)),
        sa.Column("freq_type", _text(64)),
        sa.Column("delimiter_code", _text(32)),
        sa.Column("encoding_type", _text(64)),
        sa.Column("row_count_desc", _text(200)),
        sa.Column("enabled_flag", _char(), nullable=False, server_default=_default("'Y'")),
        sa.Column("job_desc", _text(2000)),
        sa.Column("field_count", sa.Integer(), nullable=False, server_default=_default("0")),
        sa.Column("is_deleted", _char(), nullable=False, server_default=_default("'N'")),
        sa.Column("created_by", _text(64), nullable=False, server_default=_default("'system'")),
        sa.Column("created_at", _timestamp(), nullable=False, server_default=_default("CURRENT_TIMESTAMP")),
        sa.Column("updated_by", _text(64), nullable=False, server_default=_default("'system'")),
        sa.Column("updated_at", _timestamp(), nullable=False, server_default=_default("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("system_id", "job_code", name="uq_p_push_job_system_code"),
        sa.ForeignKeyConstraint(["system_id"], [ref("p_push_system", "system_id")], ondelete="CASCADE"),
        schema=schema,
    )
    _create_indexes("p_push_job", [
        ("idx_p_push_job_ix_01", ["system_id", "enabled_flag", "freq_type"]),
        ("idx_p_push_job_ix_02", ["system_id", "is_deleted", "job_code"]),
    ])

    op.create_table(
        "p_push_job_field",
        sa.Column("field_id", _number(big=True), primary_key=True),
        sa.Column("job_id", _number(big=True), nullable=False),
        sa.Column("field_name", _text(128), nullable=False),
        sa.Column("field_cn_name", _text(256), nullable=False),
        sa.Column("field_order", sa.Integer(), nullable=False, server_default=_default("0")),
        sa.Column("source_code", _text(64)),
        sa.Column("data_type", _text(128), nullable=False),
        sa.Column("field_meaning", _text(2000)),
        sa.Column("is_deleted", _char(), nullable=False, server_default=_default("'N'")),
        sa.Column("created_by", _text(64), nullable=False, server_default=_default("'system'")),
        sa.Column("created_at", _timestamp(), nullable=False, server_default=_default("CURRENT_TIMESTAMP")),
        sa.Column("updated_by", _text(64), nullable=False, server_default=_default("'system'")),
        sa.Column("updated_at", _timestamp(), nullable=False, server_default=_default("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("job_id", "field_name", name="uq_p_push_job_field"),
        sa.ForeignKeyConstraint(["job_id"], [ref("p_push_job", "job_id")], ondelete="CASCADE"),
        schema=schema,
    )
    _create_indexes("p_push_job_field", [("idx_p_push_job_field_ix_01", ["job_id", "field_order"])])

    op.create_table(
        "p_push_change_log",
        sa.Column("change_id", _number(big=True), primary_key=True),
        sa.Column("system_id", _number(big=True)),
        sa.Column("job_id", _number(big=True)),
        sa.Column("object_type", _text(32), nullable=False),
        sa.Column("object_code", _text(128), nullable=False),
        sa.Column("change_type", _text(64), nullable=False),
        sa.Column("change_summary", _text(1000)),
        sa.Column("before_json", sa.Text()),
        sa.Column("after_json", sa.Text()),
        sa.Column("operator_name", _text(64), nullable=False, server_default=_default("'system'")),
        sa.Column("change_time", _timestamp(), nullable=False, server_default=_default("CURRENT_TIMESTAMP")),
        sa.Column("trace_id", _text(128)),
        schema=schema,
    )
    _create_indexes("p_push_change_log", [
        ("idx_p_push_change_log_ix_01", ["system_id", "change_time"]),
        ("idx_p_push_change_log_ix_02", ["job_id", "change_time"]),
        ("idx_p_push_change_log_ix_03", ["object_type", "object_code", "change_time"]),
    ])

    json_type = _large_text(4000)
    json_default = None if _dialect() == "mysql" else _default("'[]'")
    op.create_table(
        "p_report_asset",
        sa.Column("report_pk", _number(big=True), primary_key=True),
        sa.Column("report_code", _text(64), nullable=False),
        sa.Column("report_name", _text(256), nullable=False),
        sa.Column("report_alias", _text(256)),
        sa.Column("report_type", _text(64), nullable=False),
        sa.Column("domain_name", _text(128)),
        sa.Column("freq_code", _text(32)),
        sa.Column("stat_period_code", _text(32)),
        sa.Column("date_caliber_code", _text(32)),
        sa.Column("date_caliber_other_desc", _text(500)),
        sa.Column("data_timeliness_code", _text(32)),
        sa.Column("data_timeliness_custom_desc", _text(500)),
        sa.Column("status_code", _text(32), nullable=False, server_default=_default("'enabled'")),
        sa.Column("effective_date", _text(10)),
        sa.Column("expire_date", _text(10)),
        sa.Column("purpose_desc", _large_text(2000)),
        sa.Column("stat_object_desc", _large_text(1000)),
        sa.Column("stat_scope_desc", _large_text(1000)),
        sa.Column("time_caliber_desc", _large_text(1000)),
        sa.Column("filter_condition_desc", _large_text(2000)),
        sa.Column("special_rule_desc", _large_text(2000)),
        sa.Column("owner_dept_name", _text(128), nullable=False),
        sa.Column("owner_name", _text(64), nullable=False),
        sa.Column("maintainer_name", _text(64)),
        sa.Column("related_tables_json", json_type, nullable=False, server_default=json_default),
        sa.Column("related_indicators_json", json_type, nullable=False, server_default=json_default),
        sa.Column("remark_desc", _large_text(2000)),
        sa.Column("is_deleted", _char(), nullable=False, server_default=_default("'N'")),
        sa.Column("created_by", _text(64), nullable=False, server_default=_default("'system'")),
        sa.Column("created_at", _timestamp(), nullable=False, server_default=_default("CURRENT_TIMESTAMP")),
        sa.Column("updated_by", _text(64), nullable=False, server_default=_default("'system'")),
        sa.Column("updated_at", _timestamp(), nullable=False, server_default=_default("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("report_code", name="uq_p_report_asset_report_code"),
        schema=schema,
    )
    _create_indexes("p_report_asset", [("idx_p_report_asset_ix_01", ["status_code", "report_type", "domain_name"])])

    op.create_table(
        "p_manual_code_table",
        sa.Column("table_id", _number(big=True), primary_key=True),
        sa.Column("table_code", _text(64), nullable=False),
        sa.Column("table_name", _text(128), nullable=False),
        sa.Column("table_style", _text(16), nullable=False),
        sa.Column("owner_name", _text(64)),
        sa.Column("status_code", _text(16), nullable=False, server_default=_default("'active'")),
        sa.Column("remark", _text(1000)),
        sa.Column("created_by", _text(64), nullable=False, server_default=_default("'system'")),
        sa.Column("created_at", _timestamp(), nullable=False, server_default=_default("CURRENT_TIMESTAMP")),
        sa.Column("updated_by", _text(64), nullable=False, server_default=_default("'system'")),
        sa.Column("updated_at", _timestamp(), nullable=False, server_default=_default("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("table_code", name="uq_p_manual_code_table_code"),
        sa.CheckConstraint("table_style IN ('enum', 'dim', 'status', 'map', 'custom')"),
        sa.CheckConstraint("status_code IN ('active', 'draft', 'disabled')"),
        schema=schema,
    )
    _create_indexes("p_manual_code_table", [("idx_p_manual_code_table_filter", ["table_style", "status_code", "updated_at"])])

    op.create_table(
        "p_lineage_snapshot",
        sa.Column("snapshot_id", _text(128), primary_key=True),
        sa.Column("generated_at", _timestamp(), nullable=False),
        sa.Column("generator_name", _text(128), nullable=False),
        sa.Column("generator_version", _text(64), nullable=False),
        sa.Column("import_batch_id", _text(128), nullable=False),
        sa.Column("status_code", _text(16), nullable=False),
        sa.UniqueConstraint("import_batch_id", name="uq_p_lineage_snapshot_batch"),
        sa.CheckConstraint("status_code IN ('ACTIVE', 'INACTIVE')"),
        schema=schema,
    )
    op.create_table(
        "p_lineage_node",
        sa.Column("snapshot_id", _text(128), nullable=False),
        sa.Column("node_id", _text(256), nullable=False),
        sa.Column("kind_code", _text(32), nullable=False),
        sa.Column("node_name", _text(256), nullable=False),
        sa.Column("display_name", _text(512), nullable=False),
        sa.Column("namespace_name", _text(128), nullable=False),
        sa.Column("attributes_json", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("snapshot_id", "node_id"),
        sa.ForeignKeyConstraint(["snapshot_id"], [ref("p_lineage_snapshot", "snapshot_id")], ondelete="CASCADE"),
        schema=schema,
    )
    _create_indexes("p_lineage_node", [("idx_p_lineage_node_lookup", ["snapshot_id", "kind_code", "node_name"])])
    op.create_table(
        "p_lineage_edge",
        sa.Column("snapshot_id", _text(128), nullable=False),
        sa.Column("edge_id", _text(256), nullable=False),
        sa.Column("source_node_id", _text(256), nullable=False),
        sa.Column("target_node_id", _text(256), nullable=False),
        sa.Column("kind_code", _text(64), nullable=False),
        sa.Column("evidence_type", _text(64), nullable=False),
        sa.Column("source_record_id", _text(256), nullable=False),
        sa.Column("evidence_description", _text(1000), nullable=False),
        sa.Column("confidence_code", _text(16), nullable=False),
        sa.Column("generated_at", _timestamp(), nullable=False),
        sa.Column("diagnostics_json", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("snapshot_id", "edge_id"),
        sa.ForeignKeyConstraint(["snapshot_id"], [ref("p_lineage_snapshot", "snapshot_id")], ondelete="CASCADE"),
        schema=schema,
    )
    _create_indexes("p_lineage_edge", [
        ("idx_p_lineage_edge_source", ["snapshot_id", "source_node_id"]),
        ("idx_p_lineage_edge_target", ["snapshot_id", "target_node_id"]),
    ])


def downgrade() -> None:
    raise NotImplementedError("Database downgrades are intentionally unsupported")
