"""Add stable multi-source lineage and optional caliber documentation."""

# pyright: reportMissingImports=false

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0016_indicator_source_lineage"
down_revision = "0015_ai_llm_daily_quota"
branch_labels = None
depends_on = None

SOURCE_TABLE = "p_indicator_source"
SOURCE_INDEX = "idx_p_indicator_source_lookup"
FORMULA_COLUMNS = ("caliber_formula", "caliber_sql")


def _schema() -> str | None:
    return op.get_context().opts.get("version_table_schema")


def _integer_type(bind):
    return sa.Integer() if bind.dialect.name == "sqlite" else sa.BigInteger()


def _add_caliber_columns(bind) -> None:
    schema = _schema()
    inspector = sa.inspect(bind)
    if not inspector.has_table("p_indicator_item", schema=schema):
        raise RuntimeError("p_indicator_item is required for indicator source lineage")
    columns = {
        str(column["name"]).lower(): column
        for column in inspector.get_columns("p_indicator_item", schema=schema)
    }
    for name in FORMULA_COLUMNS:
        existing = columns.get(name)
        if existing is None:
            op.add_column(
                "p_indicator_item",
                sa.Column(name, sa.Text(), nullable=True),
                schema=schema,
            )
        elif not isinstance(existing["type"], sa.Text) or bool(existing.get("nullable", True)) is False:
            raise RuntimeError(f"p_indicator_item.{name} conflicts with the text contract")


def _create_source_table(bind) -> None:
    schema = _schema()
    inspector = sa.inspect(bind)
    if not inspector.has_table(SOURCE_TABLE, schema=schema):
        number = _integer_type(bind)
        op.create_table(
            SOURCE_TABLE,
            sa.Column("source_pk", number, nullable=False),
            sa.Column("indicator_pk", number, nullable=False),
            sa.Column("source_asset_id", number, nullable=True),
            sa.Column("source_field_id", number, nullable=True),
            sa.Column("source_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("is_deleted", sa.String(1), nullable=False, server_default=sa.text("'N'")),
            sa.Column("created_by", sa.String(64), nullable=False, server_default=sa.text("'system'")),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_by", sa.String(64), nullable=False, server_default=sa.text("'system'")),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.PrimaryKeyConstraint("source_pk", name="pk_p_indicator_source"),
            schema=schema,
        )
    inspector = sa.inspect(bind)
    columns = {
        str(column["name"]).lower(): column
        for column in inspector.get_columns(SOURCE_TABLE, schema=schema)
    }
    expected = {
        "source_pk", "indicator_pk", "source_asset_id", "source_field_id",
        "source_order", "is_deleted", "created_by", "created_at", "updated_by", "updated_at",
    }
    if set(columns) != expected:
        raise RuntimeError("p_indicator_source conflicts with its additive schema contract")
    primary_key = inspector.get_pk_constraint(SOURCE_TABLE, schema=schema).get("constrained_columns") or []
    if [str(column).lower() for column in primary_key] != ["source_pk"]:
        raise RuntimeError("p_indicator_source has an incompatible primary key")
    # SQLite reflection reports INTEGER PRIMARY KEY columns as nullable even
    # though the primary-key constraint makes them non-null in practice.
    required = {"indicator_pk", "source_order", "is_deleted", "created_by", "created_at", "updated_by", "updated_at"}
    if any(bool(columns[name].get("nullable", True)) for name in required):
        raise RuntimeError("p_indicator_source has nullable required columns")
    if any(
        not isinstance(columns[name]["type"], sa.Integer)
        for name in ("source_pk", "indicator_pk", "source_asset_id", "source_field_id", "source_order")
    ):
        raise RuntimeError("p_indicator_source has incompatible numeric columns")
    if not isinstance(columns["is_deleted"]["type"], sa.String) or columns["is_deleted"]["type"].length not in (None, 1):
        raise RuntimeError("p_indicator_source has an incompatible deletion flag")
    if any(
        not isinstance(columns[name]["type"], sa.String) or columns[name]["type"].length not in (None, 64)
        for name in ("created_by", "updated_by")
    ):
        raise RuntimeError("p_indicator_source has incompatible audit columns")
    if not isinstance(columns["created_at"]["type"], sa.DateTime) or not isinstance(columns["updated_at"]["type"], sa.DateTime):
        raise RuntimeError("p_indicator_source has incompatible timestamp columns")
    indexes = {
        str(index["name"]).lower(): tuple(str(column).lower() for column in index.get("column_names") or [])
        for index in inspector.get_indexes(SOURCE_TABLE, schema=schema)
    }
    observed_index = indexes.get(SOURCE_INDEX)
    expected_index = ("indicator_pk", "is_deleted", "source_order")
    if observed_index is not None and observed_index != expected_index:
        raise RuntimeError("p_indicator_source lookup index conflicts with its contract")
    if observed_index is None:
        op.create_index(SOURCE_INDEX, SOURCE_TABLE, list(expected_index), schema=schema)


def _backfill_legacy_source_pairs(bind) -> None:
    """Copy legacy stable IDs without rewriting or deleting their source rows."""
    schema = _schema()
    metadata = sa.MetaData()
    indicator = sa.Table("p_indicator_item", metadata, autoload_with=bind, schema=schema)
    source = sa.Table(SOURCE_TABLE, metadata, autoload_with=bind, schema=schema)
    fields = sa.Table("p_asset_field", metadata, autoload_with=bind, schema=schema)
    indicator_rows = bind.execute(sa.select(
        indicator.c.indicator_pk,
        indicator.c.source_asset_id,
        indicator.c.result_field_id,
    ).where(indicator.c.is_deleted == "N")).mappings()
    field_rows = bind.execute(sa.select(fields.c.field_id, fields.c.asset_id)).mappings()
    field_assets = {row["field_id"]: row["asset_id"] for row in field_rows}
    existing_rows = bind.execute(sa.select(
        source.c.indicator_pk,
        source.c.source_asset_id,
        source.c.source_field_id,
    )).mappings()
    existing = {
        (row["indicator_pk"], row["source_asset_id"], row["source_field_id"])
        for row in existing_rows
    }
    max_row = bind.execute(sa.select(sa.func.max(source.c.source_pk))).scalar()
    next_id = int(max_row or 0) + 1
    for row in indicator_rows:
        asset_id = row["source_asset_id"]
        field_id = row["result_field_id"]
        if asset_id is None and field_id is None:
            continue
        if asset_id is None and field_id is not None:
            asset_id = field_assets.get(field_id)
        key = (row["indicator_pk"], asset_id, field_id)
        if key in existing:
            continue
        bind.execute(sa.insert(source).values(
            source_pk=next_id,
            indicator_pk=row["indicator_pk"],
            source_asset_id=asset_id,
            source_field_id=field_id,
            source_order=0,
            is_deleted="N",
            created_by="migration",
            updated_by="migration",
        ))
        existing.add(key)
        next_id += 1


def upgrade() -> None:
    bind = op.get_bind()
    _add_caliber_columns(bind)
    _create_source_table(bind)
    _backfill_legacy_source_pairs(bind)


def downgrade() -> None:
    # Dropping this additive table would destroy source relationships created
    # after upgrade. Roll back application code while retaining the compatible
    # schema, then use a forward migration if the schema itself must change.
    raise NotImplementedError("indicator source lineage is rolled back forward-only")
