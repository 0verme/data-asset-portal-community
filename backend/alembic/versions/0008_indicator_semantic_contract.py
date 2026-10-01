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

from app.migrations.revision_logic import plan_indicator_reference_backfill

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


def _backfill_references() -> None:
    if not (_has_table(ASSET_TABLE) and _has_table(FIELD_TABLE)):
        return

    bind = op.get_bind()
    asset = sa.Table(ASSET_TABLE, sa.MetaData(), autoload_with=bind, schema=_schema())
    field = sa.Table(FIELD_TABLE, sa.MetaData(), autoload_with=bind, schema=_schema())
    indicator = sa.Table(
        INDICATOR_TABLE, sa.MetaData(), autoload_with=bind, schema=_schema()
    )

    asset_rows = bind.execute(
        sa.select(
            asset.c.asset_id,
            asset.c.table_name,
            asset.c.schema_name,
            asset.c.catalog_name,
            asset.c.qualified_name,
            asset.c.is_deleted,
        )
    ).mappings().all()
    field_rows = bind.execute(
        sa.select(
            field.c.field_id,
            field.c.asset_id,
            field.c.field_name,
            field.c.is_deleted,
        )
    ).mappings().all()
    indicator_rows = bind.execute(
        sa.select(
            indicator.c.indicator_pk,
            indicator.c.result_table_name,
            indicator.c.result_field_name,
            indicator.c.source_asset_id,
            indicator.c.result_field_id,
        )
    ).mappings().all()

    for update in plan_indicator_reference_backfill(
        indicator_rows, asset_rows, field_rows
    ):
        op.execute(
            sa.update(indicator)
            .where(indicator.c.indicator_pk == update.indicator_pk)
            .values(**dict(update.values))
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
