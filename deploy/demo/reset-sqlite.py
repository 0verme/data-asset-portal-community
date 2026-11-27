#!/usr/bin/env python3
"""Run the public_demo reset under the existing host reset/update flock."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
from contextlib import ExitStack, closing
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PROFILE = "public_demo"
LOCK_FD = 9  # Inherited from the host's reset-seed.sh.
SERVICE = "data-asset-portal"
SYSTEMCTL = "/usr/bin/systemctl"
SIDECARS = ("-wal", "-shm", "-journal")


class Refused(RuntimeError):
    """An error message that is safe to write to the reset log."""


def log(message):
    print(f"[{datetime.now().astimezone().isoformat(timespec='seconds')}] {message}", flush=True)


def canonical(path):
    if not path.is_absolute() or path != path.resolve(strict=True):
        raise Refused("a noncanonical path was supplied")
    return path


def file_identity(info):
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise Refused("a database, sidecar, or lock is not a singly linked regular file")
    return info.st_dev, info.st_ino


def database_identity(path):
    return file_identity(path.lstat())


def effective_target():
    """Use the application's runtime environment and DB resolver, without connecting."""
    from backend.app.settings import load_runtime_env

    inherited = dict(os.environ)
    try:
        if inherited.get("ASSET_DB_PROFILE", PROFILE).strip() != PROFILE:
            raise Refused("inherited database profile is not public_demo")
        load_runtime_env()
        from backend.app.db.facade import (
            DEFAULT_CONFIG_PATH,
            get_db_profile,
            resolve_db_profile_name,
        )

        if os.environ.get("ASSET_DB_PROFILE", "").strip() != PROFILE:
            raise Refused("effective database profile is not public_demo")
        resolve_db_profile_name()
        config = get_db_profile(PROFILE)
        if config["type"] != "sqlite":
            raise Refused("effective database provider is not SQLite")
        config_path = Path(os.environ.get("ASSET_DB_CONFIG_PATH") or DEFAULT_CONFIG_PATH)
        return config_path.resolve(strict=True), Path(config["database"])
    finally:
        os.environ.clear()
        os.environ.update(inherited)


def sidecars(path):
    found = []
    for suffix in SIDECARS:
        entry = path.with_name(path.name + suffix)
        try:
            database_identity(entry)
        except FileNotFoundError:
            continue
        found.append(entry)
    return found


def check_integrity(connection):
    if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
        raise Refused("SQLite integrity check failed")


def sqlite_backup(source, destination):
    deadline = time.monotonic() + 60

    def progress(*_):
        if time.monotonic() > deadline:
            raise Refused("SQLite backup timed out")

    with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as original:
        with closing(sqlite3.connect(destination)) as backup:
            original.backup(backup, pages=256, progress=progress)
            # A standalone copy must open without any WAL from the live DB.
            if backup.execute("PRAGMA journal_mode=DELETE").fetchone() != ("delete",):
                raise Refused("could not make the backup self-contained")
    verify_copy(destination)


def verify_copy(path):
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as reader:
        check_integrity(reader)
        if not reader.execute("SELECT 1 FROM sqlite_schema WHERE type='table' LIMIT 1").fetchone():
            raise Refused("SQLite backup has no tables")


def run_command(command, *, env=None):
    # Tool output may contain runtime paths, configuration values or credentials.
    subprocess.run(
        command, cwd=REPO, env=env, pass_fds=(LOCK_FD,),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True,
    )


def service_state():
    try:
        result = subprocess.run(
            [SYSTEMCTL, "is-active", SERVICE], pass_fds=(LOCK_FD,),
            capture_output=True, text=True, check=False,
        )
    except OSError:
        return "unknown"
    value = result.stdout.strip()
    return value if value in {"active", "inactive", "failed", "activating", "deactivating"} else "unknown"


def change_service(action, expected):
    run_command(["sudo", "-n", SYSTEMCTL, action, SERVICE])
    if service_state() != expected:
        raise Refused(f"service failed to reach {expected} state")
    log(f"SERVICE_STATE: {expected}")


def temporary_file(stack, directory, prefix):
    fd, name = tempfile.mkstemp(dir=directory, prefix=prefix)
    path = Path(name)
    stack.callback(path.unlink, missing_ok=True)
    stack.callback(os.close, fd)
    return path, fd


class Reset:
    def __init__(self, args):
        self.args = args
        self.stage = "preflight"
        self.stop_attempted = False
        self.replace_attempted = False
        self.backup = None

    def check_identity(self, identity):
        canonical(self.database)
        if database_identity(self.database) != identity:
            raise Refused("authorized database was replaced")

    def check_target(self, identity):
        self.check_identity(identity)
        if effective_target() != (self.config, self.database):
            raise Refused("effective SQLite target changed")
        self.check_identity(identity)
        return sidecars(self.database)

    def save_database(self, stack):
        self.check_target(self.original)
        temporary, fd = temporary_file(stack, self.backups, ".reset-backup-")
        sqlite_backup(self.database, temporary)
        self.check_target(self.original)
        os.fsync(fd)
        name = f"{self.database.name}.{datetime.now():%Y%m%dT%H%M%S.%f}"
        backup = self.backups / name
        temporary.rename(backup)
        directory = os.open(self.backups, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        self.backup = backup
        self.backup_identity = file_identity(os.fstat(fd))
        log("BACKUP: SQLite snapshot verified")

    def preserve_database_metadata(self, fd):
        replacement = os.fstat(fd)
        original = self.original_info
        if (replacement.st_uid, replacement.st_gid) != (original.st_uid, original.st_gid):
            os.fchown(fd, original.st_uid, original.st_gid)
        os.fchmod(fd, stat.S_IMODE(original.st_mode))

    def prepare_replacement(self, stack):
        replacement, fd = temporary_file(stack, self.database.parent, ".reset-new-")
        self.preserve_database_metadata(fd)
        self.replacement_identity = file_identity(os.fstat(fd))
        self.check_target(self.original)
        # Flush the old WAL through SQLite before swapping the main file. An
        # interrupted swap must never leave the old main without its commits.
        with closing(sqlite3.connect(self.database.as_uri() + "?mode=rw", uri=True)) as db:
            if db.execute("PRAGMA journal_mode=DELETE").fetchone() != ("delete",):
                raise Refused("could not close the live SQLite journal")
        if self.check_target(self.original):
            raise Refused("SQLite sidecars remained after stopping writes")
        self.replace_attempted = True
        replacement.replace(self.database)

    def rebuild(self):
        env = {
            **os.environ, "ASSET_DB_PROFILE": PROFILE,
            "ASSET_DB_CONFIG_PATH": str(self.config), "COMMUNITY_DEMO_BOOTSTRAP": "0",
        }
        self.stage = "schema-apply"
        self.check_target(self.replacement_identity)
        run_command([
            sys.executable, "backend/scripts/schema_migrate.py", "apply",
            "--profile", PROFILE, "--config", str(self.config),
        ], env=env)
        self.stage = "seed"
        self.check_target(self.replacement_identity)
        run_command([sys.executable, "demo/seed_sqlite.py", "--database", str(self.database)], env=env)
        self.stage = "restore-personal-overrides"
        self.check_target(self.replacement_identity)
        run_command([
            sys.executable, str(REPO / "deploy/demo/restore-personal-overrides.py"),
            "--overrides", str(self.args.overrides),
        ], env=env)
        self.check_target(self.replacement_identity)

    def recover(self, stack):
        if not self.stop_attempted:
            log("ROLLBACK: not needed")
            return
        try:
            identity = self.original
            if self.replace_attempted and database_identity(self.database) == self.replacement_identity:
                change_service("stop", "inactive")
                identity = self.restore_database(stack)
                log("ROLLBACK: database restored")
            else:
                log("ROLLBACK: database replacement not performed")
            self.check_target(identity)
        except Exception as exc:
            log(f"ROLLBACK: FAIL ({reason(exc)})")
            log(f"SERVICE_RECOVERY: {service_state()}")
            return
        try:
            if service_state() != "active":
                change_service("start", "active")
            log("SERVICE_RECOVERY: active")
        except Exception as exc:
            log(f"SERVICE_RECOVERY: FAIL ({reason(exc)}) state={service_state()}")

    def restore_database(self, stack):
        self.check_identity(self.replacement_identity)
        if database_identity(self.backup) != self.backup_identity:
            raise Refused("backup file was replaced")
        temporary, fd = temporary_file(stack, self.database.parent, ".reset-restore-")
        shutil.copyfile(self.backup, temporary)
        verify_copy(temporary)
        self.preserve_database_metadata(fd)
        os.fsync(fd)
        self.check_identity(self.replacement_identity)
        for entry in sidecars(self.database):
            entry.unlink()
        self.check_identity(self.replacement_identity)
        if sidecars(self.database):
            raise Refused("SQLite sidecars reappeared during rollback")
        temporary.replace(self.database)
        return file_identity(os.fstat(fd))

    def prune_backups(self):
        files = sorted(
            (file for file in self.backups.glob(self.database.name + ".[0-9]*")
             if file.is_file() and not file.is_symlink()),
            reverse=True,
        )
        for file in files[7:]:
            file.unlink()

    def run(self):
        with ExitStack() as stack:
            try:
                # Confirm the reset wrapper still owns the lock; never open a
                # different lock file or drop the descriptor in child processes.
                file_identity(os.fstat(LOCK_FD))
                fcntl.flock(LOCK_FD, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.database = canonical(self.args.authorized_database)
                self.backups = canonical(self.args.backup_dir)
                if not self.backups.is_dir() or not self.args.overrides.is_file():
                    raise Refused("backup directory or RAG override is missing")
                self.config, configured_target = effective_target()
                if configured_target != self.database:
                    raise Refused("effective SQLite file differs from the authorized target")
                fd = os.open(self.database, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                stack.callback(os.close, fd)
                self.original_info = os.fstat(fd)
                self.original = file_identity(self.original_info)
                self.check_target(self.original)
                version = json.loads((REPO / "demo/manifest.json").read_text())["version"]
                if type(version) is not int:
                    raise Refused("invalid seed version")
                log(f"SEED_VERSION: {version}")
                self.stage = "stop-service"
                self.stop_attempted = True
                change_service("stop", "inactive")
                self.stage = "backup"
                self.save_database(stack)
                self.stage = "replace-database"
                self.prepare_replacement(stack)
                self.rebuild()
                self.stage = "start-service"
                change_service("start", "active")
                self.stage = "smoke"
                run_command(self.args.smoke)
                if service_state() != "active":
                    raise Refused("service is not active after smoke checks")
            except Exception as exc:
                log(f"FAILURE: stage={self.stage} ({reason(exc)})")
                self.recover(stack)
                return 1

            try:
                self.prune_backups()
            except OSError:
                log("BACKUP_PRUNE: failed")
            return 0


def reason(exc):
    return str(exc) if isinstance(exc, Refused) else type(exc).__name__


def interrupted(signum, _frame):
    raise Refused(f"interrupted by signal {signum}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--authorized-database", required=True, type=Path)
    parser.add_argument("--backup-dir", required=True, type=Path)
    parser.add_argument("--overrides", required=True, type=Path)
    parser.add_argument("smoke", nargs="+", help="Existing host smoke-check command, after --")
    args = parser.parse_args()
    sys.path.insert(0, str(REPO))
    os.chdir(REPO)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, interrupted)
    log("RESET_START")
    reset = Reset(args)
    try:
        result = reset.run()
    except Exception as exc:
        log(f"FAILURE: stage={reset.stage} ({reason(exc)})")
        result = 1
    log("RESET_END: " + ("PASS" if result == 0 else "FAIL"))
    return result


if __name__ == "__main__":
    sys.exit(main())
