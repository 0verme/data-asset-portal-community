"""Authorized endpoint-scoped field-mapping statistics projection tests."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app.application import Identity
from backend.app.authorization.core import AuthorizationService
from backend.app.contracts.models import DataEnvelope, MappingStats
from backend.app.contracts.validation import validate_contract
from backend.app.fastapi_app import create_fastapi_app
from backend.app.security.public_field_policy import public_key_visible


class FieldMappingStatsPublicContractTests(unittest.TestCase):
    @staticmethod
    def _stats(field_count: int = 0) -> dict[str, object]:
        return {
            "sourceSystemCount": 0,
            "sourceTableCount": 0,
            "fieldCount": field_count,
            "mappedFieldCount": 0,
            "unmappedFieldCount": 0,
            "emptyCommentCount": 0,
            "emptyCommentRate": 0,
            "coverage": 0,
            "password": "must-not-be-returned",
            "updatedBy": "must-not-be-returned",
            "diagnostics": {"trace": "must-not-be-returned"},
        }

    @staticmethod
    def _client(service, identity=None) -> TestClient:
        return TestClient(
            create_fastapi_app(
                identity_resolver=lambda _request: identity,
                field_mapping_service_instance=service,
                authorization_service_instance=AuthorizationService(),
            )
        )

    def test_stats_field_count_is_endpoint_scoped_across_public_profiles(self):
        cases = (
            ("strict", None, "strict"),
            ("internal", None, "internal"),
            ("strict", Identity("admin", "authorized-user", "Authorized"), "internal"),
            ("internal", Identity("admin", "authorized-user", "Authorized"), "internal"),
        )
        for configured_profile, identity, effective_profile in cases:
            with self.subTest(
                configured_profile=configured_profile,
                authenticated=identity is not None,
            ):
                service = MagicMock()
                service.get_stats.return_value = self._stats(0)
                with patch.dict(
                    os.environ,
                    {"PUBLIC_CATALOG_PROFILE": configured_profile},
                    clear=True,
                ):
                    response = self._client(service, identity).get(
                        "/api/field-mappings/stats"
                    )

                self.assertEqual(200, response.status_code, response.text)
                self.assertEqual(0, response.json()["data"]["fieldCount"])
                for hidden_key in ("password", "updatedBy", "diagnostics"):
                    self.assertNotIn(hidden_key, response.json()["data"])
                self.assertFalse(
                    public_key_visible("fieldCount", profile=effective_profile)
                )
                service.get_stats.assert_called_once()

    def test_field_count_remains_hidden_on_other_catalog_endpoints(self):
        service = MagicMock()
        service.get_table_mappings.return_value = {
            "items": [{"tablePk": 1, "srcTable": "demo_table", "fieldCount": 7}],
            "total": 1,
            "page": 1,
            "pageSize": 50,
        }
        with patch.dict(
            os.environ, {"PUBLIC_CATALOG_PROFILE": "internal"}, clear=True
        ):
            response = self._client(service).get("/api/field-mappings/tables")

        self.assertEqual(200, response.status_code, response.text)
        self.assertNotIn("fieldCount", response.json()["items"][0])
        self.assertFalse(public_key_visible("fieldCount", profile="internal"))

    def test_disabled_profile_access_gate_is_unchanged(self):
        service = MagicMock()
        service.get_stats.return_value = self._stats(3)
        with patch.dict(
            os.environ, {"PUBLIC_CATALOG_PROFILE": "disabled"}, clear=True
        ):
            guest_response = self._client(service).get("/api/field-mappings/stats")
            self.assertEqual(401, guest_response.status_code, guest_response.text)
            service.get_stats.assert_not_called()

            authenticated_response = self._client(
                service, Identity("admin", "authorized-user", "Authorized")
            ).get("/api/field-mappings/stats")
            self.assertEqual(200, authenticated_response.status_code)
            self.assertEqual(3, authenticated_response.json()["data"]["fieldCount"])
            service.get_stats.assert_called_once()

            service.reset_mock()
            disabled_role_response = self._client(
                service, Identity("unknown-role", "blocked-user", "Blocked")
            ).get("/api/field-mappings/stats")
            self.assertEqual(403, disabled_role_response.status_code)
            service.get_stats.assert_not_called()

    def test_mapping_stats_contract_rejects_missing_field_count(self):
        with self.assertRaises(ValidationError):
            validate_contract(
                {"data": {"sourceSystemCount": 1}},
                DataEnvelope[MappingStats],
            )


if __name__ == "__main__":
    unittest.main()
