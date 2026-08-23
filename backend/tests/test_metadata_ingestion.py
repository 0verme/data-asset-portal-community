from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient  # type: ignore

from backend.app.application import Identity  # type: ignore
from backend.app.contracts.metadata_ingestion import (  # type: ignore
    AssetMetadataIngestionRequest,
    LineageMetadataIngestionRequest,
)
from backend.app.db.sqlite_adapter import connect  # type: ignore
from backend.app.fastapi_app import create_fastapi_app  # type: ignore
from backend.app.migrations.schema import initialize  # type: ignore
from backend.app.services.metadata_ingestion_service import (  # type: ignore
    MetadataIngestionService,
    MetadataValidationError,
)


def asset_request(*, source_name: str = "warehouse", external_id: str = "public.orders", name: str = "orders"):
    return AssetMetadataIngestionRequest.model_validate(
        {
            "contract_version": "1.0",
            "source": {"type": "postgresql", "name": source_name, "namespace": "finance"},
            "collector": {"name": "test-collector", "version": "1.0.0"},
            "assets": [
                {
                    "external_id": external_id,
                    "qualified_name": f"public.{name}",
                    "asset_type": "table",
                    "schema": "public",
                    "name": name,
                    "fields": [
                        {
                            "name": "id",
                            "data_type": "integer",
                            "nullable": False,
                            "primary_key": True,
                            "ordinal_position": 1,
                            "description": "identifier",
                        }
                    ],
                }
            ],
        }
    )


def lineage_request(*, import_id: str = "run-1", bad_edge: bool = False):
    return LineageMetadataIngestionRequest.model_validate(
        {
            "contractVersion": "1.0",
            "source": {"type": "postgresql", "name": "warehouse", "namespace": "finance"},
            "collector": {"name": "lineage-test", "version": "1.0.0"},
            "snapshot": {"importId": import_id, "generatedAt": "2026-08-22T10:00:00Z", "mode": "replace"},
            "nodes": [
                {"externalId": "source", "type": "table", "name": "public.orders"},
                {"externalId": "target", "type": "table", "name": "public.orders_daily"},
            ],
            "edges": [
                {
                    "sourceId": "missing" if bad_edge else "source",
                    "targetId": "target",
                    "type": "table_lineage",
                    "evidence": {"type": "mapping", "sourceRecordId": "m1", "description": "fixture"},
                    "confidence": 0.9,
                }
            ],
        }
    )


class MetadataContractTests(unittest.TestCase):
    def setUp(self):
        self.service = MetadataIngestionService(db=MagicMock())

    def test_snake_case_and_camel_case_are_accepted_but_response_is_camel_case(self):
        request = asset_request()
        payload = request.model_dump(by_alias=True)
        self.assertEqual("1.0", payload["contractVersion"])
        self.assertEqual("public.orders", payload["assets"][0]["qualifiedName"])

    def test_duplicate_field_and_unsupported_major_are_rejected(self):
        request = asset_request()
        request.assets[0].fields.append(request.assets[0].fields[0])
        _, errors = self.service._preflight_assets(request)
        self.assertEqual("INVALID_DUPLICATE_FIELD", errors[0]["code"])
        unsupported = request.model_copy(update={"contract_version": "2.0"})
        with self.assertRaises(MetadataValidationError):
            self.service._validate_contract_version(unsupported.contract_version)

    def test_lineage_is_self_contained_and_exact_duplicate_edges_are_deduplicated(self):
        request = lineage_request()
        request.edges.append(request.edges[0])
        normalized = self.service._preflight_lineage(request)
        self.assertEqual(2, len(normalized["nodes"]))
        self.assertEqual(1, len(normalized["edges"]))

    def test_lineage_bad_reference_and_confidence_are_validation_errors(self):
        with self.assertRaises(MetadataValidationError):
            self.service._preflight_lineage(lineage_request(bad_edge=True))
        request = lineage_request()
        request.edges[0].confidence = "impossible"
        with self.assertRaises(MetadataValidationError):
            self.service._preflight_lineage(request)

    def test_different_sources_have_different_natural_keys(self):
        first = self.service._preflight_assets(asset_request(source_name="warehouse-a"))[0][0]
        second = self.service._preflight_assets(asset_request(source_name="warehouse-b"))[0][0]
        self.assertNotEqual(first["key"], second["key"])

    def test_scale_limit_supports_one_thousand_assets_and_ten_thousand_fields(self):
        request = asset_request()
        request.assets = []
        for index in range(1_000):
            asset = asset_request(external_id=f"public.orders_{index}", name=f"orders_{index}").assets[0]
            asset.fields.extend(
                asset.fields[0].model_copy(
                    update={
                        "name": f"field_{field_number}",
                        "primary_key": False,
                        "nullable": True,
                        "ordinal_position": field_number,
                    }
                )
                for field_number in range(2, 11)
            )
            request.assets.append(asset)
        normalized, errors = self.service._preflight_assets(request)
        self.assertEqual(1_000, len(normalized))
        self.assertEqual([], errors)


class MetadataSqlitePersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.database = Path(self.temp_dir.name) / "metadata.sqlite"
        self.config = Path(self.temp_dir.name) / "database.yaml"
        self.config.write_text(
            "profiles:\n  metadata_test:\n    type: sqlite\n    database: "
            + self.database.as_posix()
            + "\n",
            encoding="utf-8",
        )
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(self.config),
                "ASSET_DB_PROFILE": "metadata_test",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            initialize(connection, {"type": "sqlite", "database": str(self.database)}, "sqlite")
        finally:
            connection.close()
        self.service = MetadataIngestionService(db_profile="metadata_test")

    def _asset_count(self):
        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            return connection.execute("SELECT COUNT(*) FROM dwp.p_asset_table WHERE source_key IS NOT NULL").fetchone()[0]
        finally:
            connection.close()

    def _active_snapshot_rows(self):
        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            return connection.execute("SELECT import_batch_id FROM dwp.p_lineage_snapshot WHERE status_code = 'ACTIVE'").fetchall()
        finally:
            connection.close()

    def _snapshot_count(self):
        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            return connection.execute("SELECT COUNT(*) FROM dwp.p_lineage_snapshot").fetchone()[0]
        finally:
            connection.close()

    def test_asset_idempotency_rename_source_isolation_and_dry_run(self):
        first = self.service.ingest_assets(asset_request(source_name="source-a", external_id="stable-id"))
        renamed = asset_request(source_name="source-a", external_id="stable-id", name="orders_renamed")
        renamed.assets[0].qualified_name = "public.orders_renamed"
        updated = self.service.ingest_assets(renamed)
        other_source = self.service.ingest_assets(asset_request(source_name="source-b", external_id="stable-id"))
        preview = self.service.ingest_assets(asset_request(source_name="source-c", external_id="preview"), dry_run=True)
        authoritative = asset_request(source_name="source-a", external_id="authoritative-only", name="authoritative_only")
        authoritative.authoritative = True
        candidates = self.service.ingest_assets(authoritative, dry_run=True)
        self.assertEqual("create", first["items"][0]["status"])
        self.assertEqual(1, updated["summary"]["update"])
        self.assertEqual(1, other_source["summary"]["create"])
        self.assertEqual("preview", preview["status"])
        self.assertGreaterEqual(candidates["summary"]["deleteCandidate"], 1)
        self.assertEqual(2, self._asset_count())

    def test_lineage_persistence_failure_keeps_old_active_snapshot(self):
        self.service.ingest_lineage(lineage_request(import_id="run-old"))
        with patch.object(self.service._db, "execute_many", side_effect=RuntimeError("write failed")), self.assertRaises(RuntimeError):
            self.service.ingest_lineage(lineage_request(import_id="run-new"))
        self.assertEqual(1, len(self._active_snapshot_rows()))
        self.assertEqual(1, self._snapshot_count())


class MetadataApiTests(unittest.TestCase):
    def setUp(self):
        self.service = MagicMock()
        self.service.ingest_assets.return_value = {
            "ingestionId": "ingestion-1",
            "correlationId": "request-1",
            "status": "completed",
            "contractVersion": "1.0",
            "dryRun": False,
            "source": {"type": "postgresql", "name": "warehouse"},
            "collector": {"name": "test", "version": "1.0"},
            "summary": {"received": 1, "valid": 1, "create": 1},
            "items": [{"index": 0, "externalKey": "public.orders", "status": "create"}],
        }
        self.service.ingest_lineage.return_value = self.service.ingest_assets.return_value
        self.service.get_ingestion.return_value = self.service.ingest_assets.return_value
        app = create_fastapi_app(
            identity_resolver=lambda _request: Identity("maintainer", "collector", "Collector"),
            metadata_ingestion_service_instance=self.service,
        )
        self.client = TestClient(app)

    def test_asset_and_lineage_routes_are_additive_and_authenticated(self):
        asset_payload = asset_request().model_dump(by_alias=True)
        response = self.client.post("/api/metadata/assets/ingestions", json=asset_payload)
        self.assertEqual(201, response.status_code)
        response = self.client.post("/api/metadata/assets:bulk-upsert", json=asset_payload)
        self.assertEqual(201, response.status_code)
        self.assertEqual(2, self.service.ingest_assets.call_count)

        lineage_payload = lineage_request().model_dump(mode="json", by_alias=True)
        response = self.client.post("/api/metadata/lineage/ingestions", json=lineage_payload)
        self.assertEqual(201, response.status_code)
        response = self.client.post("/api/metadata/lineage:snapshots", json=lineage_payload)
        self.assertEqual(201, response.status_code)
        self.assertEqual(2, self.service.ingest_lineage.call_count)
        self.assertEqual(200, self.client.get("/api/metadata/ingestions/ingestion-1").status_code)

    def test_anonymous_collector_cannot_write(self):
        app = create_fastapi_app(identity_resolver=lambda _request: None, metadata_ingestion_service_instance=self.service)
        response = TestClient(app).post("/api/metadata/assets/ingestions", json=asset_request().model_dump(by_alias=True))
        self.assertEqual(401, response.status_code)


if __name__ == "__main__":
    unittest.main()
