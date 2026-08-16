import unittest
from unittest.mock import patch

from backend.app import create_app
from backend.app.services.system_management_service import SystemManagementService, SystemValidationError


class UserStatusServiceTests(unittest.TestCase):
    def setUp(self):
        self.service = SystemManagementService()

    def test_locked_payload_is_rejected(self):
        with self.assertRaises(SystemValidationError):
            self.service._normalize_user_payload({
                "username": "locked_user",
                "displayName": "Locked user",
                "status": "locked",
            })

    def test_legacy_locked_database_status_reads_as_disabled(self):
        self.assertEqual(self.service._db_status_to_user_status("LOCKED"), "disabled")
        self.assertEqual(self.service._user_status_to_db_status("disabled"), "DISABLED")



class UserStatusRouteTests(unittest.TestCase):
    def test_no_dedicated_lock_or_unlock_route_is_registered(self):
        with patch.dict("os.environ", {"FLASK_SECRET_KEY": "test-secret-key"}):
            routes = {rule.rule for rule in create_app().url_map.iter_rules()}
        self.assertNotIn("/api/system/users/<username>/lock", routes)
        self.assertNotIn("/api/system/users/<username>/unlock", routes)
