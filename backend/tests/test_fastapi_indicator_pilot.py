"""Flask/FastAPI parity tests for the P3 Indicator pilot."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.app.application import Identity
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.indicator_service import (
    IndicatorNotFoundError,
    IndicatorValidationError,
)


INDICATOR = {
    "id": "CUST001",
    "name": "Customer flag",
    "meaning": "meaning",
    "resultTableName": "dws.customer",
    "resultFieldName": "flag",
    "dimension": "cus",
    "caliber": "caliber",
    "path": "CUS > flag",
    "status": "enabled",
    "registrar": "tester",
    "registeredAt": "2026-07-12",
}


class FastApiIndicatorPilotTests(unittest.TestCase):
    def setUp(self):
        self._old_secret = os.environ.get("FLASK_SECRET_KEY")
        os.environ["FLASK_SECRET_KEY"] = "test-fastapi-pilot"
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
        service_patch = patch("backend.app.routes.indicator.indicator_service", service)
        service_patch.start()
        self.addCleanup(service_patch.stop)
        fastapi_app = create_fastapi_app(
            capabilities=self.capabilities,
            identity_resolver=lambda _request: identity,
            indicator_service_instance=service,
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

    def test_list_flow_has_flask_fastapi_json_parity_and_reuses_service(self):
        service = MagicMock()
        service.get_indicators.return_value = [INDICATOR]
        flask_app, fastapi_app = self._apps(service)

        flask_response = flask_app.test_client().get("/api/indicators?dimension=cus")
        fastapi_response = TestClient(fastapi_app).get("/api/indicators?dimension=cus")

        self.assertEqual(flask_response.status_code, fastapi_response.status_code)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())
        service.get_indicators.assert_called()

    def test_authenticated_create_flow_has_parity_and_uses_shared_contract(self):
        service = MagicMock()
        service.create_indicator.return_value = INDICATOR
        flask_app, fastapi_app = self._apps(
            service, identity=Identity("maintainer", "tester", "Tester")
        )
        flask_client = self._login_as_maintainer(flask_app)
        body = {"id": "CUST001", "name": "Customer flag", "status": "enabled"}

        flask_response = flask_client.post("/api/indicators", json=body)
        fastapi_response = TestClient(fastapi_app).post("/api/indicators", json=body)

        self.assertEqual(201, flask_response.status_code)
        self.assertEqual(flask_response.status_code, fastapi_response.status_code)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())
        service.create_indicator.assert_called_with(body)

    def test_auth_failure_preserves_401_error_shape(self):
        service = MagicMock()
        flask_app, fastapi_app = self._apps(service)

        flask_response = flask_app.test_client().post("/api/indicators", json={})
        fastapi_response = TestClient(fastapi_app).post("/api/indicators", json={})

        self.assertEqual(401, flask_response.status_code)
        self.assertEqual(flask_response.status_code, fastapi_response.status_code)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())
        service.create_indicator.assert_not_called()

    def test_service_validation_error_preserves_422_error_shape(self):
        error = IndicatorValidationError([{"field": "name", "message": "name is required"}])
        service = MagicMock()
        service.create_indicator.side_effect = error
        flask_app, fastapi_app = self._apps(
            service, identity=Identity("maintainer", "tester", "Tester")
        )
        flask_client = self._login_as_maintainer(flask_app)

        flask_response = flask_client.post("/api/indicators", json={})
        fastapi_response = TestClient(fastapi_app).post("/api/indicators", json={})

        self.assertEqual(422, flask_response.status_code)
        self.assertEqual(flask_response.status_code, fastapi_response.status_code)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())

    def test_not_found_and_community_boundary_are_preserved(self):
        service = MagicMock()
        service.get_indicator_detail.side_effect = IndicatorNotFoundError("MISSING")
        flask_app, fastapi_app = self._apps(service)

        flask_response = flask_app.test_client().get("/api/indicators/MISSING")
        fastapi_client = TestClient(fastapi_app)
        fastapi_response = fastapi_client.get("/api/indicators/MISSING")

        self.assertEqual(flask_response.status_code, fastapi_response.status_code)
        self.assertEqual(flask_response.get_json(), fastapi_response.json())
        self.assertEqual(404, fastapi_client.get("/api/reports").status_code)
        self.assertEqual(404, fastapi_client.get("/api/push").status_code)


if __name__ == "__main__":
    unittest.main()
