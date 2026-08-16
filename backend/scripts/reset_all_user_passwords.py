#!/usr/bin/env python3
"""Reset every portal user's password to their current username."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.db.gaussdb import (  # noqa: E402
    AUTH_PROFILE_ENV,
    DEFAULT_PROFILE_ENV,
    database_transaction,
    execute_many,
    fetch_all,
    load_db_profiles,
)
from app.services.auth_service import TABLE_ADMIN_USER, build_password_hash  # noqa: E402


def resolve_profile(explicit_profile: str | None = None) -> str:
    profiles = load_db_profiles()
    candidates = (
        explicit_profile,
        os.getenv(AUTH_PROFILE_ENV),
        os.getenv(DEFAULT_PROFILE_ENV),
        "primary",
    )
    for candidate in candidates:
        profile = (candidate or "").strip()
        if profile and profile in profiles:
            return profile
    available = ", ".join(sorted(profiles)) or "(none)"
    raise RuntimeError(f"No usable database profile found. Available profiles: {available}")


def _load_users(profile: str) -> list[tuple[int, str]]:
    columns, rows = fetch_all(
        profile,
        f"SELECT id, username FROM {TABLE_ADMIN_USER} ORDER BY id",
    )
    users = [dict(zip(columns, row)) for row in rows]
    invalid_ids = [str(user["id"]) for user in users if not str(user.get("username") or "").strip()]
    if invalid_ids:
        raise RuntimeError(f"Refusing to reset users with blank usernames: {', '.join(invalid_ids)}")
    return [(int(user["id"]), str(user["username"]).strip()) for user in users]


def preview_password_reset(profile: str) -> list[tuple[int, str]]:
    return _load_users(profile)


def reset_all_user_passwords(profile: str) -> int:
    with database_transaction():
        users = _load_users(profile)
        execute_many(
            profile,
            f"""
UPDATE {TABLE_ADMIN_USER}
SET password_hash = ?,
    updated_at = CURRENT_TIMESTAMP
WHERE id = ?
""".strip(),
            [(build_password_hash(username), user_id) for user_id, username in users],
        )
    return len(users)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Reset every portal user's password to their current username.",
    )
    parser.add_argument("--profile", help="database profile (defaults to auth/default/primary profile)")
    parser.add_argument("--config", help="database profile YAML path")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="perform the reset; without this flag the script only previews",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="skip the interactive confirmation (requires --apply)",
    )
    args = parser.parse_args(argv)

    if args.yes and not args.apply:
        parser.error("--yes requires --apply")
    if args.config:
        os.environ["ASSET_DB_CONFIG_PATH"] = args.config

    profile = resolve_profile(args.profile)
    users = preview_password_reset(profile)
    print(f"profile={profile} users={len(users)}")

    if not args.apply:
        print("Dry run only. Re-run with --apply to reset all passwords.")
        return 0

    print("WARNING: Every portal user will be able to sign in with their username as the password.")
    if not args.yes and input('Type "RESET ALL" to continue: ').strip() != "RESET ALL":
        print("Cancelled. No passwords were changed.")
        return 1

    updated = reset_all_user_passwords(profile)
    print(f"Reset complete. updated={updated}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
