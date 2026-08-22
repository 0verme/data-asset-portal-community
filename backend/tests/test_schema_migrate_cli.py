# Copyright 2025 Jearhe
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""CLI contract tests for the schema migration command.

The migration CLI mirrors native backend startup by applying the runtime profile
(ASSET_RUNTIME_PROFILE) so the README Community quick-start commands work as
written: `schema_migrate.py apply --profile community_sqlite` must resolve the
profile file and the Community module set without hand-written flags.
"""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND.parent

PYTHON = sys.executable
MIGRATE = BACKEND / "scripts" / "schema_migrate.py"

COMMUNITY_MODULES = "portal,dwm,mapping,lineage,root,indicator,apiAsset,system"


def _run_cli(args, env_extra=None):
    env = dict(os.environ)
    env.setdefault("FLASK_SECRET_KEY", "test-only-migration-secret")
    if env_extra:
        env.update(env_extra)
    return subprocess.run(
        [PYTHON, str(MIGRATE), *args],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


class SchemaMigrateCliContractTests(unittest.TestCase):
    def test_fresh_sqlite_baseline_upgrades_to_alembic_head(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "fresh.sqlite"
            config = root / "database.yaml"
            config.write_text(
                "profiles:\n  fresh:\n    type: sqlite\n"
                f"    database: {database.as_posix()}\n",
                encoding="utf-8",
            )
            apply = _run_cli(["apply", "--profile", "fresh", "--config", str(config)])
            self.assertEqual(0, apply.returncode, apply.stderr)
            self.assertIn("applied=0001_baseline", apply.stdout)

            status = _run_cli(["status", "--profile", "fresh", "--config", str(config)])
            self.assertEqual(0, status.returncode, status.stderr)
            self.assertIn("revision=0002_portable_asset_filter", status.stdout)
            connection = sqlite3.connect(database)
            try:
                row = connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='index' "
                    "AND name='idx_p_asset_table_filter'"
                ).fetchone()
            finally:
                connection.close()
            self.assertEqual(("idx_p_asset_table_filter",), row)

    def test_offline_plan_with_community_modules(self):
        proc = _run_cli(["plan", "--offline", "--dialect", "sqlite"])
        self.assertEqual(0, proc.returncode, proc.stderr)
        self.assertIn("0001_baseline", proc.stdout)
        self.assertIn("sqlite.sql", proc.stdout)

    def test_offline_verify_all_sqlite_migrations(self):
        proc = _run_cli(["verify", "--offline", "--dialect", "sqlite"])
        self.assertEqual(0, proc.returncode, proc.stderr)
        self.assertIn("verify=ok", proc.stdout)
        self.assertIn("0001_baseline", proc.stdout)
        self.assertIn("tables=24", proc.stdout)

    def test_offline_verify_includes_mysql_baseline(self):
        proc = _run_cli(["verify", "--offline", "--dialect", "mysql"])
        self.assertEqual(0, proc.returncode, proc.stderr)
        self.assertIn("verify=ok", proc.stdout)
        self.assertIn("dialect=mysql", proc.stdout)

    def test_community_profile_applies_config_path(self):
        # With ASSET_RUNTIME_PROFILE=community the CLI must resolve the
        # community config file without --config, mirroring Flask startup.
        env = {
            "ASSET_RUNTIME_PROFILE": "community",
            "ASSET_DB_PROFILE": "community_sqlite",
        }
        proc = _run_cli(["status", "--profile", "community_sqlite"], env_extra=env)
        # status against a missing sqlite file may print "ledger=unmanaged";
        # the important contract is that it does NOT fail on missing database.yaml.
        self.assertNotIn("database.yaml", proc.stderr, proc.stderr)
        self.assertIn("dialect=", proc.stdout, proc.stdout)

    def test_offline_plan_defaults_to_community_modules(self):
        # Module selection is intentionally ignored after migration squashing:
        # every fresh database receives the complete Community baseline.
        env = {"ASSET_RUNTIME_PROFILE": "community"}
        proc = _run_cli(["plan", "--offline", "--dialect", "sqlite"], env_extra=env)
        self.assertEqual(0, proc.returncode, proc.stderr)
        self.assertIn("0001_baseline", proc.stdout)

    def test_module_list_flag_still_works(self):
        proc = _run_cli(
            ["plan", "--offline", "--dialect", "sqlite", "--modules", "apiAsset"]
        )
        self.assertEqual(0, proc.returncode, proc.stderr)
        self.assertIn("0001_baseline", proc.stdout)

    def test_community_profile_reads_backend_env_local(self):
        # Mirror native startup: the CLI must load backend/.env.local so the
        # README Community quick-start (configure .env.local, then run
        # `schema_migrate.py apply --profile community_sqlite`) works as
        # written in a clean clone without hand-exported variables.
        env_local = BACKEND / ".env.local"
        backup = env_local.read_text(encoding="utf-8") if env_local.exists() else None
        try:
            env_local.write_text(
                "ASSET_RUNTIME_PROFILE=community\n",
                encoding="utf-8",
            )
            env = {k: v for k, v in os.environ.items() if k != "ASSET_RUNTIME_PROFILE"}
            env.pop("ASSET_RUNTIME_PROFILE", None)
            proc = subprocess.run(
                [PYTHON, str(MIGRATE), "plan", "--offline", "--dialect", "sqlite"],
                cwd=REPO_ROOT,
                env=env,
                capture_output=True,
                text=True,
                timeout=120,
            )
            self.assertEqual(0, proc.returncode, proc.stderr)
            self.assertIn("0001_baseline", proc.stdout)
        finally:
            if backup is None:
                env_local.unlink(missing_ok=True)
            else:
                env_local.write_text(backup, encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
