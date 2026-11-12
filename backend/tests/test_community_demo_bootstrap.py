from __future__ import annotations

import io
import importlib
import os
import sqlite3
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
verify_demo_database = _demo.verify_demo_database


class CommunityDemoBootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="community demo path ")
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.paths = DemoPaths.for_root(self.root)

    def test_demo_verifier_allows_only_inactive_migration_owned_config_rows(self):
        from backend.app.ai_llm_quota_contract import (
            AI_LLM_DAILY_LIMIT_CODE,
            AI_LLM_QUOTA_CATEGORY_CODE,
            AI_LLM_QUOTA_CATEGORY_NAME,
            AI_LLM_QUOTA_ITEM_NAME,
            DEFAULT_AI_LLM_DAILY_LIMIT,
        )
        from backend.app.migrations.rag_search_config_seed import (
            RAG_CONFIG_CATEGORY_CODE,
            RAG_CONFIG_CATEGORY_NAME,
            RAG_CONFIG_DEFAULT_JSON,
            RAG_CONFIG_ITEM_CODE,
            RAG_CONFIG_ITEM_NAME,
        )

        database = self.root / "demo.sqlite"
        tables = (
            "p_menu",
            "p_asset_table",
            "p_upstream_system",
            "p_push_system",
            "p_report_asset",
            "p_lineage_node",
        )
        plan = {table: {"rows": []} for table in tables}
        plan.update({
            "p_code_category": {"rows": [{"category_code": "DEMO"}]},
            "p_code_item": {"rows": [{"category_code": "DEMO"}]},
        })
        with sqlite3.connect(database) as connection:
            for table in tables:
                connection.execute(f"CREATE TABLE {table} (id INTEGER)")
            connection.execute(
                "CREATE TABLE p_code_category "
                "(category_code TEXT, category_name TEXT, is_active TEXT)"
            )
            connection.executemany(
                "INSERT INTO p_code_category VALUES (?, ?, ?)",
                [
                    ("DEMO", "Demo category", "Y"),
                    (RAG_CONFIG_CATEGORY_CODE, RAG_CONFIG_CATEGORY_NAME, "N"),
                    (AI_LLM_QUOTA_CATEGORY_CODE, AI_LLM_QUOTA_CATEGORY_NAME, "N"),
                ],
            )
            connection.execute(
                "CREATE TABLE p_code_item "
                "(category_code TEXT, item_code TEXT, item_name TEXT, "
                "item_value TEXT, ext_json TEXT, is_active TEXT)"
            )
            connection.executemany(
                "INSERT INTO p_code_item VALUES (?, ?, ?, ?, ?, ?)",
                [
                    ("DEMO", "DEFAULT", "Demo item", "demo", "{}", "Y"),
                    (
                        RAG_CONFIG_CATEGORY_CODE,
                        RAG_CONFIG_ITEM_CODE,
                        RAG_CONFIG_ITEM_NAME,
                        "reserved-rag-config",
                        RAG_CONFIG_DEFAULT_JSON,
                        "N",
                    ),
                    (
                        AI_LLM_QUOTA_CATEGORY_CODE,
                        AI_LLM_DAILY_LIMIT_CODE,
                        AI_LLM_QUOTA_ITEM_NAME,
                        str(DEFAULT_AI_LLM_DAILY_LIMIT),
                        None,
                        "N",
                    ),
                ],
            )
            connection.execute("CREATE TABLE p_admin_user (username TEXT)")
            connection.execute("INSERT INTO p_admin_user VALUES ('admin')")

        with (
            patch("demo.seed_loader.community_seed_plan", return_value=plan),
            patch("demo.seed_loader.ADMIN_USER", {"username": "admin"}),
        ):
            counts = verify_demo_database(database)
            self.assertEqual(3, counts["p_code_category"])
            self.assertEqual(3, counts["p_code_item"])
            with sqlite3.connect(database) as connection:
                connection.execute(
                    "UPDATE p_code_item SET item_value = '75' "
                    "WHERE category_code = ? AND item_code = ?",
                    (AI_LLM_QUOTA_CATEGORY_CODE, AI_LLM_DAILY_LIMIT_CODE),
                )
            verify_demo_database(database)
            with sqlite3.connect(database) as connection:
                connection.execute(
                    "UPDATE p_code_item SET item_value = '0' "
                    "WHERE category_code = ? AND item_code = ?",
                    (AI_LLM_QUOTA_CATEGORY_CODE, AI_LLM_DAILY_LIMIT_CODE),
                )
            with self.assertRaises(BootstrapError):
                verify_demo_database(database)
            with sqlite3.connect(database) as connection:
                connection.execute(
                    "UPDATE p_code_item SET item_value = ? "
                    "WHERE category_code = ? AND item_code = ?",
                    (
                        str(DEFAULT_AI_LLM_DAILY_LIMIT),
                        AI_LLM_QUOTA_CATEGORY_CODE,
                        AI_LLM_DAILY_LIMIT_CODE,
                    ),
                )
                connection.execute(
                    "UPDATE p_code_category SET is_active = 'Y' "
                    "WHERE category_code = ?",
                    (AI_LLM_QUOTA_CATEGORY_CODE,),
                )
            with self.assertRaises(BootstrapError):
                verify_demo_database(database)
            with sqlite3.connect(database) as connection:
                connection.execute(
                    "UPDATE p_code_category SET is_active = 'N' "
                    "WHERE category_code = ?",
                    (AI_LLM_QUOTA_CATEGORY_CODE,),
                )
                connection.execute(
                    "UPDATE p_code_category SET is_active = 'Y' "
                    "WHERE category_code = ?",
                    (RAG_CONFIG_CATEGORY_CODE,),
                )
            with self.assertRaises(BootstrapError):
                verify_demo_database(database)

    def test_quota_seed_accepts_legacy_hidden_label_without_touching_admin_value(self):
        from backend.app.ai_llm_quota_contract import (
            AI_LLM_DAILY_LIMIT_CODE,
            AI_LLM_QUOTA_CATEGORY_CODE,
            AI_LLM_QUOTA_CATEGORY_NAME,
        )
        from backend.app.migrations.ai_llm_quota_seed import plan_ai_llm_quota_seed

        plan = plan_ai_llm_quota_seed(
            [{
                "category_code": AI_LLM_QUOTA_CATEGORY_CODE,
                "category_name": AI_LLM_QUOTA_CATEGORY_NAME,
                "is_active": "N",
            }],
            [{
                "category_code": AI_LLM_QUOTA_CATEGORY_CODE,
                "item_code": AI_LLM_DAILY_LIMIT_CODE,
                "item_name": "每日 LLM 调用上限",
                "item_value": "73",
                "is_active": "N",
            }],
        )

        self.assertTrue(plan.safe, plan.error)
        self.assertEqual((), plan.categories)
        self.assertEqual((), plan.items)

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
        self.paths.database.parent.mkdir(parents=True, exist_ok=True)
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
                "DATABASE_PASSWORD": "synthetic-not-a-real-secret",
                "PGPASSFILE": "/synthetic/pgpass",
                "POSTGRES_PASSWORD": "synthetic-not-a-real-secret",
                "MYSQL_PWD": "synthetic-not-a-real-secret",
                "ASSET_DB_PROFILE": "primary",
                "ASSET_AUTH_DB_PROFILE": "production_auth",
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
        self.assertNotIn("ASSET_AUTH_DB_PROFILE", environment)
        self.assertNotIn("BACKEND_RUNTIME", environment)
        # Deprecated lineage selectors must never survive into the demo child env.
        self.assertNotIn("LINEAGE_DB_PROFILE", environment)
        self.assertNotIn("LINEAGE_STORAGE_MODE", environment)
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
            "DATABASE_PASSWORD",
            "PGPASSFILE",
            "POSTGRES_PASSWORD",
            "MYSQL_PWD",
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
        self.assertEqual(15099, defaults.backend_port)
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
        self.assertIn("Password: 123456", output.getvalue())
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
        self.assertIn("Password: 123456", output.getvalue())

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

        with (
            patch.dict(
                os.environ,
                {
                    "APP_ENV": "production",
                    "ASSET_DB_PROFILE": "production_dap",
                },
                clear=False,
            ),
            patch(
                "backend.app.db.facade.get_db_profile",
                return_value={"type": "gaussdb", "schema": "dap"},
            ),
            patch.object(
                lineage_service,
                "get_db_profile",
                return_value={"type": "gaussdb", "schema": "dap"},
            ),
        ):
            self.assertEqual(
                {
                    "mode": "persistent",
                    "profile": "production_dap",
                    "schema": "dap",
                },
                lineage_service.lineage_storage_status(),
            )

    def test_production_without_storage_profile_is_explicitly_unavailable(self):
        lineage_service = importlib.import_module(
            "backend.app.services.lineage_service"
        )
        with patch.dict(
            os.environ,
            {"APP_ENV": "production", "ASSET_DB_PROFILE": ""},
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

    def test_demo_bootstrap_ignores_external_database_settings_from_env_files(self):
        settings = importlib.import_module("backend.app.settings")

        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env.local"
            env_file.write_text(
                "ASSET_DB_PROFILE=primary\n"
                "ASSET_AUTH_DB_PROFILE=production_auth\n"
                "LINEAGE_DB_PROFILE=production_lineage\n"
                "LINEAGE_STORAGE_MODE=poc\n"
                "ASSET_DB_PASSWORD=synthetic-not-a-real-secret\n"
                "DATABASE_URL=postgresql://example.invalid/test\n"
                "PGHOST=example.invalid\n"
                "MYSQL_PASSWORD=synthetic-not-a-real-secret\n"
                "DB_HOST=example.invalid\n"
                "DATABASE_PASSWORD=synthetic-not-a-real-secret\n"
                "PGPASSFILE=/synthetic/pgpass\n"
                "POSTGRES_PASSWORD=synthetic-not-a-real-secret\n"
                "MYSQL_PWD=synthetic-not-a-real-secret\n",
                encoding="utf-8",
            )
            with (
                patch.object(settings, "_ENV_FILES", (env_file,)),
                patch.dict(
                    os.environ,
                    {
                        "COMMUNITY_DEMO_BOOTSTRAP": "1",
                        "ASSET_DB_PROFILE": "community_sqlite",
                    },
                    clear=True,
                ),
            ):
                settings.load_runtime_env(overwrite=False)
                self.assertEqual("community_sqlite", os.environ["ASSET_DB_PROFILE"])
                for name in (
                    "ASSET_AUTH_DB_PROFILE",
                    "LINEAGE_DB_PROFILE",
                    "LINEAGE_STORAGE_MODE",
                    "ASSET_DB_PASSWORD",
                    "DATABASE_URL",
                    "PGHOST",
                    "MYSQL_PASSWORD",
                    "DB_HOST",
                    "DATABASE_PASSWORD",
                    "PGPASSFILE",
                    "POSTGRES_PASSWORD",
                    "MYSQL_PWD",
                ):
                    self.assertNotIn(name, os.environ)
                settings.load_runtime_env(overwrite=True)
                self.assertEqual("community_sqlite", os.environ["ASSET_DB_PROFILE"])
                for name in (
                    "ASSET_AUTH_DB_PROFILE",
                    "LINEAGE_DB_PROFILE",
                    "LINEAGE_STORAGE_MODE",
                    "ASSET_DB_PASSWORD",
                    "DATABASE_URL",
                    "PGHOST",
                    "MYSQL_PASSWORD",
                    "DB_HOST",
                    "DATABASE_PASSWORD",
                    "PGPASSFILE",
                    "POSTGRES_PASSWORD",
                    "MYSQL_PWD",
                ):
                    self.assertNotIn(name, os.environ)


if __name__ == "__main__":
    unittest.main()
