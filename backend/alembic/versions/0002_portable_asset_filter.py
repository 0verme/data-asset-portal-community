"""Add a portable filter index after the consolidated baseline."""

from alembic import op

revision = "0002_portable_asset_filter"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    schema = op.get_context().opts.get("version_table_schema")
    op.create_index(
        "idx_p_asset_table_filter",
        "p_asset_table",
        ["layer_code", "domain_code"],
        unique=False,
        schema=schema,
    )


def downgrade() -> None:
    raise NotImplementedError("Database downgrades are intentionally unsupported")
