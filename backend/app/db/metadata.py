"""Shared SQLAlchemy Core metadata for database-backed services."""

from sqlalchemy import MetaData


LOGICAL_SCHEMA = "__app__"
metadata = MetaData(schema=LOGICAL_SCHEMA)
