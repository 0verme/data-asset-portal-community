from __future__ import annotations

import copy
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

from backend.app.contracts.metadata_ingestion import (  # type: ignore
    AssetMetadataIngestionRequest,
)
from backend.tests.db_test_support import skip_without_postgres_integration

MODULE_PATH = Path(__file__).resolve().parents[2] / "examples" / "metadata_ingestion" / "postgresql_collector.py"
SPEC = importlib.util.spec_from_file_location("postgresql_reference_collector", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise ImportError(f"Unable to load reference collector: {MODULE_PATH}")
COLLECTOR = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = COLLECTOR
SPEC.loader.exec_module(COLLECTOR)


BASE_CONFIG = {
    "source": {
        "type": "postgresql",
        "name": "warehouse",
        "namespace": "finance",
        "host": "127.0.0.1",
        "port": 5432,
        "database": "analytics",
        "username": "dap_reader",
        "password_env": "TEST_PG_PASSWORD",
        "schemas": {"include": ["dwm", "dwd"]},
    },
    "sink": {
        "url": "http://127.0.0.1:15099",
        "session_cookie_env": "TEST_DAP_SESSION",
        "timeout": 10,
    },
    "collector": {"version": "0.1.0"},
}


class FakeCursor:
    def __init__(self):
        self.calls: list[tuple[str, object | None]] = []
        self.description: list[tuple[str]] = []
        self._rows: list[tuple[object, ...]] = []

    def execute(self, sql: str, params: object | None = None):
        self.calls.append((sql, params))
        if "FROM pg_catalog.pg_namespace" in sql:
            self.description = [("schema_name",), ("is_system",)]
            self._rows = [
                ("dwd", False),
                ("dm", False),
                ("information_schema", True),
                ("pg_catalog", True),
                ("pg_temp_3", True),
                ("public", False),
            ]
        elif "FROM pg_catalog.pg_attribute" in sql:
            self.description = [
                ("schema_name",),
                ("table_name",),
                ("field_name",),
                ("data_type",),
                ("nullable",),
                ("ordinal_position",),
                ("column_comment",),
                ("column_default",),
                ("primary_key",),
            ]
            self._rows = [
                ("dwd", "customer", "customer_id", "bigint", False, 1, "ID", "nextval(...)", True),
                ("dwd", "customer", "amount", "numeric(18,2)", True, 2, None, "0", False),
                ("dwd", "customer", "tags", "text[]", True, 3, "Tags", None, False),
            ]
        elif "FROM pg_catalog.pg_class" in sql:
            self.description = [
                ("schema_name",),
                ("table_name",),
                ("table_type",),
                ("table_comment",),
            ]
            self._rows = [("dwd", "customer", "table", "Customers")]
        else:  # pragma: no cover - protects the test from accidental new queries.
            raise AssertionError(f"unexpected SQL: {sql}")
        return self

    def fetchall(self):
        return list(self._rows)

    def close(self):
        return None


class FakeConnection:
    def __init__(self):
        self.cursor_instance = FakeCursor()
        self.closed = False

    def cursor(self):
        return self.cursor_instance

    def close(self):
        self.closed = True


class FakeResponse:
    def __init__(self, status: int = 201, body: str = "{}", headers=None):
        self.status = status
        self._body = body.encode("utf-8")
        self.headers = headers or MagicMock()

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class MetadataReferenceCollectorTests(unittest.TestCase):
    def _write_config(self, value=None) -> Path:
        import yaml

        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "postgresql.yml"
        path.write_text(yaml.safe_dump(value or BASE_CONFIG), encoding="utf-8")
        return path

    def test_config_requires_host_database_username_and_password_env(self):
        for key in ("host", "database", "username"):
            value = copy.deepcopy(BASE_CONFIG)
            del value["source"][key]
            with self.subTest(key=key), self.assertRaises(COLLECTOR.ConfigError):
                COLLECTOR.load_config(self._write_config(value))

        value = copy.deepcopy(BASE_CONFIG)
        del value["source"]["password_env"]
        with self.assertRaisesRegex(COLLECTOR.ConfigError, "password_env is required"):
            COLLECTOR.load_config(self._write_config(value))

    def test_config_rejects_plaintext_password_and_keeps_schema_filter(self):
        value = copy.deepcopy(BASE_CONFIG)
        value["source"]["password"] = "must-not-be-accepted"
        with self.assertRaisesRegex(COLLECTOR.ConfigError, "source.password"):
            COLLECTOR.load_config(self._write_config(value))

        config = COLLECTOR.load_config(self._write_config(BASE_CONFIG))
        self.assertEqual(("dwm", "dwd"), config.source.schemas)
        self.assertEqual(
            "http://127.0.0.1:15099/api/metadata/assets/ingestions", config.sink_url
        )

    def test_schema_filter_ignores_system_schemas_and_reads_only_catalogs(self):
        connection = FakeConnection()
        result = COLLECTOR.scan(connection, schema_include=("dwd",))
        self.assertEqual(("dwd",), result.schemas)
        self.assertEqual(("dm", "public"), result.filtered_schemas)
        self.assertEqual(
            ("information_schema", "pg_catalog", "pg_temp_3"), result.ignored_schemas
        )
        self.assertEqual(1, len(result.table_rows))
        self.assertEqual(3, len(result.column_rows))
        self.assertEqual(3, len(connection.cursor_instance.calls))
        for sql, _params in connection.cursor_instance.calls:
            normalized = " ".join(sql.split()).upper()
            self.assertTrue(normalized.startswith("SELECT"))
            self.assertNotRegex(normalized, r"\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b")
            self.assertNotIn("SELECT *", normalized)

    def test_catalog_fixture_maps_comments_types_nullable_and_table_type_to_contract(self):
        payload = COLLECTOR.build_contract(
            [
                {
                    "schema_name": "public",
                    "table_name": "orders",
                    "table_type": "partitioned_table",
                    "table_comment": "Orders",
                }
            ],
            [
                {
                    "schema_name": "public",
                    "table_name": "orders",
                    "field_name": "amount",
                    "data_type": "numeric(18,2)",
                    "nullable": True,
                    "ordinal_position": 1,
                    "primary_key": False,
                    "column_comment": "Amount",
                    "column_default": "0",
                },
                {
                    "schema_name": "public",
                    "table_name": "orders",
                    "field_name": "tags",
                    "data_type": "text[]",
                    "nullable": False,
                    "ordinal_position": 2,
                    "primary_key": True,
                    "column_comment": None,
                },
            ],
            source_name="warehouse",
            source_namespace="finance",
            database_name="analytics",
        )
        validated = AssetMetadataIngestionRequest.model_validate(payload)
        asset = validated.assets[0]
        self.assertEqual("partitioned_table", asset.asset_type)
        self.assertEqual("Orders", asset.description)
        self.assertEqual("numeric(18,2)", asset.fields[0].data_type)
        self.assertTrue(asset.fields[0].nullable)
        self.assertEqual("Amount", asset.fields[0].description)
        self.assertEqual("text[]", asset.fields[1].data_type)
        self.assertIsNone(asset.fields[1].description)
        self.assertEqual("analytics", asset.database)
        serialized = json.dumps(payload)
        self.assertNotIn("p_asset_table", serialized)
        self.assertNotIn("p_asset_field", serialized)
        # The current public Contract has no persisted default-value property.
        self.assertNotIn('"default"', serialized)

    def test_payload_uses_stable_source_scoped_external_ids(self):
        payload = COLLECTOR.build_contract(
            [{"schema_name": "public", "table_name": "orders"}],
            [],
            source_name="warehouse",
        )
        self.assertEqual("public.orders", payload["assets"][0]["externalId"])
        self.assertEqual("warehouse", payload["source"]["name"])
        self.assertEqual("postgresql-reference", payload["collector"]["name"])

    def test_publisher_posts_json_over_http_only_and_redacts_nothing_into_payload(self):
        response = FakeResponse(201, '{"status":"completed"}')
        with patch.object(COLLECTOR, "urlopen", return_value=response) as urlopen:
            status, body = COLLECTOR.publish(
                "http://dap.example/api/metadata/assets/ingestions",
                {"contractVersion": "1.0", "assets": []},
                session_cookie="signed-cookie",
            )
        self.assertEqual(201, status)
        self.assertIn("completed", body)
        request = urlopen.call_args.args[0]
        self.assertEqual("POST", request.method)
        self.assertEqual("session=signed-cookie", request.get_header("Cookie"))
        self.assertIn(b'"contractVersion": "1.0"', request.data)
        self.assertNotIn(b"p_asset", request.data)

    def test_sync_maps_http_failures_to_explicit_stages(self):
        config = COLLECTOR.load_config(self._write_config(BASE_CONFIG))
        payload = {"contractVersion": "1.0", "assets": [{"name": "orders"}]}

        def http_error(status: int, body: str = ""):
            return HTTPError(
                "http://dap.example",
                status,
                "error",
                {},
                io.BytesIO(body.encode("utf-8")),
            )

        with patch.object(COLLECTOR, "_session_cookie", return_value="cookie"):
            with patch.object(
                COLLECTOR,
                "publish",
                side_effect=http_error(401, '{"error":{"message":"login required"}}'),
            ), self.assertRaises(COLLECTOR.DapConnectionError) as unauthorized:
                COLLECTOR._sync_payload(config, payload)
            self.assertIn("HTTP 401", str(unauthorized.exception))

            with patch.object(
                COLLECTOR,
                "publish",
                side_effect=http_error(422, '{"error":{"message":"invalid contract"}}'),
            ), self.assertRaises(COLLECTOR.MetadataContractError) as invalid:
                COLLECTOR._sync_payload(config, payload)
            self.assertIn("invalid contract", str(invalid.exception))

            with patch.object(
                COLLECTOR,
                "publish",
                side_effect=http_error(500, '{"error":{"message":"server error"}}'),
            ), self.assertRaises(COLLECTOR.MetadataSyncError) as failed:
                COLLECTOR._sync_payload(config, payload)
            self.assertIn("HTTP 500", str(failed.exception))

            with patch.object(
                COLLECTOR,
                "publish",
                side_effect=URLError("timed out"),
            ), self.assertRaises(COLLECTOR.DapConnectionError) as timeout:
                COLLECTOR._sync_payload(config, payload)
            self.assertIn("DAP request failed", str(timeout.exception))

    def test_password_is_required_from_environment_and_never_exposed_in_driver_error(self):
        config = COLLECTOR.load_config(self._write_config(BASE_CONFIG))
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(COLLECTOR.ConfigError):
            COLLECTOR.connect_postgres(config.source)

        fake_psycopg = MagicMock()
        fake_psycopg.connect.side_effect = RuntimeError("password=super-secret")
        with (
            patch.dict(os.environ, {"TEST_PG_PASSWORD": "super-secret"}, clear=False),
            patch.object(COLLECTOR, "_load_psycopg", return_value=fake_psycopg),
            self.assertRaises(COLLECTOR.PostgresConnectionError) as error,
        ):
            COLLECTOR.connect_postgres(config.source)
        self.assertNotIn("super-secret", str(error.exception))
        self.assertIn("[REDACTED]", str(error.exception))
        kwargs = fake_psycopg.connect.call_args.kwargs
        self.assertIn("default_transaction_read_only=on", kwargs["options"])
        self.assertEqual("super-secret", kwargs["password"])

    def test_login_credentials_are_not_logged_or_returned_as_payload(self):
        config_value = copy.deepcopy(BASE_CONFIG)
        config_value["sink"]["username_env"] = "TEST_DAP_USER"
        config_value["sink"]["password_env"] = "TEST_DAP_PASSWORD"
        config = COLLECTOR.load_config(self._write_config(config_value))
        response = FakeResponse(200, '{"message":"ok"}')
        response.headers.get_all.return_value = ["session=signed-cookie; Path=/; HttpOnly"]
        with (
            patch.dict(
                os.environ,
                {"TEST_DAP_USER": "collector", "TEST_DAP_PASSWORD": "super-secret"},
                clear=False,
            ),
            patch.object(COLLECTOR, "urlopen", return_value=response) as urlopen,
        ):
            cookie = COLLECTOR._login(config)
        self.assertEqual("signed-cookie", cookie)
        self.assertEqual("POST", urlopen.call_args.args[0].method)
        self.assertNotIn("super-secret", repr(cookie))


@skip_without_postgres_integration()
class PostgreSQLReferenceCollectorIntegrationTests(unittest.TestCase):
    """Exercise the scanner against the PostgreSQL 16 CI service when enabled."""

    schema_name = "dap_245_collector_fixture"
    previous_password: str | None = None

    @classmethod
    def setUpClass(cls):
        import psycopg
        import yaml

        config_path = Path(os.environ["TEST_DATABASE_CONFIG_PATH"])
        raw = yaml.safe_load(config_path.read_text(encoding="utf-8"))
        profile = raw["profiles"][os.environ["TEST_DATABASE_PROFILE"]]
        cls.profile = profile
        cls.previous_password = os.environ.get("DAP_245_TEST_PG_PASSWORD")
        os.environ["DAP_245_TEST_PG_PASSWORD"] = str(profile.get("password") or "")
        cls.connection = psycopg.connect(
            host=profile.get("host", "127.0.0.1"),
            port=int(profile.get("port", 5432)),
            dbname=profile["database"],
            user=profile["user"],
            password=profile.get("password"),
        )
        cls.connection.autocommit = True
        with cls.connection.cursor() as cursor:
            cursor.execute(f"DROP SCHEMA IF EXISTS {cls.schema_name} CASCADE")
            cursor.execute(f"CREATE SCHEMA {cls.schema_name}")
            cursor.execute(
                f"""
                CREATE TABLE {cls.schema_name}.customer (
                    customer_id bigint PRIMARY KEY,
                    customer_name varchar(100),
                    amount numeric(18, 2),
                    tags text[],
                    created_at timestamp
                )
                """
            )
            cursor.execute(
                f"COMMENT ON TABLE {cls.schema_name}.customer IS 'collector fixture customer table'"
            )
            cursor.execute(
                f"COMMENT ON COLUMN {cls.schema_name}.customer.customer_name IS 'customer display name'"
            )

    @classmethod
    def tearDownClass(cls):
        try:
            with cls.connection.cursor() as cursor:
                cursor.execute(f"DROP SCHEMA IF EXISTS {cls.schema_name} CASCADE")
            cls.connection.close()
        finally:
            if cls.previous_password is None:
                os.environ.pop("DAP_245_TEST_PG_PASSWORD", None)
            else:
                os.environ["DAP_245_TEST_PG_PASSWORD"] = cls.previous_password

    def test_scan_maps_real_schema_table_columns_and_comments(self):
        profile = self.profile
        source = COLLECTOR.SourceConfig(
            type="postgresql",
            name="ci-postgres",
            namespace="collector-test",
            host=str(profile.get("host", "127.0.0.1")),
            port=int(profile.get("port", 5432)),
            database=str(profile["database"]),
            username=str(profile["user"]),
            password_env="DAP_245_TEST_PG_PASSWORD",
            schemas=(self.schema_name,),
            connect_timeout=10,
            statement_timeout_ms=120000,
        )
        config = COLLECTOR.CollectorConfig(
            source=source,
            sink_url="http://dap.example/api/metadata/assets/ingestions",
            session_cookie_env="UNUSED_SESSION",
            dap_username_env=None,
            dap_password_env=None,
            http_timeout=10,
            collector_version="0.1.0",
        )
        result = COLLECTOR.scan_source(config)
        payload = COLLECTOR.build_contract(
            list(result.table_rows),
            list(result.column_rows),
            source_name=source.name,
            source_namespace=source.namespace,
            database_name=source.database,
        )
        validated = AssetMetadataIngestionRequest.model_validate(payload)
        self.assertEqual((self.schema_name,), result.schemas)
        self.assertEqual(1, len(validated.assets))
        asset = validated.assets[0]
        self.assertEqual("customer", asset.name)
        self.assertEqual("collector fixture customer table", asset.description)
        fields = {field.name: field for field in asset.fields}
        self.assertEqual("bigint", fields["customer_id"].data_type)
        self.assertFalse(fields["customer_id"].nullable)
        self.assertTrue(fields["customer_id"].primary_key)
        self.assertEqual("numeric(18,2)", fields["amount"].data_type)
        self.assertEqual("text[]", fields["tags"].data_type)
        self.assertEqual("customer display name", fields["customer_name"].description)


if __name__ == "__main__":
    unittest.main()
