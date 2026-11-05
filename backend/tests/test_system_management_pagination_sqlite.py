from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.dialects import sqlite

from backend.app.application import Identity
from backend.app.authorization.core import AuthorizationService, AuthorizationSubject
from backend.app.authorization.persistence import seed_rbac
from backend.app.db.sqlite_adapter import connect
from backend.app.fastapi_app import create_fastapi_app
from backend.app.migrations.schema import initialize
from backend.app.services.system_management_service import SystemManagementService


class SystemManagementPaginationSqliteTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="system-management-pagination-")
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        self.database = root / "system.sqlite"
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
                "ASSET_AUTH_DB_PROFILE": "primary",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)

        config = {"type": "sqlite", "database": str(self.database)}
        self.connection = connect(config)
        self.addCleanup(self.connection.close)
        self.assertTrue(initialize(self.connection, config, "sqlite"))
        seed_rbac(self.connection, config)
        stamp = datetime(2026, 11, 4, 12, 0, 0).strftime("%Y-%m-%d %H:%M:%S")
        for index in range(1, 24):
            created_at = datetime(2026, 11, 1 + (index % 27), 12, 0, 0).strftime("%Y-%m-%d %H:%M:%S")
            self.connection.execute(
                "INSERT INTO dwp.p_admin_user "
                "(id, username, password_hash, display_name, status, role, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    index,
                    f"fixture-user-{index:02d}",
                    "synthetic-hash",
                    "Tail User" if index == 23 else f"User {index:02d}",
                    "ACTIVE" if index % 2 else "DISABLED",
                    "admin" if index % 2 else "maintainer",
                    created_at,
                ),
            )
        for index in range(1, 22):
            self.connection.execute(
                "INSERT INTO dwp.p_role "
                "(role_code, name, description, builtin, enabled, created_at, updated_at) "
                "VALUES (?, ?, ?, 'N', 'Y', ?, ?)",
                (
                    f"fixture-role-{index:02d}",
                    "Tail Role" if index == 21 else f"Fixture Role {index:02d}",
                    f"Description {index:02d}",
                    stamp,
                    stamp,
                ),
            )
        for index in range(1, 24):
            self.connection.execute(
                "INSERT INTO dwp.p_menu "
                "(menu_id, menu_code, menu_name, menu_icon, menu_path, display_order, nav_placement, "
                "admin_only, is_active, menu_desc, created_by, updated_by) "
                "VALUES (?, ?, ?, 'grid', ?, ?, 'more', 'N', ?, ?, 'fixture', 'fixture')",
                (
                    index,
                    f"fixture-menu-{index:02d}",
                    "Tail Menu" if index == 23 else f"Fixture Menu {index:02d}",
                    f"/fixture/{index:02d}",
                    index * 10,
                    "Y" if index % 2 else "N",
                    f"Synthetic menu {index:02d}",
                ),
            )
        self.connection.execute(
            "INSERT INTO dwp.p_code_category "
            "(category_id, category_code, category_name, category_desc, display_order, is_active, created_by, updated_by) "
            "VALUES (9001, 'PAGING_FIXTURE', 'Pagination Fixture', 'Synthetic only', 9001, 'Y', 'fixture', 'fixture')"
        )
        for index in range(1, 24):
            self.connection.execute(
                "INSERT INTO dwp.p_code_item "
                "(item_id, category_code, item_code, item_name, item_value, item_desc, display_order, is_active, created_by, updated_by) "
                "VALUES (?, 'PAGING_FIXTURE', ?, ?, ?, ?, ?, ?, 'fixture', 'fixture')",
                (
                    9100 + index,
                    f"ITEM_{index:02d}",
                    "Tail Parameter" if index == 23 else f"Parameter {index:02d}",
                    f"value-{index:02d}",
                    f"Synthetic parameter {index:02d}",
                    index * 10,
                    "Y" if index % 2 else "N",
                ),
            )
        self.connection.commit()

        self.service = SystemManagementService()
        repository = MagicMock()
        repository.get_subject.return_value = AuthorizationSubject("fixture-admin", "admin")
        repository.get_permissions.return_value = {
            "system:user:read", "system:role:read", "system:menu:read", "system:param:read",
        }
        authorization = AuthorizationService(repository)
        self.client = TestClient(
            create_fastapi_app(
                identity_resolver=lambda _request: Identity("fixture-admin", "admin", "Fixture Admin"),
                authorization_service_instance=authorization,
                system_management_service_instance=self.service,
            )
        )
        self.statements = []
        fetch_rows = self.service._core_fetch

        def capture(statement):
            self.statements.append(statement)
            return fetch_rows(statement)

        self.service._core_fetch = capture

    def _assert_page_sql(self, start_index: int):
        statements = self.statements[start_index:]
        compiled = [str(statement.compile(dialect=sqlite.dialect())).upper() for statement in statements]
        self.assertTrue(any(" LIMIT " in sql and " OFFSET " in sql for sql in compiled), compiled)
        self.assertTrue(any("COUNT" in sql for sql in compiled), compiled)

    def test_user_pages_filter_count_and_preserve_legacy_full_list(self):
        users = self.service.get_users_page(page=2, page_size=10)
        self.assertEqual((23, 2, 10), (users["total"], users["page"], users["pageSize"]))
        self.assertEqual(10, len(users["items"]))
        self._assert_page_sql(0)
        self.assertEqual(23, len(self.service.get_users()))
        tail = self.service.get_users_page(keyword="Tail User", page=1, page_size=10)
        self.assertEqual((1, "fixture-user-23"), (tail["total"], tail["items"][0]["username"]))
        enabled = self.service.get_users_page(keyword="启用", page=1, page_size=20)
        self.assertEqual(12, enabled["total"])
        maintainers = self.service.get_users_page(keyword="业务维护员", page=1, page_size=20)
        self.assertEqual(11, maintainers["total"])

    def test_role_pages_batch_user_and_permission_projections(self):
        start = len(self.statements)
        roles = self.service.get_roles_page(page=2, page_size=10)
        self.assertEqual((23, 2, 10), (roles["total"], roles["page"], roles["pageSize"]))
        self.assertEqual(10, len(roles["items"]))
        self.assertTrue(all("userCount" in item and "permissionCodes" in item for item in roles["items"]))
        self.assertEqual(4, len(self.statements) - start)  # count + page + batched user counts + permissions
        self._assert_page_sql(start)
        tail = self.service.get_roles_page(keyword="Tail Role", page=1, page_size=10)
        self.assertEqual((1, "fixture-role-21"), (tail["total"], tail["items"][0]["roleCode"]))
        self.assertEqual(23, len(self.service.get_roles()))

    def test_menu_pages_do_not_replace_full_navigation_collection(self):
        start = len(self.statements)
        menus = self.service.get_menus_page(page=2, page_size=10)
        self.assertEqual((23, 2, 10), (menus["total"], menus["page"], menus["pageSize"]))
        self.assertEqual(10, len(menus["items"]))
        self._assert_page_sql(start)
        tail = self.service.get_menus_page(keyword="Tail Menu", page=1, page_size=10)
        self.assertEqual((1, "fixture-menu-23"), (tail["total"], tail["items"][0]["code"]))
        self.assertEqual(23, len(self.service.get_menus()))

    def test_parameter_item_pages_keep_category_and_legacy_options_complete(self):
        start = len(self.statements)
        items = self.service.get_param_dicts_page(category_code="PAGING_FIXTURE", page=2, page_size=10)
        self.assertEqual((23, 2, 10), (items["total"], items["page"], items["pageSize"]))
        self.assertEqual(10, len(items["items"]))
        self._assert_page_sql(start)
        tail = self.service.get_param_dicts_page(
            category_code="PAGING_FIXTURE", keyword="Tail Parameter", page=1, page_size=10
        )
        self.assertEqual((1, "ITEM_23"), (tail["total"], tail["items"][0]["code"]))
        self.assertEqual(23, len(self.service.get_param_dicts("PAGING_FIXTURE")))
        reserved = self.service.get_param_dicts_page(category_code="RAG_SEARCH_CONFIG", page=1, page_size=10)
        self.assertEqual((0, []), (reserved["total"], reserved["items"]))

    def test_authenticated_routes_return_explicit_page_envelopes(self):
        cases = (
            ("/api/system/users/page?page=2&pageSize=10", 23, 10),
            ("/api/system/roles/page?page=2&pageSize=10", 23, 10),
            ("/api/system/menus/page?page=2&pageSize=10", 23, 10),
            ("/api/system/param-dicts/page?categoryCode=PAGING_FIXTURE&page=2&pageSize=10", 23, 10),
        )
        for path, total, page_size in cases:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(200, response.status_code, response.text)
                payload = response.json()
                self.assertEqual((total, 2, page_size), (payload["total"], payload["page"], payload["pageSize"]))
                self.assertEqual(10, len(payload["items"]))


if __name__ == "__main__":
    unittest.main()
