"""Add source-scoped metadata identity and lineage ingestion bookkeeping.

The public contract does not expose these columns.  They let the application
persist an external natural key without making ``p_asset_table.table_name`` a
cross-source global key.  Existing legacy rows remain addressable through the
current CRUD paths because all new columns are nullable.
"""

from __future__ import annotations

from alembic import op  # type: ignore
import sqlalchemy as sa  # type: ignore

revision = "0004_metadata_ingestion_identity"
down_revision = "0003_open_repository_modules"
branch_labels = None
depends_on = None


ASSET_COLUMNS = (
    "asset_id",
    "table_name",
    "table_cn_name",
    "schema_name",
    "catalog_name",
    "database_name",
    "source_key",
    "asset_type",
    "external_id",
    "qualified_name",
    "layer_code",
    "domain_code",
    "owner_name",
    "grain_desc",
    "cycle_desc",
    "table_desc",
    "field_count",
    "is_deleted",
    "created_by",
    "created_at",
    "updated_by",
    "updated_at",
)
NEW_ASSET_COLUMNS = {
    "catalog_name": ("VARCHAR", 128),
    "database_name": ("VARCHAR", 128),
    "source_key": ("VARCHAR", 64),
    "asset_type": ("VARCHAR", 64),
    "external_id": ("VARCHAR", 256),
    "qualified_name": ("VARCHAR", 512),
}
NEW_LINEAGE_COLUMNS = {
    "source_key": ("VARCHAR", 64),
    "content_hash": ("VARCHAR", 64),
    "ingestion_id": ("VARCHAR", 64),
}


def _dialect() -> str:
    return op.get_bind().dialect.name


def _schema() -> str | None:
    return op.get_context().opts.get("version_table_schema")


def _text(length: int | None = None):
    if _dialect() == "sqlite":
        return sa.Text()
    return sa.String(length) if length else sa.Text()


def _timestamp():
    return sa.TIMESTAMP()


def _inspect():
    return sa.inspect(op.get_bind())


def _columns(table: str) -> set[str]:
    return {str(item["name"]).lower() for item in _inspect().get_columns(table, schema=_schema())}


def _asset_table_definition():
    asset_id_type = sa.Integer() if _dialect() == "sqlite" else sa.BigInteger()
    return (
        sa.Column("asset_id", asset_id_type, primary_key=True),
        sa.Column("table_name", _text(256), nullable=False),
        sa.Column("table_cn_name", _text(256)),
        sa.Column("schema_name", _text(128), nullable=False, server_default=sa.text("'dwp'")),
        sa.Column("catalog_name", _text(128)),
        sa.Column("database_name", _text(128)),
        sa.Column("source_key", _text(64)),
        sa.Column("asset_type", _text(64)),
        sa.Column("external_id", _text(256)),
        sa.Column("qualified_name", _text(512)),
        sa.UniqueConstraint("source_key", "asset_type", "external_id", name="uq_p_asset_ingestion_identity"),
        sa.Column("layer_code", _text(32)),
        sa.Column("domain_code", _text(64)),
        sa.Column("owner_name", _text(128)),
        sa.Column("grain_desc", _text(1000)),
        sa.Column("cycle_desc", _text(1000)),
        sa.Column("table_desc", _text(2000)),
        sa.Column("field_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_deleted", _text(1), nullable=False, server_default=sa.text("'N'")),
        sa.Column("created_by", _text(64), nullable=False, server_default=sa.text("'system'")),
        sa.Column("created_at", _timestamp(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_by", _text(64), nullable=False, server_default=sa.text("'system'")),
        sa.Column("updated_at", _timestamp(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )


def _has_table_name_unique() -> bool:
    inspector = _inspect()
    try:
        for item in inspector.get_unique_constraints("p_asset_table", schema=_schema()):
            if [str(column).lower() for column in item.get("column_names") or []] == ["table_name"]:
                return True
    except (NotImplementedError, sa.exc.NoSuchTableError):
        pass
    try:
        for item in inspector.get_indexes("p_asset_table", schema=_schema()):
            if item.get("unique") and [str(column).lower() for column in item.get("column_names") or []] == ["table_name"]:
                return True
    except (NotImplementedError, sa.exc.NoSuchTableError):
        pass
    return False


def _rebuild_sqlite_asset_table(existing_columns: set[str]) -> None:
    schema = _schema()
    bind = op.get_bind()
    old_table = sa.Table("p_asset_table", sa.MetaData(), autoload_with=bind, schema=schema)
    temporary_name = "p_asset_table_metadata_tmp"
    op.create_table(temporary_name, *_asset_table_definition(), schema=schema)
    target = sa.Table(temporary_name, sa.MetaData(), autoload_with=bind, schema=schema)
    copied = [column for column in ASSET_COLUMNS if column.lower() in existing_columns]
    column_map = {
        "asset_id": old_table.c.asset_id,
        "table_name": old_table.c.table_name,
        "table_cn_name": old_table.c.table_cn_name,
        "schema_name": old_table.c.schema_name,
        "layer_code": old_table.c.layer_code,
        "domain_code": old_table.c.domain_code,
        "owner_name": old_table.c.owner_name,
        "grain_desc": old_table.c.grain_desc,
        "cycle_desc": old_table.c.cycle_desc,
        "table_desc": old_table.c.table_desc,
        "field_count": old_table.c.field_count,
        "is_deleted": old_table.c.is_deleted,
        "created_by": old_table.c.created_by,
        "created_at": old_table.c.created_at,
        "updated_by": old_table.c.updated_by,
        "updated_at": old_table.c.updated_at,
    }
    for name in ("catalog_name", "database_name", "source_key", "asset_type", "external_id", "qualified_name"):
        if name in existing_columns:
            column_map[name] = getattr(old_table.c, name)
    op.execute(
        target.insert().from_select(
            copied,
            sa.select(*(column_map[column] for column in copied)),
        )
    )
    op.drop_table("p_asset_table", schema=schema)
    op.rename_table(temporary_name, "p_asset_table", schema=schema)


def _drop_table_name_unique() -> None:
    inspector = _inspect()
    dropped = set()
    try:
        constraints = inspector.get_unique_constraints("p_asset_table", schema=_schema())
    except (NotImplementedError, sa.exc.NoSuchTableError):
        constraints = []
    for item in constraints:
        columns = [str(column).lower() for column in item.get("column_names") or []]
        name = item.get("name")
        if columns == ["table_name"] and name:
            op.drop_constraint(name, "p_asset_table", type_="unique", schema=_schema())
            dropped.add(str(name).lower())
    try:
        indexes = inspector.get_indexes("p_asset_table", schema=_schema())
    except (NotImplementedError, sa.exc.NoSuchTableError):
        indexes = []
    for item in indexes:
        columns = [str(column).lower() for column in item.get("column_names") or []]
        name = item.get("name")
        if item.get("unique") and columns == ["table_name"] and name and str(name).lower() not in dropped:
            op.drop_index(name, table_name="p_asset_table", schema=_schema())


def _add_missing_columns(table: str, definitions: dict[str, tuple[str, int]]) -> None:
    existing = _columns(table)
    for name, (_kind, length) in definitions.items():
        if name not in existing:
            op.add_column(table, sa.Column(name, _text(length), nullable=True), schema=_schema())


def _has_asset_identity_unique() -> bool:
    try:
        constraints = _inspect().get_unique_constraints("p_asset_table", schema=_schema())
    except (NotImplementedError, sa.exc.NoSuchTableError):
        constraints = []
    return any(
        [str(column).lower() for column in item.get("column_names") or []]
        == ["source_key", "asset_type", "external_id"]
        for item in constraints
    )


def _ensure_asset_identity_unique() -> None:
    if not _has_asset_identity_unique():
        op.create_unique_constraint(
            "uq_p_asset_ingestion_identity",
            "p_asset_table",
            ["source_key", "asset_type", "external_id"],
            schema=_schema(),
        )


def _ensure_lineage_columns() -> None:
    _add_missing_columns("p_lineage_snapshot", NEW_LINEAGE_COLUMNS)


def upgrade() -> None:
    existing_asset_columns = _columns("p_asset_table")
    if _dialect() == "sqlite" and (
        set(ASSET_COLUMNS) - existing_asset_columns or _has_table_name_unique()
    ):
        _rebuild_sqlite_asset_table(existing_asset_columns)
    else:
        _add_missing_columns("p_asset_table", NEW_ASSET_COLUMNS)
        _drop_table_name_unique()
    _ensure_asset_identity_unique()
    _ensure_lineage_columns()


def downgrade() -> None:
    raise NotImplementedError("Database downgrades are intentionally unsupported")
