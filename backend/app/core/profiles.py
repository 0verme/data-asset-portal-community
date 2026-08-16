"""Apply named runtime profiles through the existing environment config surface."""

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
    enabled = profile.get("modules", {}).get("enabled", [])
    disabled = profile.get("modules", {}).get("disabled", [])
    os.environ.setdefault("ASSET_EDITION", str(profile.get("edition") or name))
    os.environ.setdefault("ASSET_ENABLED_MODULES", ",".join(enabled))
    os.environ.setdefault("ASSET_DISABLED_MODULES", ",".join(disabled))
    if name == "community":
        os.environ.setdefault("ASSET_DB_CONFIG_PATH", str(CONFIG_ROOT / "database.community.yaml"))
        os.environ.setdefault("ASSET_DB_PROFILE", "community_sqlite")
    return profile
