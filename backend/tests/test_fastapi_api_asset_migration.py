"""Flask/FastAPI parity tests for the P4 API Asset migration."""
from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.app.application import Identity
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.api_asset_service import ApiAssetNotFoundError


ASSET = {
    "code": "API_CUSTOMER",
    "name": "Customer API",
    "method": "GET",
    "path": "/customers",
    "status": "enabled",
    "params": [],
    "responseFields": [],
    "relations": [],
}


class FastApiApiAssetMigrationTests(unittest.TestCase):
    def setUp(self):
        self.old = os.environ.get("FLASK_SECRET_KEY")
        os.environ["FLASK_SECRET_KEY"] = "test-fastapi-api-asset"
        self.addCleanup(self.restore)
        self.private = resolve_capabilities(edition="private")
        self.community = resolve_capabilities(edition="community")

    def restore(self):
        if self.old is None:
            os.environ.pop("FLASK_SECRET_KEY", None)
        else:
            os.environ["FLASK_SECRET_KEY"] = self.old

    def apps(self, service, identity=None, capabilities=None):
        capabilities = capabilities or self.private
        flask_app = create_app(capabilities=capabilities)
        flask_app.config.update(TESTING=True)
        service_patch = patch("backend.app.routes.api_asset.api_asset_service", service)
        service_patch.start()
        self.addCleanup(service_patch.stop)
        fastapi_app = create_fastapi_app(
            capabilities=capabilities,
            identity_resolver=lambda _request: identity,
            api_asset_service_instance=service,
        )
        return flask_app, fastapi_app

    def login(self, app):
        client = app.test_client()
        with client.session_transaction() as session:
            session["dap_auth_user"] = {
                "role": "maintainer",
                "user": "tester",
                "name": "Tester",
            }
        return client

    def test_list_detail_and_create_parity(self):
        service = MagicMock()
        service.get_assets.return_value = [ASSET]
        service.get_asset.return_value = ASSET
        service.create.return_value = ASSET
        flask_app, fastapi_app = self.apps(
            service, Identity("maintainer", "tester", "Tester")
        )
        flask_client = self.login(flask_app)
        fastapi_client = TestClient(fastapi_app)
        self.assertEqual(
            flask_app.test_client().get("/api/api-assets").get_json(),
            fastapi_client.get("/api/api-assets").json(),
        )
        self.assertEqual(
            flask_app.test_client().get("/api/api-assets/API_CUSTOMER").get_json(),
            fastapi_client.get("/api/api-assets/API_CUSTOMER").json(),
        )
        body = {
            "code": "API_CUSTOMER",
            "name": "Customer API",
            "method": "GET",
            "path": "/customers",
            "status": "enabled",
        }
        self.assertEqual(
            flask_client.post("/api/api-assets", json=body).get_json(),
            fastapi_client.post("/api/api-assets", json=body).json(),
        )

    def test_error_auth_and_community_boundary(self):
        service = MagicMock()
        service.get_asset.side_effect = ApiAssetNotFoundError("missing")
        flask_app, fastapi_app = self.apps(service)
        fastapi_client = TestClient(fastapi_app)
        self.assertEqual(
            flask_app.test_client().get("/api/api-assets/missing").get_json(),
            fastapi_client.get("/api/api-assets/missing").json(),
        )
        self.assertEqual(
            flask_app.test_client().post("/api/api-assets", json={}).get_json(),
            fastapi_client.post("/api/api-assets", json={}).json(),
        )
        community_app = create_fastapi_app(capabilities=self.community)
        self.assertEqual(
            404,
            TestClient(community_app).get("/api/reports").status_code,
        )


if __name__ == "__main__":
    unittest.main()
