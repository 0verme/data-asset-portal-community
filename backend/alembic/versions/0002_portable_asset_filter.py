"""Add a portable filter index after the consolidated baseline."""

from alembic import op
import sqlalchemy as sa

revision = "0002_portable_asset_filter"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    schema = op.get_context().opts.get("version_table_schema")
    inspector = sa.inspect(op.get_bind())
    for index in inspector.get_indexes("p_asset_table", schema=schema):
        if str(index.get("name") or "").lower() != "idx_p_asset_table_filter":
            continue
        columns = tuple(
            str(column).lower() for column in index.get("column_names") or ()
        )
        if columns != ("layer_code", "domain_code") or index.get("unique"):
            raise RuntimeError(
                "idx_p_asset_table_filter exists with an unexpected definition: "
                f"columns={columns!r}, unique={index.get('unique')!r}"
            )
        return

    op.create_index(
        "idx_p_asset_table_filter",
        "p_asset_table",
        ["layer_code", "domain_code"],
        unique=False,
        schema=schema,
    )


def downgrade() -> None:
    raise NotImplementedError("Database downgrades are intentionally unsupported")
