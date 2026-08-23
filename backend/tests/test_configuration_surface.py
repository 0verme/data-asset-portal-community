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
        ):
            self.assertNotIn(removed, template)
        self.assertIn("APP_SECRET_KEY", template)
        self.assertIn("ASSET_DB_PROFILE", template)

    def test_advanced_document_preserves_database_and_runtime_contracts(self):
        documentation = (ROOT / "docs/configuration.md").read_text(encoding="utf-8")
        for value in (
            "ASSET_DB_JDBC_URL",
            "ASSET_DB_JAR_PATH",
            "TEST_DATABASE_PROFILE",
            "database.example.yaml",
            "database.community.yaml",
            "APP_*",
        ):
            self.assertIn(value, documentation)


if __name__ == "__main__":
    unittest.main()
