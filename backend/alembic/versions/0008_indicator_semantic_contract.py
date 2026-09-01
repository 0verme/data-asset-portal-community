"""Add stable indicator references and the minimal semantic contract.

Legacy table/field strings remain intact as display and compatibility
snapshots. Backfill only uses exact, unique matches among non-deleted assets
and fields; ambiguous or unresolved values are intentionally left NULL.
"""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0008_indicator_semantic_contract"
down_revision = "0007_binary_status_contract"
branch_labels = None
depends_on = None

INDICATOR_TABLE = "p_indicator_item"
ASSET_TABLE = "p_asset_table"
FIELD_TABLE = "p_asset_field"
REFERENCE_INDEX = "idx_p_indicator_semantic_ref"
SEMANTIC_STATE_DEFAULT = "'candidate'"


def _dialect() -> str:
    return op.get_bind().dialect.name


def _schema() -> str | None:
    return op.get_context().opts.get("version_table_schema")


def _inspect():
    return sa.inspect(op.get_bind())


def _has_table(name: str) -> bool:
    return _inspect().has_table(name, schema=_schema())


def _columns(table: str) -> set[str]:
    return {
        str(item["name"]).lower()
        for item in _inspect().get_columns(table, schema=_schema())
    }


def _number():
    return sa.Integer() if _dialect() == "sqlite" else sa.BigInteger()


def _text(length: int):
    return sa.Text() if _dialect() == "sqlite" else sa.String(length)


def _add_missing_columns() -> None:
    existing = _columns(INDICATOR_TABLE)
    definitions = (
        ("source_asset_id", sa.Column("source_asset_id", _number(), nullable=True)),
        ("result_field_id", sa.Column("result_field_id", _number(), nullable=True)),
        ("aggregation_code", sa.Column("aggregation_code", _text(32), nullable=True)),
        (
            "semantic_state",
            sa.Column(
                "semantic_state",
                _text(32),
                nullable=False,
                server_default=sa.text(SEMANTIC_STATE_DEFAULT),
            ),
        ),
    )
    for name, column in definitions:
        if name not in existing:
            op.add_column(INDICATOR_TABLE, column, schema=_schema())


def _ensure_reference_index() -> None:
    indexes = _inspect().get_indexes(INDICATOR_TABLE, schema=_schema())
    if REFERENCE_INDEX not in {str(item.get("name")) for item in indexes}:
        op.create_index(
            REFERENCE_INDEX,
            INDICATOR_TABLE,
            ["source_asset_id", "result_field_id"],
            unique=False,
            schema=_schema(),
        )


def _value(row, key: str) -> str:
    raw = row.get(key)
    return str(raw).strip() if raw is not None else ""


def _int_value(value):
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _asset_keys(row) -> set[str]:
    table_name = _value(row, "table_name")
    if not table_name:
        return set()
    keys = {table_name}
    qualified_name = _value(row, "qualified_name")
    if qualified_name:
        keys.add(qualified_name)
    schema_name = _value(row, "schema_name")
    catalog_name = _value(row, "catalog_name")
    if schema_name:
        keys.add(f"{schema_name}.{table_name}")
    if catalog_name and schema_name:
        keys.add(f"{catalog_name}.{schema_name}.{table_name}")
    return keys


def _active_asset_rows(bind):
    asset = sa.Table(ASSET_TABLE, sa.MetaData(), autoload_with=bind, schema=_schema())
    # pi-lens-ignore: python-sql-injection
    rows = (
        bind.execute(
            sa.select(
                asset.c.asset_id,
                asset.c.table_name,
                asset.c.schema_name,
                asset.c.catalog_name,
                asset.c.qualified_name,
                asset.c.is_deleted,
            )
        )
        .mappings()
        .all()
    )
    return [row for row in rows if _value(row, "is_deleted").upper() == "N"]


def _active_field_rows(bind):
    field = sa.Table(FIELD_TABLE, sa.MetaData(), autoload_with=bind, schema=_schema())
    # pi-lens-ignore: python-sql-injection
    rows = (
        bind.execute(
            sa.select(
                field.c.field_id,
                field.c.asset_id,
                field.c.field_name,
                field.c.is_deleted,
            )
        )
        .mappings()
        .all()
    )
    return [row for row in rows if _value(row, "is_deleted").upper() == "N"]


def _backfill_references() -> None:
    if not (_has_table(ASSET_TABLE) and _has_table(FIELD_TABLE)):
        return

    bind = op.get_bind()
    asset_rows = _active_asset_rows(bind)
    field_rows = _active_field_rows(bind)
    indicator = sa.Table(
        INDICATOR_TABLE, sa.MetaData(), autoload_with=bind, schema=_schema()
    )

    asset_by_key: dict[str, set[int]] = {}
    active_asset_ids: set[int] = set()
    for row in asset_rows:
        asset_id = _int_value(row.get("asset_id"))
        if asset_id is None:
            continue
        active_asset_ids.add(asset_id)
        for key in _asset_keys(row):
            asset_by_key.setdefault(key, set()).add(asset_id)

    field_by_asset_name: dict[tuple[int, str], set[int]] = {}
    for row in field_rows:
        asset_id = _int_value(row.get("asset_id"))
        field_id = _int_value(row.get("field_id"))
        if asset_id is None or field_id is None or asset_id not in active_asset_ids:
            continue
        field_by_asset_name.setdefault(
            (asset_id, _value(row, "field_name")), set()
        ).add(field_id)

    # pi-lens-ignore: python-sql-injection
    indicators = (
        bind.execute(
            sa.select(
                indicator.c.indicator_pk,
                indicator.c.result_table_name,
                indicator.c.result_field_name,
                indicator.c.source_asset_id,
                indicator.c.result_field_id,
            )
        )
        .mappings()
        .all()
    )
    for row in indicators:
        source_asset_id = row.get("source_asset_id")
        result_field_id = row.get("result_field_id")
        values = {}

        if source_asset_id is None:
            candidates = asset_by_key.get(_value(row, "result_table_name"), set())
            if len(candidates) == 1:
                source_asset_id = next(iter(candidates))
                values["source_asset_id"] = source_asset_id

        source_asset_id_int = _int_value(source_asset_id)
        if result_field_id is None and source_asset_id_int in active_asset_ids:
            candidates = field_by_asset_name.get(
                (source_asset_id_int, _value(row, "result_field_name")),
                set(),
            )
            if len(candidates) == 1:
                values["result_field_id"] = next(iter(candidates))

        if values:
            # pi-lens-ignore: python-sql-injection
            op.execute(
                sa.update(indicator)
                .where(indicator.c.indicator_pk == row["indicator_pk"])
                .values(**values)
            )


def _backfill_semantic_state() -> None:
    indicator = sa.table(
        INDICATOR_TABLE,
        sa.column("semantic_state", _text(32)),
        schema=_schema(),
    )
    # pi-lens-ignore: python-sql-injection
    op.execute(
        sa.update(indicator)
        .where(indicator.c.semantic_state.is_(None))
        .values(semantic_state="candidate")
    )


def upgrade() -> None:
    if not _has_table(INDICATOR_TABLE):
        return
    _add_missing_columns()
    _ensure_reference_index()
    _backfill_semantic_state()
    _backfill_references()


def downgrade() -> None:
    raise NotImplementedError("Database downgrades are intentionally unsupported")
