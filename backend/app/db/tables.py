"""Portable Core table declarations for migrated business queries."""

from sqlalchemy import Column, DateTime, Integer, String, Table, Text

from .metadata import metadata


def _table(name, *columns):
    return Table(name, metadata, *columns)


admin_user = _table(
    "p_admin_user",
    Column("id", Integer, primary_key=True),
    Column("username", String(128), nullable=False),
    Column("password_hash", Text, nullable=False),
    Column("display_name", String(255)),
    Column("status", String(32)),
    Column("role", String(32)),
    Column("last_login_at", DateTime),
    Column("updated_at", DateTime),
)

asset_domain = _table(
    "p_asset_domain",
    Column("domain_code", String(64), primary_key=True),
    Column("domain_name", String(256), nullable=False),
    Column("display_order", Integer, nullable=False),
    Column("is_active", String(1), nullable=False),
    Column("is_deleted", String(1), nullable=False),
)

asset_layer = _table(
    "p_asset_layer",
    Column("layer_code", String(32), primary_key=True),
    Column("layer_name", String(128), nullable=False),
    Column("display_order", Integer, nullable=False),
    Column("is_active", String(1), nullable=False),
    Column("is_deleted", String(1), nullable=False),
)

asset_table = _table(
    "p_asset_table",
    Column("asset_id", Integer, primary_key=True),
    Column("table_name", String(256), nullable=False),
    Column("table_cn_name", String(256)),
    Column("schema_name", String(128), nullable=False),
    Column("layer_code", String(32)),
    Column("domain_code", String(64)),
    Column("owner_name", String(128)),
    Column("grain_desc", String(1000)),
    Column("cycle_desc", String(1000)),
    Column("table_desc", String(2000)),
    Column("field_count", Integer, nullable=False),
    Column("is_deleted", String(1), nullable=False),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)

asset_field = _table(
    "p_asset_field",
    Column("field_id", Integer, primary_key=True),
    Column("asset_id", Integer, nullable=False),
    Column("field_name", String(256), nullable=False),
    Column("field_cn_name", String(256)),
    Column("data_type", String(128)),
    Column("field_order", Integer, nullable=False),
    Column("nullable_flag", String(1), nullable=False),
    Column("pk_flag", String(1), nullable=False),
    Column("partition_flag", String(1), nullable=False),
    Column("enum_desc", Text),
    Column("field_desc", Text),
    Column("is_deleted", String(1), nullable=False),
    Column("created_by", String(64), nullable=False),
    Column("created_at", DateTime),
    Column("updated_by", String(64), nullable=False),
    Column("updated_at", DateTime),
)

asset_change_log = _table(
    "p_asset_change_log",
    Column("change_id", Integer, primary_key=True),
    Column("asset_id", Integer),
    Column("table_name", String(256), nullable=False),
    Column("change_type", String(64), nullable=False),
    Column("change_summary", String(1000)),
    Column("before_json", Text),
    Column("after_json", Text),
    Column("operator_name", String(64), nullable=False),
    Column("change_time", DateTime),
)
