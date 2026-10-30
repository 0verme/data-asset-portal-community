"""Configured editor options distinguish empty categories from failures."""

import unittest
from unittest.mock import patch

from backend.app.services.business_option_catalog import get_business_option_catalog
from backend.app.services.common_code_service import CommonCodeDataSourceError


class BusinessOptionCatalogTests(unittest.TestCase):
    def test_maps_only_configured_items_and_keeps_missing_distinct(self):
        batch = {
            "categoryCodes": ["UPSTREAM_DB_TYPE", "UPSTREAM_DEPT"],
            "items": [
                {
                    "categoryCode": "UPSTREAM_DB_TYPE",
                    "code": "CUSTOM_DB",
                    "name": "制造数据库",
                    "value": "制造数据库",
                    "active": True,
                    "ext": {"must_not_leak": "internal"},
                },
                {
                    "categoryCode": "UPSTREAM_DEPT",
                    "code": "EQUIPMENT",
                    "name": "设备管理部",
                    "value": "设备管理部",
                },
            ],
            "missingCodes": ["PUSH_PROTOCOL"],
        }
        with patch(
            "backend.app.services.business_option_catalog.common_code_service.get_items_batch",
            return_value=batch,
        ) as get_batch:
            result = get_business_option_catalog(
                ["UPSTREAM_DB_TYPE", "UPSTREAM_DEPT", "PUSH_PROTOCOL"]
            )

        self.assertEqual(
            {
                "categories": {
                    "UPSTREAM_DB_TYPE": [
                        {"code": "CUSTOM_DB", "name": "制造数据库", "value": "制造数据库"}
                    ],
                    "UPSTREAM_DEPT": [
                        {"code": "EQUIPMENT", "name": "设备管理部", "value": "设备管理部"}
                    ],
                    "PUSH_PROTOCOL": [],
                },
                "missingCategories": ["PUSH_PROTOCOL"],
            },
            result,
        )
        get_batch.assert_called_once_with(
            ["UPSTREAM_DB_TYPE", "UPSTREAM_DEPT", "PUSH_PROTOCOL"]
        )

    def test_empty_existing_category_is_not_reported_missing(self):
        with patch(
            "backend.app.services.business_option_catalog.common_code_service.get_items_batch",
            return_value={
                "categoryCodes": ["FILE_ENCODING"],
                "items": [],
                "missingCodes": ["FREQ_TYPE"],
            },
        ):
            result = get_business_option_catalog(["FILE_ENCODING", "FREQ_TYPE"])

        self.assertEqual({"FILE_ENCODING": [], "FREQ_TYPE": []}, result["categories"])
        self.assertEqual(["FREQ_TYPE"], result["missingCategories"])

    def test_data_source_error_propagates_without_fallback(self):
        with patch(
            "backend.app.services.business_option_catalog.common_code_service.get_items_batch",
            side_effect=CommonCodeDataSourceError("dictionary unavailable"),
        ):
            with self.assertRaises(CommonCodeDataSourceError):
                get_business_option_catalog(["UPSTREAM_DB_TYPE"])


if __name__ == "__main__":
    unittest.main()
