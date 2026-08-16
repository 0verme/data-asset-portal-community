import unittest
from unittest.mock import patch

from flask import Flask

from backend.app.auth import SESSION_KEY
from backend.app.routes.system_management import system_management_bp


MENU_ITEMS = [
    {
        "id": "1",
        "code": "upstream",
        "name": "Upstream",
        "status": "enabled",
        "adminOnly": False,
    },
    {
        "id": "2",
        "code": "disabled-business",
        "name": "Disabled business",
        "status": "disabled",
        "adminOnly": False,
    },
    {
        "id": "3",
        "code": "system",
        "name": "System",
        "status": "enabled",
        "adminOnly": True,
    },
    {
        "id": "4",
        "code": "disabled-admin",
        "name": "Disabled admin",
        "status": "disabled",
        "adminOnly": True,
    },
]


class SystemMenuAccessTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.config.update(TESTING=True, SECRET_KEY="test-only-menu-access-secret")
        app.register_blueprint(system_management_bp, url_prefix="/api/system")
        self.client = app.test_client()

    def _login_as(self, role):
        with self.client.session_transaction() as session:
            session[SESSION_KEY] = {"role": role, "user": role, "name": role.title()}

    def _get_menus(self):
        with patch(
            "backend.app.routes.system_management.system_management_service.get_menus",
            return_value=MENU_ITEMS,
        ):
            return self.client.get("/api/system/menus")

    def test_anonymous_menu_request_returns_only_enabled_public_menus(self):
        response = self._get_menus()

        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["code"] for item in response.get_json()["items"]], ["upstream"])

    def test_admin_menu_request_returns_complete_menu_list(self):
        self._login_as("admin")

        response = self._get_menus()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["items"], MENU_ITEMS)

    def test_maintainer_keeps_enabled_business_and_operation_log_entry(self):
        self._login_as("maintainer")

        response = self._get_menus()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item["code"] for item in response.get_json()["items"]],
            ["upstream", "system"],
        )

    def test_menu_writes_reject_anonymous_and_maintainer(self):
        requests = (
            ("post", "/api/system/menus"),
            ("put", "/api/system/menus/1"),
            ("patch", "/api/system/menus/1/status"),
            ("patch", "/api/system/menus/1/move"),
            ("delete", "/api/system/menus/1"),
        )

        for method, path in requests:
            with self.subTest(role="anonymous", method=method, path=path):
                response = getattr(self.client, method)(path, json={})
                self.assertEqual(response.status_code, 401)

        self._login_as("maintainer")
        for method, path in requests:
            with self.subTest(role="maintainer", method=method, path=path):
                response = getattr(self.client, method)(path, json={})
                self.assertEqual(response.status_code, 403)
