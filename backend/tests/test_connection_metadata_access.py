import os
import unittest
from unittest.mock import patch

from backend.app import create_app
from backend.app.services.push_service import PushService, PushValidationError
from backend.app.services.upstream_service import UpstreamService


FORBIDDEN_PUBLIC_KEYS = {
    "host_name", "hostname", "ip", "port", "account", "account_name",
    "auth", "auth_type", "contact", "sourcePath", "targetPath", "fields",
    "db", "schema", "database", "password", "token", "secret",
}


def assert_no_connection_metadata(test_case, value):
    if isinstance(value, dict):
        test_case.assertTrue(FORBIDDEN_PUBLIC_KEYS.isdisjoint(value))
        for nested in value.values():
            assert_no_connection_metadata(test_case, nested)
    elif isinstance(value, list):
        for nested in value:
            assert_no_connection_metadata(test_case, nested)


class PublicSummaryDtoTestCase(unittest.TestCase):
    @staticmethod
    def _system_payload(**overrides):
        payload = {
            "id": "TARGET",
            "name": "Target",
            "abbr": "TGT",
            "host": "target.demo.invalid",
            "protocol": "SFTP",
            "auth": "密钥认证",
            "status": "enabled",
            "port": 22,
            "jobs": [],
        }
        payload.update(overrides)
        return payload

    def test_push_public_summary_exposes_host_only_from_connection_metadata(self):
        service = PushService()
        system = service._to_public_system(
            {
                "system_code": "target",
                "system_name": "Target",
                "system_abbr": "TGT",
                "system_desc": "summary",
                "protocol_type": "SFTP",
                "dept_name": "Data",
                "status_code": "enabled",
                "host_name": "private-host",
                "port_no": 22,
                "account_name": "private-account",
                "auth_type": "key",
                "contact_name": "private-contact",
            },
            [{"job_code": "job", "job_name": "Job", "source_file_name": "in.csv", "target_file_name": "out.csv", "freq_desc": "1", "freq_type": "daily", "enabled_flag": "Y", "job_desc": "summary"}],
        )
        self.assertEqual("private-host", system["host"])
        self.assertEqual("", system["dataDeveloperContact"])
        self.assertEqual("normal", system["importanceLevel"])
        self.assertEqual("", system["latestOutputTime"])
        assert_no_connection_metadata(self, system)

    def test_push_public_summary_includes_both_contacts(self):
        service = PushService()
        system = service._to_public_system(
            {
                "system_id": 1,
                "system_code": "target",
                "system_name": "Target",
                "system_abbr": "TGT",
                "system_desc": "summary",
                "protocol_type": "SFTP",
                "contact_name": "downstream-contact",
                "data_developer_contact_name": "developer-contact",
                "dept_name": "Data",
                "status_code": "enabled",
            },
            [],
        )
        self.assertEqual("downstream-contact", system["downstreamContact"])
        self.assertEqual("developer-contact", system["dataDeveloperContact"])
        self.assertEqual("", system["host"])
        assert_no_connection_metadata(self, system)

    def test_push_system_importance_defaults_and_preserves_legacy_updates(self):
        service = PushService()
        service._get_allowed_values = lambda _category, fallback: fallback

        created = service._normalize_system_payload(self._system_payload())
        self.assertEqual("normal", created["importanceLevel"])
        self.assertEqual("", created["latestOutputTime"])

        updated = service._normalize_system_payload(
            self._system_payload(),
            current_system={"importanceLevel": "important", "latestOutputTime": "08:30", "jobs": []},
        )
        self.assertEqual("important", updated["importanceLevel"])
        self.assertEqual("08:30", updated["latestOutputTime"])

    def test_push_system_id_allows_numeric_prefix_without_relaxing_other_ids(self):
        service = PushService()
        service._get_allowed_values = lambda _category, fallback: fallback

        for system_id in ("123_SYS", "SYS_123", "123"):
            normalized = service._normalize_system_payload(self._system_payload(id=system_id))
            self.assertEqual(system_id, normalized["id"])

        for system_id in ("123-SYS", "123 SYS", "系统123"):
            with self.assertRaises(PushValidationError):
                service._normalize_system_payload(self._system_payload(id=system_id))

        details = []
        self.assertIsNone(service._validate_id("1JOB", "id", details))
        self.assertTrue(details)

        field_details = []
        service._normalize_job_fields(
            [{"name": "1FIELD", "cn": "字段", "meaning": "", "src": "DWM", "type": "string"}],
            field_details,
        )
        self.assertIn("fields[0].name", {item["field"] for item in field_details})

    def test_push_system_importance_validates_time_and_clears_normal_time(self):
        service = PushService()
        service._get_allowed_values = lambda _category, fallback: fallback

        for value in ("", "00:00", "23:59"):
            normalized = service._normalize_system_payload(
                self._system_payload(importanceLevel="important", latestOutputTime=value)
            )
            self.assertEqual(value, normalized["latestOutputTime"])

        normalized = service._normalize_system_payload(
            self._system_payload(importanceLevel="normal", latestOutputTime="08:30")
        )
        self.assertEqual("", normalized["latestOutputTime"])

        for overrides, field in (
            ({"importanceLevel": "urgent"}, "importanceLevel"),
            ({"importanceLevel": "important", "latestOutputTime": "24:00"}, "latestOutputTime"),
            ({"importanceLevel": "important", "latestOutputTime": "8:30"}, "latestOutputTime"),
        ):
            with self.assertRaises(PushValidationError) as raised:
                service._normalize_system_payload(self._system_payload(**overrides))
            self.assertIn(field, {item["field"] for item in raised.exception.details})

    def test_push_system_payload_accepts_legacy_contact_as_downstream_contact(self):
        service = PushService()
        service._get_allowed_values = lambda _category, fallback: fallback
        system = service._normalize_system_payload(
            {
                "id": "TARGET",
                "name": "Target",
                "abbr": "TGT",
                "host": "target.demo.invalid",
                "protocol": "SFTP",
                "auth": "密钥认证",
                "status": "enabled",
                "port": 22,
                "contact": "legacy-contact",
                "dataDeveloperContact": "developer-contact",
                "jobs": [],
            }
        )
        self.assertEqual("legacy-contact", system["downstreamContact"])
        self.assertEqual("developer-contact", system["dataDeveloperContact"])

    def test_upstream_public_summary_uses_allowlisted_fields(self):
        service = UpstreamService()
        system = service._row_to_system(
            {
                "system_pk": 1, "system_id": "source", "system_abbr": "SRC", "system_name": "Source",
                "db_type": "Oracle", "status_code": "enabled", "owner_name": "owner", "dept_name": "Data",
                "system_desc": "summary", "host_name": "private-host", "db_name": "private-db", "schema_name": "private-schema",
            },
            ["01:00"],
        )
        assert_no_connection_metadata(self, system)


class ConnectionMetadataRouteTestCase(unittest.TestCase):
    def setUp(self):
        self.original_secret = os.getenv("FLASK_SECRET_KEY")
        os.environ["FLASK_SECRET_KEY"] = "test-only-connection-metadata-secret"
        self.addCleanup(self._restore_secret)
        self.client = create_app().test_client()

    def _restore_secret(self):
        if self.original_secret is None:
            os.environ.pop("FLASK_SECRET_KEY", None)
        else:
            os.environ["FLASK_SECRET_KEY"] = self.original_secret

    def test_anonymous_admin_detail_routes_are_rejected(self):
        self.assertEqual(401, self.client.get("/api/push/systems/target/admin-detail").status_code)
        self.assertEqual(401, self.client.get("/api/upstreams/systems/source/admin-detail").status_code)

    @patch("backend.app.routes.push.push_service.get_push_system_detail")
    @patch("backend.app.routes.upstream.upstream_service.get_system_detail")
    def test_public_detail_routes_only_return_summary_dtos(self, mock_upstream_detail, mock_push_detail):
        mock_push_detail.return_value = {"id": "target", "name": "Target", "jobs": [{"id": "job", "cn": "Job"}]}
        mock_upstream_detail.return_value = {"id": "source", "name": "Source", "dbType": "Oracle"}

        push_response = self.client.get("/api/push/systems/target")
        upstream_response = self.client.get("/api/upstreams/systems/source")

        self.assertEqual(200, push_response.status_code)
        self.assertEqual(200, upstream_response.status_code)
        assert_no_connection_metadata(self, push_response.get_json())
        assert_no_connection_metadata(self, upstream_response.get_json())


if __name__ == "__main__":
    unittest.main()
