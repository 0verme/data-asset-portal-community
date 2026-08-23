#!/usr/bin/env python3
"""Create the first administrator interactively (one-time bootstrap)."""
from __future__ import annotations

import getpass
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

try:
    from backend.app.services.system_management_service import (  # type: ignore  # noqa: E402
        SystemDataSourceError,
        SystemManagementError,
        SystemUserAlreadyExistsError,
        system_management_service,
    )
except ModuleNotFoundError:
    from app.services.system_management_service import (  # noqa: E402
        SystemDataSourceError,
        SystemManagementError,
        SystemUserAlreadyExistsError,
        system_management_service,
    )


def _load_runtime() -> None:
    """Mirror native startup / schema_migrate: load env files, then runtime profile."""
    try:
        from app.settings import load_runtime_env
    except ModuleNotFoundError:  # pragma: no cover - package vs script entry
        from backend.app.settings import load_runtime_env  # type: ignore

    # Default overwrite=True matches historical/normal runtime file precedence.
    # Community demo uses overwrite=False in its own bootstrap path, not this CLI.
    load_runtime_env()

    try:
        from app.core.profiles import apply_runtime_profile
    except ModuleNotFoundError:  # pragma: no cover - package vs script entry
        from backend.app.core.profiles import apply_runtime_profile  # type: ignore

    apply_runtime_profile()


def _is_configuration_failure(error: BaseException) -> bool:
    """True when the failure is missing/invalid runtime or database profile config."""
    cause: BaseException = error.__cause__ if error.__cause__ is not None else error
    return isinstance(cause, (FileNotFoundError, KeyError, RuntimeError, ValueError))


def _report_database_failure(error: BaseException) -> None:
    """Emit an operator-safe message without connection details or broad string matching."""
    if _is_configuration_failure(error):
        print(
            "Database configuration is not ready; "
            "check ASSET_DB_PROFILE / runtime env (for example backend/.env.local).",
            file=sys.stderr,
        )
        return
    if isinstance(error, SystemDataSourceError):
        print(
            "Database schema is not initialized; run database migration first.",
            file=sys.stderr,
        )
        return
    if isinstance(error, SystemManagementError):
        print(str(error), file=sys.stderr)
        return
    print(
        f"Database is not ready; run database migration first ({type(error).__name__}).",
        file=sys.stderr,
    )


def main() -> int:
    try:
        _load_runtime()
    except Exception as error:  # noqa: BLE001 - CLI boundary; keep message operator-safe
        _report_database_failure(error)
        return 1

    username = input("Username: ").strip()
    display_name = input("Display name: ").strip()
    password = getpass.getpass("Password: ")
    confirmation = getpass.getpass("Confirm password: ")
    if password != confirmation:
        print("Password confirmation does not match.", file=sys.stderr)
        return 1
    try:
        created = system_management_service.create_bootstrap_admin(
            username, display_name, password
        )
    except SystemUserAlreadyExistsError:
        print(f"{username or 'admin'} already exists", file=sys.stderr)
        return 1
    except SystemManagementError as error:
        _report_database_failure(error)
        return 1
    except (FileNotFoundError, KeyError, RuntimeError, ValueError) as error:
        # Do not expose provider connection details or a traceback to first-time operators.
        _report_database_failure(error)
        return 1
    print(f"Admin user '{created}' created successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
