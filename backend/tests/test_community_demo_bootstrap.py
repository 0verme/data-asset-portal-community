from __future__ import annotations

import io
import importlib
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import call, patch

_demo = importlib.import_module("scripts.community_demo")
BootstrapError = _demo.BootstrapError
DemoPaths = _demo.DemoPaths
build_demo_environment = _demo.build_demo_environment
check_ports = _demo.check_ports
ensure_lineage_workspace = _demo.ensure_lineage_workspace
parse_args = _demo._parse_args
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
        self.assertEqual("development", environment["APP_ENV"])
        self.assertEqual("false", environment["APP_DEBUG"])
        self.assertEqual(
            "demo-secret-that-is-not-fixed-production-secret",
            environment["APP_SECRET_KEY"],
        )
        self.assertEqual("remote", environment["VITE_API_MODE"])
        self.assertEqual("unchanged", environment["KEEP_ME"])
        for key in (
            "DATABASE_URL",
            "PGHOST",
            "PGSERVICE",
            "MYSQL_HOST",
            "DB_HOST",
            "FLASK_ENV",
            "FLASK_DEBUG",
            "FLASK_SECRET_KEY",
            "FLASK_CORS_ORIGINS",
        ):
            self.assertNotIn(key, environment)

    def test_custom_ports_are_used_for_child_environment_urls(self):
        environment = build_demo_environment(
            {},
            self.paths,
            "demo-secret-that-is-not-fixed-production-secret",
            15099,
            15173,
        )

        self.assertEqual(
            "http://127.0.0.1:15173,http://localhost:15173",
            environment["APP_CORS_ORIGINS"],
        )
        self.assertEqual("http://127.0.0.1:15099", environment["VITE_BACKEND_URL"])

    def test_ports_are_parsed_with_defaults_and_range_validation(self):
        defaults = parse_args([])
        self.assertEqual(5099, defaults.backend_port)
        self.assertEqual(5173, defaults.frontend_port)

        custom = parse_args(["--backend-port", "15099", "--frontend-port", "15173"])
        self.assertEqual(15099, custom.backend_port)
        self.assertEqual(15173, custom.frontend_port)

        for invalid_port in ("0", "65536"):
            with self.subTest(invalid_port=invalid_port):
                with self.assertRaises(SystemExit) as error:
                    parse_args(["--backend-port", invalid_port])
                self.assertEqual(2, error.exception.code)

    def test_port_conflict_check_uses_requested_ports(self):
        checked_ports = []

        def port_is_open(port):
            checked_ports.append(port)
            return False

        with patch.object(_demo, "_port_is_open", side_effect=port_is_open):
            check_ports(15099, 15173)

        self.assertEqual([15099, 15173], checked_ports)

    def test_run_demo_uses_requested_ports_for_processes_and_readiness(self):
        backend_process = object()
        frontend_process = object()
        output = io.StringIO()

        with (
            redirect_stdout(output),
            patch.object(_demo, "check_ports") as check_ports_mock,
            patch.object(
                _demo.subprocess,
                "Popen",
                side_effect=[backend_process, frontend_process],
            ) as popen_mock,
            patch.object(_demo, "_wait_for_http") as wait_mock,
            patch.object(_demo, "_terminate_process") as terminate_mock,
            patch.object(_demo.time, "sleep", side_effect=KeyboardInterrupt),
        ):
            _demo.run_demo(
                self.paths,
                {},
                Path("python"),
                15099,
                15173,
            )

        check_ports_mock.assert_called_once_with(15099, 15173)
        backend_command = popen_mock.call_args_list[0].args[0]
        frontend_command = popen_mock.call_args_list[1].args[0]
        self.assertEqual("15099", backend_command[-1])
        self.assertEqual("15173", frontend_command[-2])
        self.assertIn("Demo administrator:", output.getvalue())
        self.assertIn("Username: admin", output.getvalue())
        self.assertIn("Password: 12346", output.getvalue())
        wait_mock.assert_any_call(
            "http://127.0.0.1:15099/healthz", backend_process, "Backend"
        )
        wait_mock.assert_any_call(
            "http://127.0.0.1:15173/", frontend_process, "Frontend"
        )
        terminate_mock.assert_has_calls(
            [call(frontend_process, "frontend"), call(backend_process, "backend")]
        )

    def test_init_only_prints_demo_admin_credentials(self):
        output = io.StringIO()
        with (
            redirect_stdout(output),
            patch.object(
                _demo,
                "initialize_demo",
                return_value=({}, Path("python")),
            ),
        ):
            result = _demo.main(["--init-only"])

        self.assertEqual(0, result)
        self.assertIn("Demo administrator:", output.getvalue())
        self.assertIn("Username: admin", output.getvalue())
        self.assertIn("Password: 12346", output.getvalue())

    def test_missing_lineage_entries_trigger_one_idempotent_workspace_build(self):
        commands = []

        def fake_run(command, *, cwd, environment, label):
            commands.append((command, cwd, environment, label))
            for relative_path in _demo.LINEAGE_WORKSPACE_ENTRYPOINTS:
                entry = self.paths.root / "frontend" / relative_path
                entry.parent.mkdir(parents=True, exist_ok=True)
                entry.write_text("built", encoding="utf-8")

        with patch.object(_demo, "_run", side_effect=fake_run):
            ensure_lineage_workspace(self.paths, "npm")
            ensure_lineage_workspace(self.paths, "npm")

        self.assertEqual(1, len(commands))
        command, cwd, environment, label = commands[0]
        self.assertEqual(["npm", "run", "build:lineage"], command)
        self.assertEqual(self.paths.root / "frontend", cwd)
        self.assertEqual("development", environment["NODE_ENV"])
        self.assertEqual("Build lineage workspace packages", label)

    def test_non_demo_lineage_profile_still_selects_persistent_storage(self):
        lineage_service = importlib.import_module(
            "backend.app.services.lineage_service"
        )

        with patch.dict(
            os.environ,
            {
                "APP_ENV": "production",
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
            {"APP_ENV": "production", "LINEAGE_DB_PROFILE": ""},
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
