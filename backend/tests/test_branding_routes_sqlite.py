from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app.application import Identity
from backend.app.authorization.core import AuthorizationService, AuthorizationSubject
from backend.app.db.sqlite_adapter import connect
from backend.app.fastapi_app import create_fastapi_app
from backend.app.migrations.schema import initialize
from backend.app.services.branding_service import (
    DEFAULT_BRANDING_CONFIG,
    BrandingService,
    default_public_branding,
)


class BrandingRoutesSqliteTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="dap-branding-routes-")
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        self.database = root / "branding.sqlite"
        self.uploads = root / "uploads" / "branding"
        self.config_path = root / "database.yaml"
        self.config_path.write_text(
            "profiles:\n"
            "  primary:\n"
            "    type: sqlite\n"
            f"    database: '{self.database.as_posix()}'\n",
            encoding="utf-8",
        )
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(self.config_path),
                "ASSET_DB_PROFILE": "primary",
                "APP_ENV": "test",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)

        db_config = {"type": "sqlite", "database": str(self.database)}
        self.connection = connect(db_config)
        self.addCleanup(self.connection.close)
        self.assertTrue(initialize(self.connection, db_config, "sqlite"))
        self.branding = BrandingService(upload_directory=self.uploads)
        self.admin = self._client("fixture-admin", "admin", {"system:param:read", "system:param:write"})
        self.readonly = self._client("fixture-reader", "maintainer", {"system:param:read"})
        self.anonymous = TestClient(create_fastapi_app(branding_service_instance=self.branding))

    def _client(self, username: str, role: str, permissions: set[str]) -> TestClient:
        repository = MagicMock()
        repository.get_subject.return_value = AuthorizationSubject(username, role)
        repository.get_permissions.return_value = permissions
        authorization = AuthorizationService(repository)
        return TestClient(create_fastapi_app(
            identity_resolver=lambda _request: Identity(role, username, username),
            authorization_service_instance=authorization,
            branding_service_instance=self.branding,
        ))

    def test_public_config_is_anonymous_localized_and_strictly_allowlisted(self):
        response = self.anonymous.get("/api/system/public-config", params={"lang": "en-US"})
        self.assertEqual(200, response.status_code)
        self.assertEqual("no-cache, must-revalidate", response.headers["cache-control"])
        data = response.json()["data"]
        self.assertEqual(set(data), {"site", "hero", "login", "version"})
        self.assertEqual(
            set(data["site"]),
            {"title", "display_name", "announcement", "logo_url", "favicon_url", "default_accent"},
        )
        self.assertEqual("purple", data["site"]["default_accent"])
        self.assertEqual(default_public_branding("en-US"), data)
        self.assertEqual("Data Asset Portal", data["hero"]["title"])
        self.assertEqual("Data Asset Portal", data["site"]["title"])
        self.assertEqual("Data Asset Portal", data["site"]["display_name"])
        chinese_default = self.anonymous.get(
            "/api/system/public-config", params={"lang": "zh-CN"}
        ).json()["data"]
        self.assertEqual("数据资产门户", chinese_default["site"]["title"])
        self.assertEqual("数据资产门户", chinese_default["site"]["display_name"])
        self.assertEqual("数据资产门户", chinese_default["hero"]["title"])
        self.assertNotIn("database", json.dumps(data).lower())

        self.assertEqual(401, self.anonymous.get("/api/system/branding-config").status_code)
        self.assertEqual(401, self.anonymous.put("/api/system/branding-config", json={}).status_code)

    def test_admin_update_public_read_reset_defaults_and_audit(self):
        before_count = self.connection.execute("SELECT COUNT(*) FROM dwp.p_operation_log").fetchone()[0]
        payload = {
            "site": {
                "title": {"zh-CN": "星河目录", "en-US": "Orbit Catalog"},
                "display_name": {"zh-CN": "星河数据门户", "en-US": "Orbit Data Portal"},
                "announcement": {"zh-CN": "公告：周五维护", "en-US": "Maintenance on Friday"},
                "default_accent": "blue",
            },
            "hero": {
                "title": {"zh-CN": "探索数据资产", "en-US": "Explore data assets"},
                "subtitle": {"zh-CN": "面向团队的数据目录", "en-US": "A data catalog for teams"},
                "search_placeholder": {"zh-CN": "搜索业务数据", "en-US": "Search business data"},
            },
            "login": {"hint": {"zh-CN": "请联系管理员", "en-US": "Contact your administrator"}},
        }
        updated = self.admin.put("/api/system/branding-config", json=payload)
        self.assertEqual(200, updated.status_code, updated.text)
        self.assertEqual("Orbit Catalog", self.anonymous.get(
            "/api/system/public-config", params={"lang": "en-US"}
        ).json()["data"]["site"]["title"])
        self.assertEqual("Orbit Data Portal", self.anonymous.get(
            "/api/system/public-config", params={"lang": "en-US"}
        ).json()["data"]["site"]["display_name"])
        self.assertEqual("blue", self.anonymous.get(
            "/api/system/public-config", params={"lang": "en-US"}
        ).json()["data"]["site"]["default_accent"])
        invalid_accent = self.admin.put(
            "/api/system/branding-config",
            json={"site": {"default_accent": "crimson"}},
        )
        self.assertEqual(422, invalid_accent.status_code, invalid_accent.text)
        self.assertEqual("请联系管理员", self.anonymous.get(
            "/api/system/public-config", params={"lang": "zh-CN"}
        ).json()["data"]["login"]["hint"])
        for language, expected in payload["hero"]["title"].items():
            self.assertEqual(expected, self.anonymous.get(
                "/api/system/public-config", params={"lang": language}
            ).json()["data"]["hero"]["title"])
        after_count = self.connection.execute("SELECT COUNT(*) FROM dwp.p_operation_log").fetchone()[0]
        self.assertGreater(after_count, before_count)

        restored = self.admin.post("/api/system/branding-config/reset")
        self.assertEqual(200, restored.status_code, restored.text)
        self.assertEqual(default_public_branding("en-US"), self.anonymous.get(
            "/api/system/public-config", params={"lang": "en-US"}
        ).json()["data"])
        self.assertEqual(DEFAULT_BRANDING_CONFIG["site"]["title"], restored.json()["data"]["config"]["site"]["title"])
        self.assertEqual(DEFAULT_BRANDING_CONFIG["site"]["display_name"], restored.json()["data"]["config"]["site"]["display_name"])
        self.assertEqual(DEFAULT_BRANDING_CONFIG["hero"]["title"], restored.json()["data"]["config"]["hero"]["title"])

    def test_saved_legacy_brand_values_are_preserved_when_reading_existing_config(self):
        legacy_names = {
            "zh-CN": "数据资产管理与血缘分析平台",
            "en-US": "Data Asset Management and Lineage Platform",
        }
        saved = self.admin.put("/api/system/branding-config", json={
            "site": {"title": legacy_names},
            "hero": {"title": legacy_names},
        })
        self.assertEqual(200, saved.status_code, saved.text)

        loaded = self.admin.get("/api/system/branding-config").json()["data"]["config"]
        self.assertEqual(legacy_names, loaded["site"]["title"])
        self.assertEqual(legacy_names, loaded["hero"]["title"])
        for locale, expected in legacy_names.items():
            public = self.anonymous.get(
                "/api/system/public-config", params={"lang": locale}
            ).json()["data"]
            self.assertEqual(expected, public["site"]["title"])
            self.assertEqual(expected, public["hero"]["title"])

    def test_read_permission_cannot_write_and_invalid_types_do_not_change_config(self):
        before = self.branding.get_admin_config()
        denied = self.readonly.put("/api/system/branding-config", json={
            "site": {"title": {"zh-CN": "越权修改"}},
        })
        self.assertEqual(403, denied.status_code)
        invalid = self.admin.put("/api/system/branding-config", json={
            "site": {"title": "not bilingual text"},
        })
        self.assertEqual(422, invalid.status_code)
        self.assertEqual(before, self.branding.get_admin_config())

        unknown_field = self.admin.put("/api/system/branding-config", json={
            "site": {"title": {"zh-CN": "标题"}, "database_password": {"zh-CN": "secret"}},
        })
        self.assertEqual(422, unknown_field.status_code)

    def test_safe_svg_upload_is_publicly_static_and_malicious_uploads_are_rejected(self):
        safe_svg = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2 L22 22" stroke="#123456"/></svg>'
        uploaded = self.admin.post(
            "/api/system/branding-config/assets/logo",
            files={"file": ("brand.svg", safe_svg, "image/svg+xml")},
        )
        self.assertEqual(201, uploaded.status_code, uploaded.text)
        url = uploaded.json()["data"]["url"]
        served = self.admin.get(url)
        self.assertEqual(200, served.status_code)
        self.assertIn("immutable", served.headers["cache-control"])
        self.assertEqual("nosniff", served.headers["x-content-type-options"])
        self.assertIn(b"<path", served.content)

        malicious = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>alert(1)</script></svg>'
        rejected_svg = self.admin.post(
            "/api/system/branding-config/assets/logo",
            files={"file": ("evil.svg", malicious, "image/svg+xml")},
        )
        self.assertEqual(422, rejected_svg.status_code)
        fake_png = self.admin.post(
            "/api/system/branding-config/assets/favicon",
            files={"file": ("fake.png", b"\x89PNG\r\n\x1a\nnot actually png", "image/png")},
        )
        self.assertEqual(422, fake_png.status_code)
        oversized = self.admin.post(
            "/api/system/branding-config/assets/favicon",
            files={"file": ("large.png", b"x" * (200 * 1024), "image/png")},
        )
        self.assertEqual(422, oversized.status_code)
        self.assertEqual(404, self.admin.get("/static/branding/not-a-hash.svg").status_code)

    def test_upload_requires_write_permission(self):
        response = self.readonly.post(
            "/api/system/branding-config/assets/logo",
            files={"file": ("logo.svg", b"<svg/>", "image/svg+xml")},
        )
        self.assertEqual(403, response.status_code)
        self.assertFalse(self.uploads.exists())


if __name__ == "__main__":
    unittest.main()
