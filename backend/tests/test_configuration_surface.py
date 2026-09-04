from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]


class ConfigurationSurfaceTests(unittest.TestCase):
    def test_deployment_template_contains_core_only(self):
        template = (ROOT / "backend/.env.example").read_text(encoding="utf-8")
        for removed in (
            "ASSET_ADMIN_USER",
            "ASSET_ADMIN_PASSWORD",
            "ASSET_ADMIN_DISPLAY_NAME",
            "TEST_DATABASE_PROFILE",
            "FLASK_SECRET_KEY",
            "FLASK_ENV",
            "FLASK_DEBUG",
            "FLASK_CORS_ORIGINS",
            "FLASK_MAX_CONTENT_LENGTH_MB",
        ):
            self.assertNotIn(removed, template)
        self.assertIn("APP_SECRET_KEY", template)
        self.assertIn("ASSET_DB_PROFILE", template)
        # Relative cwd-dependent path must not be the active default assignment.
        self.assertNotRegex(template, r"(?m)^ASSET_DB_CONFIG_PATH=backend/")
        self.assertIn("ASSET_AUTH_DB_PROFILE", template)

    def test_advanced_document_preserves_database_and_runtime_contracts(self):
        documentation = (ROOT / "docs/configuration.md").read_text(encoding="utf-8")
        for value in (
            "ASSET_DB_JDBC_URL",
            "ASSET_DB_JAR_PATH",
            "TEST_DATABASE_PROFILE",
            "database.example.yaml",
            "database.community.yaml",
            "APP_*",
            "ASSET_AUTH_DB_PROFILE",
            "FLASK_SECRET_KEY",
            "HMAC-SHA256",
        ):
            self.assertIn(value, documentation)

    def test_mock_credentials_remain_discoverable_and_aligned(self):
        auth_ts = (ROOT / "frontend/src/auth.ts").read_text(encoding="utf-8")
        frontend_env = (ROOT / "frontend/.env.example").read_text(encoding="utf-8")
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("community-demo-password", auth_ts)
        self.assertNotIn("admin123", auth_ts)
        self.assertIn("community-demo-password", frontend_env)
        self.assertNotIn("admin123", frontend_env)
        self.assertIn("community-demo-password", readme)
        self.assertNotIn("the demo credentials configured by the mock demo", readme)


if __name__ == "__main__":
    unittest.main()
