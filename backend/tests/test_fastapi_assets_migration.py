"""Flask/FastAPI parity tests for the P4 Assets module migration."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.app.application import Identity
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.assets_service import AssetNotFoundError


ASSET = {
    "name": "DWS_CUSTOMER",
    "cn": "Customer",
    "domain": "营销",
    "layer": "DWM",
    "owner": "tester",
    "grain": "customer",
    "cycle": "daily",
    "desc": "demo",
    "schema": "DWS_DWM",
    "fieldCount": 1,
    "fields": [
        {
            "name": "ID",
            "cn": "id",
            "type": "BIGINT",
            "nullable": False,
            "pk": True,
            "part": False,
            "enum": None,
        }
    ],
    "assetRisks": [],
}


class FastApiAssetsMigrationTests(unittest.TestCase):
    def setUp(self):
        self._old_secret = os.environ.get("FLASK_SECRET_KEY")
        os.environ["FLASK_SECRET_KEY"] = "test-fastapi-assets"
        self.addCleanup(self._restore_secret)
        self.capabilities = resolve_capabilities(edition="community")

    def _restore_secret(self):
        if self._old_secret is None:
            os.environ.pop("FLASK_SECRET_KEY", None)
        else:
            os.environ["FLASK_SECRET_KEY"] = self._old_secret

    def _apps(self, service, *, identity=None):
        flask_app = create_app(capabilities=self.capabilities)
        flask_app.config.update(TESTING=True)
        service_patch = patch("backend.app.routes.assets.assets_service", service)
        service_patch.start()
        self.addCleanup(service_patch.stop)
        fastapi_app = create_fastapi_app(
            capabilities=self.capabilities,
            identity_resolver=lambda _request: identity,
            assets_service_instance=service,
        )
        return flask_app, fastapi_app

    @staticmethod
    def _login_as_maintainer(flask_app):
        client = flask_app.test_client()
        with client.session_transaction() as session:
            session["dap_auth_user"] = {
                "role": "maintainer",
                "user": "tester",
                "name": "Tester",
            }
        return client

    def test_summary_flow_has_flask_fastapi_parity_and_pagination_contract(self):
        service = MagicMock()
        service.get_asset_table_page.return_value = {
            "items": [ASSET],
            "page": 2,
            "pageSize": 20,
            "total": 21,
        }
        flask_app, fastapi_app = self._apps(service)

        flask_response = flask_app.test_client().get(
            "/api/assets/tables?summary=true&page=2&pageSize=20"
        )
        fastapi_response = TestClient(fastapi_app).get(
            "/api/assets/tables?summary=true&page=2&pageSize=20"
        )

        self.assertEqual(flask_response.status_code, fastapi_response.status_code)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())
        self.assertEqual(21, fastapi_response.json()["total"])

    def test_detail_and_fields_reuse_shared_asset_service(self):
        service = MagicMock()
        service.get_asset_detail.return_value = ASSET
        service.get_asset_fields.return_value = ASSET["fields"]
        flask_app, fastapi_app = self._apps(service)
        flask_client = flask_app.test_client()
        fastapi_client = TestClient(fastapi_app)

        flask_detail = flask_client.get("/api/assets/tables/DWS_CUSTOMER")
        fastapi_detail = fastapi_client.get("/api/assets/tables/DWS_CUSTOMER")
        self.assertEqual(flask_detail.get_json(), fastapi_detail.json())

        flask_fields = flask_client.get("/api/assets/tables/DWS_CUSTOMER/fields")
        fastapi_fields = fastapi_client.get("/api/assets/tables/DWS_CUSTOMER/fields")
        self.assertEqual(flask_fields.get_json(), fastapi_fields.json())
        service.get_asset_detail.assert_called_with("DWS_CUSTOMER")
        service.get_asset_fields.assert_called_with("DWS_CUSTOMER")

    def test_authenticated_create_flow_preserves_body_and_response(self):
        service = MagicMock()
        service.create_asset_table.return_value = ASSET
        flask_app, fastapi_app = self._apps(
            service, identity=Identity("maintainer", "tester", "Tester")
        )
        flask_client = self._login_as_maintainer(flask_app)
        body = {
            "name": "DWS_CUSTOMER",
            "cn": "Customer",
            "domain": "营销",
            "layer": "DWM",
            "schema": "DWS_DWM",
            "fields": ASSET["fields"],
        }

        flask_response = flask_client.post("/api/assets/tables", json=body)
        fastapi_response = TestClient(fastapi_app).post("/api/assets/tables", json=body)

        self.assertEqual(201, flask_response.status_code)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())
        service.create_asset_table.assert_called_with(body)

    def test_auth_and_not_found_error_parity(self):
        service = MagicMock()
        service.get_asset_detail.side_effect = AssetNotFoundError("MISSING")
        flask_app, fastapi_app = self._apps(service)
        flask_response = flask_app.test_client().get("/api/assets/tables/MISSING")
        fastapi_client = TestClient(fastapi_app)
        fastapi_response = fastapi_client.get("/api/assets/tables/MISSING")

        self.assertEqual(flask_response.status_code, fastapi_response.status_code)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())
        self.assertEqual(
            flask_app.test_client().post("/api/assets/tables", json={}).get_json(),
            fastapi_client.post("/api/assets/tables", json={}).json(),
        )
        self.assertEqual(404, fastapi_client.get("/api/reports").status_code)


if __name__ == "__main__":
    unittest.main()
