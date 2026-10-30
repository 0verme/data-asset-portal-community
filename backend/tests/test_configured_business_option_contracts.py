"""Configured business options are accepted by the corresponding writers."""

import unittest
from unittest.mock import patch

from backend.app.services.push_service import PushService, PushValidationError
from backend.app.services.upstream_service import UpstreamService, UpstreamValidationError


class ConfiguredBusinessOptionContractTests(unittest.TestCase):
    def test_upstream_accepts_configured_cross_industry_values(self):
        service = UpstreamService()
        configured = {
            "UPSTREAM_DB_TYPE": [
                {"code": "CUSTOM_DB", "name": "制造数据库", "value": "制造数据库"}
            ],
            "UPSTREAM_DEPT": [
                {"code": "EQUIPMENT", "name": "设备管理部", "value": "设备管理部"}
            ],
        }
        payload = {
            "id": "up_equipment",
            "abbr": "EQP",
            "name": "设备台账",
            "host": "equipment.example.invalid",
            "dbType": "制造数据库",
            "dept": "设备管理部",
            "status": "enabled",
            "unloadTimes": ["02:00"],
        }
        with patch(
            "backend.app.services.upstream_service.common_code_service.get_item_values",
            return_value=["enabled", "disabled"],
        ), patch(
            "backend.app.services.upstream_service.common_code_service.get_items",
            side_effect=lambda code: configured[code],
        ):
            result = service._normalize_payload(payload)
            self.assertEqual("制造数据库", result["dbType"])
            self.assertEqual("设备管理部", result["dept"])
            with self.assertRaises(UpstreamValidationError):
                service._normalize_payload({**payload, "dbType": "UNCONFIGURED_DB"})

    def test_push_system_accepts_configured_protocol_and_auth_and_preserves_legacy(self):
        service = PushService()
        configured = {
            "SYSTEM_STATUS": ["enabled", "disabled"],
            "PUSH_PROTOCOL": ["HTTPS_CUSTOM"],
            "PUSH_AUTH_TYPE": ["OIDC workload identity"],
            "UPSTREAM_DEPT": ["设备管理部"],
        }
        payload = {
            "id": "PUSH_EQUIPMENT",
            "name": "设备台账推送",
            "abbr": "EQP",
            "host": "push.example.invalid",
            "port": 443,
            "protocol": "HTTPS_CUSTOM",
            "auth": "OIDC workload identity",
            "dept": "设备管理部",
            "status": "enabled",
            "jobs": [],
        }
        with patch(
            "backend.app.services.push_service.common_code_service.get_item_values",
            side_effect=lambda code: configured[code],
        ):
            normalized = service._normalize_system_payload(payload)
            self.assertEqual("HTTPS_CUSTOM", normalized["protocol"])
            self.assertEqual("OIDC workload identity", normalized["auth"])
            self.assertEqual("设备管理部", normalized["dept"])

            current = {**normalized, "protocol": "RETIRED_PROTO", "auth": "Legacy auth"}
            edited = service._normalize_system_payload(
                {**payload, "protocol": "RETIRED_PROTO", "auth": "Legacy auth"},
                current_system=current,
            )
            self.assertEqual("RETIRED_PROTO", edited["protocol"])
            self.assertEqual("Legacy auth", edited["auth"])

            with self.assertRaises(PushValidationError):
                service._normalize_system_payload(
                    {**payload, "protocol": "NOT_CONFIGURED"}
                )

    def test_push_system_allows_empty_department_when_no_department_options_exist(self):
        service = PushService()
        payload = {
            "id": "PUSH_NO_DEPT",
            "name": "系统未分配部门",
            "abbr": "NODEPT",
            "host": "push.example.invalid",
            "port": 443,
            "protocol": "HTTPS_CUSTOM",
            "auth": "OIDC workload identity",
            "dept": "",
            "status": "enabled",
            "jobs": [],
        }
        configured = {
            "SYSTEM_STATUS": ["enabled", "disabled"],
            "PUSH_PROTOCOL": ["HTTPS_CUSTOM"],
            "PUSH_AUTH_TYPE": ["OIDC workload identity"],
            "UPSTREAM_DEPT": [],
        }
        with patch(
            "backend.app.services.push_service.common_code_service.get_item_values",
            side_effect=lambda code: configured[code],
        ):
            normalized = service._normalize_system_payload(payload)
        self.assertEqual("", normalized["dept"])

    def test_push_job_accepts_configured_encoding_delimiter_and_frequency(self):
        service = PushService()
        configured = {
            "PUSH_DELIMITER": ["^"],
            "FILE_ENCODING": ["UTF-16LE"],
            "FREQ_TYPE": ["EVERY_QUARTER"],
        }
        payload = {
            "id": "JOB_EQUIPMENT",
            "cn": "设备明细",
            "sourceFileName": "equipment.csv",
            "targetFileName": "equipment.csv",
            "delimiter": "^",
            "encoding": "UTF-16LE",
            "freqType": "EVERY_QUARTER",
            "enabled": True,
            "fields": [{"name": "equipment_id", "cn": "设备编号"}],
        }
        with patch(
            "backend.app.services.push_service.common_code_service.get_item_values",
            side_effect=lambda code: configured[code],
        ):
            normalized = service._normalize_job_payload(payload)
            self.assertEqual("^", normalized["delimiter"])
            self.assertEqual("UTF-16LE", normalized["encoding"])
            self.assertEqual("EVERY_QUARTER", normalized["freqType"])
            current_job = {
                **normalized,
                "delimiter": "RETIRED_DELIMITER",
                "encoding": "RETIRED_ENCODING",
                "freqType": "RETIRED_FREQUENCY",
            }
            edited = service._normalize_job_payload(
                {
                    **payload,
                    "delimiter": "RETIRED_DELIMITER",
                    "encoding": "RETIRED_ENCODING",
                    "freqType": "RETIRED_FREQUENCY",
                },
                current_job=current_job,
            )
            self.assertEqual("RETIRED_DELIMITER", edited["delimiter"])
            self.assertEqual("RETIRED_ENCODING", edited["encoding"])
            self.assertEqual("RETIRED_FREQUENCY", edited["freqType"])
            with self.assertRaises(PushValidationError):
                service._normalize_job_payload({**payload, "freqType": "NOT_CONFIGURED"})


if __name__ == "__main__":
    unittest.main()
