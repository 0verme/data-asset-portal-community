"""Reset integration with disposable SQLite files and simulated service control."""

from __future__ import annotations

import argparse
import fcntl
import io
import json
import os
import runpy
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from backend.app import settings
from demo.seed_loader import community_seed_plan

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "deploy/demo/reset-sqlite.py"
RESET = runpy.run_path(str(SCRIPT))
GLOBALS = RESET["Reset"].run.__globals__


class DemoResetTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        self.database = self.root / "demo.sqlite"
        self.other = self.root / "other.sqlite"
        for path in (self.database, self.other):
            with closing(sqlite3.connect(path)) as db:
                db.execute("CREATE TABLE before_reset (value TEXT)")
                db.execute("INSERT INTO before_reset VALUES (?)", (path.stem,))
                db.commit()
        self.backups = self.root / "backups"
        self.backups.mkdir()
        self.config = self.root / "database.yaml"
        self.write_profile(self.database)
        self.overrides = self.root / "personal-overrides.json"
        self.override = {
            "enabled": True, "serviceUrl": "http://localhost:18081",
            "strategy": "hybrid", "topK": 5, "timeoutMs": 2000,
        }
        self.overrides.write_text(json.dumps({"rag": self.override}))
        self.secret = "fixture-only-rag-credential"
        self.enterContext(patch.dict(os.environ, {
            "PATH": os.environ.get("PATH", os.defpath),
            "ASSET_DB_CONFIG_PATH": str(self.config),
            "ASSET_DB_PROFILE": "public_demo",
            "RAG_SEARCH_SERVICE_TOKEN": self.secret,
        }, clear=True))
        self.enterContext(patch.object(settings, "_ENV_FILES", ()))
        self.lock_path = self.root / "shared.lock"
        self.lock = self.enterContext(self.lock_path.open("w"))
        self.enterContext(patch.dict(GLOBALS, {
            "LOCK_FD": self.lock.fileno(),
            "service_state": lambda: self.state,
            "run_command": self.run_command,
        }))
        self.real_command = RESET["run_command"]
        self.commands = []
        self.state = "active"
        self.args = argparse.Namespace(
            authorized_database=self.database, backup_dir=self.backups,
            overrides=self.overrides, smoke=["smoke"],
        )

    def write_profile(self, database, provider="sqlite"):
        self.config.write_text(json.dumps({
            "defaults": {"type": "sqlite", "database": str(self.database)},
            "profiles": {"public_demo": {"type": provider, "database": str(database)}},
        }))

    def run_command(self, command, *, env=None):
        if command[0] == "sudo":
            action = command[-2]
            self.commands.append(action)
            self.state = {"stop": "inactive", "start": "active"}[action]
        elif command == ["smoke"]:
            self.commands.append("smoke")
        else:
            self.commands.append(Path(command[1]).name)
            # Migration, seed and RAG restoration run as actual subprocesses.
            self.real_command(command, env=env)

    def reset(self, expected):
        output = io.StringIO()
        with redirect_stdout(output):
            result = RESET["Reset"](self.args).run()
        logs = output.getvalue()
        self.assertNotIn(self.secret, logs)
        self.assertNotIn(str(self.root), logs)
        self.assertEqual(result, expected, logs)
        return logs

    def assert_refused_without_writes(self, message):
        before = [(self.database, self.database.read_bytes()), (self.other, self.other.read_bytes())]
        self.assertIn(message, self.reset(1))
        self.assertEqual(self.commands, [])
        self.assertEqual(list(self.backups.iterdir()), [])
        for path, content in before:
            self.assertEqual(path.read_bytes(), content)

    def test_rejects_wrong_profile_provider_target_and_aliases(self):
        with patch.dict(os.environ, {"ASSET_DB_PROFILE": "another"}):
            self.assert_refused_without_writes("profile is not public_demo")
        self.write_profile(self.database, "postgres")
        # A valid Postgres profile may have the same database string as SQLite.
        data = json.loads(self.config.read_text())
        data["defaults"].update(host="localhost", user="fixture", password="fixture", schema="dwp")
        self.config.write_text(json.dumps(data))
        self.assert_refused_without_writes("provider is not SQLite")
        self.write_profile(self.other)
        self.assert_refused_without_writes("differs from the authorized target")
        alias = self.root / "alias.sqlite"
        alias.symlink_to(self.database)
        self.write_profile(alias)
        self.assert_refused_without_writes("differs from the authorized target")
        self.args.authorized_database = alias
        self.assert_refused_without_writes("noncanonical")
        self.args.authorized_database = self.database
        self.write_profile(self.database)
        alias.unlink()
        alias.hardlink_to(self.database)
        self.assert_refused_without_writes("singly linked")

    def test_requires_explicit_authorization_and_existing_flock(self):
        before = self.database.read_bytes()
        command = [sys.executable, str(SCRIPT), "--backup-dir", str(self.backups),
                   "--overrides", str(self.overrides), "--", "/usr/bin/false"]
        result = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 2)
        self.assertIn("--authorized-database", result.stderr)
        result = subprocess.run(command[:2] + ["--authorized-database", str(self.database)] + command[2:],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        self.assertIn("FAILURE: stage=preflight", result.stdout)
        self.assertEqual(self.database.read_bytes(), before)
        self.assertEqual(list(self.backups.iterdir()), [])

    def leave_wal(self, query, value):
        # Simulate a process exit before SQLite can run its last-close checkpoint.
        subprocess.run([sys.executable, "-c", """
import os, sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute("PRAGMA journal_mode=WAL")
db.execute("PRAGMA wal_autocheckpoint=0")
db.execute(sys.argv[2], (sys.argv[3],))
db.commit()
os._exit(0)
""", str(self.database), query, value], check=True, timeout=10)
        self.assertTrue(self.database.with_suffix(".sqlite-wal").is_file())

    def snapshot_seed(self):
        plan = community_seed_plan()
        with closing(sqlite3.connect(self.database)) as db:
            rows = {}
            for table in ("p_asset_table", "p_asset_field", "p_indicator_item"):
                columns = ", ".join(plan[table]["columns"])
                rows[table] = db.execute(f"SELECT {columns} FROM {table} ORDER BY 1").fetchall()
                self.assertEqual(rows[table], sorted(map(tuple, plan[table]["rows"])))
            rag, = db.execute("SELECT ext_json FROM p_code_item WHERE category_code=?",
                              ("RAG_SEARCH_CONFIG",)).fetchone()
            self.assertEqual(json.loads(rag), self.override)
            self.assertNotIn(self.secret, rag)
        return rows

    def test_wal_backup_and_two_resets_keep_seed_and_rag_stable(self):
        self.leave_wal("INSERT INTO before_reset VALUES (?)", "committed only in WAL")
        with closing(sqlite3.connect(self.database.as_uri() + "?immutable=1", uri=True)) as db:
            self.assertEqual(db.execute("SELECT value FROM before_reset").fetchall(), [("demo",)])
        for index in range(8):
            name = f"{self.database.name}.20000101T00000{index}"
            (self.backups / name).touch()
        self.assertIn("BACKUP: SQLite snapshot verified", self.reset(0))
        first = self.snapshot_seed()
        saved = sorted(self.backups.iterdir())[-1]
        with closing(sqlite3.connect(saved.as_uri() + "?immutable=1", uri=True)) as db:
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone(), ("ok",))
            self.assertEqual(db.execute("SELECT value FROM before_reset ORDER BY rowid").fetchall(),
                             [("demo",), ("committed only in WAL",)])
        self.assertEqual(len(list(self.backups.iterdir())), 7)
        self.reset(0)
        self.assertEqual(self.snapshot_seed(), first)
        self.assertEqual(len(list(self.backups.iterdir())), 7)
        self.assertEqual(self.commands.count("smoke"), 2)

    def test_backup_and_integrity_failures_do_not_rebuild(self):
        before = self.database.read_bytes()
        def fail_backup(*_):
            raise OSError("injected backup I/O failure")

        with patch.dict(GLOBALS, {"sqlite_backup": fail_backup}):
            self.assertIn("stage=backup", self.reset(1))
        self.assertEqual(self.commands, ["stop", "start"])
        self.assertEqual(self.database.read_bytes(), before)
        self.assertEqual(list(self.backups.iterdir()), [])

        self.commands.clear()
        corrupt = b"corrupt SQLite fixture"
        self.database.write_bytes(corrupt)
        self.assertIn("stage=backup", self.reset(1))
        self.assertEqual(self.commands, ["stop", "start"])
        self.assertEqual(self.database.read_bytes(), corrupt)
        self.assertEqual(list(self.backups.iterdir()), [])

    def test_replacement_during_backup_refuses_to_touch_either_file(self):
        before, other = self.database.read_bytes(), self.other.read_bytes()
        original = self.root / "moved.sqlite"
        backup = RESET["sqlite_backup"]

        def replace_after_copy(source, destination):
            backup(source, destination)
            source.rename(original)
            self.other.rename(source)

        with patch.dict(GLOBALS, {"sqlite_backup": replace_after_copy}):
            self.assertIn("authorized database was replaced", self.reset(1))
        self.assertEqual(self.commands, ["stop"])
        self.assertEqual(self.database.read_bytes(), other)
        self.assertEqual(original.read_bytes(), before)
        self.assertEqual(list(self.backups.iterdir()), [])

    def test_smoke_failure_restores_snapshot_without_new_sidecars(self):
        self.leave_wal("INSERT INTO before_reset VALUES (?)", "previous WAL row")

        def fail_smoke(command, *, env=None):
            if command == ["smoke"]:
                self.leave_wal("UPDATE p_asset_table SET table_name=? WHERE rowid=1", "new WAL row")
                raise subprocess.CalledProcessError(1, command)
            self.run_command(command, env=env)

        with patch.dict(GLOBALS, {"run_command": fail_smoke}):
            logs = self.reset(1)
        self.assertIn("FAILURE: stage=smoke", logs)
        self.assertIn("ROLLBACK: database restored", logs)
        self.assertIn("SERVICE_RECOVERY: active", logs)
        for suffix in ("-wal", "-shm", "-journal"):
            self.assertFalse(Path(str(self.database) + suffix).exists())
        with closing(sqlite3.connect(self.database)) as db:
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone(), ("ok",))
            self.assertEqual(db.execute("SELECT value FROM before_reset ORDER BY rowid").fetchall(),
                             [("demo",), ("previous WAL row",)])

    def test_failed_service_stop_is_reported_and_preserves_database(self):
        before = self.database.read_bytes()
        with patch.dict(GLOBALS, {"run_command": lambda *args, **kw: None}):
            logs = self.reset(1)
        self.assertIn("stage=stop-service", logs)
        self.assertIn("SERVICE_RECOVERY: active", logs)
        self.assertEqual(self.database.read_bytes(), before)
        self.assertEqual(list(self.backups.iterdir()), [])

    def test_shared_flock_contention_and_release_after_abnormal_exit(self):
        with subprocess.Popen([sys.executable, "-c", """
import fcntl, sys
with open(sys.argv[1], "r+") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    print("held", flush=True)
    sys.stdin.read()
""", str(self.lock_path)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True) as update:
            try:
                self.assertEqual(update.stdout.readline(), "held\n")
                self.assert_refused_without_writes("stage=preflight")
            finally:
                update.kill()
                update.wait(timeout=10)
        fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.assertIn("BACKUP: SQLite snapshot verified", self.reset(0))
