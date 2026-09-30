from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import yaml

from backend.app.db.core import _schema_translate_map
from backend.app.db.facade import get_db_profile, normalize_sql_for_profile
from backend.app.db.providers import GaussDBProvider
from backend.app.migrations.schema import _prefix

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = ROOT / "backend/configs/database.example.yaml"


class DatabaseExampleConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="database-example-")
        self.addCleanup(self.temp_dir.cleanup)
        self.repository = Path(self.temp_dir.name) / "repo"
        self.backend = self.repository / "backend"
        self.config_path = self.backend / "configs" / "database.yaml"
        self.config_path.parent.mkdir(parents=True)
        shutil.copyfile(TEMPLATE, self.config_path)
        self.jar_path = self.backend / "resources" / "jars" / "gaussdb200.jar"
        self.jar_path.parent.mkdir(parents=True)
        self.jar_path.touch()

    @contextmanager
    def configured_runtime(self, extra_env=None):
        environment = {
            "ASSET_DB_CONFIG_PATH": str(self.config_path),
            "ASSET_DB_PROFILE": "gauss_primary",
            "ASSET_DB_JAR_PATH": "",
        }
        environment.update(extra_env or {})
        with (
            patch.dict(os.environ, environment),
            patch("backend.app.db.facade.CONFIG_PATH", self.config_path),
            patch("backend.app.db.facade.get_db_profile_overrides", return_value={}),
        ):
            yield

    def test_template_keeps_gaussdb_options_profile_scoped(self):
        template = yaml.safe_load(TEMPLATE.read_text(encoding="utf-8"))
        defaults = template["defaults"]
        profiles = template["profiles"]

        self.assertNotIn("type", defaults)
        for key in ("driver", "jar_path", "socket_timeout"):
            self.assertNotIn(key, defaults)
            self.assertNotIn(key, profiles["primary"])
            self.assertNotIn(key, profiles["mysql_primary"])
        self.assertTrue(all(profile.get("type") for profile in profiles.values()))
        self.assertEqual(
            "resources/jars/gaussdb200.jar", profiles["gauss_primary"]["jar_path"]
        )
        self.assertEqual(
            "com.huawei.gauss200.jdbc.Driver", profiles["gauss_primary"]["driver"]
        )
        self.assertEqual(120, profiles["gauss_primary"]["socket_timeout"])
        self.assertEqual("dwp", profiles["gauss_primary"]["schema"])
        self.assertIn("currentSchema=dwp", profiles["gauss_primary"]["jdbc_url"])

        env_example = (ROOT / "backend/.env.example").read_text(encoding="utf-8")
        self.assertRegex(env_example, r"(?m)^ASSET_DB_PROFILE=primary$")
        self.assertIn("Examples: primary / mysql_primary / gauss_primary", env_example)

    def test_relative_jar_path_resolves_from_config_location_not_process_cwd(self):
        original_cwd = Path.cwd()
        try:
            for cwd in (self.repository, self.backend):
                with self.subTest(cwd=cwd):
                    os.chdir(cwd)
                    with self.configured_runtime():
                        profile = get_db_profile("gauss_primary")
                    self.assertEqual(self.jar_path.resolve(), Path(profile["jar_path"]))
        finally:
            os.chdir(original_cwd)

    def test_environment_jar_path_overrides_yaml_profile_path(self):
        override = self.backend / "external-driver.jar"
        override.touch()
        with self.configured_runtime({"ASSET_DB_JAR_PATH": str(override)}):
            profile = get_db_profile("gauss_primary")
        self.assertEqual(override.resolve(), Path(profile["jar_path"]))

    def test_gauss_schema_drives_physical_schema_sql_and_migration_prefix(self):
        with self.configured_runtime():
            profile = get_db_profile("gauss_primary")
            self.assertEqual("dwp", profile["schema"])
            self.assertEqual("dwp", GaussDBProvider().physical_schema(profile))
            self.assertEqual({"__app__": "dwp"}, _schema_translate_map(profile))
            self.assertIn(
                "dwp.assets",
                normalize_sql_for_profile(
                    "gauss_primary", "SELECT * FROM __app__.assets"
                ),
            )
        self.assertEqual("dwp.", _prefix(profile))


if __name__ == "__main__":
    unittest.main()
