from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context

from app.db.facade import get_db_profile, get_engine
from app.db.registry import get_provider

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

target_metadata = None


def _profile():
    name = context.get_x_argument(as_dictionary=True).get("profile")
    return name or os.getenv("ASSET_DB_PROFILE", "").strip()


def _settings():
    profile = _profile()
    if not profile:
        raise RuntimeError("Alembic requires -x profile=NAME or ASSET_DB_PROFILE")
    db_config = get_db_profile(profile)
    provider = get_provider(db_config["type"])
    return profile, db_config, provider


def _version_table_schema(provider, db_config):
    return provider.physical_schema(db_config) or None


def run_migrations_offline():
    _, db_config, provider = _settings()
    engine = get_engine(_profile(), config=db_config)
    if engine is None:
        raise RuntimeError("DWS revisions must be rendered offline and applied through schema_migrate.py")
    context.configure(
        url=engine.url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_schema=_version_table_schema(provider, db_config),
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    profile, db_config, provider = _settings()
    engine = get_engine(profile, config=db_config)
    if engine is None:
        raise RuntimeError("DWS online revisions are applied through schema_migrate.py")
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table_schema=_version_table_schema(provider, db_config),
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
