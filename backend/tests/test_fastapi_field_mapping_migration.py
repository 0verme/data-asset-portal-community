"""Flask/FastAPI parity tests for the P4 Field Mapping migration."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app


SOURCE_SYSTEM = {
    "name": "CRM",
    "count": 2,
    "dataSourceId": 7,
    "upstreamSystemId": 7,
    "systemCode": "CRM",
    "systemAbbr": "mysql",
}
FIELD_MAPPING = {
    "dataSourceId": 7,
    "upstreamSystemId": 7,
    "systemCode": "CRM",
    "srcSystem": "CRM",
    "systemAbbr": "mysql",
    "srcTable": "customer",
    "srcTableCn": "Customer",
    "srcField": "id",
    "srcType": "BIGINT",
    "srcComment": "identifier",
    "targetLayer": "DWD",
    "targetTable": "dwd_customer",
    "loadMode": "full",
    "targetField": "customer_id",
    "mappingRule": "direct",
    "updatedAt": "2026-08-20",
}
TABLE_MAPPING = {
    "dataSourceId": 7,
    "upstreamSystemId": 7,
    "systemCode": "CRM",
    "srcSystem": "CRM",
    "systemAbbr": "mysql",
    "srcTable": "customer",
    "srcTableCn": "Customer",
    "targetLayer": "DWD",
    "targetTable": "dwd_customer",
    "loadMode": "full",
    "fieldCount": 2,
    "mappedCount": 2,
    "emptyCommentCount": 0,
    "emptyCommentRate": 0,
    "updatedAt": "2026-08-20",
}
STATS = {
    "sourceSystemCount": 1,
    "sourceTableCount": 1,
    "fieldCount": 2,
    "mappedFieldCount": 2,
    "unmappedFieldCount": 0,
    "emptyCommentCount": 0,
    "emptyCommentRate": 0,
    "coverage": 100,
}
PAGE = {"items": [FIELD_MAPPING], "total": 1, "page": 1, "pageSize": 50}
TABLE_PAGE = {"items": [TABLE_MAPPING], "total": 1, "page": 1, "pageSize": 50}


class FastApiFieldMappingMigrationTests(unittest.TestCase):
    def setUp(self):
        self._old_secret = os.environ.get("FLASK_SECRET_KEY")
        os.environ["FLASK_SECRET_KEY"] = "test-fastapi-field-mapping"
        self.addCleanup(self._restore_secret)
        self.capabilities = resolve_capabilities(edition="community")

    def _restore_secret(self):
        if self._old_secret is None:
            os.environ.pop("FLASK_SECRET_KEY", None)
        else:
            os.environ["FLASK_SECRET_KEY"] = self._old_secret

    def _apps(self, service):
        flask_app = create_app(capabilities=self.capabilities)
        flask_app.config.update(TESTING=True)
        service_patch = patch("backend.app.routes.field_mapping.field_mapping_service", service)
        service_patch.start()
        self.addCleanup(service_patch.stop)
        fastapi_app = create_fastapi_app(
            capabilities=self.capabilities,
            field_mapping_service_instance=service,
        )
        return flask_app, fastapi_app

    def test_source_systems_and_stats_have_parity(self):
        service = MagicMock()
        service.get_source_systems.return_value = [SOURCE_SYSTEM]
        service.get_stats.return_value = STATS
        flask_app, fastapi_app = self._apps(service)
        flask_client = flask_app.test_client()
        fastapi_client = TestClient(fastapi_app)

        flask_sources = flask_client.get("/api/field-mappings/source-systems")
        fastapi_sources = fastapi_client.get("/api/field-mappings/source-systems")
        self.assertEqual(flask_sources.get_json(), fastapi_sources.json())

        flask_stats = flask_client.get("/api/field-mappings/stats?dataSourceId=7")
        fastapi_stats = fastapi_client.get("/api/field-mappings/stats?dataSourceId=7")
        self.assertEqual(flask_stats.get_json(), fastapi_stats.json())
        self.assertEqual(1, fastapi_stats.json()["data"]["sourceSystemCount"])

    def test_field_and_table_pages_preserve_query_aliases_and_pagination(self):
        service = MagicMock()
        service.get_field_mappings.return_value = PAGE
        service.get_table_mappings.return_value = TABLE_PAGE
        flask_app, fastapi_app = self._apps(service)
        query = "/api/field-mappings/fields?dataSourceId=7&page=1&pageSize=50&sortKey=srcField"
        flask_response = flask_app.test_client().get(query)
        fastapi_response = TestClient(fastapi_app).get(query)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())

        table_query = "/api/field-mappings/tables?sourceSystemId=7&page=1&pageSize=50"
        flask_table = flask_app.test_client().get(table_query)
        fastapi_table = TestClient(fastapi_app).get(table_query)
        self.assertEqual(flask_table.get_json(), fastapi_table.json())
        self.assertEqual(1, fastapi_table.json()["total"])

    def test_community_boundary_excludes_private_routes(self):
        service = MagicMock()
        _, fastapi_app = self._apps(service)
        client = TestClient(fastapi_app)
        self.assertEqual(404, client.get("/api/reports").status_code)
        self.assertEqual(404, client.get("/api/push").status_code)
        self.assertEqual(404, client.get("/api/manual-code-tables").status_code)


if __name__ == "__main__":
    unittest.main()
