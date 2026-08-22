from __future__ import annotations

import importlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_demo = importlib.import_module("scripts.community_demo")
BootstrapError = _demo.BootstrapError
DemoPaths = _demo.DemoPaths
build_demo_environment = _demo.build_demo_environment
prepare_demo_runtime = _demo.prepare_demo_runtime


class CommunityDemoBootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="community demo path ")
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.paths = DemoPaths.for_root(self.root)

    def test_generated_runtime_is_stable_and_secret_is_reused(self):
        first_secret = prepare_demo_runtime(self.paths)
        first_config = self.paths.database_config.read_text(encoding="utf-8")
        second_secret = prepare_demo_runtime(self.paths)

        self.assertEqual(first_secret, second_secret)
        self.assertEqual(
            first_config, self.paths.database_config.read_text(encoding="utf-8")
        )
        self.assertIn("type: sqlite", first_config)
        self.assertIn("community_sqlite:", first_config)
        self.assertGreaterEqual(len(first_secret), 48)
        self.assertNotIn(
            first_secret, self.paths.database_config.read_text(encoding="utf-8")
        )
        self.assertFalse((self.paths.runtime / "frontend.env").exists())

    def test_redirected_database_path_is_rejected(self):
        outside_database = self.root / "user.sqlite"
        outside_database.write_text("user data", encoding="utf-8")
        try:
            self.paths.database.symlink_to(outside_database)
        except (OSError, NotImplementedError) as error:
            self.skipTest(f"symlinks unavailable on this platform: {error}")

        with self.assertRaises(BootstrapError):
            prepare_demo_runtime(self.paths)
        self.assertEqual("user data", outside_database.read_text(encoding="utf-8"))

    def test_existing_user_config_is_not_touched(self):
        user_config = self.root / "backend" / ".env.local"
        user_config.parent.mkdir(parents=True)
        original = (
            "ASSET_DB_PROFILE=primary\nDATABASE_URL=postgresql://example.invalid/test\n"
        )
        user_config.write_text(original, encoding="utf-8")

        prepare_demo_runtime(self.paths)

        self.assertEqual(original, user_config.read_text(encoding="utf-8"))

    def test_external_database_environment_cannot_redirect_demo(self):
        environment = build_demo_environment(
            {
                "LINEAGE_DB_PROFILE": "production_lineage",
                "DATABASE_URL": "postgresql://example.invalid/test",
                "PGHOST": "example.invalid",
                "PGSERVICE": "production",
                "MYSQL_HOST": "example.invalid",
                "DB_HOST": "example.invalid",
                "ASSET_DB_PROFILE": "primary",
                "ASSET_DB_DATABASE": "production",
                "VITE_API_MODE": "mock",
                "KEEP_ME": "unchanged",
            },
            self.paths,
            "demo-secret-that-is-not-fixed-production-secret",
        )

        self.assertEqual("sqlite", environment["ASSET_DB_TYPE"])
        self.assertEqual("community_sqlite", environment["ASSET_DB_PROFILE"])
        self.assertEqual(
            str(self.paths.database.resolve()), environment["ASSET_DB_DATABASE"]
        )
        self.assertEqual("community_sqlite", environment["ASSET_AUTH_DB_PROFILE"])
        self.assertNotIn("BACKEND_RUNTIME", environment)
        self.assertEqual("community_sqlite", environment["LINEAGE_DB_PROFILE"])
        self.assertEqual("remote", environment["VITE_API_MODE"])
        self.assertEqual("unchanged", environment["KEEP_ME"])
        for key in ("DATABASE_URL", "PGHOST", "PGSERVICE", "MYSQL_HOST", "DB_HOST"):
            self.assertNotIn(key, environment)

    def test_non_demo_lineage_profile_still_selects_persistent_storage(self):
        lineage_service = importlib.import_module(
            "backend.app.services.lineage_service"
        )

        with patch.dict(
            os.environ,
            {
                "FLASK_ENV": "production",
                "LINEAGE_DB_PROFILE": "production_lineage",
            },
            clear=False,
        ):
            self.assertEqual(
                {
                    "mode": "persistent",
                    "profile": "production_lineage",
                    "schema": "dwp",
                },
                lineage_service.lineage_storage_status(),
            )

    def test_production_without_storage_profile_is_explicitly_unavailable(self):
        lineage_service = importlib.import_module(
            "backend.app.services.lineage_service"
        )
        with patch.dict(
            os.environ,
            {"FLASK_ENV": "production", "LINEAGE_DB_PROFILE": ""},
            clear=False,
        ), self.assertRaises(lineage_service.LineageConfigurationError):
            lineage_service.lineage_storage_status()

    def test_load_runtime_env_can_preserve_process_owned_values(self):
        settings = importlib.import_module("backend.app.settings")

        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env.local"
            env_file.write_text("ASSET_DB_PROFILE=primary\n", encoding="utf-8")
            with (
                patch.object(settings, "_ENV_FILES", (env_file,)),
                patch.dict(
                    os.environ, {"ASSET_DB_PROFILE": "community_sqlite"}, clear=False
                ),
            ):
                settings.load_runtime_env(overwrite=False)
                self.assertEqual("community_sqlite", os.environ["ASSET_DB_PROFILE"])
                settings.load_runtime_env(overwrite=True)
                self.assertEqual("primary", os.environ["ASSET_DB_PROFILE"])


if __name__ == "__main__":
    unittest.main()
