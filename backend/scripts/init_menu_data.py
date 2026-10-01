#!/usr/bin/env python3
"""Compatibility CLI for the application-level default menu seed."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", default=os.getenv("ASSET_DB_PROFILE", "primary"))
    parser.add_argument("--config", help="database profile YAML path")
    args = parser.parse_args()
    if args.config:
        os.environ["ASSET_DB_CONFIG_PATH"] = str(Path(args.config).resolve())

    from app.navigation.persistence import seed_menus_for_profile

    result = seed_menus_for_profile(args.profile)
    print(f"menu_seed=inserted:{result.inserted} total:{result.total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
