"""Asset field counts remain accurate through public projection and API errors."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app.authorization.core import AuthorizationService
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.assets_service import AssetDataSourceError


class AssetFieldCountContractTests(unittest.TestCase):
    @staticmethod
    def _client(service) -> TestClient:
        return TestClient(
            create_fastapi_app(
                identity_resolver=lambda _request: None,
                assets_service_instance=service,
                authorization_service_instance=AuthorizationService(),
            )
        )

    def test_strict_public_asset_list_and_detail_preserve_active_counts(self):
        service = MagicMock()
        fields = [
            {
                "fieldId": index,
                "assetId": 1,
                "name": f"field_{index}",
                "cn": f"字段 {index}",
                "type": "INTEGER",
                "nullable": index != 1,
                "pk": index == 1,
                "part": False,
            }
            for index in range(1, 13)
        ]
        service.get_asset_table_page.return_value = {
            "items": [
                {"assetId": 1, "name": "orders", "fieldCount": 12, "fields": []},
                {"assetId": 2, "name": "empty", "fieldCount": 0, "fields": []},
            ],
            "page": 1,
            "pageSize": 20,
            "total": 2,
        }
        service.get_asset_detail_by_id.return_value = {
            "assetId": 1,
            "name": "orders",
            "fieldCount": 12,
            "fields": fields,
        }

        with patch.dict(os.environ, {"PUBLIC_CATALOG_PROFILE": "strict"}, clear=True):
            client = self._client(service)
            page = client.get("/api/assets/tables?summary=true&page=1&pageSize=20")
            detail = client.get("/api/assets/1")

        self.assertEqual(200, page.status_code, page.text)
        self.assertEqual(200, detail.status_code, detail.text)
        self.assertEqual([12, 0], [item["fieldCount"] for item in page.json()["items"]])
        self.assertEqual(12, detail.json()["data"]["fieldCount"])
        self.assertEqual(12, len(detail.json()["data"]["fields"]))

    def test_missing_field_count_remains_unknown(self):
        service = MagicMock()
        service.get_asset_table_page.return_value = {
            "items": [{"assetId": 3, "name": "unknown", "fields": []}],
            "page": 1,
            "pageSize": 20,
            "total": 1,
        }

        with patch.dict(os.environ, {"PUBLIC_CATALOG_PROFILE": "strict"}, clear=True):
            response = self._client(service).get(
                "/api/assets/tables?summary=true&page=1&pageSize=20"
            )

        self.assertEqual(200, response.status_code, response.text)
        self.assertIsNone(response.json()["items"][0].get("fieldCount"))

    def test_asset_query_failure_stays_a_server_error(self):
        service = MagicMock()
        service.get_asset_table_page.side_effect = AssetDataSourceError("数据库查询失败")

        with patch.dict(os.environ, {"PUBLIC_CATALOG_PROFILE": "strict"}, clear=True):
            response = self._client(service).get(
                "/api/assets/tables?summary=true&page=1&pageSize=20"
            )

        self.assertEqual(500, response.status_code, response.text)
        self.assertEqual("ASSET_DATA_SOURCE_ERROR", response.json()["error"]["code"])


if __name__ == "__main__":
    unittest.main()
