"""Opt-in consistent catalog capture; never changes normal DB defaults.

Only file-backed SQLite is proved here. Other providers MUST gain their own
isolation evidence before this boundary can be enabled for them.
"""

from __future__ import annotations

from contextlib import contextmanager
from math import ceil
from time import monotonic

from .facade import database_transaction, get_db_profile


class CatalogCaptureUnsupported(RuntimeError):
    pass


class CatalogCaptureTimeout(RuntimeError):
    pass


class CatalogCaptureLimit(RuntimeError):
    pass


@contextmanager
def catalog_read_transaction(profile: str, *, timeout_seconds: float):
    deadline = monotonic() + timeout_seconds
    config = get_db_profile(profile)
    if config["type"] != "sqlite" or config["database"] == ":memory:":
        raise CatalogCaptureUnsupported("CATALOG_CAPTURE_UNSUPPORTED")
    if not 0 < timeout_seconds <= 30:
        raise ValueError("capture timeout must be in (0, 30]")

    with database_transaction() as transaction:
        connection = transaction.connection_for(profile, config=config)
        raw = getattr(connection, "driver_connection", connection)
        query_only = raw.execute("PRAGMA query_only").fetchone()[0]
        busy_timeout = raw.execute("PRAGMA busy_timeout").fetchone()[0]
        if raw.in_transaction or raw.execute("PRAGMA read_uncommitted").fetchone()[0]:
            raise CatalogCaptureUnsupported("CATALOG_CAPTURE_UNSAFE_CONNECTION")
        try:
            raw.execute("PRAGMA query_only = ON")
            # Per-connection settings only. No WAL/DDL/init/default changes.
            remaining_ms = max(1, ceil((deadline - monotonic()) * 1000))
            raw.execute(f"PRAGMA busy_timeout = {remaining_ms:d}")
            raw.set_progress_handler(lambda: int(monotonic() >= deadline), 1000)
            # sqlite3 legacy SELECT transaction handling is not sufficient.
            # This explicit BEGIN fixes one read view at the first catalog read.
            raw.execute("BEGIN")
            yield deadline
            if monotonic() >= deadline:
                raise CatalogCaptureTimeout("CATALOG_CAPTURE_TIMEOUT")
        except Exception as error:
            if monotonic() >= deadline:
                raise CatalogCaptureTimeout("CATALOG_CAPTURE_TIMEOUT") from None
            raise error
        finally:
            raw.set_progress_handler(None, 0)
            # End the read view BEFORE restoring connection settings or pooling.
            raw.rollback()
            raw.execute(f"PRAGMA query_only = {int(query_only):d}")
            raw.execute(f"PRAGMA busy_timeout = {int(busy_timeout):d}")
