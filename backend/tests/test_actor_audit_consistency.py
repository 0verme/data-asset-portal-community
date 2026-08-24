"""Focused CRUD regressions for business-row and operation-log actor parity."""

# pyright: reportMissingImports=false

from __future__ import annotations

from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from sqlalchemy.dialects import sqlite

from backend.app.application import ActorSource, Identity, RequestContext, actor_scope, request_context_scope, resolve_actor
from backend.app.services.api_asset_service import ApiAssetService
from backend.app.services.assets_service import AssetsService
from backend.app.services.metadata_ingestion_service import MetadataIngestionService


class _AuditRecorder:
    def __init__(self, events, **kwargs):
        self.events = events
        self.kwargs = kwargs
        self.handle = SimpleNamespace(
            operation_object=kwargs.get("operation_object"),
            before=None,
            after=None,
        )

    def __enter__(self):
        self.actor = resolve_actor()
        self.events.append(self)
        return self.handle

    def __exit__(self, exc_type, exc_value, traceback):
        return False


def _audit_factory(events):
    return lambda **kwargs: _AuditRecorder(events, **kwargs)


def _statement_params(statement):
    return statement.compile(dialect=sqlite.dialect()).params


class AssetAuditConsistencyTests(unittest.TestCase):
    def setUp(self):
        self.service = AssetsService()
        self.table = {
            "name": "orders",
            "cn": "订单",
            "domain": "客户域",
            "layer": "DWA",
            "schema": "DWS_DWA",
            "owner": "owner",
            "grain": "one row",
            "cycle": "daily",
            "desc": "orders",
            "fields": [
                {
                    "name": "order_id",
                    "cn": "订单号",
                    "type": "string",
                    "nullable": False,
                    "pk": True,
                    "part": False,
                    "enum": None,
                }
            ],
            "current_name": None,
        }

    def _prepare(self):
        self.service._validate_table_payload = MagicMock(return_value=self.table)
        self.service._ensure_db_table_absent = MagicMock()
        self.service._load_domain_mappings = MagicMock(return_value=({}, {"客户域": "D01"}))
        self.service._get_db_asset_detail = MagicMock(return_value={"name": "orders", "fields": []})
        self.service._with_empty_asset_risks = MagicMock(side_effect=lambda value: value)
        self.service._execute_statements = MagicMock()

    def test_authenticated_create_uses_request_actor_even_when_explicit_actor_is_supplied(self):
        self._prepare()
        self.service._get_next_id = MagicMock(side_effect=[7, 8, 9])
        events = []

        with patch("backend.app.services.assets_service.operation_log_service.audit", side_effect=_audit_factory(events)):
            with request_context_scope(
                RequestContext(
                    identity=Identity("maintainer", "alice", "Alice"),
                    method="POST",
                    path="/api/assets/tables",
                )
            ):
                self.service.create_asset_table({"name": "orders"}, actor="forged-client")

        self.assertEqual(1, len(events))
        self.assertEqual(ActorSource.REQUEST, events[0].actor.source)
        self.assertEqual("alice", events[0].actor.name)
        statements = self.service._execute_statements.call_args.args[0]
        audit_values = []
        for statement in statements:
            params = _statement_params(statement)
            for key in ("created_by", "updated_by", "operator_name"):
                if key in params:
                    audit_values.append(params[key])
        self.assertTrue(audit_values)
        self.assertEqual({"alice"}, set(audit_values))

    def test_update_keeps_created_row_and_change_log_actor_aligned(self):
        self._prepare()
        self.service._get_db_asset_detail_row = MagicMock(return_value={"asset_id": 7})
        self.service._get_next_id = MagicMock(side_effect=[8, 9])
        events = []

        with patch("backend.app.services.assets_service.operation_log_service.audit", side_effect=_audit_factory(events)):
            with request_context_scope(
                RequestContext(
                    identity=Identity("maintainer", "bob", "Bob"),
                    method="PUT",
                    path="/api/assets/tables/orders",
                )
            ):
                self.service.update_asset_table("orders", {"name": "orders"})

        self.assertEqual("bob", events[0].actor.name)
        statements = self.service._execute_statements.call_args.args[0]
        values = []
        for statement in statements:
            params = _statement_params(statement)
            for key in ("created_by", "updated_by", "operator_name"):
                if key in params:
                    values.append(params[key])
        self.assertTrue(values)
        self.assertEqual({"bob"}, set(values))
        update_params = _statement_params(statements[0])
        self.assertEqual("bob", update_params["updated_by"])
        self.assertNotIn("created_by", update_params)


class MetadataIngestionAuditRegressionTests(unittest.TestCase):
    def test_explicit_ingestion_actor_reaches_asset_fields_and_change_log(self):
        service = MetadataIngestionService(db=MagicMock())
        item = {
            "name": "orders",
            "description": "orders",
            "schema": "external",
            "catalog": "",
            "database": "",
            "source_key": "source-1",
            "asset_type": "table",
            "external_id": "orders",
            "qualified_name": "external.orders",
            "fields": [
                {
                    "name": "order_id",
                    "description": "订单号",
                    "type": "string",
                    "nullable": False,
                    "pk": True,
                    "part": False,
                }
            ],
        }

        with actor_scope(resolve_actor(explicit_actor="metadata-ingestion")):
            statements, field_rows, _ = service._asset_statements(
                item,
                asset_id=7,
                field_id_start=8,
                change_id=9,
                current=None,
            )

        asset_params = _statement_params(statements[0])
        change_params = _statement_params(statements[1])
        self.assertEqual("metadata-ingestion", asset_params["created_by"])
        self.assertEqual("metadata-ingestion", asset_params["updated_by"])
        self.assertEqual("metadata-ingestion", field_rows[0]["created_by"])
        self.assertEqual("metadata-ingestion", field_rows[0]["updated_by"])
        self.assertEqual("metadata-ingestion", change_params["operator_name"])


class ApiAssetAuditRegressionTests(unittest.TestCase):
    def setUp(self):
        self.service = ApiAssetService()
        self.item = {
            "code": "CUSTOMER_API",
            "name": "Customer API",
            "method": "GET",
            "path": "/customers",
            "version": "v1",
            "systemId": 3,
            "type": "query",
            "status": "enabled",
            "ownerDept": "platform",
            "ownerName": "tester",
            "maintainerName": "tester",
            "description": "customer endpoint",
            "remark": "remark",
        }

    def test_http_create_and_update_never_fall_back_to_system(self):
        self.service._validate_asset = MagicMock(return_value=self.item)
        self.service._exists = MagicMock(return_value=False)
        self.service._next = MagicMock(return_value=7)
        self.service._execute = MagicMock()
        self.service.get_asset = MagicMock(return_value={**self.item, "updatedBy": "alice"})
        events = []

        with patch("backend.app.services.api_asset_service.operation_log_service.audit", side_effect=_audit_factory(events)):
            with request_context_scope(
                RequestContext(identity=Identity("maintainer", "alice", "Alice"), method="POST", path="/api/api-assets")
            ):
                self.service.create(self.item, actor="system")

            create_params = _statement_params(self.service._execute.call_args.args[0][0])
            self.assertEqual("alice", create_params["created_by"])
            self.assertEqual("alice", create_params["updated_by"])

            self.service._execute.reset_mock()
            with request_context_scope(
                RequestContext(identity=Identity("maintainer", "bob", "Bob"), method="PUT", path="/api/api-assets/CUSTOMER_API")
            ):
                self.service.update("CUSTOMER_API", self.item, actor="system")

        update_params = _statement_params(self.service._execute.call_args.args[0][0])
        self.assertEqual("bob", update_params["updated_by"])
        self.assertNotEqual("system", update_params["updated_by"])
        self.assertEqual(["alice", "bob"], [event.actor.name for event in events])


if __name__ == "__main__":
    unittest.main()
