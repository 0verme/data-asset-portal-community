"""Portable Core table declarations shared by database-backed services."""

from sqlalchemy import Column, DateTime, Integer, String, Table, Text

from .metadata import metadata


admin_user = Table(
    "p_admin_user",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("username", String(128), nullable=False),
    Column("password_hash", Text, nullable=False),
    Column("display_name", String(255)),
    Column("status", String(32)),
    Column("role", String(32)),
    Column("last_login_at", DateTime),
    Column("updated_at", DateTime),
)
