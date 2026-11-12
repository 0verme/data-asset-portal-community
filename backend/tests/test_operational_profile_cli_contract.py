from __future__ import annotations

import os
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import yaml

from backend.scripts import imp_dws_comments, init_menu_data, seed_term_roots


class OperationalProfileCliTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        self.config_path = root / "database.yaml"
        profiles = {
            "app_test": {"type": "sqlite", "database": str(root / "app.sqlite")},
            "menu_test": {"type": "sqlite", "database": str(root / "menu.sqlite")},
            "primary": {"type": "sqlite", "database": str(root / "primary.sqlite")},
            "term_root_test": {
                "type": "postgres",
                "host": "127.0.0.1",
                "port": 5432,
                "database": "dap_term_root_test",
                "schema": "dwp",
                "user": "test_user",
                "password": "synthetic_test_password",
            },
        }
        self.config_path.write_text(
            yaml.safe_dump({"profiles": profiles}), encoding="utf-8"
        )

    def _environment(self, **values):
        environment = {"ASSET_DB_CONFIG_PATH": str(self.config_path)}
        environment.update(values)
        return patch.dict(os.environ, environment, clear=True)

    def test_menu_seed_defaults_to_validated_asset_profile(self):
        with self._environment(ASSET_DB_PROFILE="app_test"), patch(
            "app.navigation.persistence.seed_menus_for_profile",
            return_value=SimpleNamespace(inserted=2, total=11),
        ) as seed, redirect_stdout(StringIO()) as output:
            self.assertEqual(0, init_menu_data.main(["--config", str(self.config_path)]))
        seed.assert_called_once_with("app_test")
        self.assertIn("profile=app_test", output.getvalue())

    def test_menu_seed_keeps_explicit_cli_target(self):
        with self._environment(ASSET_DB_PROFILE="app_test"), patch(
            "app.navigation.persistence.seed_menus_for_profile",
            return_value=SimpleNamespace(inserted=0, total=11),
        ) as seed:
            self.assertEqual(
                0,
                init_menu_data.main(
                    ["--profile", "menu_test", "--config", str(self.config_path)]
                ),
            )
        seed.assert_called_once_with("menu_test")

    def test_menu_seed_never_falls_back_to_primary(self):
        with self._environment(), patch(
            "app.navigation.persistence.seed_menus_for_profile"
        ) as seed:
            with self.assertRaisesRegex(RuntimeError, "ASSET_DB_PROFILE"):
                init_menu_data.main(["--config", str(self.config_path)])
        seed.assert_not_called()

    def test_term_root_seed_uses_asset_profile_for_dry_run_only(self):
        expected_rows = seed_term_roots._seed_items()
        with self._environment(ASSET_DB_PROFILE="term_root_test"), patch.object(
            seed_term_roots, "_plan", return_value=(expected_rows, [], [])
        ), patch.object(seed_term_roots, "_apply") as apply, redirect_stdout(
            StringIO()
        ) as output:
            self.assertEqual(
                0,
                seed_term_roots.main(
                    ["--dry-run", "--config", str(self.config_path)]
                ),
            )
        self.assertIn("target=postgres:127.0.0.1/dap_term_root_test schema=dwp", output.getvalue())
        self.assertIn("action=dry-run", output.getvalue())
        apply.assert_not_called()

    def test_term_root_seed_never_falls_back_to_primary(self):
        with self._environment():
            with self.assertRaisesRegex(RuntimeError, "ASSET_DB_PROFILE"):
                seed_term_roots.main(["--dry-run", "--config", str(self.config_path)])

    def test_dws_import_keeps_explicit_source_profile(self):
        with self._environment(), patch.object(
            imp_dws_comments, "resolve_db_profile_name"
        ) as resolve:
            self.assertEqual(
                "external_source_test",
                imp_dws_comments.resolve_source_profile(" external_source_test "),
            )
        resolve.assert_not_called()

    def test_dws_import_default_requires_asset_profile_without_gauss_fallback(self):
        with self._environment():
            with self.assertRaisesRegex(RuntimeError, "ASSET_DB_PROFILE"):
                imp_dws_comments.resolve_source_profile(None)


if __name__ == "__main__":
    unittest.main()
