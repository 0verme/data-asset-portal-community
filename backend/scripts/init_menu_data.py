#!/usr/bin/env python3
"""Compatibility CLI for the application-level default menu seed."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--profile",
        help="explicit operational target; defaults to the validated ASSET_DB_PROFILE",
    )
    parser.add_argument("--config", help="database profile YAML path")
    args = parser.parse_args(argv)
    if args.config:
        os.environ["ASSET_DB_CONFIG_PATH"] = str(Path(args.config).resolve())

    from app.db.facade import resolve_cli_db_profile_name
    from app.navigation.persistence import seed_menus_for_profile

    profile = resolve_cli_db_profile_name(args.profile)
    result = seed_menus_for_profile(profile)
    print(f"profile={profile} menu_seed=inserted:{result.inserted} total:{result.total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
