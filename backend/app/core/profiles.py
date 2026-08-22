"""Apply named runtime profiles through the existing environment config surface."""

# pyright: reportMissingModuleSource=false

from __future__ import annotations

import os
from pathlib import Path

import yaml


CONFIG_ROOT = Path(__file__).resolve().parents[2] / "configs"
PROFILE_ENV = "ASSET_RUNTIME_PROFILE"


def apply_runtime_profile() -> dict | None:
    name = (os.getenv(PROFILE_ENV) or "").strip().lower()
    if not name:
        return None
    path = CONFIG_ROOT / f"{name}.yaml"
    if not path.is_file():
        raise ValueError(f"unknown runtime profile: {name}")
    profile = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if name == "community":
        os.environ.setdefault("ASSET_DB_CONFIG_PATH", str(CONFIG_ROOT / "database.community.yaml"))
        os.environ.setdefault("ASSET_DB_PROFILE", "community_sqlite")
    return profile
