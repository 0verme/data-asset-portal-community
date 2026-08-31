from __future__ import annotations

# pyright: reportMissingImports=false
import unittest
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from backend.app.application import Identity
from backend.app.authorization.core import AuthorizationService, AuthorizationSubject
from backend.app.contracts import FieldMappingImportResponse
from backend.app.fastapi_app import create_fastapi_app


class FieldMappingImportApiTests(unittest.TestCase):
    def setUp(self):
        self.identity: Identity | None = None
        self.permissions: set[str] = set()
        repository = MagicMock()
        repository.get_subject.side_effect = self._subject
        repository.get_permissions.side_effect = lambda _role: self.permissions
        self.authorization = AuthorizationService(repository)
        self.service = MagicMock()
        self.service.import_mappings.return_value = FieldMappingImportResponse(
            mode="upsert",
            dry_run=False,
            summary={
                "received": 1,
                "created": 1,
                "updated": 0,
                "unchanged": 0,
                "failed": 0,
                "fieldCount": 1,
            },
            items=[
                {
                    "index": 0,
                    "identity": {
                        "sourceSystemId": 101,
                        "upstreamSystemId": 101,
                        "dataSourceId": 1,
                        "sourceTable": "ORDERS",
                        "targetTable": "DWF_ORDERS",
                    },
                    "action": "created",
                    "fieldCount": 1,
                    "createdFieldCount": 1,
                }
            ],
        ).model_dump(by_alias=True, exclude_none=True)
        self.app = create_fastapi_app(
            identity_resolver=lambda _request: self.identity,
            authorization_service_instance=self.authorization,
            field_mapping_service_instance=self.service,
        )
        self.client = TestClient(self.app)

    def _subject(self, identity):
        if identity is None:
            return None
        return AuthorizationSubject(identity.user, identity.role)

    @staticmethod
    def _payload():
        return {
            "mode": "upsert",
            "dryRun": False,
            "items": [
                {
                    "sourceSystemId": 101,
                    "sourceTable": "ORDERS",
                    "targetTable": "DWF_ORDERS",
                    "fields": [{"sourceField": "ORDER_ID", "fieldOrder": 1}],
                }
            ],
        }

    def test_anonymous_import_is_rejected_before_service(self):
        response = self.client.post("/api/field-mappings/import", json=self._payload())

        self.assertEqual(401, response.status_code)
        self.assertEqual("UNAUTHORIZED", response.json()["error"]["code"])
        self.service.import_mappings.assert_not_called()

    def test_authenticated_user_without_write_permission_is_forbidden(self):
        self.identity = Identity("maintainer", "reader", "Reader")
        self.permissions = {"field_mapping:read"}

        response = self.client.post("/api/field-mappings/import", json=self._payload())

        self.assertEqual(403, response.status_code)
        self.assertEqual("FORBIDDEN", response.json()["error"]["code"])
        self.service.import_mappings.assert_not_called()

    def test_write_permission_reaches_service_and_returns_contract(self):
        self.identity = Identity("admin", "admin-user", "Admin")
        self.permissions = {"field_mapping:write"}

        response = self.client.post("/api/field-mappings/import", json=self._payload())

        self.assertEqual(200, response.status_code)
        self.assertEqual("created", response.json()["items"][0]["action"])
        self.service.import_mappings.assert_called_once()

    def test_malformed_contract_returns_422(self):
        self.identity = Identity("admin", "admin-user", "Admin")
        self.permissions = {"field_mapping:write"}

        response = self.client.post(
            "/api/field-mappings/import",
            json={"items": []},
        )

        self.assertEqual(422, response.status_code)
        self.assertEqual("VALIDATION_ERROR", response.json()["error"]["code"])
        self.service.import_mappings.assert_not_called()


if __name__ == "__main__":
    unittest.main()
