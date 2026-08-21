"""Current Community schema baseline.

Fresh databases execute backend/schema/<dialect>.sql before this revision is
stamped. Existing compatible databases are schema-checked before stamping.
"""

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    raise NotImplementedError("Database downgrades are intentionally unsupported")
