from __future__ import annotations

import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend.app.db.base import (
    BackendCapabilities,
    BackendCapability,
    CrossProfileTransactionError,
    DatabaseConnectionError,
    validate_provider_contract,
)
from backend.app.db.facade import (
    active_transaction_connection,
    clear_engine_cache,
    connect_with_profile,
    database_transaction,
    get_engine,
)
from backend.app.db.providers import (
    BUILTIN_PROVIDERS,
    GaussDBProvider,
    PostgreSQLProvider,
    SQLiteProvider,
)
from backend.app.db.registry import (
    clear_registry_for_tests,
    get_provider,
    register_provider,
)


class ProviderContractTests(unittest.TestCase):
    def tearDown(self):
        clear_engine_cache()
        clear_registry_for_tests()

    def test_every_builtin_provider_exposes_the_formal_contract(self):
        for provider in BUILTIN_PROVIDERS:
            with self.subTest(provider=provider.name):
                validate_provider_contract(provider)
                self.assertIs(get_provider(provider.name), provider)
                for alias in provider.aliases:
                    self.assertIs(get_provider(alias), provider)
                self.assertIsInstance(provider.capabilities, BackendCapabilities)
                self.assertTrue(provider.capabilities.supports(BackendCapability.TRANSACTIONS))
                self.assertTrue(provider.migration_dialect)

    def test_capability_matrix_describes_infrastructure_not_brand(self):
        by_name = {provider.name: provider for provider in BUILTIN_PROVIDERS}
        for name in ("sqlite", "postgres"):
            self.assertTrue(by_name[name].capabilities.sqlalchemy_engine)
            self.assertTrue(by_name[name].capabilities.connection_pool)
            self.assertFalse(by_name[name].capabilities.jdbc)
            self.assertTrue(by_name[name].capabilities.alembic_online)
        dws = by_name["gaussdb"]
        self.assertFalse(dws.capabilities.sqlalchemy_engine)
        self.assertFalse(dws.capabilities.connection_pool)
        self.assertTrue(dws.capabilities.jdbc)
        self.assertTrue(dws.capabilities.dbapi_connection)
        self.assertFalse(dws.capabilities.savepoints)

    def test_provider_profile_validation_fails_before_connection(self):
        with self.assertRaisesRegex(ValueError, "port between 1 and 65535"):
            PostgreSQLProvider().validate(
                "bad-port",
                {"type": "postgres", "database": "asset", "user": "u", "password": "p", "port": 70000},
                config_path=Path("database.yaml"),
            )
        with self.assertRaisesRegex(ValueError, "requires user, password"):
            PostgreSQLProvider().validate(
                "missing-credentials",
                {"type": "postgres", "database": "asset"},
                config_path=Path("database.yaml"),
            )
        with self.assertRaisesRegex(ValueError, "requires database"):
            SQLiteProvider().validate("missing-database", {"type": "sqlite"}, config_path=Path("database.yaml"))

    def test_dws_validation_requires_jdbc_credentials_and_driver_file(self):
        with tempfile.TemporaryDirectory() as directory:
            jar = Path(directory) / "driver.jar"
            jar.touch()
            with self.assertRaisesRegex(ValueError, "requires jdbc_url, user, password"):
                GaussDBProvider().validate(
                    "dws",
                    {"type": "gaussdb", "jar_path": str(jar)},
                    config_path=Path(directory) / "database.yaml",
                )

    def test_third_party_provider_uses_the_same_contract_and_aliases(self):
        @dataclass(frozen=True)
        class ThirdPartyProvider:
            name: str = "contractdb"
            aliases: tuple[str, ...] = ("contract",)
            migration_dialect: str = "contract"
            placeholder: str = "?"
            capabilities: BackendCapabilities = BackendCapabilities(
                dbapi_connection=True,
                transactions=True,
                schema_translation=True,
            )

            def validate(self, profile, config, *, config_path):
                config["validated"] = True
                return config

            def create_engine(self, config):
                return None

            def connect(self, config):
                return object()

            def physical_schema(self, config):
                return "app"

        provider = register_provider(ThirdPartyProvider())
        self.assertIs(provider, get_provider("contract"))
        self.assertTrue(get_provider("contract").validate("p", {}, config_path=Path("db"))["validated"])

    def test_invalid_third_party_provider_is_rejected_atomically(self):
        @dataclass(frozen=True)
        class InvalidProvider:
            name: str = "invalid"
            aliases: tuple[str, ...] = ("invalid",)
            migration_dialect: str = "x"
            placeholder: str = "?"
            capabilities: BackendCapabilities = BackendCapabilities()

            def validate(self, profile, config, *, config_path):
                return config

            def create_engine(self, config):
                return None

            def connect(self, config):
                return None

            def physical_schema(self, config):
                return None

        with self.assertRaisesRegex(ValueError, "unique"):
            register_provider(InvalidProvider())
        with self.assertRaises(ValueError):
            get_provider("invalid")


class EngineContractTests(unittest.TestCase):
    def tearDown(self):
        clear_engine_cache()

    def test_cache_reuses_same_profile_and_isolates_different_profiles(self):
        with tempfile.TemporaryDirectory() as directory:
            config = {"type": "sqlite", "database": str(Path(directory) / "db.sqlite")}
            first = get_engine("profile-a", config=config)
            self.assertIs(first, get_engine("profile-a", config=dict(config)))
            self.assertIsNot(first, get_engine("profile-b", config=dict(config)))
            changed = dict(config, database=str(Path(directory) / "changed.sqlite"))
            self.assertIsNot(first, get_engine("profile-a", config=changed))

    def test_sqlalchemy_pool_configuration_is_real_engine_state(self):
        postgres = PostgreSQLProvider().create_engine(
            {
                "type": "postgres",
                "host": "127.0.0.1",
                "port": 5432,
                "database": "asset",
                "user": "u",
                "password": "password",
                "connect_timeout": 7,
                "pool_size": 2,
                "pool_timeout": 11,
                "pool_recycle": 123,
            }
        )
        try:
            for engine in (postgres,):
                self.assertTrue(engine.pool._pre_ping)
                self.assertEqual(123, engine.pool._recycle)
                self.assertEqual(11, engine.pool._timeout)
            self.assertTrue(postgres.dialect.name.startswith("postgresql"))
        finally:
            postgres.dispose()

    def test_postgres_connect_timeout_reaches_the_dbapi_creator(self):
        config = {
            "type": "postgres", "host": "127.0.0.1", "port": 5432,
            "database": "asset", "user": "u", "password": "password",
            "connect_timeout": 9,
        }
        with patch("backend.app.db.providers.create_engine") as factory, patch(
            "backend.app.db.postgres_adapter.connect", return_value=object()
        ) as connect:
            PostgreSQLProvider().create_engine(config)
            factory.call_args.kwargs["creator"]()
        connect.assert_called_once_with(config, options=None)

    def test_sqlite_pool_semantics_are_explicitly_type_specific(self):
        with tempfile.TemporaryDirectory() as directory:
            engine = SQLiteProvider().create_engine({"database": str(Path(directory) / "db.sqlite")})
            try:
                self.assertTrue(engine.pool._pre_ping)
                self.assertEqual("NullPool", type(engine.pool).__name__)
            finally:
                engine.dispose()


class TransactionContractTests(unittest.TestCase):
    def test_transaction_reuses_one_connection_and_rejects_cross_profile(self):
        connection = MagicMock()
        connection.jconn.getAutoCommit.return_value = False
        with patch("backend.app.db.facade.connect_with_profile", return_value=connection) as connect:
            with self.assertRaises(CrossProfileTransactionError):
                with database_transaction():
                    first = active_transaction_connection("profile-a")
                    second = active_transaction_connection("profile-a")
                    self.assertIs(first, second)
                    active_transaction_connection("profile-b")
        connect.assert_called_once_with("profile-a")
        connection.rollback.assert_called_once_with()
        connection.close.assert_called_once_with()

    def test_nested_transactions_are_rejected_without_savepoint_semantics(self):
        with database_transaction():
            with self.assertRaisesRegex(RuntimeError, "Nested database transactions"):
                with database_transaction():
                    pass

    def test_success_commits_and_failure_rolls_back_and_closes(self):
        for failed in (False, True):
            with self.subTest(failed=failed):
                connection = MagicMock()
                connection.jconn.getAutoCommit.return_value = False
                with patch("backend.app.db.facade.connect_with_profile", return_value=connection):
                    if failed:
                        with self.assertRaisesRegex(RuntimeError, "business failure"):
                            with database_transaction():
                                active_transaction_connection("profile")
                                raise RuntimeError("business failure")
                    else:
                        with database_transaction():
                            active_transaction_connection("profile")
                if failed:
                    connection.rollback.assert_called_once_with()
                    connection.commit.assert_not_called()
                else:
                    connection.commit.assert_called_once_with()
                    connection.rollback.assert_not_called()
                connection.close.assert_called_once_with()


class ConnectionFailureRedactionTests(unittest.TestCase):
    def test_provider_failure_is_controlled_and_logs_are_redacted(self):
        config = {
            "type": "postgres",
            "password": "top-secret",
            "token": "token-secret",
            "url": "postgresql://user:top-secret@127.0.0.1/asset",
        }
        engine = MagicMock()
        engine.raw_connection.side_effect = RuntimeError(
            "connect failed postgresql://user:top-secret@127.0.0.1/asset password=top-secret token=token-secret"
        )
        with patch("backend.app.db.facade.get_db_profile", return_value=config), patch(
            "backend.app.db.facade.get_engine", return_value=engine
        ), self.assertLogs("backend.app.db.facade", level="ERROR") as logs:
            with self.assertRaises(DatabaseConnectionError) as raised:
                connect_with_profile("secret-profile")
        for text in (str(raised.exception), "\n".join(logs.output)):
            self.assertNotIn("top-secret", text)
            self.assertNotIn("token-secret", text)
            self.assertNotIn("top-secret@", text)
        self.assertIn("provider=postgres", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
