"""PR1: real isolated SQLite capture, current authorization and wire integrity.

No network DBs, model/index dependency, real metadata or credentials are used.
"""

from __future__ import annotations

import copy
import json
import os
import sqlite3
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app.application import Identity
from backend.app.authorization.core import AuthorizationService
from backend.app.authorization.permissions import PERMISSION_DEFINITIONS
from backend.app.authorization.repository import DatabaseAuthorizationRepository
from backend.app.contracts.catalog_snapshot import (
    EntityRef, SnapshotIntegrityError, SnapshotReceiver, projection_hash, validate_documents,
)
from backend.app.contracts.metadata_ingestion import AssetMetadataIngestionRequest
from backend.app.db.catalog_capture import CatalogCaptureUnsupported, catalog_read_transaction
from backend.app.db.facade import active_transaction_connection, clear_engine_cache
from backend.app.db.sqlite_adapter import connect
from backend.app.fastapi_app import create_fastapi_app
from backend.app.migrations.schema import initialize
from backend.app.services.assets_service import AssetDataSourceError, AssetsService
from backend.app.services.catalog_snapshot_service import CatalogSnapshotService, SnapshotError
from backend.app.services.metadata_ingestion_service import MetadataIngestionService
from backend.tests.test_asset_sync_lifecycle import source_asset, source_field


class CatalogSnapshotTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.database = Path(directory.name) / "snapshot.sqlite"
        config = Path(directory.name) / "database.yaml"
        config.write_text(
            f"profiles:\n  snapshot_test:\n    type: sqlite\n    database: {self.database.as_posix()}\n",
            encoding="utf-8",
        )
        environment = patch.dict(os.environ, {
            "ASSET_DB_CONFIG_PATH": str(config), "ASSET_DB_PROFILE": "snapshot_test",
            "PUBLIC_CATALOG_PROFILE": "strict", "PUBLIC_CATALOG_EXPORT_ENABLED": "true",
        })
        environment.start()
        self.addCleanup(environment.stop)
        self.addCleanup(clear_engine_cache)
        connection = self._connect()
        try:
            initialize(connection, {"type": "sqlite", "database": str(self.database)}, "sqlite")
            connection.execute(
                "INSERT INTO dwp.p_asset_domain VALUES ('D01', 'Synthetic domain', 1, 'Y', 'N')"
            )
            connection.execute(
                "INSERT INTO dwp.p_asset_layer VALUES ('DWD', 'Synthetic layer', 1, 'Y', 'N')"
            )
            for role in ("maintainer", "viewer"):
                connection.execute(
                    "INSERT OR REPLACE INTO dwp.p_role "
                    "(role_code,name,builtin,enabled) VALUES (?,?,'N','Y')", (role, role),
                )
            for item in PERMISSION_DEFINITIONS:
                connection.execute(
                    "INSERT OR IGNORE INTO dwp.p_permission "
                    "(permission_code,resource,action,name,description) VALUES (?,?,?,?,?)",
                    (item.code, item.resource, item.action, item.name, item.description),
                )
            connection.execute(
                "INSERT OR IGNORE INTO dwp.p_role_permission VALUES ('maintainer','metadata:read')"
            )
            for username, role in (("snapshot-owner", "maintainer"), ("snapshot-viewer", "viewer")):
                connection.execute(
                    "INSERT INTO dwp.p_admin_user (id,username,password_hash,status,role) "
                    "VALUES (?,?,?,'enabled',?)",
                    (1 if role == "maintainer" else 2, username, "synthetic-not-a-login-hash", role),
                )
            connection.commit()
        finally:
            connection.close()
        self.issuer = Identity("maintainer", "snapshot-owner")
        self.viewer = Identity("viewer", "snapshot-viewer")
        self.assets = AssetsService()
        self.ingestion = MetadataIngestionService(db_profile="snapshot_test")
        self.authorization = AuthorizationService(DatabaseAuthorizationRepository(lambda: "snapshot_test"))
        self.now = datetime(2026, 10, 30, tzinfo=timezone.utc)
        self.clock = 100.0
        self.service = self._service()
        self._ingest([source_asset(
            description="Source table description", fields=[
                source_field("amount", ordinal=1, description="Source field description"),
                source_field("identifier", ordinal=2, description=None),
            ],
        )])
        self._sql(
            "UPDATE dwp.p_asset_table SET table_cn_name='中文表名',domain_code='D01',layer_code='DWD'"
        )
        self._sql("UPDATE dwp.p_asset_field SET field_cn_name='中文字段名' WHERE field_name='amount'")

    def _connect(self):
        return connect({"type": "sqlite", "database": str(self.database)})

    def _sql(self, sql, values=()):
        connection = self._connect()
        try:
            cursor = connection.execute(sql, values)
            result = cursor.fetchall()
            connection.commit()
            return result
        finally:
            connection.close()

    def _service(self, **options):
        return CatalogSnapshotService(
            self.assets, self.authorization, catalog_id="synthetic-catalog",
            now=lambda: self.now, clock=lambda: self.clock, **options,
        )

    def _ingest(self, assets, source="source-a"):
        request = AssetMetadataIngestionRequest.model_validate({
            "contractVersion": "1.0",
            "source": {"type": "postgresql", "name": source, "namespace": "synthetic"},
            "collector": {"name": "snapshot-test", "version": "1"}, "assets": assets,
        })
        result = self.ingestion.ingest_assets(request)
        self.assertFalse(result.get("errors"), result)
        return result

    def _lease(self, **options):
        values = {"issuer": self.issuer, "identity": self.viewer, "workload_id": "synthetic-builder", "page_size": 2}
        values.update(options)
        return self.service.issue(**values)

    @staticmethod
    def _credentials(lease):
        return {
            "catalog_id": lease.binding["catalogId"], "scope_id": lease.binding["scopeId"],
            "snapshot_id": lease.binding["snapshotId"], "workload_id": lease.binding["workloadId"],
            "proof": lease.proof,
        }

    def _pages(self, lease):
        cursor = None
        result = []
        while True:
            page = self.service.read_page(**self._credentials(lease), cursor=cursor)
            result.append(page)
            if page["final"]:
                return result
            cursor = page["nextCursor"]

    def _documents(self, lease):
        receiver = SnapshotReceiver(lease.binding, now=lambda: self.now)
        cursor = None
        for page in self._pages(lease):
            receiver.accept(page, request_cursor=cursor)
            cursor = page["nextCursor"]
        return receiver.finish(lambda: self.service.confirm_manifest(**self._credentials(lease)))

    def _client(self, *, service=True, authenticated=False, https=True):
        app = create_fastapi_app(
            assets_service_instance=self.assets,
            authorization_service_instance=self.authorization,
            catalog_snapshot_service_instance=self.service if service else None,
            identity_resolver=lambda _request: self.issuer if authenticated else None,
        )
        client = TestClient(app, base_url="https://testserver" if https else "http://testserver")
        self.addCleanup(client.close)
        return client

    @staticmethod
    def _path(lease):
        binding = lease.binding
        return f"/api/assets/snapshots/{binding['catalogId']}/{binding['scopeId']}/{binding['snapshotId']}"

    @staticmethod
    def _headers(lease):
        return {"Authorization": f"Bearer {lease.proof}", "X-DAP-Workload": lease.binding["workloadId"]}

    def _error(self, code, call):
        with self.assertRaises(SnapshotError) as caught:
            call()
        self.assertEqual(code, caught.exception.code)

    def test_full_snapshot_ids_descriptions_context_and_no_database_writes(self):
        before = self._sql("SELECT COUNT(*) FROM dwp.p_operation_log")
        lease = self._lease()
        documents = self._documents(lease)
        self.assertEqual(3, len(documents))
        table, amount, identifier = documents
        self.assertEqual("中文表名", table["displayName"])
        self.assertEqual("Source table description", table["description"])
        self.assertEqual("Source field description", amount["description"])
        self.assertEqual("中文字段名", amount["displayName"])
        self.assertIsNone(identifier["description"])
        self.assertEqual("Source table description", amount["parentDescription"])
        self.assertEqual("Synthetic domain", amount["domain"])
        self.assertEqual("DWD", amount["layer"])
        self.assertEqual(table["ref"]["assetId"], amount["ref"]["assetId"])
        self.assertGreater(amount["ref"]["fieldId"], 0)
        self.assertEqual("catalog-complete", table["fieldSetState"])
        self.assertEqual("unknown", table["sourceFieldSetState"])
        self.assertNotIn("sourceUpdatedAt", amount)
        self.assertEqual(before, self._sql("SELECT COUNT(*) FROM dwp.p_operation_log"))
        serialized = json.dumps(documents)
        for forbidden in ("schema", "owner_name", "source_key", "password", "updated_by", "fieldCount"):
            self.assertNotIn(forbidden, serialized)
        self.assertNotIn(lease.proof, repr(lease))

    def test_existing_read_is_additive_and_keeps_cn_fallback(self):
        asset_id = self._sql("SELECT asset_id FROM dwp.p_asset_table")[0][0]
        client = self._client()
        for path in (f"/api/assets/{asset_id}", "/api/assets/tables/orders"):
            response = client.get(path)
            self.assertEqual(200, response.status_code, response.text)
            fields = response.json()["data"]["fields"]
            self.assertEqual("中文字段名", fields[0]["cn"])
            self.assertEqual("Source field description", fields[0]["description"])
            self.assertIsNone(fields[1]["description"])
        fields = client.get(f"/api/assets/{asset_id}/fields").json()["items"]
        self.assertEqual("Source field description", fields[0]["description"])
        summary = client.get("/api/assets/tables?summary=1").json()["items"][0]
        self.assertEqual([], summary["fields"])

    def test_missing_null_empty_value_hashes_and_cn_are_independent(self):
        table = {"asset_id": 1, "table_name": "one", "table_cn_name": "显示"}
        field = {"asset_id": 1, "field_id": 10, "field_name": "a", "field_cn_name": "中文"}
        hashes = set()
        for extra in ({}, {"field_desc": None}, {"field_desc": ""}, {"field_desc": "source"}):
            documents = self.service._project([table], [{**field, **extra}], "strict")
            item = json.loads(documents[1])
            self.assertEqual("中文", item["displayName"])
            self.assertEqual("field_desc" in extra, "description" in item)
            hashes.add(item["projectionHash"])
        self.assertEqual(4, len(hashes))

    def test_deterministic_pages_idempotent_retry_and_frozen_metadata(self):
        lease = self._lease(page_size=1)
        pages = self._pages(lease)
        self.assertEqual([0, 1, 2], [page["pageNumber"] for page in pages])
        self.assertEqual(pages[0], self.service.read_page(**self._credentials(lease)))
        self.assertEqual(64, len(pages[0]["nextCursor"]))
        self.assertNotIn("offset", pages[0]["nextCursor"])
        with patch.object(self.assets, "_fetch_rows", side_effect=AssertionError("no metadata reread")):
            self.assertEqual(3, len(self._documents(lease)))

    def test_duplicate_missing_interrupted_and_corrupt_pages_cannot_finish(self):
        lease = self._lease(page_size=1)
        pages = self._pages(lease)
        bad_sequences = ([pages[0], pages[0]], [pages[1]], [pages[0], pages[2]], [pages[0]])
        for sequence in bad_sequences:
            with self.subTest(pages=[page["pageNumber"] for page in sequence]):
                receiver = SnapshotReceiver(lease.binding, now=lambda: self.now)
                with self.assertRaises((SnapshotIntegrityError, ValueError)):
                    cursor = None
                    for page in sequence:
                        receiver.accept(page, request_cursor=cursor)
                        cursor = page["nextCursor"]
                    receiver.finish(lambda: self.service.confirm_manifest(**self._credentials(lease)))
        for mutation in ("document", "count", "hash", "parent", "binding"):
            with self.subTest(mutation=mutation):
                corrupted = copy.deepcopy(pages)
                if mutation == "document":
                    corrupted[0]["items"][0]["description"] = "altered"
                elif mutation == "count":
                    corrupted[-1]["documentCount"] += 1
                elif mutation == "hash":
                    corrupted[-1]["manifestHash"] = "0" * 64
                elif mutation == "parent":
                    item = corrupted[1]["items"][0]
                    item["ref"]["assetId"] += 1
                    item["projectionHash"] = projection_hash(item)
                else:
                    corrupted[1]["binding"]["scopeId"] = "0" * 64
                receiver = SnapshotReceiver(lease.binding, now=lambda: self.now)
                with self.assertRaises((SnapshotIntegrityError, ValueError)):
                    cursor = None
                    for page in corrupted:
                        receiver.accept(page, request_cursor=cursor)
                        cursor = page["nextCursor"]
                    receiver.finish(lambda: self.service.confirm_manifest(**self._credentials(lease)))

    def test_cursor_proof_and_resource_bindings(self):
        first = self._lease(page_size=1)
        second = self._lease(page_size=1)
        cursor = self._pages(first)[0]["nextCursor"]
        credentials = self._credentials(first)
        for changes, code in (
            ({"proof": "x" * 43}, "SNAPSHOT_AUTH_REQUIRED"),
            ({"proof": second.proof}, "SNAPSHOT_AUTH_REQUIRED"),
            ({"catalog_id": "other-catalog"}, "SNAPSHOT_FORBIDDEN"),
            ({"scope_id": second.binding["scopeId"] + "x"}, "SNAPSHOT_FORBIDDEN"),
            ({"workload_id": "other-workload"}, "SNAPSHOT_FORBIDDEN"),
            ({"cursor": cursor[:-1] + ("0" if cursor[-1] != "0" else "1")}, "SNAPSHOT_CURSOR_INVALID"),
            ({"cursor": self._pages(second)[0]["nextCursor"]}, "SNAPSHOT_CURSOR_INVALID"),
            ({"page_size": 2}, "SNAPSHOT_CURSOR_INVALID"),
        ):
            with self.subTest(code=code, keys=list(changes)):
                self._error(code, lambda: self.service.read_page(**{**credentials, **changes}))
        other_instance = self._service()
        self._error("SNAPSHOT_EXPIRED", lambda: other_instance.read_page(**credentials))
        self.service.revoke(first.binding["snapshotId"])
        self._error("SNAPSHOT_EXPIRED", lambda: self.service.read_page(**credentials))

    def test_expiry_uses_wall_and_monotonic_clocks(self):
        for monotonic_only in (False, True):
            with self.subTest(monotonic_only=monotonic_only):
                lease = self._lease(ttl_seconds=1)
                if monotonic_only:
                    self.clock += 2
                else:
                    self.now += timedelta(seconds=2)
                self._error("SNAPSHOT_EXPIRED", lambda: self.service.read_page(**self._credentials(lease)))

    def test_current_user_role_permission_and_policy_revocation(self):
        mutations = (
            ("UPDATE dwp.p_admin_user SET status='disabled' WHERE username='snapshot-viewer'", "SNAPSHOT_AUTH_REQUIRED"),
            ("UPDATE dwp.p_role SET enabled='N' WHERE role_code='viewer'", "SNAPSHOT_FORBIDDEN"),
            ("DELETE FROM dwp.p_role_permission WHERE role_code='maintainer'", "SNAPSHOT_FORBIDDEN"),
            ("INSERT INTO dwp.p_role_permission VALUES ('viewer','root:write')", "SNAPSHOT_POLICY_CHANGED"),
        )
        for sql, code in mutations:
            with self.subTest(code=code, sql=sql):
                lease = self._lease()
                self._sql(sql)
                self._error(code, lambda: self.service.confirm_manifest(**self._credentials(lease)))
                self._sql("UPDATE dwp.p_admin_user SET status='enabled'")
                self._sql("UPDATE dwp.p_role SET enabled='Y'")
                self._sql("INSERT OR IGNORE INTO dwp.p_role_permission VALUES ('maintainer','metadata:read')")
                self._sql("DELETE FROM dwp.p_role_permission WHERE role_code='viewer'")
                self._error("SNAPSHOT_EXPIRED", lambda: self.service.read_page(**self._credentials(lease)))
        lease = self._lease()
        with patch.dict(os.environ, {"PUBLIC_CATALOG_PROFILE": "internal"}):
            self._error("SNAPSHOT_POLICY_CHANGED", lambda: self.service.read_page(**self._credentials(lease)))

    def test_strict_internal_disabled_and_no_client_profile_escalation(self):
        strict = self._lease(identity=None)
        internal = self._lease()
        self.assertNotEqual(strict.binding["scopeId"], internal.binding["scopeId"])
        with patch.dict(os.environ, {"PUBLIC_CATALOG_PROFILE": "disabled"}):
            self._error("SNAPSHOT_FORBIDDEN", lambda: self._lease(identity=None))
            valid = self._lease()
            response = self._client().get(self._path(valid), headers=self._headers(valid))
            self.assertEqual(200, response.status_code, response.text)
        with patch.dict(os.environ, {"PUBLIC_CATALOG_EXPORT_ENABLED": "false"}):
            self._error("SNAPSHOT_FORBIDDEN", lambda: self._lease(identity=None))
        client = self._client()
        for query in ("profile=internal", "allowedIds=1", "cursor=x", "pageSize=0", "pageSize=201", "pageSize=1&pageSize=2"):
            response = client.get(self._path(strict) + "?" + query, headers=self._headers(strict))
            self.assertIn(response.status_code, (409, 422), response.text)
        self._error("SNAPSHOT_FORBIDDEN", lambda: self._lease(issuer=self.viewer))
        with self.assertRaises(ValueError):
            CatalogSnapshotService(self.assets, AuthorizationService(), catalog_id="synthetic")

    def test_https_workload_only_no_cookie_fallback_no_metadata_write_rights(self):
        lease = self._lease()
        client = self._client(authenticated=True)
        path = self._path(lease)
        response = client.get(path)
        self.assertEqual(401, response.status_code)
        response = client.get(path, headers=self._headers(lease))
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual("no-store", response.headers["cache-control"])
        response = self._client(https=False).get(
            path, headers={**self._headers(lease), "X-Forwarded-Proto": "https"},
        )
        self.assertEqual(403, response.status_code)
        anonymous = self._client()
        response = anonymous.post("/api/assets/tables", json={}, headers=self._headers(lease))
        self.assertEqual(401, response.status_code)
        for method in ("post", "put", "delete"):
            response = getattr(anonymous, method)(path, headers=self._headers(lease))
            self.assertEqual(405, response.status_code)
        response = self._client(service=False).get(path, headers=self._headers(lease))
        self.assertEqual(401, response.status_code)
        disabled_authenticated = self._client(service=False, authenticated=True).get(
            path, headers=self._headers(lease),
        )
        self.assertEqual(503, disabled_authenticated.status_code)
        self.assertEqual("SNAPSHOT_DISABLED", disabled_authenticated.json()["error"]["code"])

    def test_final_online_confirmation_cannot_use_revoked_authority(self):
        lease = self._lease()
        receiver = SnapshotReceiver(lease.binding, now=lambda: self.now)
        cursor = None
        for page in self._pages(lease):
            receiver.accept(page, request_cursor=cursor)
            cursor = page["nextCursor"]
        self._sql("UPDATE dwp.p_admin_user SET status='disabled' WHERE username='snapshot-owner'")
        self._error("SNAPSHOT_AUTH_REQUIRED", lambda: receiver.finish(
            lambda: self.service.confirm_manifest(**self._credentials(lease)),
        ))
        self._sql("UPDATE dwp.p_admin_user SET status='enabled'")
        with self.assertRaises(SnapshotIntegrityError):
            receiver.finish(lambda: self.service.confirm_manifest(**self._credentials(lease)))

    def test_permission_revocation_during_capture_or_page_is_not_released(self):
        capture = self.assets.capture_catalog_rows

        def revoked_capture(**options):
            rows = capture(**options)
            self._sql("UPDATE dwp.p_admin_user SET status='disabled' WHERE username='snapshot-owner'")
            return rows

        with patch.object(self.assets, "capture_catalog_rows", side_effect=revoked_capture):
            self._error("SNAPSHOT_AUTH_REQUIRED", self._lease)
        self.assertEqual({}, self.service._snapshots)
        self._sql("UPDATE dwp.p_admin_user SET status='enabled'")
        lease = self._lease()
        check = self.service._check
        calls = []

        def revoked_page(snapshot, **credentials):
            check(snapshot, **credentials)
            calls.append(1)
            if len(calls) == 1:
                self._sql("UPDATE dwp.p_admin_user SET status='disabled' WHERE username='snapshot-viewer'")

        with patch.object(self.service, "_check", side_effect=revoked_page):
            self._error("SNAPSHOT_AUTH_REQUIRED", lambda: self.service.read_page(**self._credentials(lease)))

    def test_partial_failure_unknown_fields_and_sensitive_content_never_become_empty(self):
        fetch = self.assets._fetch_rows
        calls = []

        def fail_fields(statement):
            calls.append(1)
            if len(calls) == 2:
                raise AssetDataSourceError("synthetic private query detail")
            return fetch(statement)

        with patch.object(self.assets, "_fetch_rows", side_effect=fail_fields):
            self._error("SNAPSHOT_UNAVAILABLE", self._lease)
        self.assertEqual({}, self.service._snapshots)
        self._sql("UPDATE dwp.p_asset_field SET field_desc='password=synthetic-fixture' WHERE field_name='amount'")
        self._error("SNAPSHOT_CONTENT_REJECTED", self._lease)
        self.assertEqual({}, self.service._snapshots)
        self._sql("UPDATE dwp.p_asset_field SET field_desc='jdbc:postgresql://example.invalid/synthetic'")
        self._error("SNAPSHOT_CONTENT_REJECTED", self._lease)

    def test_hidden_columns_do_not_change_authorized_hash(self):
        before = self._lease(identity=None)
        self._sql(
            "UPDATE dwp.p_asset_table SET schema_name='SYNTHETIC_OTHER',owner_name='Synthetic hidden owner',updated_by='hidden'"
        )
        after = self._lease(identity=None)
        self.assertEqual(before.binding["dataRevision"], after.binding["dataRevision"])
        self.assertEqual(self._documents(before), self._documents(after))

    def test_resource_bounds_wide_table_empty_and_capture_timeout(self):
        self.service = self._service(max_documents=2)
        self._error("SNAPSHOT_LIMIT", self._lease)
        self.service = self._service(max_bytes=1024)
        self._error("SNAPSHOT_LIMIT", self._lease)
        self.service = self._service(capture_timeout=0.000001)
        self._error("CAPTURE_TIMEOUT", self._lease)
        self.assertEqual({}, self.service._snapshots)
        self.service = self._service()
        self._ingest([source_asset(fields=[source_field(f"f{number}", ordinal=number + 1) for number in range(501)])])
        lease = self._lease(page_size=200)
        pages = self._pages(lease)
        self.assertEqual([200, 200, 102], [len(page["items"]) for page in pages])
        self.assertEqual(502, len(self._documents(lease)))
        asset_id = self._sql("SELECT asset_id FROM dwp.p_asset_table")[0][0]
        self.assets.delete_asset_table_by_id(asset_id)
        empty = self._lease()
        self.assertEqual((), self._documents(empty))
        self.assertTrue(self._pages(empty)[0]["final"])
        self.assertEqual(0, self._pages(empty)[0]["documentCount"])

    def test_text_budget_capacity_and_readonly_connection_restoration(self):
        self._sql("UPDATE dwp.p_asset_field SET field_desc=?", ("x" * 16385,))
        self._error("SNAPSHOT_LIMIT", self._lease)
        self._sql("UPDATE dwp.p_asset_field SET field_desc=NULL")
        self.service = self._service(max_snapshots=1)
        self._lease()
        self._error("SNAPSHOT_BUSY", self._lease)
        self.now += timedelta(seconds=301)
        self._lease()
        with catalog_read_transaction("snapshot_test", timeout_seconds=1):
            connection = active_transaction_connection("snapshot_test")
            with self.assertRaises(sqlite3.OperationalError):
                connection.execute("DELETE FROM dwp.p_asset_field")
        connection = self._connect()
        try:
            self.assertEqual(0, connection.execute("PRAGMA query_only").fetchone()[0])
            self.assertFalse(connection.in_transaction)
        finally:
            connection.close()

    def test_other_providers_and_memory_are_rejected_before_connecting(self):
        for provider in ("postgres", "mysql", "gaussdb", "sqlite"):
            with self.subTest(provider=provider), patch(
                "backend.app.db.catalog_capture.get_db_profile",
                return_value={"type": provider, "database": ":memory:"},
            ), patch("backend.app.db.catalog_capture.database_transaction") as transaction:
                with self.assertRaises(CatalogCaptureUnsupported):
                    with catalog_read_transaction("unused", timeout_seconds=1):
                        self.fail("unsupported provider yielded a transaction")
                transaction.assert_not_called()

    def test_snapshot_identity_lifecycle_governance_and_multiple_sources(self):
        def read_current():
            lease = self._lease(page_size=200)
            documents = self._documents(lease)
            self.service.revoke(lease.binding["snapshotId"])
            return documents

        original = read_current()
        asset_id = original[0]["ref"]["assetId"]
        original_ids = {item["name"]: item["ref"]["fieldId"] for item in original[1:]}
        current = self.assets.get_asset_detail_by_id(asset_id)
        self._sql("INSERT INTO dwp.p_asset_domain VALUES ('D02','Next synthetic domain',2,'Y','N')")
        self._sql("INSERT INTO dwp.p_asset_layer VALUES ('DM','Next synthetic layer',2,'Y','N')")
        for item in current["fields"]:
            if item["name"] == "amount":
                item.update(cn="治理中文名", enum="SYNTHETIC_A,SYNTHETIC_B")
        self.assets.update_asset_table_by_id(asset_id, {
            "name": "orders", "cn": "治理表名", "domain": "Next synthetic domain", "layer": "DM",
            "owner": "Synthetic owner", "grain": "One synthetic row", "cycle": "Daily",
            "fields": current["fields"],
        })
        governed = read_current()
        amount = next(item for item in governed if item["name"] == "amount")
        self.assertEqual(original_ids["amount"], amount["ref"]["fieldId"])
        self.assertEqual("Source field description", amount["description"])
        self.assertEqual("治理中文名", amount["displayName"])
        self.assertEqual("SYNTHETIC_A,SYNTHETIC_B", amount["enumeration"])
        self.assertEqual("Next synthetic domain", amount["domain"])
        self.assertEqual("DM", amount["layer"])
        self.assertNotEqual(original[1]["projectionHash"], amount["projectionHash"])
        self._ingest([source_asset(fields=[
            source_field("AMOUNT", ordinal=1, description="Updated source description"),
            source_field("identifier", ordinal=2, description=None),
        ])])
        changed = read_current()
        amount = next(item for item in changed if item["name"] == "AMOUNT")
        self.assertEqual(original_ids["amount"], amount["ref"]["fieldId"])
        self.assertEqual("Updated source description", amount["description"])
        self.assertEqual("治理中文名", amount["displayName"])
        self._ingest([source_asset(fields=[source_field("renamed_amount", ordinal=1)])])
        renamed = read_current()[1]
        renamed_id = renamed["ref"]["fieldId"]
        self.assertNotIn(renamed_id, original_ids.values())
        self.assertEqual("renamed_amount", renamed["name"])
        self._ingest([source_asset(fields=[source_field("amount", ordinal=1)])])
        recreated = read_current()
        recreated_id = recreated[1]["ref"]["fieldId"]
        self.assertNotIn(recreated_id, {*original_ids.values(), renamed_id})
        # Absent fields preserves the catalog set. An authoritative [] removes it.
        self._ingest([source_asset()])
        self.assertEqual(recreated, read_current())
        self._ingest([source_asset(fields=[])])
        only_table = read_current()
        self.assertEqual(1, len(only_table))
        self.assertEqual("catalog-complete", only_table[0]["fieldSetState"])
        self.assertEqual("unknown", only_table[0]["sourceFieldSetState"])
        self._ingest([source_asset(fields=[source_field("amount", ordinal=1)])])
        before_delete_id = read_current()[1]["ref"]["fieldId"]
        self.assets.delete_asset_table_by_id(asset_id)
        self.assertEqual((), read_current())
        self._ingest([source_asset(fields=[source_field("amount", ordinal=1)])])
        restored = read_current()
        self.assertEqual(asset_id, restored[0]["ref"]["assetId"])
        self.assertGreater(restored[1]["ref"]["fieldId"], before_delete_id)
        self._ingest([source_asset(fields=[source_field("amount", ordinal=1)])], source="source-b")
        both = read_current()
        tables = [item for item in both if item["ref"]["entityType"] == "table"]
        fields = [item for item in both if item["ref"]["entityType"] == "field"]
        self.assertEqual(["orders", "orders"], [item["name"] for item in tables])
        self.assertEqual(2, len({item["ref"]["assetId"] for item in tables}))
        self.assertEqual(2, len({item["ref"]["fieldId"] for item in fields}))
        self.assertEqual({item["ref"]["assetId"] for item in tables}, {item["ref"]["assetId"] for item in fields})

    def test_receiver_identity_parent_order_and_confirmation_expiry(self):
        documents = list(self._documents(self._lease()))
        for ref in (
            {"entityType": "field", "assetId": 1},
            {"entityType": "table", "assetId": 0},
            {"entityType": "table", "assetId": True},
            {"entityType": "table", "assetId": 1, "fieldId": None},
        ):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                EntityRef.model_validate(ref)
        for mutation in ("order", "duplicate", "parent", "unknown-key"):
            modified = copy.deepcopy(documents)
            if mutation == "order":
                modified.reverse()
            elif mutation == "duplicate":
                modified.append(copy.deepcopy(modified[-1]))
            elif mutation == "parent":
                modified[1]["parentName"] = "wrong"
                modified[1]["projectionHash"] = projection_hash(modified[1])
            else:
                modified[1]["unexpected"] = "not approved"
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                validate_documents(modified)
        lease = self._lease(ttl_seconds=1, page_size=200)
        receiver = SnapshotReceiver(lease.binding, now=lambda: self.now)
        receiver.accept(self._pages(lease)[0])

        def confirmed_then_expired():
            confirmation = self.service.confirm_manifest(**self._credentials(lease))
            self.now += timedelta(seconds=2)
            return confirmation

        with self.assertRaises(SnapshotIntegrityError):
            receiver.finish(confirmed_then_expired)

    def test_receiver_cursor_cycle_and_memory_budget_reject_completion(self):
        lease = self._lease(page_size=1)
        pages = self._pages(lease)
        pages[1]["nextCursor"] = pages[0]["nextCursor"]
        receiver = SnapshotReceiver(lease.binding, now=lambda: self.now)
        receiver.accept(pages[0])
        with self.assertRaises(SnapshotIntegrityError):
            receiver.accept(pages[1], request_cursor=pages[0]["nextCursor"])
        for options in ({"max_documents": 0}, {"max_bytes": 1}):
            receiver = SnapshotReceiver(lease.binding, now=lambda: self.now, **options)
            with self.assertRaises(SnapshotIntegrityError):
                receiver.accept(pages[0])

    def test_authority_failure_invalid_policy_and_unexpected_errors_are_safe(self):
        lease = self._lease()
        client = self._client()
        with patch.object(self.authorization.repository, "get_subject", side_effect=RuntimeError("synthetic private diagnostic")):
            response = client.get(self._path(lease), headers=self._headers(lease))
            self.assertEqual(503, response.status_code)
            self.assertNotIn("diagnostic", response.text)
            self.assertNotIn(lease.proof, response.text)
        self._error("SNAPSHOT_EXPIRED", lambda: self.service.read_page(**self._credentials(lease)))
        lease = self._lease()
        with patch.dict(os.environ, {"PUBLIC_CATALOG_PROFILE": "not-a-policy"}):
            self._error("SNAPSHOT_UNAVAILABLE", lambda: self.service.read_page(**self._credentials(lease)))
        with patch.object(self.service, "read_page", side_effect=RuntimeError("synthetic private diagnostic")):
            response = client.get(self._path(lease), headers=self._headers(lease))
            self.assertEqual(503, response.status_code)
            self.assertEqual("no-store", response.headers["cache-control"])
            self.assertNotIn("diagnostic", response.text)

    def test_workload_secret_is_independent_and_rejected_text_has_no_output(self):
        lease = self._lease()
        with patch("backend.app.settings.get_session_secret", side_effect=AssertionError("no session secret use")):
            self.assertEqual(3, len(self._documents(lease)))
        self.service.revoke(lease.binding["snapshotId"])
        for text in (
            "Bearer synthetic-fixture", "-----BEGIN PRIVATE KEY----- synthetic fixture",
            "username=synthetic-fixture", "host=example.invalid", "source_path=/synthetic/file",
        ):
            with self.subTest(text=text):
                self._sql("UPDATE dwp.p_asset_field SET enum_desc=?", (text,))
                self._error("SNAPSHOT_CONTENT_REJECTED", self._lease)
                self.assertEqual({}, self.service._snapshots)

    def test_concurrent_issuance_is_bounded_without_blocking_or_partial_lease(self):
        started = threading.Event()
        release = threading.Event()
        capture = self.assets.capture_catalog_rows
        leases, errors = [], []

        def held_capture(**options):
            started.set()
            if not release.wait(10):
                raise AssertionError("test did not release capture")
            return capture(**options)

        def issue():
            try:
                leases.append(self._lease())
            except BaseException as error:
                errors.append(error)

        with patch.object(self.assets, "capture_catalog_rows", side_effect=held_capture):
            worker = threading.Thread(target=issue)
            worker.start()
            try:
                self.assertTrue(started.wait(10))
                self._error("SNAPSHOT_BUSY", self._lease)
            finally:
                release.set()
                worker.join(15)
        self.assertFalse(worker.is_alive())
        self.assertEqual([], errors)
        self.assertEqual(1, len(leases))
        self.assertEqual(3, len(self._documents(leases[0])))

    def test_raw_byte_budget_rejects_before_payload_transfer(self):
        self._sql("UPDATE dwp.p_asset_field SET field_desc=?", ("x" * 2048,))
        self.service = self._service(max_bytes=1024)
        with patch.object(self.assets, "_fetch_rows", side_effect=AssertionError("payload transfer must not start")):
            self._error("SNAPSHOT_LIMIT", self._lease)
        self.assertEqual({}, self.service._snapshots)

    def test_embedded_nul_in_table_or_field_text_is_rejected_before_truncation(self):
        cases = (
            ("UPDATE dwp.p_asset_table SET table_desc=?", "Visible\x00table suffix", "Source table description"),
            ("UPDATE dwp.p_asset_field SET field_desc=? WHERE field_name='amount'", "Visible\x00field suffix", "Source field description"),
        )
        for statement, invalid_text, original_text in cases:
            with self.subTest(statement=statement):
                self._sql(statement, (invalid_text,))
                with patch.object(self.assets, "_fetch_rows", side_effect=AssertionError("truncated payload must not transfer")):
                    self._error("SNAPSHOT_CONTENT_REJECTED", self._lease)
                self.assertEqual({}, self.service._snapshots)
                self._sql(statement, (original_text,))

    def test_parent_context_amplification_is_bounded_during_projection(self):
        self.service = self._service(max_bytes=10240)
        tables = [{"asset_id": 1, "table_name": "one", "table_desc": "x" * 3000}]
        fields = [{"asset_id": 1, "field_id": number + 1, "field_name": f"f{number}"} for number in range(501)]
        with patch.object(self.service, "_seal", wraps=self.service._seal) as seal:
            self._error("SNAPSHOT_LIMIT", lambda: self.service._project(tables, fields, "strict"))
            self.assertLess(seal.call_count, 5)

    def _concurrent_capture(self, journal_mode):
        self._sql(f"PRAGMA dwp.journal_mode={journal_mode}")
        before = self._lease()
        initial = self._documents(before)
        table_read = threading.Event()
        applied = threading.Event()
        committed = threading.Event()
        errors = []

        def writer():
            try:
                if not table_read.wait(10):
                    raise AssertionError("capture did not reach table read")
                connection = self._connect()
                try:
                    connection.execute("PRAGMA busy_timeout=10000")
                    connection.execute("UPDATE dwp.p_asset_table SET table_desc='Concurrent new table',table_cn_name='新中文'")
                    connection.execute("UPDATE dwp.p_asset_domain SET domain_name='New domain'")
                    connection.execute("UPDATE dwp.p_asset_layer SET layer_name='New layer'")
                    connection.execute("UPDATE dwp.p_asset_field SET field_desc='Concurrent new field',field_name='renamed' WHERE field_name='amount'")
                    connection.execute("UPDATE dwp.p_asset_field SET is_deleted='Y' WHERE field_name='identifier'")
                    connection.execute(
                        "INSERT INTO dwp.p_asset_field "
                        "(field_id,asset_id,field_name,field_order,nullable_flag,pk_flag,partition_flag,is_deleted,created_by,updated_by) "
                        "SELECT 900,asset_id,'concurrent_added',99,'Y','N','N','N','test','test' FROM dwp.p_asset_table LIMIT 1"
                    )
                    connection.execute(
                        "INSERT INTO dwp.p_asset_table "
                        "(asset_id,table_name,schema_name,field_count,is_deleted,created_by,updated_by) "
                        "VALUES (900,'concurrent_table','synthetic',0,'N','test','test')"
                    )
                    applied.set()
                    connection.commit()
                    committed.set()
                finally:
                    connection.close()
            except BaseException as error:
                errors.append(error)
                applied.set()
                committed.set()

        worker = threading.Thread(target=writer)
        worker.start()
        fetch = self.assets._fetch_rows
        calls = []

        def interleaved(statement):
            rows = fetch(statement)
            calls.append(1)
            if len(calls) == 1:
                table_read.set()
                self.assertTrue(applied.wait(10))
                if journal_mode == "WAL":
                    self.assertTrue(committed.wait(10))
                else:
                    self.assertFalse(committed.is_set(), "rollback-journal writer must wait for read view")
            return rows

        try:
            with patch.object(self.assets, "_fetch_rows", side_effect=interleaved):
                during = self._lease()
        finally:
            worker.join(15)
        self.assertFalse(worker.is_alive())
        self.assertEqual([], errors)
        self.assertTrue(committed.is_set())
        self.assertEqual(initial, self._documents(during))
        self.assertEqual(before.binding["dataRevision"], during.binding["dataRevision"])
        after = self._lease()
        changed = self._documents(after)
        self.assertNotEqual(during.binding["dataRevision"], after.binding["dataRevision"])
        self.assertTrue(any(item["name"] == "concurrent_table" for item in changed))
        self.assertTrue(any(item["name"] == "concurrent_added" for item in changed))
        self.assertFalse(any(item["name"] == "identifier" for item in changed))
        renamed = next(item for item in changed if item["name"] == "renamed")
        self.assertEqual("Concurrent new table", renamed["parentDescription"])
        self.assertEqual("New domain", renamed["domain"])
        self.assertEqual("New layer", renamed["layerDisplayName"])

    def test_wal_concurrent_add_update_delete_is_one_view(self):
        self._concurrent_capture("WAL")

    def test_rollback_journal_capture_blocks_commit_without_torn_reads(self):
        self._concurrent_capture("DELETE")


if __name__ == "__main__":
    unittest.main()
