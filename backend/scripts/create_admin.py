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
        SystemManagementError,
        SystemUserAlreadyExistsError,
        system_management_service,
    )
except ModuleNotFoundError:
    from app.services.system_management_service import (  # noqa: E402
        SystemManagementError,
        SystemUserAlreadyExistsError,
        system_management_service,
    )


def main() -> int:
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
        message = str(error)
        if "数据库" in message or "database" in message.lower():
            print("Database schema is not initialized; run database migration first.", file=sys.stderr)
        else:
            print(message, file=sys.stderr)
        return 1
    except (FileNotFoundError, KeyError, RuntimeError) as error:
        # Do not expose provider connection details or a traceback to first-time operators.
        print(f"Database is not ready; run database migration first ({type(error).__name__}).", file=sys.stderr)
        return 1
    print(f"Admin user '{created}' created successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
